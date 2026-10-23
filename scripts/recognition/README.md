# Local browser PDF recognition bridge

`pdfRecognitionPlugin()` installs a local API in Vite development and preview.
It uses only Node built-ins and Python's standard library, reusing the OMR adapter
and MusicXML inspection from `scripts/omr`. No score is sent to an external service.
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

API prefix: `/api/pdf-recognition`.

- `GET /status`: local dependency availability.
- `POST /jobs?pages=1,2,4-6`: raw `application/pdf`, optional URI-encoded
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
