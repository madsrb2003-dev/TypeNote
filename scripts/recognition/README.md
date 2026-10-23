# Local browser PDF recognition bridge

`pdfRecognitionPlugin()` installs a local API in Vite development and preview.
The default path uses Node built-ins and Python's standard library, reusing the
OMR adapter and MusicXML inspection from `scripts/omr`. Experimental scan
preparation uses optional local image dependencies. No score is sent to an external service.
The bridge is restricted to loopback clients, localhost hosts and same-origin
requests. Mutation requests also require `X-TypeNote-Request: pdf-import`.
Private `.typenote-imports` and `.typenote-tools` static paths are blocked.

Requirements: Python 3 and Poppler `pdfinfo` on PATH, plus Audiveris. Executable
selection uses `TYPENOTE_AUDIVERIS`, then `.typenote-tools/audiveris`, the macOS
application, or `audiveris` on PATH. `TYPENOTE_PYTHON` overrides `python3`.

Each accepted PDF gets a UUID folder in ignored `.typenote-imports`. The complete
original PDF, provider files, recognition log, extracted MusicXML bytes and atomic
`result.json` are retained. Multiple scores remain separate. Provider failures can
have partial scores; their status remains failed. Recognition is limited to one
active job per local server, 100 MiB per PDF, 200 pages and ten minutes. Cancel
stops the Python worker and the provider's process group. Original PDFs remain
available for comparison. Stale unfinished jobs are marked failed after restart.
The bridge does not measure recognition accuracy.

Browser recognition explicitly rasterizes PDFs at 400 dpi. On the supplied
Departure scan, Audiveris's 300 dpi default dropped an upper staff, invented a
separate Voice part and collapsed three bars into one. At 400 dpi it recovered
one two-staff piano part and all 34 bars. This does not restore every note or
clef: the result still needs musical review. The evaluation harness retains its
provider-default resolution so historical runs remain reproducible.

Read-only project checks flag systems with fewer recognized staves than the
usual layout. Layout changes can be intentional; these checks never reassign
notes or change clefs. Provider rhythm failures logged at INFO level are also
surfaced in recognition diagnostics. Original PDFs and raw provider outputs
remain unchanged. See `docs/departure-recognition-review.md` for the comparison.

## Experimental curved piano scans

**Standard** remains the default. **Curved piano scan** treats the PDF as one
piano piece, relaxes staff-line tracking and optionally straightens photographed
pages locally. Do not use this grouping mode for separate pieces or ensembles.
It improves some supplied scans but does not guarantee correct notes or rhythm.

Install optional preparation dependencies into the Python environment selected by
`TYPENOTE_PYTHON`:

```sh
python3 -m pip install -r scripts/recognition/requirements-scan.txt
```

Preparation also needs Poppler `pdftoppm`. It rasterizes grayscale PGM at 400 dpi,
retains grayscale PNG pages and coordinate maps, and gives Audiveris a binary TIFF.
Local thresholds are capped below white to avoid inventing dark halos beside
faint lines. Original PDFs are never replaced. Limits are 20 pages, 24 million
pixels/page, 180 million pixels total and 180 seconds within the ten-minute job.
Missing dependencies, uncertain staff geometry or exceeded limits leave the
original PDF as input and produce a diagnostic. Piano grouping still applies.
Prepared page-text crops use the matching grayscale images and coordinates.

Known provider crashes can trigger one bounded project-copy recovery: remove only
unreferenced zero-pixel glyph records, or retry a piano courtesy-measure failure.
Original projects and logs remain; all requested pages must complete. Diagnostics
also flag unplaced chords, rhythm failures and deleted barline columns. These are
warnings for manual comparison, not automatic musical corrections.

See [current corpus findings](../../docs/omr-recovery-review.md).

API prefix: `/api/pdf-recognition`.

- `GET /status`: local dependency availability.
- `POST /jobs?pages=1,2,4-6&mode=piano-scan`: raw `application/pdf`, optional mode (omit for Standard), optional URI-encoded
  `X-TypeNote-Filename`; returns HTTP 202 with a job ID.
- `GET /jobs/:id`: status, message, bounded diagnostics and distinct output IDs.
- `POST /jobs/:id/cancel`: requests cancellation.
- `GET /jobs/:id/outputs/:outputId`: complete MusicXML.
- `GET /jobs/:id/original`: original PDF for inline viewing.
- `GET /jobs/:id/log`: complete local provider log download.

Tests use synthetic PDFs/scores and local fake executables:

```sh
python3 -m unittest discover -s scripts/recognition -p 'test_*.py'
node --test scripts/recognition/plugin.test.mjs
```

Node HTTP integration tests need permission to open a temporary loopback socket;
Python tests also verify that cancellation stops provider child processes.
