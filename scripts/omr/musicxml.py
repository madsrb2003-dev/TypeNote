"""Bounded, non-extracting inspection of recognition output, not accuracy scoring."""

from pathlib import Path, PurePosixPath
import re
import xml.etree.ElementTree as ET
import zipfile

MAX_XML_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 2048


def parse_xml(data: bytes) -> ET.Element:
    if len(data) > MAX_XML_BYTES:
        raise ValueError("XML exceeds the 32 MiB inspection limit")
    # Standard MusicXML external DOCTYPE declarations are allowed. ElementTree
    # does not fetch them. Internal subsets/entities are unnecessary here.
    normalized = data.replace(b"\x00", b"")
    if re.search(br"<!ENTITY\b|<!DOCTYPE[^>]*\[", normalized, re.IGNORECASE):
        raise ValueError("XML internal subsets and entity declarations are unsupported")
    try:
        return ET.fromstring(data)
    except ET.ParseError as error:
        raise ValueError(f"Invalid XML: {error}") from error


def safe_member(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and ".." not in path.parts and "\\" not in name


def musicxml_bytes(path: Path) -> bytes:
    if path.suffix.lower() != ".mxl":
        if path.stat().st_size > MAX_XML_BYTES:
            raise ValueError("XML exceeds the 32 MiB inspection limit")
        return path.read_bytes()
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("MXL archive exceeds the 256 MiB inspection limit")
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise ValueError("MXL archive contains too many entries")
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)) or not all(map(safe_member, names)):
                raise ValueError("MXL archive contains duplicate or unsafe paths")
            if sum(entry.file_size for entry in entries) > MAX_ARCHIVE_BYTES:
                raise ValueError("MXL uncompressed data exceeds the 256 MiB limit")

            def read_member(name: str) -> bytes:
                if not safe_member(name):
                    raise ValueError("MXL rootfile has an unsafe path")
                info = archive.getinfo(name)
                if info.file_size > MAX_XML_BYTES:
                    raise ValueError("MXL XML entry exceeds the 32 MiB limit")
                if info.flag_bits & 1:
                    raise ValueError("Encrypted MXL entries are unsupported")
                return archive.read(info)

            container = parse_xml(read_member("META-INF/container.xml"))
            roots = [element for element in container.iter()
                     if element.tag.split("}")[-1] == "rootfile"]
            preferred = [element for element in roots if element.get("media-type") ==
                         "application/vnd.recordare.musicxml+xml"]
            candidates = preferred or roots
            if not candidates or not candidates[0].get("full-path"):
                raise ValueError("MXL container has no MusicXML rootfile")
            return read_member(candidates[0].attrib["full-path"])
    except (zipfile.BadZipFile, KeyError, RuntimeError, NotImplementedError) as error:
        raise ValueError(f"Unreadable MXL archive: {error}") from error


def inspect_musicxml(data: bytes) -> dict:
    root = parse_xml(data)
    kind = root.tag.split("}")[-1]
    if kind not in ("score-partwise", "score-timewise"):
        raise ValueError(f"Expected MusicXML score, found {kind}")
    names = [element.tag.split("}")[-1] for element in root.iter()]
    return {
        "root": kind,
        "version": root.get("version"),
        "counts": {name: names.count(name) for name in (
            "part", "measure", "note", "rest", "pitch", "chord", "direction",
            "notations", "tie", "slur", "tuplet", "accidental", "fingering")},
        "typenote_import_within_known_limits": kind == "score-partwise" and len(data) <= 10 * 1024 * 1024,
        "validation": "XML syntax/root and counts only; not schema, musical correctness or accuracy",
    }
