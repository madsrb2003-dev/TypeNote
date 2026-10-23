"""Optional scan preparation preserves pages and refuses uncertain geometry."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import scan_geometry as scan

try:
    import numpy as np
    from PIL import Image
    import scipy
    IMAGE_TOOLS = True
except ImportError:
    IMAGE_TOOLS = False


@unittest.skipUnless(IMAGE_TOOLS, 'Optional local image dependencies are unavailable')
class GeometryTests(unittest.TestCase):
    @staticmethod
    def page(curved=False):
        image = np.full((900, 700), 255, dtype=np.uint8)
        for center in (240, 520):
            for x in range(60, 670):
                shift = round(12 * np.sin(x / 130)) if curved else 0
                for offset in (-24, -12, 0, 12, 24):
                    image[center + shift + offset:center + shift + offset + 2, x] = 80
        return image

    def test_automatic_spacing_and_count_without_staff_seeds(self):
        geometry = scan.detect_staff_geometry(self.page(curved=True))
        self.assertEqual(len(geometry.targets), 2)
        self.assertAlmostEqual(geometry.interline, 12, delta=1)
        self.assertTrue(all(record['medianConfidence'] >= .55 for record in geometry.evidence))

    def test_dark_photographed_paper_uses_local_contrast_for_staff_detection(self):
        image = self.page(curved=True)
        image[image == 255] = 170
        geometry = scan.detect_staff_geometry(image)
        self.assertEqual(len(geometry.targets), 2)
        with self.assertRaises(scan.GeometryRefused):
            scan.detect_staff_geometry(np.full((900, 700), 170, dtype=np.uint8))

    def test_identity_retains_every_pixel(self):
        image = np.arange(700 * 900, dtype=np.uint32).reshape(900, 700).astype('uint8')
        curves = np.tile(np.array([[240.], [520.]]), (1, 700))
        geometry = scan.StaffGeometry(700, 900, 12., curves, np.array([240., 520.]), ())
        result, sources, destinations, maximum = scan.warp_staff_geometry(image, geometry)
        np.testing.assert_array_equal(result, image)
        np.testing.assert_array_equal(sources, destinations)
        self.assertEqual(maximum, 0)

    def test_curved_mapping_is_monotonic_and_has_exact_inverse(self):
        image = self.page(curved=True)
        geometry = scan.detect_staff_geometry(image)
        result, sources, destinations, maximum = scan.warp_staff_geometry(image, geometry)
        self.assertEqual(result.shape, image.shape)
        self.assertGreater(maximum, 5)
        self.assertTrue(np.all(np.diff(sources, axis=1) > 0))
        self.assertTrue(np.all(np.diff(destinations, axis=1) > 0))
        for x in range(0, image.shape[1], 31):
            ys = np.arange(image.shape[0])
            mapped = np.interp(ys, destinations[x], sources[x])
            np.testing.assert_allclose(np.interp(mapped, sources[x], destinations[x]), ys, atol=1e-10)

    def test_blank_and_crossing_staff_mapping_are_refused(self):
        with self.assertRaises(scan.GeometryRefused):
            scan.detect_staff_geometry(np.full((900, 700), 255, dtype=np.uint8))
        image = self.page()
        curves = np.tile(np.array([[520.], [240.]]), (1, 700))
        geometry = scan.StaffGeometry(700, 900, 12., curves, np.array([240., 520.]), ())
        with self.assertRaises(scan.GeometryRefused):
            scan.warp_staff_geometry(image, geometry)

    def test_faint_ink_is_retained_without_creating_black_halos_on_white_paper(self):
        image = np.full((120, 120), 255, dtype=np.uint8)
        image[:, np.arange(120) % 36 < 6] = 0
        binary = scan.binarize_scan(image)
        np.testing.assert_array_equal(binary, image)
        faint = np.full((120, 120), 235, dtype=np.uint8)
        faint[:, 58:61] = 185
        result = scan.binarize_scan(faint)
        self.assertTrue(np.all(result[:, 58:61] == 0))
        self.assertTrue(np.all(result[faint == 235] == 255))
        dark = np.full((120, 120), 170, dtype=np.uint8)
        dark[:, 58:61] = 150
        corrected = scan.binarize_scan(dark)
        self.assertTrue(np.all(corrected[:, 58:61] == 0))
        self.assertTrue(np.all(corrected[dark == 170] == 255))

    def test_detection_obeys_cancellation_callback(self):
        def stop():
            raise scan.GeometryRefused('cancelled')
        with self.assertRaisesRegex(scan.GeometryRefused, 'cancelled'):
            scan.detect_staff_geometry(self.page(), stop)


@unittest.skipUnless(IMAGE_TOOLS, 'Optional local image dependencies are unavailable')
class PreparationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pdf = self.root / 'original.pdf'
        self.pdf.write_bytes(b'%PDF-original-content')
        self.destination = self.root / 'prepared'
        self.calls = []
        self.second_blank = False
        self.page_count = 2

    def command(self, command, **kwargs):
        self.calls.append(command)
        if command[0] == '/local/pdfinfo':
            data = (''.join(f'Page {index} size: 126 x 162 pts\n' for index in range(1, self.page_count + 1))
                    if '-box' in command else f'Pages: {self.page_count}\n')
            return subprocess.CompletedProcess(command, 0, data.encode(), b'')
        page = int(command[command.index('-f') + 1])
        image = GeometryTests.page(curved=True)
        if page == 2 and self.second_blank:
            image[:] = 255
        Image.fromarray(image).save(command[-1] + '.pgm')
        return subprocess.CompletedProcess(command, 0, b'', b'')

    def prepare(self, pages=None, timeout=60):
        with patch('scan_geometry.shutil.which', side_effect=lambda command: '/local/' + command), \
                patch('scan_geometry.subprocess.run', side_effect=self.command):
            return scan.prepare_piano_scan(self.pdf, self.destination, pages or [2], timeout)

    def test_selected_subset_keeps_all_source_pages_and_bidirectional_maps(self):
        target, diagnostics = self.prepare()
        self.assertIsNotNone(target, diagnostics)
        with Image.open(target) as image:
            self.assertEqual(image.n_frames, 2)
            self.assertEqual(image.info['dpi'], (400., 400.))
        import json
        report = json.loads((target.parent / 'geometry.json').read_text())
        self.assertEqual(report['requestedPages'], [2])
        self.assertEqual([page['sourcePage'] for page in report['pages']], [1, 2])
        for page in report['pages']:
            with np.load(target.parent / page['map']) as mapping:
                self.assertTrue(np.all(np.diff(mapping['source_anchors'], axis=1) > 0))
                self.assertTrue(np.all(np.diff(mapping['destination_anchors'], axis=1) > 0))
        self.assertEqual(self.pdf.read_bytes(), b'%PDF-original-content')

    def test_uncertain_second_page_removes_only_new_preparation(self):
        self.destination.mkdir()
        sentinel = self.destination / 'keep.txt'
        sentinel.write_text('user data')
        self.second_blank = True
        target, diagnostics = self.prepare()
        self.assertIsNone(target)
        self.assertIn('original PDF is unchanged', diagnostics[0])
        self.assertEqual(list(self.destination.iterdir()), [sentinel])
        self.assertEqual(self.pdf.read_bytes(), b'%PDF-original-content')

    def test_oversized_page_count_and_invalid_selection_refuse_before_rendering(self):
        self.page_count = 21
        self.assertIsNone(self.prepare()[0])
        self.assertEqual(len(self.calls), 1)
        self.page_count = 2
        self.calls.clear()
        self.assertIsNone(self.prepare(pages=[True])[0])
        self.assertEqual(len(self.calls), 1)

    def test_missing_dependencies_and_no_time_leave_original_untouched(self):
        with patch('scan_geometry._dependencies', side_effect=ImportError()):
            result, diagnostics = scan.prepare_piano_scan(self.pdf, self.destination, [1], 60)
        self.assertIsNone(result)
        self.assertIn('dependencies unavailable', diagnostics[0])
        self.assertIsNone(self.prepare(timeout=0)[0])
        self.assertEqual(self.calls, [])
        self.assertFalse(self.destination.exists())

    def test_pixel_preflight_refuses_before_any_rasterizer_call(self):
        with patch('scan_geometry.MAX_PAGE_PIXELS', 1000):
            target, diagnostics = self.prepare()
        self.assertIsNone(target)
        self.assertIn('pixel limit', diagnostics[0])
        self.assertTrue(all(command[0] == '/local/pdfinfo' for command in self.calls))
        self.assertFalse(self.destination.exists())

    def test_interrupt_propagates_so_worker_does_not_start_recognition_after_cancel(self):
        with patch('scan_geometry._dependencies', side_effect=KeyboardInterrupt()):
            with self.assertRaises(KeyboardInterrupt):
                scan.prepare_piano_scan(self.pdf, self.destination, [1], 60)
        self.assertFalse(self.destination.exists())

    def test_cancel_marker_refuses_before_dependency_or_process_work(self):
        (self.root / 'cancel.requested').touch()
        self.assertIsNone(self.prepare()[0])
        self.assertEqual(self.calls, [])
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
