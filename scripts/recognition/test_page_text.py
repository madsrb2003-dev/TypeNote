"""Conservative page-text regions, bounded project reads and local crop calls."""
import base64
from dataclasses import replace
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile
from page_text import (Box, PNG_SIGNATURE,
                       FAILURE, page_regions, png_dimensions, preserve_page_text, sheet_geometry)

SCORE = b'''<score-partwise version="4.0"><identification><miscellaneous>
<miscellaneous-field name="source-sheet-2">1</miscellaneous-field>
</miscellaneous></identification><defaults><page-layout><page-height>2000</page-height>
<page-width>1500</page-width></page-layout></defaults><part-list><score-part id="P1"/></part-list>
<part id="P1"><measure number="1"><note id="keep"><pitch><step>C</step><octave>4</octave></pitch>
<duration>1</duration><notations><unknown keep="yes"/></notations></note></measure></part></score-partwise>'''
SHEET = b'''<sheet><picture width="1000" height="2000"/><scale><interline main="20"/></scale>
<page><system><part><staff><lines><line><point x="100" y="400"/></line>
<line><point x="900" y="480"/></line></lines></staff></part><sig><inters>
<sentence role="Direction"><bounds x="200" y="325" w="150" h="40"/></sentence>
<sentence role="Rights"><bounds x="400" y="1900" w="200" h="40"/></sentence>
<clef><bounds x="80" y="370" w="30" h="100"/></clef>
</inters></sig></system><system><part><staff><lines><line>
<point x="100" y="1700"/></line><line><point x="900" y="1780"/>
</line></lines></staff></part></system></page></sheet>'''


def png(width, height):
    # Only the PNG header is relevant to crop sanity checks; image decoder QA is
    # covered by actual Poppler artifact inspection, not this fake subprocess.
    return PNG_SIGNATURE + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', width, height) + b'\x08\x02\0\0\0' + b'\0' * 4


class PageTextTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.raw = Path(temporary.name) / 'raw'
        self.raw.mkdir()
        self.pdf = self.raw.parent / 'original.pdf'
        self.pdf.write_bytes(b'%PDF-test')
        with zipfile.ZipFile(self.raw / 'source.omr', 'w') as archive:
            archive.writestr('book.xml', '<book><sheet number="2"><input><number>4</number></input></sheet></book>')
            archive.writestr('sheet#2/sheet#2.xml', SHEET)
        self.calls = []

    def subprocess(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if command[0] == '/tool/pdfinfo':
            return subprocess.CompletedProcess(command, 0, b'Page 4 size: 480 x 960 pts\nPage 4 rot: 0\n', b'')
        width, height = int(command[command.index('-W') + 1]), int(command[command.index('-H') + 1])
        Path(command[-1] + '.png').write_bytes(png(width, height))
        return subprocess.CompletedProcess(command, 0, b'', b'')

    def preserve(self, data=SCORE):
        with patch('page_text.shutil.which', side_effect=lambda name: '/tool/' + name), \
                patch('page_text.subprocess.run', side_effect=self.subprocess):
            return preserve_page_text(data, self.raw, self.pdf)

    def test_crossing_sentence_is_excluded_whole_and_direction_retained_separately(self):
        geometry = sheet_geometry(SHEET)
        regions = dict(page_regions(geometry))
        self.assertEqual(regions['header'].bottom, 323)
        self.assertLessEqual(regions['direction'].y, 325)
        self.assertGreaterEqual(regions['direction'].bottom, 365)
        self.assertLess(regions['direction'].bottom, 370)  # clef starts here
        self.assertEqual(regions['footer'].y, 1880)

    def test_deep_music_is_excluded_and_sparse_pages_do_not_get_blank_footer(self):
        geometry = sheet_geometry(SHEET)
        deep = replace(geometry, music=geometry.music + (Box(20, 1880, 60, 50),))
        self.assertNotIn('footer', dict(page_regions(deep)))
        sparse = replace(geometry, last_staff_bottom=800, sentences=())
        self.assertNotIn('footer', dict(page_regions(sparse)))

    def test_sparse_page_footer_does_not_include_unused_space_above_lettering(self):
        geometry = sheet_geometry(SHEET)
        sparse = replace(geometry, last_staff_bottom=800, music=(),
                         sentences=(('Rights', Box(400, 1900, 200, 40)),))
        footer = dict(page_regions(sparse))['footer']
        self.assertEqual(footer.y, 1880)
        self.assertEqual(footer.height, 120)

    def test_direction_that_intersects_music_is_not_copied(self):
        geometry = sheet_geometry(SHEET)
        overlapping = replace(geometry, music=geometry.music + (Box(200, 350, 15, 25),))
        self.assertNotIn('direction', dict(page_regions(overlapping)))

    def test_opening_direction_fully_inside_header_is_isolated(self):
        geometry = sheet_geometry(SHEET.replace(b'y="325"', b'y="250"'))
        regions = dict(page_regions(geometry))
        self.assertLess(regions['header'].bottom, 250)
        self.assertLessEqual(regions['direction'].y, 250)
        self.assertGreaterEqual(regions['direction'].bottom, 290)

    def test_enrichment_preserves_music_and_creates_standard_positioned_credits(self):
        before = ET.fromstring(SCORE)
        enriched, diagnostics = self.preserve()
        root = ET.fromstring(enriched)
        self.assertNotEqual(enriched, SCORE)
        self.assertEqual(ET.tostring(root.find('part')), ET.tostring(before.find('part')))
        self.assertEqual(ET.tostring(root.find('identification')), ET.tostring(before.find('identification')))
        credits = root.findall('credit')
        self.assertEqual(len(credits), 3)
        self.assertEqual([credit.findtext('credit-type') for credit in credits],
                         ['typenote-source-header', 'typenote-source-footer', 'typenote-source-direction'])
        self.assertTrue(all(c.get('page') == '1' for c in credits))
        image = credits[0].find('credit-image')
        self.assertEqual(image.get('width'), '1500.0000')
        self.assertEqual(image.get('valign'), 'bottom')
        self.assertAlmostEqual(float(image.get('default-y')) + float(image.get('height')), 2000)
        self.assertEqual(image.get('type'), 'image/png')
        self.assertTrue(base64.b64decode(image.get('source').split(',')[1]).startswith(PNG_SIGNATURE))
        self.assertTrue(diagnostics)
        self.assertLess(list(root).index(credits[-1]), list(root).index(root.find('part-list')))
        for command, kwargs in self.calls:
            self.assertEqual(command[command.index('-f') + 1], '4')  # source sheet 2 maps to PDF page 4
            self.assertLessEqual(kwargs['timeout'], 30)
            self.assertNotIn('shell', kwargs)
        self.assertEqual([c[0] for c, _ in self.calls].count('/tool/pdftoppm'), 3)

    def test_rotation_and_pdf_resolution_are_mapped_not_assumed(self):
        from page_text import _page_pixels
        result = subprocess.CompletedProcess([], 0, b'Page 4 size: 480 x 960 pts\nPage 4 rot: 90\n')
        with patch('page_text.subprocess.run', return_value=result):
            self.assertEqual(_page_pixels(self.pdf, 4, '/tool/pdfinfo'), (2000, 1000))

    def test_already_recognized_opening_direction_is_not_duplicated_as_image(self):
        for marking in ['<words>Moderately</words>', '<metronome><beat-unit>quarter</beat-unit></metronome>']:
            with self.subTest(marking=marking):
                source = SCORE.replace(b'<note id="keep">',
                                       f'<direction><direction-type>{marking}</direction-type></direction><note id="keep">'.encode())
                enriched, _ = self.preserve(source)
                root = ET.fromstring(enriched)
                self.assertEqual([c.findtext('credit-type') for c in root.findall('credit')],
                                 ['typenote-source-header', 'typenote-source-footer'])
                self.assertEqual(ET.tostring(root.find('part')), ET.tostring(ET.fromstring(source).find('part')))

    def test_already_preserved_source_is_idempotent(self):
        enriched, _ = self.preserve()
        with patch('page_text.subprocess.run') as process:
            self.assertEqual(preserve_page_text(enriched, self.raw, self.pdf), (enriched, []))
            process.assert_not_called()

    def test_missing_tools_or_geometry_preserves_original_without_failure(self):
        with patch('page_text.shutil.which', return_value=None):
            self.assertEqual(preserve_page_text(SCORE, self.raw, self.pdf), (SCORE, [FAILURE]))
        (self.raw / 'source.omr').write_bytes(b'not zip')
        self.assertEqual(self.preserve(), (SCORE, [FAILURE]))

    def test_unsupported_xml_invalid_mapping_and_entity_definitions_are_unchanged(self):
        for source in [b'<score-timewise/>', b'<broken', SCORE.replace(b'source-sheet-2', b'source-sheet-201'),
                       SCORE.replace(b'<part id="P1">', b'<part id="P1"><measure><print new-page="yes"/></measure>'),
                       b'<!DOCTYPE a [<!ENTITY x "unsafe">]>' + SCORE]:
            with self.subTest(source=source[:80]):
                self.assertEqual(self.preserve(source), (source, [FAILURE]))

    def test_timeout_and_oversized_or_invalid_png_fail_softly(self):
        with patch('page_text.shutil.which', return_value='/tool'), \
                patch('page_text.subprocess.run', side_effect=subprocess.TimeoutExpired('tool', 30)):
            self.assertEqual(preserve_page_text(SCORE, self.raw, self.pdf), (SCORE, [FAILURE]))
        with patch('page_text.MAX_IMAGE', 10):
            self.assertEqual(self.preserve(), (SCORE, [FAILURE]))
        with patch('page_text.MAX_IMAGES', 10):
            self.assertEqual(self.preserve(), (SCORE, [FAILURE]))
        with patch('page_text.MAX_XML', len(SCORE) + 10):
            self.assertEqual(self.preserve(), (SCORE, [FAILURE]))
        with patch('page_text.png_dimensions', return_value=(1, 1)):
            self.assertEqual(self.preserve(), (SCORE, [FAILURE]))

    def test_zip_members_are_never_extracted_and_oversized_geometry_is_rejected(self):
        with zipfile.ZipFile(self.raw / 'source.omr', 'w') as archive:
            archive.writestr('book.xml', '<book><sheet number="2"/></book>')
            archive.writestr('../../escape', 'private')
            archive.writestr('sheet#2/sheet#2.xml', SHEET)
        with patch('page_text.MAX_SHEET_XML', 10):
            self.assertEqual(self.preserve(), (SCORE, [FAILURE]))
        self.assertFalse((self.raw.parent / 'escape').exists())

    def test_overall_time_budget_and_unexpected_optional_tool_failure_fail_softly(self):
        with patch('page_text.time.monotonic', side_effect=[0, 100]), \
                patch('page_text.shutil.which', return_value='/tool'):
            self.assertEqual(preserve_page_text(SCORE, self.raw, self.pdf), (SCORE, [FAILURE]))
        with patch('page_text.shutil.which', return_value='/tool'), \
                patch('page_text.subprocess.run', side_effect=RuntimeError('private provider detail')):
            self.assertEqual(preserve_page_text(SCORE, self.raw, self.pdf), (SCORE, [FAILURE]))

    def test_straightened_text_crops_use_matching_prepared_page_not_original_pdf(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest('Optional local Pillow unavailable')
        prepared = self.raw.parent / 'prepared'
        prepared.mkdir()
        image = Image.new('L', (1000, 2000), 255)
        # The source mapping in the project is PDF page 4, not OMR sheet 2.
        image.paste(0, (0, 0, 1000, 250))
        image.save(prepared / 'page-4.png')
        with patch('page_text.shutil.which', return_value=None), \
                patch('page_text.subprocess.run') as run:
            enriched, diagnostics = preserve_page_text(SCORE, self.raw, self.pdf, prepared_pages=prepared)
        self.assertNotEqual(enriched, SCORE, diagnostics)
        run.assert_not_called()
        root = ET.fromstring(enriched)
        self.assertEqual(root.find('part').find('measure/note').get('id'), 'keep')
        credit = root.find("credit[credit-type='typenote-source-header']/credit-image")
        import io
        pixels = base64.b64decode(credit.get('source').split(',', 1)[1])
        with Image.open(io.BytesIO(pixels)) as crop:
            self.assertEqual(crop.getpixel((10, 10)), 0)
        Image.new('L', (20, 20)).save(prepared / 'page-4.png')
        self.assertEqual(preserve_page_text(SCORE, self.raw, self.pdf, prepared_pages=prepared), (SCORE, [FAILURE]))

    def test_png_header_and_geometry_are_validated(self):
        self.assertEqual(png_dimensions(png(12, 34)), (12, 34))
        for invalid in [b'not png', png(0, 10), png(50000, 10)]:
            with self.assertRaises(ValueError):
                png_dimensions(invalid)
        for invalid in [SHEET.replace(b'main="20"', b'main="nan"'), b'<sheet/>']:
            with self.assertRaises((ValueError, TypeError)):
                sheet_geometry(invalid)


if __name__ == '__main__':
    unittest.main()
