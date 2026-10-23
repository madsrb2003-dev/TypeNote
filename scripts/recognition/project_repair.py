"""Conservative repair of empty, unreferenced provider glyph serialization.

The original OMR is never modified. A zero-repair result still writes a byte-exact
copy. This repairs project serialization only, not recognition or musical content.
"""
from collections import Counter
from pathlib import Path, PurePosixPath
import os
import re
import shutil
import stat
import tempfile
import zipfile
from urllib.parse import unquote
import xml.etree.ElementTree as ET

MAX_ENTRIES = 4000
MAX_MEMBER_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_XML_BYTES = 16 * 1024 * 1024
_SHEET = re.compile(r"sheet#([1-9][0-9]*)/sheet#\1\.xml\Z")
_TOKENS = re.compile(r"[\s,;]+")


def _safe_member(info: zipfile.ZipInfo) -> None:
    name = info.filename
    parts = PurePosixPath(name).parts
    if (not name or name.startswith('/') or '\\' in name or '\x00' in name
            or ':' in name or '..' in parts or '.' in name.split('/')
            or any(not p for p in name.rstrip('/').split('/'))):
        raise ValueError('Unsafe OMR archive member path')
    mode = info.external_attr >> 16
    if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
        raise ValueError('Unsupported OMR archive member type')
    if info.flag_bits & 1:
        raise ValueError('Encrypted OMR archive member')
    if info.file_size < 0 or info.file_size > MAX_MEMBER_BYTES:
        raise ValueError('OMR archive member exceeds size limit')


def _repair_sheet(data: bytes) -> tuple[bytes, int]:
    if len(data) > MAX_XML_BYTES:
        raise ValueError('OMR sheet XML exceeds size limit')
    if b'\x00' in data or re.search(br'<!\s*(?:DOCTYPE|ENTITY)\b', data, re.I):
        raise ValueError('Unsafe OMR sheet XML declaration')
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ValueError('Invalid OMR sheet XML') from exc
    parents = {child: parent for parent in root.iter() for child in parent}
    candidates = []
    glyph_ids = Counter(g.get('id') for g in root.iter('glyph'))
    for glyph in root.iter('glyph'):
        identifier = glyph.get('id', '')
        table = glyph.find('run-table')
        if (not identifier.isascii() or not identifier.isdecimal() or table is None
                or glyph_ids[identifier] != 1):
            continue
        # Only zero geometry with no encoded run data is provably empty. Empty
        # <runs/> placeholders are acceptable; any data/other children retain it.
        try:
            width, height = int(table.get('width', '-1')), int(table.get('height', '-1'))
        except ValueError:
            continue
        if width < 0 or height < 0 or (width != 0 and height != 0):
            continue
        if any(e.tag != 'runs' or e.attrib or list(e) or (e.text or '').strip() or (e.tail or '').strip()
               for e in table):
            continue
        if (table.text or '').strip():
            continue
        if len(list(glyph)) != 1 or (glyph.text or '').strip():
            continue
        candidates.append(glyph)
    def reference_tokens(elements):
        tokens = Counter()
        for element in elements:
            # Exact attribute/text tokens include unknown fields. Ambiguous
            # matches retain the glyph; IDs themselves are not references.
            values = [v for k, v in element.attrib.items() if k != 'id']
            values.extend([element.text or '', element.tail or ''])
            for value in values:
                for token in _TOKENS.split(value.strip()):
                    tokens[token] += 1
                    # XML ID references may use a URI fragment (including
                    # xlink:href). Retain exact decoded fragment IDs too.
                    if '#' in token:
                        fragment = unquote(token.partition('#')[2])
                        tokens[fragment] += 1
        return tokens

    references = reference_tokens(root.iter())
    removed = 0
    for glyph in candidates:
        identifier = glyph.get('id')
        own_references = reference_tokens(glyph.iter())
        if references[identifier] == own_references[identifier] and glyph in parents:
            parents[glyph].remove(glyph)
            removed += 1
    if not removed:
        return data, 0
    return ET.tostring(root, encoding='utf-8', xml_declaration=True), removed


def repair_empty_glyphs(source: Path, destination: Path) -> int:
    """Copy an OMR project, removing only provably empty unreferenced glyphs.

    Raises ValueError for unsafe/budget-exceeding projects, FileExistsError when
    destination exists, and ordinary I/O errors as appropriate. No partial
    destination is published on failure. Parent directory must already exist.
    """
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError('Source and destination must differ')
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(destination)
    changed: dict[str, bytes] = {}
    repaired = 0
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError('Too many OMR archive members')
        seen = set()
        total = 0
        for info in infos:
            _safe_member(info)
            if info.filename in seen:
                raise ValueError('Duplicate OMR archive member')
            seen.add(info.filename)
            total += info.file_size
            if total > MAX_TOTAL_BYTES:
                raise ValueError('OMR archive exceeds total size limit')
            # Read every entry to verify actual size and CRC before publishing.
            with archive.open(info) as member:
                data = member.read(MAX_MEMBER_BYTES + 1)
            if len(data) != info.file_size or len(data) > MAX_MEMBER_BYTES:
                raise ValueError('Invalid OMR archive member size')
            if _SHEET.fullmatch(info.filename):
                replacement, count = _repair_sheet(data)
                if count:
                    changed[info.filename] = replacement
                    repaired += count
        handle, temp_name = tempfile.mkstemp(prefix='.omr-repair-', dir=destination.parent)
        os.close(handle)
        temp_path = Path(temp_name)
        try:
            if repaired:
                with zipfile.ZipFile(temp_path, 'w') as output:
                    output.comment = archive.comment
                    for info in infos:
                        data = changed[info.filename] if info.filename in changed else archive.read(info)
                        output.writestr(info, data)
            else:
                shutil.copyfile(source, temp_path)
            os.link(temp_path, destination)  # Atomic, exclusive publication.
        finally:
            temp_path.unlink(missing_ok=True)
    return repaired
