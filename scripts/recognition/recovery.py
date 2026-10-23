"""Bounded retries for specific provider failures, retaining every original file."""
from pathlib import Path
import shutil
import zipfile

from adapter import AudiverisAdapter, ProcessResult, run_process
from musicxml import parse_xml
from project_repair import repair_empty_glyphs


def completed_pages(project: Path) -> set[int]:
    with zipfile.ZipFile(project) as archive:
        member = archive.getinfo('book.xml')
        if member.file_size > 2 * 1024 * 1024:
            raise ValueError('Project metadata exceeds limit')
        book = parse_xml(archive.read(member))
    return {int(sheet.findtext('input/number', sheet.get('number', '0')))
            for sheet in book.findall('sheet') if 'PAGE' in sheet.findtext('steps', '').split()}


def recover_project(job: Path, raw: Path, executable: Path, process: ProcessResult,
                    mode: str, pages: list[int], timeout: float) -> tuple[ProcessResult, Path, list[str]]:
    """Retry only known faults; no successful/partial source is overwritten.

    A recovered job is complete only if every requested source sheet reached PAGE.
    A missing musical page is never treated as a cover or silently dropped.
    """
    if process.status in ('cancelled', 'timed_out') or timeout <= 1 or (job / 'cancel.requested').exists():
        return process, raw, []
    if process.status == 'completed' and process.exit_code == 0:
        return process, raw, []
    log = job / 'recognition.log'
    try:
        with log.open('rb') as stream:
            evidence = stream.read(16 * 1024 * 1024)
    except OSError:
        return process, raw, []
    serialization = b'RunTable.afterUnmarshal' in evidence
    courtesy = mode == 'piano-scan' and b'MeasuresBuilder.emptyCourtesyMeasure' in evidence
    if not serialization and not courtesy:
        return process, raw, []
    projects = [p for p in raw.glob('*.omr') if p.resolve().is_relative_to(raw.resolve())]
    if len(projects) != 1:
        return process, raw, ['A provider recovery could not safely identify a single project; original and partial files are retained.']
    destination = job / 'recovery' / ('serialization' if serialization else 'measure-build')
    copied = destination / 'source.omr'
    diagnostics = []
    try:
        destination.mkdir(parents=True, exist_ok=False)
        removed = repair_empty_glyphs(projects[0], copied)
        if serialization and not removed:
            return process, raw, ['The provider project could not be repaired without changing referenced content; original and partial files are retained.']
        if removed:
            diagnostics.append('Recovered a provider project-loading failure by removing unreferenced zero-pixel glyph records from a copy. No recognized musical object was removed.')
        command = AudiverisAdapter(executable, pdf_resolution=400, profile=mode).command(copied, destination, pages)
        if courtesy:
            index = command.index('--')
            command[index:index] = ['-constant', 'org.audiveris.omr.sheet.rhythm.MeasuresBuilder.minStandardWidth=0']
            diagnostics.append('Retried a measure-construction failure while retaining courtesy material. Review final bars and markings against the original.')
        retry_log = destination / 'recognition.log'
        retried = run_process(command, retry_log, timeout)
        # The download log contains the full chain; each original attempt also
        # remains independently available in its own directory.
        with log.open('ab') as target, retry_log.open('rb') as source:
            target.write(b'\n--- Local provider recovery attempt ---\n')
            shutil.copyfileobj(source, target)
        if retried.status == 'completed' and retried.exit_code == 0:
            if not set(pages).issubset(completed_pages(copied)):
                diagnostics.append('Recovery did not complete every requested page. Available results remain partial.')
                retried = ProcessResult(1, retried.elapsed_seconds, 'failed')
        return retried, destination, diagnostics
    except (OSError, ValueError, KeyError, RuntimeError, zipfile.BadZipFile):
        return process, raw, ['The optional provider recovery could not run safely; original and partial files are retained.']
