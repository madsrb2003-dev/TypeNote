"""Read-only checks on retained provider projects; never rewrite musical content."""
from collections import Counter
from pathlib import Path
import zipfile

from musicxml import MAX_XML_BYTES, parse_xml


def staff_diagnostics(raw: Path) -> list[str]:
    diagnostics = []
    for path in sorted(raw.rglob('*.omr'))[:100]:
        if not path.resolve().is_relative_to(raw.resolve()):
            continue
        try:
            with zipfile.ZipFile(path) as archive:
                entry = archive.getinfo('book.xml')
                if entry.file_size > MAX_XML_BYTES:
                    raise ValueError('Project metadata too large')
                book = parse_xml(archive.read(entry))
            systems = []
            for sheet in book.findall('sheet'):
                for page in sheet.findall('page'):
                    for number, system in enumerate(page.findall('system'), 1):
                        count = len(system.findall('part/staff-configuration'))
                        if count:
                            systems.append((sheet.get('number', '?'), number, count))
            if not systems:
                continue
            usual, frequency = Counter(count for _, _, count in systems).most_common(1)[0]
            # A change can be intentional (e.g. a condensed system). Report the
            # evidence, never invent a missing staff, clef or part assignment.
            if frequency < 2:
                continue
            for sheet, number, count in systems:
                if count < usual:
                    diagnostics.append(f'PDF page {sheet}, system {number}: recognized {count} staff/staves; '
                                       f'most systems have {usual}. Check for a missing staff and merged bars in the original PDF.')
                    if len(diagnostics) >= 10:
                        return diagnostics
        except (OSError, KeyError, ValueError, RuntimeError, zipfile.BadZipFile):
            diagnostics.append('Staff-layout checks could not read a retained recognition project; compare the score with the original PDF.')
    return diagnostics
