import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile
import xml.etree.ElementTree as ET

from project_repair import repair_empty_glyphs


class ProjectRepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / 'source.omr'
        self.destination = self.directory / 'copy.omr'

    def archive(self, xml, extras=()):
        with zipfile.ZipFile(self.source, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            z.comment = b'original comment'
            z.writestr('book.xml', b'<book/>')
            z.writestr('sheet#1/sheet#1.xml', xml)
            z.writestr('sheet#1/BINARY.png', b'untouched binary')
            for name, data in extras:
                z.writestr(name, data)

    def test_removes_only_unreferenced_zero_geometry_and_preserves_original(self):
        self.archive('<sheet><glyph id="4646"><run-table width="0" height="33"/></glyph>'
                     '<glyph id="9"><run-table width="3" height="4"><runs>2 1</runs></run-table></glyph></sheet>')
        original = self.source.read_bytes()
        self.assertEqual(repair_empty_glyphs(self.source, self.destination), 1)
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).digest(), hashlib.sha256(original).digest())
        with zipfile.ZipFile(self.source) as before, zipfile.ZipFile(self.destination) as after:
            self.assertEqual(after.comment, before.comment)
            for name in ['book.xml', 'sheet#1/BINARY.png']:
                self.assertEqual(after.read(name), before.read(name))
                self.assertEqual(after.getinfo(name).date_time, before.getinfo(name).date_time)
                self.assertEqual(after.getinfo(name).compress_type, before.getinfo(name).compress_type)
            root = ET.fromstring(after.read('sheet#1/sheet#1.xml'))
            self.assertEqual([g.get('id') for g in root.findall('glyph')], ['9'])

    def test_references_positive_geometry_and_actual_run_data_are_retained(self):
        self.archive('<sheet><glyph id="4646"><run-table width="0" height="33"/></glyph>'
                     '<head glyph="4646"/><glyph id="22"><run-table width="0" height="3"><runs>1</runs></run-table></glyph>'
                     '<glyph id="23"><run-table width="2" height="3"/></glyph></sheet>')
        self.assertEqual(repair_empty_glyphs(self.source, self.destination), 0)
        self.assertEqual(self.source.read_bytes(), self.destination.read_bytes())

    def test_reference_tokens_match_exactly_and_lists_protect(self):
        self.archive('<sheet><glyph id="4646"><run-table width="0" height="33"/></glyph>'
                     '<glyph id="6"><run-table width="3" height="0"/></glyph>'
                     '<head glyph="14646"/><group glyphs="5 6 7"/></sheet>')
        self.assertEqual(repair_empty_glyphs(self.source, self.destination), 1)
        with zipfile.ZipFile(self.destination) as z:
            self.assertEqual([g.get('id') for g in ET.fromstring(z.read('sheet#1/sheet#1.xml')).findall('glyph')], ['6'])

    def test_uri_fragment_references_retain_exact_identifier(self):
        for href in ['#4646', 'file.omr#4646', 'file.omr#%34%36%34%36']:
            with self.subTest(href=href):
                self.archive('<sheet xmlns:xlink="http://www.w3.org/1999/xlink">'
                             '<glyph id="4646"><run-table width="0" height="33"/></glyph>'
                             '<use xlink:href="' + href + '"/></sheet>')
                self.assertEqual(repair_empty_glyphs(self.source, self.destination), 0)
                self.assertEqual(self.source.read_bytes(), self.destination.read_bytes())
                self.destination.unlink()
        self.archive('<sheet><glyph id="4646"><run-table width="0" height="33"/></glyph>'
                     '<use href="file.omr#14646"/></sheet>')
        self.assertEqual(repair_empty_glyphs(self.source, self.destination), 1)

    def test_duplicate_glyph_identifiers_are_retained(self):
        self.archive('<sheet><glyph id="22"><run-table width="0" height="3"/></glyph>'
                     '<glyph id="22"><run-table width="0" height="3"/></glyph></sheet>')
        self.assertEqual(repair_empty_glyphs(self.source, self.destination), 0)
        self.assertEqual(self.source.read_bytes(), self.destination.read_bytes())

    def test_same_source_and_existing_destination_rejected(self):
        self.archive('<sheet/>')
        with self.assertRaises(ValueError):
            repair_empty_glyphs(self.source, self.source)
        self.destination.write_bytes(b'do not replace')
        with self.assertRaises(FileExistsError):
            repair_empty_glyphs(self.source, self.destination)
        self.assertEqual(self.destination.read_bytes(), b'do not replace')

    def test_unsafe_paths_and_duplicate_members_rejected_without_output(self):
        for path in ['../evil', '/absolute', 'a\\b', 'a//b', 'a/./b', 'C:evil']:
            with self.subTest(path=path):
                self.archive('<sheet/>', [(path, b'x')])
                with self.assertRaises(ValueError):
                    repair_empty_glyphs(self.source, self.destination)
                self.assertFalse(self.destination.exists())
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            self.archive('<sheet/>', [('book.xml', b'<book/>')])
        with self.assertRaises(ValueError):
            repair_empty_glyphs(self.source, self.destination)

    def test_budgets_reject_without_partial_file(self):
        for constant in ['MAX_ENTRIES', 'MAX_MEMBER_BYTES', 'MAX_TOTAL_BYTES', 'MAX_XML_BYTES']:
            with self.subTest(constant=constant):
                self.archive('<sheet/>')
                with patch('project_repair.' + constant, 1):
                    with self.assertRaises(ValueError):
                        repair_empty_glyphs(self.source, self.destination)
                self.assertFalse(self.destination.exists())
                self.assertEqual(list(self.directory.glob('.omr-repair-*')), [])

    def test_unsafe_or_invalid_xml_rejected(self):
        for xml in ['<!DOCTYPE sheet [<!ENTITY a "x">]><sheet>&a;</sheet>', '<sheet>']:
            self.archive(xml)
            with self.assertRaises(ValueError):
                repair_empty_glyphs(self.source, self.destination)
            self.assertFalse(self.destination.exists())

    def test_symlink_member_rejected(self):
        self.archive('<sheet/>')
        with zipfile.ZipFile(self.source, 'a') as z:
            info = zipfile.ZipInfo('link')
            info.create_system = 3
            info.external_attr = 0o120777 << 16
            z.writestr(info, 'target')
        with self.assertRaises(ValueError):
            repair_empty_glyphs(self.source, self.destination)
        self.assertFalse(self.destination.exists())

    def test_encrypted_member_rejected(self):
        self.archive('<sheet/>')
        data = bytearray(self.source.read_bytes())
        offset = data.index(b'PK\x01\x02')
        data[offset + 8] |= 1
        self.source.write_bytes(data)
        with self.assertRaises(ValueError):
            repair_empty_glyphs(self.source, self.destination)
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
