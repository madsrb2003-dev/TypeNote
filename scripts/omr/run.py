#!/usr/bin/env python3
"""Run a local PDF corpus through an explicitly supplied recognition provider."""

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

from adapter import AudiverisAdapter, RecognitionAdapter, run_process
from musicxml import inspect_musicxml, musicxml_bytes

MAX_PDF_BYTES = 100 * 1024 * 1024


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pdf_metadata(path: Path, pdfinfo: str) -> dict:
    try:
        result = subprocess.run([pdfinfo, str(path)], capture_output=True, text=True,
                                errors="replace", timeout=30)
    except subprocess.TimeoutExpired as error:
        raise ValueError("PDF inspection timed out after 30 seconds") from error
    diagnostic = result.stderr.strip()
    fields = dict(line.split(":", 1) for line in result.stdout.splitlines() if ":" in line)
    if fields.get("Encrypted", "").strip().lower().startswith("yes") or "password" in diagnostic.lower():
        raise ValueError("Encrypted/password-protected PDFs are unsupported")
    if result.returncode:
        raise ValueError("Invalid or unreadable PDF: " + diagnostic[:2000])
    try:
        pages = int(fields.get("Pages", "0").strip())
    except ValueError as error:
        raise ValueError("PDF inspection returned an invalid page count") from error
    if pages < 1:
        raise ValueError("PDF has no readable pages")
    return {"pages": pages, "pdfinfo_diagnostics": diagnostic}


def collect_outputs(raw: Path, job: Path) -> tuple[list[dict], list[str]]:
    outputs, diagnostics = [], []
    candidates = sorted(path for path in raw.rglob("*")
                        if path.is_file() and path.suffix.lower() in (".mxl", ".xml", ".musicxml"))
    for index, path in enumerate(candidates, 1):
        entry = {"raw": str(path.relative_to(job))}
        try:
            data = musicxml_bytes(path)
            entry.update(inspect_musicxml(data))
            destination = job / "musicxml" / f"{index:03d}-{path.stem}.musicxml"
            destination.parent.mkdir(exist_ok=True)
            destination.write_bytes(data)
            entry["musicxml"] = str(destination.relative_to(job))
            entry["sha256"] = hashlib.sha256(data).hexdigest()
        except (ValueError, OSError) as error:
            entry["error"] = str(error)
            diagnostics.append(f"{path.name}: {error}")
        outputs.append(entry)
    return outputs, diagnostics


def evaluate(source: Path, job: Path, adapter: RecognitionAdapter, timeout: float,
             sheets: list[int], pdfinfo: str) -> dict:
    job.mkdir()
    raw = job / "raw"
    raw.mkdir()
    result = {"source_name": source.name, "source_path": str(source),
              "status": "preparing", "diagnostics": [], "outputs": [], "command": [],
              "pages": None, "exit_code": None, "elapsed_seconds": 0}
    try:
        result["source_bytes"] = source.stat().st_size
        result["source_sha256"] = fingerprint(source)
        if result["source_bytes"] > MAX_PDF_BYTES:
            raise ValueError("PDF exceeds the 100 MiB recognition limit; source retained at source_path")
        preserved = job / "original.pdf"
        shutil.copyfile(source, preserved)
        if fingerprint(preserved) != result["source_sha256"]:
            raise ValueError("Source changed while copying; recognition was not started")
        result["original_copy"] = "original.pdf"
        result.update(pdf_metadata(preserved, pdfinfo))
        if sheets and max(sheets) > result["pages"]:
            raise ValueError("Requested sheet number exceeds the PDF page count")
        command = adapter.command(preserved, raw, sheets)
        result["command"] = command
        result["requested_sheets"] = sheets or "all"
        write_json(job / "result.json", result)
        result.update(asdict(run_process(command, job / "recognition.log", timeout)))
        result["outputs"], output_diagnostics = collect_outputs(raw, job)
        result["diagnostics"].extend(output_diagnostics)
        result["has_musicxml"] = any("musicxml" in entry for entry in result["outputs"])
        if result["status"] == "completed" and not result["has_musicxml"]:
            result["status"] = "no_musicxml"
            result["diagnostics"].append("Provider exited successfully without inspectable MusicXML")
        result["raw_files"] = [str(path.relative_to(job)) for path in sorted(raw.rglob("*")) if path.is_file()]
        result["diagnostics"].append("Review recognition.log and the original PDF; output existence is not accuracy")
    except (ValueError, OSError) as error:
        result["status"] = "rejected" if not result["command"] else "failed"
        result["diagnostics"].append(str(error))
    except KeyboardInterrupt:
        result["status"] = "cancelled"
        result["diagnostics"].append("Interrupted during preparation or output inspection")
    write_json(job / "result.json", result)
    return result


def sheet_numbers(value: str) -> list[int]:
    try:
        values = sorted(set(int(number) for number in re.split(r"[, ]+", value.strip())))
        if not values or min(values) < 1:
            raise ValueError()
        return values
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use positive sheet numbers separated by commas, e.g. 1,2") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audiveris", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--timeout", type=float, default=600, help="Per-PDF recognition timeout in seconds")
    parser.add_argument("--sheets", type=sheet_numbers, default=[], help="Optional 1-based pages, e.g. 1 or 1,2")
    parser.add_argument("--version", default="unspecified", help="Provider version label supplied by the evaluator")
    args = parser.parse_args(argv)
    source_root, output = args.input.resolve(), args.output.resolve()
    executable = args.audiveris.resolve()
    if not source_root.is_dir():
        parser.error("--input must be an existing directory")
    if output == source_root or source_root in output.parents:
        parser.error("--output must be outside the input corpus")
    if output.exists():
        parser.error("--output must be a new directory; existing results are never overwritten")
    if not executable.is_file() or not os.access(executable, os.X_OK):
        parser.error("--audiveris must name an executable file")
    if not 0 < args.timeout < float("inf"):
        parser.error("--timeout must be a finite positive number")
    pdfinfo = shutil.which("pdfinfo")
    if not pdfinfo:
        parser.error("Poppler pdfinfo is required and was not found on PATH")
    sources = sorted(path for path in source_root.rglob("*") if path.is_file() and path.suffix.lower() == ".pdf")
    if not sources:
        parser.error("--input contains no PDF files")
    output.mkdir(parents=True)
    summary = {"schema_version": 1, "started_utc": datetime.now(timezone.utc).isoformat(),
               "provider": "Audiveris", "provider_version_label": args.version,
               "executable": str(executable), "executable_sha256": fingerprint(executable),
               "platform": platform.platform(), "python": platform.python_version(),
               "input": str(source_root), "timeout_seconds": args.timeout,
               "requested_sheets": args.sheets or "all", "total_sources": len(sources),
               "accuracy": "Not measured by this harness; compare each output with its preserved original",
               "jobs": []}
    write_json(output / "summary.json", summary)
    adapter = AudiverisAdapter(executable)
    for index, source in enumerate(sources, 1):
        name = re.sub(r"[^\w.-]+", "-", source.stem)[:70]
        job = output / f"{index:02d}-{name}"
        result = evaluate(source, job, adapter, args.timeout, args.sheets, pdfinfo)
        result["directory"] = job.name
        summary["jobs"].append(result)
        write_json(output / "summary.json", summary)
        if result["status"] == "cancelled":
            break
    summary["finished_utc"] = datetime.now(timezone.utc).isoformat()
    summary["processed_sources"] = len(summary["jobs"])
    summary["cancelled"] = any(job["status"] == "cancelled" for job in summary["jobs"])
    write_json(output / "summary.json", summary)
    print(f"Results: {output / 'summary.json'}")
    if summary["cancelled"]:
        return 130
    return 0 if all(job["status"] == "completed" for job in summary["jobs"]) else 1


if __name__ == "__main__":
    sys.exit(main())
