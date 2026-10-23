#!/usr/bin/env python3
"""One local PDF recognition job. Communicates only through atomic job files."""
import argparse
import json
import re
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'omr'))
from adapter import AudiverisAdapter, run_process
from musicxml import inspect_musicxml, musicxml_bytes
from run import pdf_metadata, write_json
from structure import staff_diagnostics

MAX_PAGES = 200


def page_numbers(value: str, count: int) -> list[int]:
    if not value.strip():
        return []
    pages = set()
    for token in value.split(','):
        match = re.fullmatch(r'\s*([1-9]\d*)(?:\s*-\s*([1-9]\d*))?\s*', token)
        if not match:
            raise ValueError('Use page numbers and ranges, for example 1,2,4-6')
        first, last = int(match[1]), int(match[2] or match[1])
        if first > last or last > count:
            raise ValueError(f'Page selection must be within 1–{count}, in ascending ranges')
        pages.update(range(first, last + 1))
    return sorted(pages)


def collect(raw: Path, job: Path) -> tuple[list[dict], list[str]]:
    outputs, diagnostics = [], []
    destination = job / 'musicxml'
    destination.mkdir(exist_ok=True)
    for path in sorted(raw.rglob('*')):
        if not path.is_file() or path.suffix.lower() not in ('.xml', '.musicxml', '.mxl'):
            continue
        if not path.resolve().is_relative_to(raw.resolve()):
            diagnostics.append('Ignored an output outside the recognition directory')
            continue
        try:
            data = musicxml_bytes(path)
            inspected = inspect_musicxml(data)
            index = str(len(outputs))
            filename = f'{index}.musicxml'
            (destination / filename).write_bytes(data)
            outputs.append({'id': index, 'name': path.stem + '.musicxml',
                            'noteCount': inspected['counts']['note'],
                            'file': 'musicxml/' + filename})
            if not inspected['typenote_import_within_known_limits']:
                diagnostics.append(f'Output {int(index) + 1} exceeds the editor import limits or uses score-timewise MusicXML')
            if len(outputs) >= 100:
                diagnostics.append('Output list limited to 100 scores; all provider files retained locally')
                break
        except (OSError, ValueError):
            diagnostics.append('A provider output could not be read as MusicXML; original output retained locally')
    return outputs, diagnostics


def provider_diagnostics(log: Path) -> list[str]:
    """Offer bounded, non-score diagnostics; full provider log is kept separately."""
    if not log.exists():
        return []
    warnings = errors = rhythm = 0
    with log.open('rb') as stream:
        for _ in range(16384):
            line = stream.readline(4096)
            if not line:
                break
            # Bound both memory and work; never include private OCR text or paths.
            lowered = line.lower()
            warnings += bool(re.search(rb'\bwarn(?:ing)?\b', lowered))
            errors += bool(re.search(rb'\berror\b|\bexception\b', lowered))
            rhythm += bool(re.search(rb'voice\{[^\n]*excess:|no correct rhythm', lowered))
    result = []
    if warnings:
        result.append(f'The recognition log contains {warnings} warning lines; inspect the local log and compare with the original PDF')
    if errors:
        result.append(f'The recognition log contains {errors} error/exception lines; some notation may be missing')
    if rhythm:
        result.append(f'The converter reported {rhythm} rhythm problems; check note lengths, rests and bar alignment against the PDF')
    return result


def execute(job: Path, executable: Path, pdfinfo: str, pages: str, timeout: float = 600) -> dict:
    result = json.loads((job / 'result.json').read_text())
    raw = job / 'raw'
    raw.mkdir(exist_ok=True)
    try:
        if (job / 'cancel.requested').exists():
            raise KeyboardInterrupt()
        metadata = pdf_metadata(job / 'original.pdf', pdfinfo)
        result['pages'] = metadata['pages']
        if result['pages'] > MAX_PAGES:
            raise ValueError('PDF exceeds the 200-page recognition limit; choose a smaller PDF')
        sheets = page_numbers(pages, result['pages'])
        result.update(status='recognizing', message='Recognizing notation locally. This may take several minutes.')
        write_json(job / 'result.json', result)
        # At 300 dpi the supplied Departure scan loses an entire upper staff
        # and its barlines. 400 dpi recovers the two-staff, 34-bar structure.
        # This changes image recognition, never pitch/staff labels in the XML.
        command = AudiverisAdapter(executable, pdf_resolution=400).command(job / 'original.pdf', raw, sheets)
        process = run_process(command, job / 'recognition.log', timeout)
        result['outputs'], diagnostics = collect(raw, job)
        result['diagnostics'].extend(diagnostics + staff_diagnostics(raw) + provider_diagnostics(job / 'recognition.log'))
        result['diagnostics'].append('Recognition can omit or misread notation. Compare the result with the original PDF before using it.')
        if process.status == 'cancelled' or (job / 'cancel.requested').exists():
            result.update(status='cancelled', message='Recognition cancelled. Original PDF and partial outputs retained locally.')
        elif process.status == 'timed_out':
            result.update(status='failed', message='Recognition timed out after 10 minutes. Try fewer pages.')
        elif process.exit_code != 0:
            result.update(status='failed', message='Recognition failed. Review the retained log; any partial scores are available below.')
        elif not result['outputs']:
            result.update(status='failed', message='Recognition produced no readable MusicXML. Try fewer pages or a clearer PDF.')
        else:
            result.update(status='completed', message='Recognition finished. Review the score for missing or incorrect notation.')
    except KeyboardInterrupt:
        result.update(status='cancelled', message='Recognition cancelled. Original PDF retained locally.')
    except ValueError as error:
        result.update(status='failed', message=str(error)[:500])
    except Exception:
        result.update(status='failed', message='Local recognition could not run. Check the local provider setup and recognition log.')
    write_json(job / 'result.json', result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True, type=Path)
    parser.add_argument('--audiveris', required=True, type=Path)
    parser.add_argument('--pdfinfo', required=True)
    parser.add_argument('--pages', default='')
    args = parser.parse_args()
    # run_process catches KeyboardInterrupt and terminates the provider's entire group.
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt()

    signal.signal(signal.SIGTERM, interrupt)
    execute(args.job, args.audiveris, args.pdfinfo, args.pages)


if __name__ == '__main__':
    main()
