# Local OMR evaluation harness

This is a reproducible feasibility tool, separate from TypeNote’s browser app.
It runs an explicitly supplied local Audiveris executable over a PDF folder,
sequentially. It does not install a provider, upload scores, or measure accuracy.
Python 3.10+ and Poppler `pdfinfo` on PATH are required on macOS/Linux.
The Audiveris executable must be installed separately and have its own runtime.

```sh
python3 scripts/omr/run.py \
  --audiveris /absolute/path/to/Audiveris \
  --version 5.11.0 \
  --input /absolute/path/to/scores \
  --output /private/tmp/typenote-omr-new-run \
  --timeout 600 \
  --sheets 1
```

Omit `--sheets` for all pages, or use comma-separated 1-based page numbers such
as `--sheets 1,2`. A first-page run is a smoke test, not a whole-score evaluation.
PDFs are discovered recursively and sorted. The output directory must not exist
and must be outside the corpus. Keep it outside version control: originals,
provider logs and MusicXML can contain private or copyrighted score content.

Each job preserves `original.pdf` with its SHA-256, provider `raw/` files including
`.omr` projects, `recognition.log`, `result.json`, and complete extracted
`musicxml/*.musicxml` files. The runner reads MXL container declarations without
extracting archive paths to disk. It rejects unsafe/duplicate paths, encrypted
entries, entity declarations, and excessive archive/XML sizes. Original PDFs
over 100 MiB are hashed and rejected without copying; their path is retained.
Encrypted or unreadable PDFs are rejected before recognition. XML bytes are
preserved, including unknown elements; output inspection only validates XML
syntax/root and records element counts. These counts are not correctness scores.

`summary.json` records all jobs, commands, source hashes, supplied provider version
label, launcher hash, operating system, timing, timeout/exit status, diagnostics,
raw output paths and MusicXML counts. The version is an evaluator-supplied label,
not an automatic verification of the installed provider. Review provider logs
for recognition warnings; Audiveris does not supply a calibrated per-note
confidence score here. `completed` only means a zero exit code and inspectable
MusicXML, including potentially incomplete or incorrect recognition.

Timeout and Ctrl+C stop the process group (including a launcher’s JVM), preserve
partial files and record the result. Ctrl+C then ends the corpus run. The exit
status is 0 when every job completed, 1 for rejected/failed/timed-out/missing-output
jobs, and 130 for cancellation. Partial MusicXML can be present after failure;
the failure status is retained. Re-run into a fresh output directory.

Open a generated uncompressed score-partwise `.musicxml` in TypeNote to review
and correct it. The `typenote_import_within_known_limits` flag checks only root
type and the app’s 10 MiB size limit, not acceptance by its complete validator.
Compare pitch, rhythm, voices, staves, accidentals, chords, markings, repeats and
layout against the preserved PDF before drawing any accuracy conclusion.

The adapter contract in `adapter.py` builds a command from a source PDF, output
directory and optional sheets. Process management and corpus reporting stay in
the harness; another local command-line provider can replace that adapter.
No provider selection or browser OMR integration is implied by this experiment.

Run the synthetic safety/process tests:

```sh
python3 -m unittest discover -s scripts/omr -p 'test_*.py'
```

## Hand-audited excerpts

`audit.py` compares an independently transcribed reference with a single-part
score-partwise output. Keep private reference transcriptions outside version
control. Each sample names a staff and measures; each event supplies rational
quarter-note onset/duration pairs and spelled pitches. For example:

```json
{"samples":[{"id":"synthetic","staff":1,"measures":[{"number":1,"events":[
  {"onset_quarters":[0,1],"duration_quarters":[3,4],
   "pitches":[{"step":"C","alter":0,"octave":4}]}
]}]}]}
```

```sh
python3 scripts/omr/audit.py \
  --reference /private/tmp/hand-reference.json \
  --sample synthetic \
  --musicxml /private/tmp/recognition.musicxml
```

The comparator reports exact event/chord matches and pitch instances matching
spelling, onset and duration, including missing/changed and extra/changed events.
It follows divisions, backup, forward and chord elements with rational timing.
Rests have an empty pitch list. Numeric voice IDs are ignored; select a known
staff/line and interpret extra simultaneous voices explicitly. Grace/unpitched
notes, multiple parts, ambiguous measure numbers and missing timing context
produce errors rather than guessed results. Dynamics, words, metronome text,
fingering and tie/slur endpoint counts are observations for separate manual
comparison. Context (clef/key/meter), layout and display intent need visual review.
An excerpt match is not a whole-score accuracy estimate.

For browser verification, run TypeNote locally, open the generated `.musicxml`,
compare its pages with `original.pdf`, correct a note, undo/redo, save and reopen
the TypeNote file, then download PDF and inspect its rendered pages. Keep the
original PDF alongside the editable result: TypeNote's version-4 document does
not embed the PDF. The experiment does not add a browser PDF-import button.

For a manual retry from an existing `.omr` project, copy the project into a fresh
recovery directory first. Audiveris can save the loaded project and export beside
it even when `-output` specifies another directory. Keep that recovery operation
separate from the original job's status and files.

Playwright is configured to clean only `test-results/e2e/`, so the ordinary
`npm run test:e2e` command preserves sibling OMR evaluation folders. If overriding
its output directory, keep it separate from evaluation artifacts; Playwright
cleans the selected directory before running tests.
