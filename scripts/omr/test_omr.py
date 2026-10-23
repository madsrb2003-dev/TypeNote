"""Synthetic fixtures only; no corpus scores are needed or embedded."""

from contextlib import redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile

from adapter import AudiverisAdapter, run_process
from musicxml import inspect_musicxml, musicxml_bytes
from run import collect_outputs, main, pdf_metadata

SCORE = b'<?xml version="1.0"?><score-partwise version="4.0"><part-list/><part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>'
CONTAINER = b'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="scores/music.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'


class OutputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, entries):
        target = self.root / "result.mxl"
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries:
                archive.writestr(name, data)
        return target

    def test_container_resolves_nested_score_without_extracting(self):
        target = self.archive([("META-INF/container.xml", CONTAINER), ("scores/music.xml", SCORE)])
        self.assertEqual(musicxml_bytes(target), SCORE)
        self.assertFalse((self.root / "scores").exists())
        facts = inspect_musicxml(musicxml_bytes(target))
        self.assertEqual(facts["counts"]["note"], 1)
        self.assertEqual(facts["counts"]["measure"], 1)

    def test_unsafe_archive_and_root_paths_rejected(self):
        for name in ("../escape", "/absolute", "scores\\escape"):
            target = self.archive([("META-INF/container.xml", CONTAINER), (name, SCORE)])
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "unsafe"):
                musicxml_bytes(target)
        target = self.archive([("META-INF/container.xml", CONTAINER.replace(b"scores/music.xml", b"../escape"))])
        with self.assertRaisesRegex(ValueError, "unsafe"):
            musicxml_bytes(target)

    def test_missing_container_and_corrupt_archive_rejected(self):
        target = self.archive([("score.xml", SCORE)])
        with self.assertRaisesRegex(ValueError, "Unreadable"):
            musicxml_bytes(target)
        target.write_bytes(b"not a zip file")
        with self.assertRaisesRegex(ValueError, "Unreadable"):
            musicxml_bytes(target)

    def test_bounded_member_read(self):
        target = self.archive([("META-INF/container.xml", CONTAINER), ("scores/music.xml", SCORE)])
        with patch("musicxml.MAX_XML_BYTES", 10), self.assertRaisesRegex(ValueError, "limit"):
            musicxml_bytes(target)

    def test_invalid_non_score_and_entities_rejected(self):
        for data in (b"<bad", b"<html/>", b'<!DOCTYPE x [<!ENTITY a "a">]><score-partwise>&a;</score-partwise>'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                inspect_musicxml(data)

    def test_standard_external_doctype_does_not_fetch(self):
        score = b'<!DOCTYPE score-partwise PUBLIC "MusicXML" "https://invalid.example/musicxml.dtd">' + SCORE.split(b"?>", 1)[1]
        self.assertEqual(inspect_musicxml(score)["root"], "score-partwise")

    def test_complete_source_preserved_even_with_unknown_notation(self):
        raw = self.root / "raw"
        raw.mkdir()
        source = SCORE.replace(b"</note>", b'<notations><unknown value="retain"/></notations></note>')
        (raw / "score.xml").write_bytes(source)
        outputs, diagnostics = collect_outputs(raw, self.root)
        self.assertEqual(diagnostics, [])
        self.assertEqual((self.root / outputs[0]["musicxml"]).read_bytes(), source)

    def test_bad_xml_preserves_raw_and_reports_error(self):
        raw = self.root / "raw"
        raw.mkdir()
        (raw / "bad.xml").write_bytes(b"<broken")
        outputs, diagnostics = collect_outputs(raw, self.root)
        self.assertIn("error", outputs[0])
        self.assertEqual(len(diagnostics), 1)
        self.assertEqual((raw / "bad.xml").read_bytes(), b"<broken")

    def test_pdf_encryption_and_invalid_pdf(self):
        for stdout, stderr, code in (("Encrypted: yes (print:yes)\nPages: 1", "", 0),
                                     ("", "Incorrect password", 1),
                                     ("", "not a PDF", 1)):
            with patch("run.subprocess.run", return_value=subprocess.CompletedProcess([], code, stdout, stderr)):
                with self.assertRaises(ValueError):
                    pdf_metadata(self.root / "source.pdf", "pdfinfo")


class ProcessTests(unittest.TestCase):
    def test_command_preserves_argument_boundaries(self):
        command = AudiverisAdapter(Path("/Applications/Audiveris App/run")).command(
            Path("/private/tmp/a score.pdf"), Path("/private/tmp/raw"), [1, 3])
        self.assertEqual(command[-5:], ["-sheets", "1", "3", "--", "/private/tmp/a score.pdf"])

    def test_piano_scan_profile_is_explicit_and_conservative(self):
        default = AudiverisAdapter(Path('provider'), pdf_resolution=400).command(Path('input.pdf'), Path('out'), [])
        self.assertNotIn('org.audiveris.omr.sheet.grid.BarsRetriever.forceSinglePart=true', default)
        piano = AudiverisAdapter(Path('provider'), pdf_resolution=400, profile='piano-scan').command(Path('input.pdf'), Path('out'), [2])
        self.assertIn('org.audiveris.omr.sheet.grid.BarsRetriever.forceSinglePart=true', piano)
        self.assertIn('org.audiveris.omr.sheet.ProcessingSwitches.indentations=false', piano)
        self.assertNotIn('org.audiveris.omr.sheet.rhythm.MeasuresBuilder.minStandardWidth=0', piano)
        self.assertEqual(piano[-4:], ['-sheets', '2', '--', 'input.pdf'])
        with self.assertRaises(ValueError):
            AudiverisAdapter(Path('provider'), profile='unknown').command(Path('input.pdf'), Path('out'), [])

    def test_timeout_terminates_local_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            started = time.monotonic()
            result = run_process([sys.executable, "-c", "import time; time.sleep(60)"],
                                 Path(temporary) / "log", 0.1)
            self.assertEqual(result.status, "timed_out")
            self.assertLess(time.monotonic() - started, 5)
            self.assertIsNotNone(result.exit_code)

    def test_interrupt_cancels_and_reaps_process(self):
        original_wait = subprocess.Popen.wait
        calls = 0

        def interrupt_once(process, *args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise KeyboardInterrupt()
            return original_wait(process, *args, **kwargs)

        with tempfile.TemporaryDirectory() as temporary, patch.object(subprocess.Popen, "wait", interrupt_once):
            result = run_process([sys.executable, "-c", "import time; time.sleep(60)"],
                                 Path(temporary) / "log", 30)
            self.assertEqual(result.status, "cancelled")
            self.assertIsNotNone(result.exit_code)


@unittest.skipUnless(shutil.which("pdfinfo"), "Poppler pdfinfo is required for CLI integration")
class CliTests(unittest.TestCase):
    def test_synthetic_pdf_provider_roundtrip_and_overwrite_guard(self):
        # A deliberately blank, original synthetic PDF: no licensed score data.
        objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
                   b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                   b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"]
        pdf = b"%PDF-1.4\n"
        offsets = [0]
        for index, body in enumerate(objects, 1):
            offsets.append(len(pdf))
            pdf += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(pdf)
        pdf += b"xref\n0 4\n0000000000 65535 f \n"
        pdf += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
        pdf += f"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            corpus = root / "input"
            corpus.mkdir()
            (corpus / "synthetic.pdf").write_bytes(pdf)
            executable = root / "fake-provider"
            executable.write_text(f"#!{sys.executable}\n"
                                  "from pathlib import Path\nimport sys\n"
                                  "output = Path(sys.argv[sys.argv.index('-output') + 1])\n"
                                  f"(output / 'result.xml').write_bytes({SCORE!r})\n"
                                  "print('Synthetic provider diagnostic')\n")
            executable.chmod(0o755)
            args = ["--audiveris", str(executable), "--input", str(corpus),
                    "--output", str(root / "results"), "--sheets", "1", "--version", "synthetic"]
            with redirect_stdout(io.StringIO()):
                self.assertEqual(main(args), 0)
            summary_path = root / "results" / "summary.json"
            summary_bytes = summary_path.read_bytes()
            summary = json.loads(summary_bytes)
            job = summary["jobs"][0]
            self.assertEqual(job["status"], "completed")
            self.assertEqual(job["pages"], 1)
            self.assertEqual(job["outputs"][0]["counts"]["note"], 1)
            self.assertEqual((root / "results" / job["directory"] / "original.pdf").read_bytes(), pdf)
            self.assertIn("Synthetic provider diagnostic", (root / "results" / job["directory"] / "recognition.log").read_text())
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
                main(args)
            self.assertEqual(raised.exception.code, 2)
            self.assertEqual(summary_path.read_bytes(), summary_bytes)


if __name__ == "__main__":
    unittest.main()
