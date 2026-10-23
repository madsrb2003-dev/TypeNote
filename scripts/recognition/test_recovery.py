"""Provider recovery checks with synthetic archives; no external processes."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'omr'))
from adapter import ProcessResult
from recovery import completed_pages, recover_project


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.job = Path(temporary.name)
        self.raw = self.job / 'raw'
        self.raw.mkdir()
        self.project = self.raw / 'original.omr'
        self.failed = ProcessResult(1, 0.1, 'failed')
        self.log = self.job / 'recognition.log'

    def archive(self, pages=(1, 2), empty_glyph=True):
        sheets = ''.join(f'<sheet number="{i}"><input><number>{page}</number></input>'
                         '<steps>LOAD PAGE</steps></sheet>' for i, page in enumerate(pages, 1))
        with zipfile.ZipFile(self.project, 'w') as z:
            z.writestr('book.xml', '<book>' + sheets + '</book>')
            glyph = '<glyph id="4646"><run-table width="0" height="33"/></glyph>' if empty_glyph else ''
            z.writestr('sheet#1/sheet#1.xml', '<sheet>' + glyph + '<head id="5" glyph="6"/></sheet>')
            z.writestr('sheet#1/BINARY.png', b'original image')

    def retry(self, command, log, timeout):
        self.assertGreater(timeout, 1)
        log.write_text('synthetic successful retry\n')
        return ProcessResult(0, 0.2, 'completed')

    def recover(self, mode='standard', pages=None, process=None, timeout=30):
        return recover_project(self.job, self.raw, Path('/synthetic/provider'),
                               process or self.failed, mode, pages or [1, 2], timeout)

    def test_serialization_repair_retains_original_and_exports_every_requested_page(self):
        self.archive()
        self.log.write_text('Original retained log\nRunTable.afterUnmarshal\n')
        original = self.project.read_bytes()
        with patch('recovery.run_process', side_effect=self.retry) as run:
            process, output, diagnostics = self.recover()
        self.assertEqual(process.status, 'completed')
        self.assertEqual(output, self.job / 'recovery' / 'serialization')
        self.assertEqual(hashlib.sha256(self.project.read_bytes()).digest(), hashlib.sha256(original).digest())
        self.assertNotEqual((output / 'source.omr').read_bytes(), original)
        command = run.call_args.args[0]
        self.assertEqual(command[-5:], ['-sheets', '1', '2', '--', str(output / 'source.omr')])
        self.assertEqual(command[0], '/synthetic/provider')
        self.assertTrue(any('unreferenced' in message for message in diagnostics))
        self.assertIn('Original retained log', self.log.read_text())
        self.assertIn('synthetic successful retry', self.log.read_text())
        self.assertEqual(completed_pages(output / 'source.omr'), {1, 2})

    def test_successful_retry_with_missing_requested_page_remains_failed(self):
        self.archive(pages=(1,))
        self.log.write_text('RunTable.afterUnmarshal')
        with patch('recovery.run_process', side_effect=self.retry):
            process, output, diagnostics = self.recover()
        self.assertEqual(process.status, 'failed')
        self.assertNotEqual(process.exit_code, 0)
        self.assertNotEqual(output, self.raw)
        self.assertTrue(any('every requested page' in message for message in diagnostics))

    def test_completed_pages_uses_original_source_numbers_and_requires_page_step(self):
        with zipfile.ZipFile(self.project, 'w') as z:
            z.writestr('book.xml', '<book><sheet number="1"><input><number>7</number></input>'
                       '<steps>LOAD PAGE</steps></sheet><sheet number="2"><input><number>8</number></input>'
                       '<steps>LOAD TEXTS</steps></sheet></book>')
        self.assertEqual(completed_pages(self.project), {7})

    def test_cancelled_timed_out_and_completed_processes_never_retry(self):
        for status, exit_code in [('cancelled', -15), ('timed_out', -15), ('completed', 0)]:
            with self.subTest(status=status), patch('recovery.run_process') as run:
                process = ProcessResult(exit_code, 1, status)
                result, output, diagnostics = self.recover(process=process)
                self.assertIs(result, process)
                self.assertEqual(output, self.raw)
                self.assertEqual(diagnostics, [])
                run.assert_not_called()

    def test_exhausted_time_or_cancel_request_never_retry(self):
        for timeout in [0, 1, -1]:
            with patch('recovery.run_process') as run:
                self.assertEqual(self.recover(timeout=timeout), (self.failed, self.raw, []))
                run.assert_not_called()
        (self.job / 'cancel.requested').touch()
        with patch('recovery.run_process') as run:
            self.assertEqual(self.recover(), (self.failed, self.raw, []))
            run.assert_not_called()

    def test_unknown_fault_never_retries(self):
        self.archive()
        self.log.write_text('Unrelated recognition failure')
        with patch('recovery.run_process') as run:
            self.assertEqual(self.recover(), (self.failed, self.raw, []))
            run.assert_not_called()
        self.assertFalse((self.job / 'recovery').exists())

    def test_courtesy_retry_requires_explicit_piano_scan_profile(self):
        self.archive(empty_glyph=False)
        self.log.write_text('MeasuresBuilder.emptyCourtesyMeasure')
        with patch('recovery.run_process') as run:
            self.assertEqual(self.recover(), (self.failed, self.raw, []))
            run.assert_not_called()
        with patch('recovery.run_process', side_effect=self.retry) as run:
            process, output, diagnostics = self.recover(mode='piano-scan')
        self.assertEqual(process.status, 'completed')
        self.assertEqual(output.name, 'measure-build')
        self.assertIn('org.audiveris.omr.sheet.rhythm.MeasuresBuilder.minStandardWidth=0', run.call_args.args[0])
        self.assertEqual(self.project.read_bytes(), (output / 'source.omr').read_bytes())
        self.assertTrue(any('courtesy' in message for message in diagnostics))

    def test_serialization_without_provably_safe_repair_never_runs_provider(self):
        self.archive(empty_glyph=False)
        self.log.write_text('RunTable.afterUnmarshal')
        with patch('recovery.run_process') as run:
            process, output, diagnostics = self.recover()
            run.assert_not_called()
        self.assertIs(process, self.failed)
        self.assertEqual(output, self.raw)
        self.assertTrue(diagnostics)

    def test_missing_archive_is_safe(self):
        self.log.write_text('RunTable.afterUnmarshal')
        with patch('recovery.run_process') as run:
            process, output, diagnostics = self.recover()
            run.assert_not_called()
        self.assertIs(process, self.failed)
        self.assertEqual(output, self.raw)
        self.assertTrue(diagnostics)

    def test_missing_log_is_safe(self):
        self.archive()
        with patch('recovery.run_process') as run:
            process, output, _diagnostics = self.recover()
            run.assert_not_called()
        self.assertIs(process, self.failed)
        self.assertEqual(output, self.raw)

    def test_existing_recovery_directory_is_not_overwritten(self):
        self.archive()
        self.log.write_text('RunTable.afterUnmarshal')
        existing = self.job / 'recovery' / 'serialization'
        existing.mkdir(parents=True)
        (existing / 'keep').write_text('retained')
        with patch('recovery.run_process') as run:
            process, output, _diagnostics = self.recover()
            run.assert_not_called()
        self.assertIs(process, self.failed)
        self.assertEqual(output, self.raw)
        self.assertEqual((existing / 'keep').read_text(), 'retained')

    def test_retry_failure_cancellation_and_timeout_propagate_without_another_retry(self):
        self.archive()
        self.log.write_text('RunTable.afterUnmarshal')
        for status in ['failed', 'cancelled', 'timed_out']:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                job = Path(directory)
                raw = job / 'raw'
                raw.mkdir()
                (raw / 'original.omr').write_bytes(self.project.read_bytes())
                (job / 'recognition.log').write_bytes(self.log.read_bytes())
                expected = ProcessResult(-15, 0.2, status)
                def retry(command, log, timeout):
                    log.write_text('synthetic interrupted retry')
                    return expected
                with patch('recovery.run_process', side_effect=retry) as run:
                    result, output, _diagnostics = recover_project(
                        job, raw, Path('/synthetic/provider'), self.failed,
                        'standard', [1, 2], 30)
                self.assertIs(result, expected)
                self.assertEqual(run.call_count, 1)
                self.assertNotEqual(output, raw)

    def test_invalid_archive_is_safe(self):
        self.project.write_bytes(b'not a zip archive')
        self.log.write_text('RunTable.afterUnmarshal')
        with patch('recovery.run_process') as run:
            process, output, diagnostics = self.recover()
            run.assert_not_called()
        self.assertIs(process, self.failed)
        self.assertEqual(output, self.raw)
        self.assertTrue(diagnostics)


if __name__ == '__main__':
    unittest.main()
