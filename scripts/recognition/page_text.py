"""Preserve page-edge lettering as local PNG facsimiles in standard MusicXML credits.

Only disposable enrichment is added: the provider's notation and metadata remain
intact. Recognition must still succeed if this optional step cannot run.
"""
import base64
from dataclasses import dataclass
import math
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET
import zipfile

MAX_XML = 10 * 1024 * 1024
MAX_IMAGE = 2 * 1024 * 1024
MAX_IMAGES = 8 * 1024 * 1024
MAX_SHEET_XML = 32 * 1024 * 1024
MAX_PAGES = 200
MAX_SECONDS = 90
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
PREFIX = 'typenote-source-'
FAILURE = 'Original page lettering could not be preserved as images; compare the retained PDF for text and layout.'


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self):
        return self.x + self.width

    @property
    def bottom(self):
        return self.y + self.height

    def intersects(self, other):
        return self.x < other.right and other.x < self.right and self.y < other.bottom and other.y < self.bottom


@dataclass(frozen=True)
class PageGeometry:
    width: float
    height: float
    interline: float
    first_staff_top: float
    last_staff_bottom: float
    sentences: tuple[tuple[str, Box], ...]
    music: tuple[Box, ...]


def _number(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('Non-finite geometry')
    return number


def _box(element):
    bounds = element.find('bounds')
    if bounds is None:
        return None
    box = Box(*(_number(bounds.get(key, '0')) for key in ('x', 'y', 'w', 'h')))
    return box if box.width > 0 and box.height > 0 else None


def sheet_geometry(data: bytes) -> PageGeometry:
    """Read only recognized staff lines and symbol/text boxes; never OCR content."""
    if len(data) > MAX_SHEET_XML or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('Unsupported project XML')
    root = ET.fromstring(data)
    picture = root.find('picture')
    interline = root.find('scale/interline')
    if picture is None or interline is None:
        raise ValueError('No picture/staff scale')
    width, height = _number(picture.get('width')), _number(picture.get('height'))
    distance = _number(interline.get('main'))
    points = [_number(point.get('y')) for point in root.findall('./page/system/part/staff/lines/line/point')]
    if not points or not (0 < width <= 100000 and 0 < height <= 100000 and 1 <= distance <= 500):
        raise ValueError('Invalid picture/staff geometry')
    if min(points) < 0 or max(points) > height:
        raise ValueError('Staff outside page')
    sentences, music = [], []
    for system in root.findall('./page/system'):
        for element in system.iter():
            box = _box(element)
            if box is None:
                continue
            if not (0 <= box.x < box.right <= width + distance and 0 <= box.y < box.bottom <= height + distance):
                continue
            if element.tag == 'sentence':
                sentences.append((element.get('role', ''), box))
            elif element.tag != 'word' and element.get('shape') != 'TEXT':
                music.append(box)
    return PageGeometry(width, height, distance, min(points), max(points), tuple(sentences), tuple(music))


def page_regions(page: PageGeometry) -> list[tuple[str, Box]]:
    """Conservative page-edge bands and isolated first-system tempo/direction text."""
    distance = page.interline
    header_end = max(0, page.first_staff_top - 3 * distance)
    # Notes, octave markings, clefs or other recognized symbols can reach above
    # the staff. A source-text band must never duplicate those musical glyphs.
    for box in page.music:
        if box.y < page.first_staff_top:
            header_end = min(header_end, max(0, box.y - distance / 2))
    # Keep opening instructions separate even when wholly inside the header
    # band. Otherwise an already encoded tempo is printed twice: once in the
    # header image and once as editable notation.
    for role, box in page.sentences:
        if role in ('Direction', 'Metronome') and box.bottom <= page.first_staff_top:
            header_end = min(header_end, max(0, box.y - 2))
    # Never slice a sentence through its baseline, even if OCR assigned it an
    # incorrect role. A crossing direction can be preserved separately below.
    while True:
        crossing = [box.y for _, box in page.sentences if box.y < header_end < box.bottom]
        if not crossing:
            break
        header_end = max(0, min(crossing) - 2)
    footer_start = min(page.height, page.last_staff_bottom + 5 * distance)
    if page.music:
        footer_start = max(footer_start, max(box.bottom for box in page.music) + distance)
    footer_start = min(page.height, footer_start)
    # Include all of a crossing footer sentence when a musical safety gap remains.
    for _, box in page.sentences:
        if box.y < footer_start < box.bottom:
            safe = max([page.last_staff_bottom] + [b.bottom for b in page.music]) + distance
            if box.y - 2 >= safe:
                footer_start = min(footer_start, box.y - 2)
            else:
                footer_start = max(footer_start, box.bottom + 2)
    regions = []
    if header_end >= distance:
        regions.append(('header', Box(0, 0, page.width, header_end)))
    # A sparse final page can leave most of the page blank. Do not preserve
    # that blank area as an opaque footer image without detected footer text.
    footer_text = [box for _, box in page.sentences
                   if box.bottom > footer_start and box.y >= page.last_staff_bottom + distance]
    if footer_text:
        # Preserve the lettering, not the unused lower half of a short page.
        # An opaque blank band would unnecessarily displace editable systems.
        footer_start = max(footer_start, min(box.y for box in footer_text) - distance)
    if footer_text and page.height - footer_start >= distance:
        regions.append(('footer', Box(0, footer_start, page.width, page.height - footer_start)))
    for role, box in page.sentences:
        if role not in ('Direction', 'Metronome') or not (header_end <= box.y < box.bottom <= page.first_staff_top):
            continue
        padding = max(2, distance / 5)
        padded = Box(max(0, box.x - padding), max(header_end, box.y - padding),
                     min(page.width, box.right + padding) - max(0, box.x - padding),
                     min(page.first_staff_top, box.bottom + padding) - max(header_end, box.y - padding))
        if not any(padded.intersects(symbol) for symbol in page.music):
            regions.append(('direction', padded))
        if sum(kind == 'direction' for kind, _ in regions) >= 20:
            break
    return regions


def _read_member(archive, name, maximum):
    info = archive.getinfo(name)
    if info.is_dir() or info.file_size > maximum or info.flag_bits & 1:
        raise ValueError('Unsupported project member')
    with archive.open(info) as stream:
        data = stream.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError('Oversized project member')
    return data


def _project_pages(raw: Path, sheets: list[int]):
    projects = []
    for project in sorted(raw.rglob('*.omr')):
        if len(projects) >= 20:
            raise ValueError('Too many projects')
        if project.resolve().is_relative_to(raw.resolve()) and project.is_file():
            projects.append(project)
    matches = []
    for project in projects:
        with zipfile.ZipFile(project) as archive:
            if len(archive.infolist()) > 20000:
                raise ValueError('Too many project members')
            book_data = _read_member(archive, 'book.xml', 2 * 1024 * 1024)
            if b'<!DOCTYPE' in book_data.upper() or b'<!ENTITY' in book_data.upper():
                raise ValueError('Unsupported book XML')
            book = ET.fromstring(book_data)
            indexed = {int(sheet.get('number')): sheet for sheet in book.findall('sheet')}
            if not all(sheet in indexed for sheet in sheets):
                continue
            pages = []
            try:
                for number in sheets:
                    original_page = int(indexed[number].findtext('input/number', str(number)))
                    if not 1 <= original_page <= MAX_PAGES:
                        raise ValueError('Invalid PDF page')
                    geometry = sheet_geometry(_read_member(archive, f'sheet#{number}/sheet#{number}.xml', MAX_SHEET_XML))
                    pages.append((original_page, geometry))
            except KeyError:
                continue
            matches.append(pages)
    if len(matches) != 1:
        raise ValueError('No unambiguous provider geometry')
    return matches[0]


def _page_pixels(pdf: Path, page: int, pdfinfo: str, timeout=30) -> tuple[int, int]:
    result = subprocess.run([pdfinfo, '-f', str(page), '-l', str(page), '-box', str(pdf)],
                            capture_output=True, timeout=timeout, check=True)
    text = result.stdout[:65536].decode('utf8', errors='replace')
    match = re.search(r'(?:Page\s+\d+ size:|Page size:)\s*([\d.]+)\s+x\s+([\d.]+)\s+pts', text)
    if not match:
        raise ValueError('No PDF dimensions')
    width, height = (_number(value) for value in match.groups())
    rotation = re.search(r'(?:Page\s+\d+ rot:|Page rot:)\s*(\d+)', text)
    if rotation and int(rotation[1]) % 180:
        width, height = height, width
    pixels = math.ceil(width * 150 / 72), math.ceil(height * 150 / 72)
    if not all(1 <= value <= 30000 for value in pixels):
        raise ValueError('Invalid PDF dimensions')
    return pixels


def png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 33 or data[:8] != PNG_SIGNATURE or data[12:16] != b'IHDR':
        raise ValueError('Invalid cropped image')
    width, height = struct.unpack('>II', data[16:24])
    if not 0 < width <= 30000 or not 0 < height <= 30000:
        raise ValueError('Invalid image dimensions')
    return width, height


def _crop(pdf, number, geometry, box, pixels, pdftoppm, destination, timeout=30, prepared_pages=None):
    sx, sy = pixels[0] / geometry.width, pixels[1] / geometry.height
    x, y = max(0, math.floor(box.x * sx)), max(0, math.floor(box.y * sy))
    right, bottom = min(pixels[0], math.ceil(box.right * sx)), min(pixels[1], math.ceil(box.bottom * sy))
    width, height = right - x, bottom - y
    if width <= 0 or height <= 0:
        raise ValueError('Empty crop')
    output = destination.with_suffix('.png')
    if prepared_pages is None:
        subprocess.run([pdftoppm, '-f', str(number), '-singlefile', '-r', '150',
                        '-x', str(x), '-y', str(y), '-W', str(width), '-H', str(height),
                        '-png', str(pdf), str(destination)], capture_output=True, timeout=timeout, check=True)
    else:
        # Provider coordinates refer to the straightened image. Cropping the
        # unchanged PDF at these coordinates could duplicate or clip notation.
        from PIL import Image
        image_path = prepared_pages / f'page-{number}.png'
        if not image_path.resolve().is_relative_to(prepared_pages.resolve()):
            raise ValueError('Prepared image outside retained page directory')
        with Image.open(image_path) as image:
            if image.size != (round(geometry.width), round(geometry.height)):
                raise ValueError('Prepared image dimensions do not match provider geometry')
            image.resize(pixels, Image.Resampling.LANCZOS).crop((x, y, right, bottom)).save(output)

    if output.stat().st_size > MAX_IMAGE:
        raise ValueError('Page lettering image exceeds size limit')
    data = output.read_bytes()
    if png_dimensions(data) != (width, height):
        raise ValueError('Crop geometry does not match PDF')
    # Use the actual rounded crop rectangle for exact page positioning.
    return data, Box(x / sx, y / sy, width / sx, height / sy)


def preserve_page_text(data: bytes, raw: Path, original_pdf: Path, timeout: float = MAX_SECONDS, prepared_pages: Path | None = None) -> tuple[bytes, list[str]]:
    """Best-effort, bounded local facsimiles; never prevent a recognized score opening."""
    try:
        deadline = time.monotonic() + min(MAX_SECONDS, timeout)
        def remaining():
            seconds = deadline - time.monotonic()
            if seconds <= 0:
                raise ValueError('Page lettering preservation timed out')
            return min(30, seconds)

        if len(data) > MAX_XML or b'<!ENTITY' in data.upper():
            raise ValueError('Oversized or unsupported MusicXML')
        # MusicXML commonly has a public external DOCTYPE. ElementTree does not
        # retrieve it; internal subsets/entities are refused above.
        root = ET.fromstring(data)
        if root.tag != 'score-partwise':
            raise ValueError('Unsupported MusicXML document')
        if any(credit.findtext('credit-type', '').startswith(PREFIX) for credit in root.findall('credit')):
            return data, []
        layout = root.find('defaults/page-layout')
        if layout is None:
            raise ValueError('No source page layout')
        page_width, page_height = _number(layout.findtext('page-width')), _number(layout.findtext('page-height'))
        if not (0 < page_width <= 60000 and 0 < page_height <= 60000):
            raise ValueError('Invalid page layout')
        sheets = []
        for field in root.findall('identification/miscellaneous/miscellaneous-field'):
            match = re.fullmatch(r'source-sheet-([1-9]\d*)', field.get('name', ''))
            if match:
                number = int(match[1])
                if number in sheets or number > MAX_PAGES:
                    raise ValueError('Invalid source pages')
                sheets.append(number)
        if not sheets or len(sheets) > MAX_PAGES:
            raise ValueError('No source pages')
        part = root.find('part')
        if part is None or 1 + len(part.findall('./measure/print[@new-page="yes"]')) != len(sheets):
            raise ValueError('Source page mapping does not match output pages')
        pdftoppm, pdfinfo = shutil.which('pdftoppm'), shutil.which('pdfinfo')
        if prepared_pages is None and (not pdftoppm or not pdfinfo):
            raise ValueError('Local PDF tools unavailable')
        pages = _project_pages(raw, sheets)
        credits, total = [], 0
        with tempfile.TemporaryDirectory(prefix='typenote-page-text-') as temporary:
            for output_page, (original_page, geometry) in enumerate(pages, 1):
                pixels = ((math.ceil(geometry.width * 150 / 400), math.ceil(geometry.height * 150 / 400))
                          if prepared_pages is not None else _page_pixels(original_pdf, original_page, pdfinfo, remaining()))
                starts = [m for i, m in enumerate(part.findall('measure'))
                          if i == 0 or m.find('print[@new-page="yes"]') is not None]
                first_measure = starts[output_page - 1]
                represented_direction = first_measure.find('.//direction-type/words') is not None or first_measure.find('.//direction-type/metronome') is not None
                for kind, box in page_regions(geometry):
                    # Keep already recognized opening directions editable. Do
                    # not draw a facsimile on top of the same engraved marking.
                    if kind == 'direction' and represented_direction:
                        continue
                    image, actual = _crop(original_pdf, original_page, geometry, box, pixels, pdftoppm,
                                          Path(temporary) / f'crop-{len(credits)}', remaining(), prepared_pages=prepared_pages)
                    total += len(image)
                    if total > MAX_IMAGES or len(credits) >= 600:
                        raise ValueError('Page lettering exceeds image budget')
                    credit = ET.Element('credit', {'page': str(output_page)})
                    ET.SubElement(credit, 'credit-type').text = PREFIX + kind
                    attrs = {'source': 'data:image/png;base64,' + base64.b64encode(image).decode('ascii'),
                             'type': 'image/png', 'halign': 'left', 'valign': 'bottom',
                             'default-x': f'{actual.x / geometry.width * page_width:.4f}',
                             'default-y': f'{(geometry.height - actual.bottom) / geometry.height * page_height:.4f}',
                             'width': f'{actual.width / geometry.width * page_width:.4f}',
                             'height': f'{actual.height / geometry.height * page_height:.4f}'}
                    ET.SubElement(credit, 'credit-image', attrs)
                    credits.append(credit)
        if not credits:
            raise ValueError('No safely separable page lettering')
        # Insert credits before part-list, the position required by MusicXML.
        index = list(root).index(root.find('part-list'))
        for offset, credit in enumerate(credits):
            root.insert(index + offset, credit)
        enriched = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        if len(enriched) > MAX_XML:
            raise ValueError('Enriched score exceeds editor file limit')
        if len(json.dumps({'version': 4, 'kind': 'musicxml', 'xml': enriched.decode('utf-8')}, ensure_ascii=False).encode('utf-8')) > MAX_XML - 2048:
            raise ValueError('Enriched score exceeds editable JSON file limit')
        return enriched, ['Preserved original page-edge lettering as images. Text within the notation may still need correction.']
    except Exception:
        # Optional provider enrichment must not turn usable recognized notation
        # into a failed recognition job, including corrupt ZIP/PNG/tool failures.
        # Cancellation signals (BaseException) still propagate to the worker.
        return data, [FAILURE]
