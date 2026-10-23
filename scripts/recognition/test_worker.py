"""Recognition worker tests using synthetic scores and no external services."""
import json
import signal
import subprocess
import sys
import time
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from worker import execute, page_numbers, provider_diagnostics, collect
from adapter import ProcessResult
from structure import staff_diagnostics

SCORE = b'<score-partwise><part-list/><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><unknown keep="yes"/></notations></note></measure></part></score-partwise>'


class WorkerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.job = Path(temporary.name)
        (self.job / 'original.pdf').write_bytes(b'%PDF-synthetic')
        (self.job / 'result.json').write_text(json.dumps({'id': 'synthetic', 'status': 'validating', 'diagnostics': [], 'outputs': []}))

    def test_page_selection_is_bounded_and_deduplicated(self):
        self.assertEqual(page_numbers('1, 2,4-6,5', 6), [1, 2, 4, 5, 6])
        self.assertEqual(page_numbers('', 2), [])
        for invalid in ('0', '2-1', '1,', '100000000-999999999', '3', 'x', '1;echo bad'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                page_numbers(invalid, 2)

    def provider(self, command, log, timeout):
        raw = self.job / 'raw'
        (raw / 'first.xml').write_bytes(SCORE)
        (raw / 'second.musicxml').write_bytes(SCORE.replace(b'C</step>', b'D</step>'))
        log.write_text('WARN private score title\nERROR private local path\n')
        return ProcessResult(0, 0.1, 'completed')

    def test_complete_distinct_xml_preserved_and_warnings_summarized(self):
        with patch('worker.pdf_metadata', return_value={'pages': 6}), patch('worker.run_process', side_effect=self.provider) as run:
            result = execute(self.job, Path('/provider'), '/pdfinfo', '1,4-6')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(result['outputs']), 2)
        self.assertEqual((self.job / result['outputs'][0]['file']).read_bytes(), SCORE)
        self.assertNotEqual(result['outputs'][0]['file'], result['outputs'][1]['file'])
        self.assertEqual(run.call_args.args[0][-7:], ['-sheets', '1', '4', '5', '6', '--', str(self.job / 'original.pdf')])
        self.assertIn('org.audiveris.omr.image.ImageLoading.pdfResolution=400', run.call_args.args[0])
        self.assertNotIn('private', json.dumps(result))

    def test_nonzero_does_not_become_success_with_partial_score(self):
        def failed(*args):
            self.provider(*args)
            return ProcessResult(1, 0.1, 'failed')
        with patch('worker.pdf_metadata', return_value={'pages': 1}), patch('worker.run_process', side_effect=failed):
            result = execute(self.job, Path('/provider'), '/pdfinfo', '')
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(len(result['outputs']), 2)

    def test_page_text_enrichment_retains_original_provider_xml(self):
        def with_project(*args):
            process = self.provider(*args)
            (self.job / 'raw' / 'original.omr').write_bytes(b'retained-provider-project')
            return process
        def enrich(data, *_args, **_kwargs):
            return data.replace(b'<part-list/>', b'<credit><credit-words>Source text</credit-words></credit><part-list/>'), ['Preserved source text']
        with patch('worker.pdf_metadata', return_value={'pages': 1}), patch('worker.run_process', side_effect=with_project), \
                patch('worker.preserve_page_text', side_effect=enrich) as preserve:
            result = execute(self.job, Path('/provider'), '/pdfinfo', '')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(preserve.call_count, 2)
        self.assertEqual((self.job / 'provider-musicxml' / '0.musicxml').read_bytes(), SCORE)
        self.assertIn(b'Source text', (self.job / result['outputs'][0]['file']).read_bytes())
        self.assertEqual(result['outputs'][0]['noteCount'], 1)

    def test_invalid_encrypted_large_and_invalid_selection_do_not_run_provider(self):
        for metadata, error, pages in ((None, 'Encrypted/password-protected PDFs are unsupported', ''),
                                       (None, 'Invalid PDF', ''), ({'pages': 201}, None, ''),
                                       ({'pages': 1}, None, '2')):
            with patch('worker.pdf_metadata', return_value=metadata, side_effect=ValueError(error) if error else None), patch('worker.run_process') as run:
                result = execute(self.job, Path('/provider'), '/pdfinfo', pages)
                self.assertEqual(result['status'], 'failed')
                run.assert_not_called()

    def test_timeout_and_cancelled_states(self):
        for status, expected in [('timed_out', 'failed'), ('cancelled', 'cancelled')]:
            with patch('worker.pdf_metadata', return_value={'pages': 1}), patch('worker.run_process', return_value=ProcessResult(-15, 1, status)):
                self.assertEqual(execute(self.job, Path('/provider'), '/pdfinfo', '')['status'], expected)

    def test_preexisting_cancel_does_not_start_provider(self):
        (self.job / 'cancel.requested').touch()
        with patch('worker.run_process') as run:
            self.assertEqual(execute(self.job, Path('/provider'), '/pdfinfo', '')['status'], 'cancelled')
            run.assert_not_called()

    def test_symlink_output_cannot_escape_raw(self):
        raw = self.job / 'raw'
        raw.mkdir()
        (self.job / 'private.xml').write_bytes(SCORE)
        (raw / 'escape.xml').symlink_to(self.job / 'private.xml')
        outputs, diagnostics = collect(raw, self.job)
        self.assertEqual(outputs, [])
        self.assertTrue(diagnostics)

    def test_sigterm_cancels_worker_and_its_provider_children(self):
        inspector = self.job / 'pdfinfo'
        inspector.write_text(f'#!{sys.executable}\nprint("Pages: 1\\nEncrypted: no")\n')
        inspector.chmod(0o755)
        ready = self.job / 'child-ready'
        stopped = self.job / 'child-stopped'
        child_code = (
            'import signal,time; from pathlib import Path; '
            f'signal.signal(signal.SIGTERM, lambda *_: (Path({str(stopped)!r}).touch(), exit(0))); '
            f'Path({str(ready)!r}).touch(); time.sleep(60)'
        )
        provider = self.job / 'provider'
        provider.write_text(f'#!{sys.executable}\nimport subprocess,sys,time\n'
                            f'subprocess.Popen([sys.executable, "-c", {child_code!r}])\ntime.sleep(60)\n')
        provider.chmod(0o755)
        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('worker.py')),
                                    '--job', str(self.job), '--audiveris', str(provider),
                                    '--pdfinfo', str(inspector)])
        try:
            until = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < until:
                time.sleep(0.02)
            self.assertTrue(ready.exists(), 'Provider child did not start')
            process.send_signal(signal.SIGTERM)
            process.wait(timeout=8)
            self.assertTrue(stopped.exists(), 'Provider child did not receive cancellation')
            self.assertEqual(json.loads((self.job / 'result.json').read_text())['status'], 'cancelled')
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                process.wait(timeout=8)

    def test_diagnostics_omit_score_text(self):
        log = self.job / 'recognition.log'
        log.write_text('WARN secret title\nERROR secret path\nexception secret note\n')
        diagnostics = provider_diagnostics(log)
        self.assertEqual(len(diagnostics), 2)
        self.assertNotIn('secret', ' '.join(diagnostics))

    def test_info_level_rhythm_problems_are_surfaced(self):
        log = self.job / 'recognition.log'
        log.write_text('INFO private title Voice{#5 excess:1/6} too long\n')
        diagnostics = provider_diagnostics(log)
        self.assertEqual(len(diagnostics), 1)
        self.assertIn('1 rhythm problems', diagnostics[0])
        self.assertNotIn('private', str(diagnostics))

    def test_missing_staff_is_reported_without_changing_project(self):
        raw = self.job / 'raw'
        raw.mkdir()
        staff = '<staff-configuration line-count="5"/>'
        systems = ''.join('<system><part>' + staff * count + '</part></system>' for count in [2, 2, 2, 1, 2])
        book = f'<book><sheet number="1"><page>{systems}</page></sheet></book>'
        project = raw / 'original.omr'
        with zipfile.ZipFile(project, 'w') as archive:
            archive.writestr('book.xml', book)
        before = project.read_bytes()
        diagnostics = staff_diagnostics(raw)
        self.assertEqual(len(diagnostics), 1)
        self.assertIn('page 1, system 4', diagnostics[0])
        self.assertIn('recognized 1', diagnostics[0])
        self.assertEqual(project.read_bytes(), before)
        with zipfile.ZipFile(project, 'w') as archive:
            archive.writestr('book.xml', book.replace('<part>' + staff + '</part>', '<part>' + staff * 2 + '</part>'))
        self.assertEqual(staff_diagnostics(raw), [])

    def test_invalid_project_metadata_does_not_hide_recognized_output(self):
        raw = self.job / 'raw'
        raw.mkdir()
        (raw / 'broken.omr').write_bytes(b'not a zip')
        self.assertEqual(len(staff_diagnostics(raw)), 1)


if __name__ == '__main__':
    unittest.main()
