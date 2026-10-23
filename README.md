# TypeNote

A local piano score editor built with React, TypeScript, Vite, VexFlow SVG notation for native scores, and Verovio for imported MusicXML. Native/XML scores stay in the browser until you download an editable file. PDF recognition copies a selected PDF to a local recognition folder on this computer. There are no accounts or external score uploads.

## Run locally

Use Node.js 22.20 or newer (supported Node 22 LTS recommended) and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Stop the server with Ctrl+C.

## Native score editor

- Piano grand staff with up to four independent voices per staff, chords of up to ten pitches, cross-staff notes, and split-staff chords.
- Named major/minor and manually assembled key signatures, local/courtesy/double accidentals, meter changes, pickups, and clef changes at measure boundaries.
- Breve through 128th durations, single/double dots, tuplets, rests, full-measure rests, beams, and stem/rest positioning.
- Dynamics, hairpins, ties, slurs, articulation, fermatas, ornaments, grace notes, arpeggios, tremolos, fingering, pedal and octave lines, and glissandi.
- Tempo/metronome and expressive text, rehearsal marks, repeats/endings, navigation marks, composer, and system/page breaks.
- Keyboard entry, clickable insertion positions and events, and undo/redo for up to 100 edits.
- Local versioned `.typenote.json` save/open, uncompressed MusicXML interchange, and direct A4 PDF download.

See [notation coverage and limits](NOTATION.md) for supported forms and verification. The editor does not implement every engraving convention or every MusicXML feature.

**Save score downloads a file.** Keep that file and use Open file to continue later. The editor does not autosave across refreshes and cannot overwrite an existing file directly. A browser navigation warning protects unsaved edits where the browser permits it. Undo history is session-only and is cleared when opening or creating a score.

## Imported scores

**Open PDF** lets you select a PDF and recognize it locally. Choose **Recognize PDF** to process all pages, or enter page numbers/ranges such as `2-5,8` to skip a cover or import a smaller section. Recognition takes time and can be cancelled. A single successful result opens automatically in the MusicXML editor as an **unsaved** document. Use **Save score** to download an editable version-4 `.typenote.json`, or **Save MusicXML** for the XML itself.

Recognition can lose notes, rhythm, voices and markings. Compare the result with **View original PDF** and review recognition/engraving diagnostics. If recognition creates several documents, choose which result to open; **Recognition results** lets you return to the other outputs. Failed/cancelled jobs retain their originals and provider files; any readable partial results are clearly labelled and open only when selected. An unsuccessful import preserves the current score.

PDF import works through the local server started by `npm run dev` or `npm run preview`. It requires Python 3, Poppler `pdfinfo`, and a local Audiveris executable with OCR language data. This workspace has its evaluated runtime configured in ignored `.typenote-tools/`. On another computer, install those tools and set `TYPENOTE_AUDIVERIS` to the Audiveris executable before starting TypeNote, for example on macOS:

```sh
TYPENOTE_AUDIVERIS='/Applications/Audiveris.app/Contents/MacOS/Audiveris' npm run dev
```

The app also discovers `.typenote-tools/audiveris` or `audiveris` on PATH; `TYPENOTE_PYTHON` can select a Python executable. Missing tools produce setup feedback. No automatic downloads, paid service, or remote recognition is used. A static deployment of `dist/` alone cannot run the local recognition process. See [local recognition setup and API](scripts/recognition/README.md).

Accepted PDFs and recognition files are retained under ignored `.typenote-imports/<job-id>/`, including `original.pdf`, complete MusicXML, `.omr` projects, logs and job status. This folder is blocked from ordinary static-file serving; the local import API provides the original and result downloads. Limits: 100 MiB/PDF, 200 source pages, one recognition job at a time, ten minutes/job. Encrypted, unreadable or invalid PDFs are rejected. Source files are kept until you remove the relevant local job folder; TypeNote JSON contains the editable XML, **not the original PDF or a recognition project bundle**. Recognition history/source links are not restored from saved JSON.

**Open MusicXML** opens an uncompressed `.musicxml` or `.xml` score-partwise document locally. The complete XML is the editable source, rather than a conversion into the smaller native score model. Unknown notation and layout attributes are retained through targeted edits and saving. XML formatting may change and selectable elements receive stable IDs; this is structural preservation, not a byte-for-byte archive. Keep the original file as well.

Verovio engraves the score in a local WebAssembly worker, including notation outside the native editor’s model. Click an individual notehead (including chord members) to highlight and correct its pitch, octave or accidental. The note selector also includes hidden and cue notes. C D E F G A H replace the selected pitch; B enters explicit B-flat. Auto follows the active signature and local accidental context; Natural writes ♮. Arrow keys select adjacent notes or change octave. Fingering, title, composer, dynamics, expression text and rehearsal marks have dedicated controls. Unambiguous tied pitches are corrected together; ambiguous ties require source editing.

**Advanced MusicXML editing** allows structural, rhythmic and other corrections without a dedicated control. Apply source changes validates XML structure and creates an undo step; it does not perform complete MusicXML schema or musical validation. Imported-score undo retains up to 30 snapshots subject to a 32 MB history budget. **Save score** downloads a version-4 `{ kind: "musicxml" }` TypeNote file containing the complete XML. **Save MusicXML** downloads that XML directly. Reopen TypeNote JSON through Open file and XML through Open MusicXML; the imported-score Open file control accepts both.

Rendering is separate from preservation: Verovio cannot guarantee faithful display of every MusicXML construct or engraving combination. Review displayed engraving diagnostics and the resulting pages. Source content remains saveable even if rendering fails. Opening MusicXML directly bypasses PDF recognition. See [coverage and limits](NOTATION.md).

## Native editor controls

Click a gap or press **Enter music** to focus the editor. Shortcuts are active only within the editor and do not intercept text inputs or selectors.

| Control | Action |
| --- | --- |
| C D E F G A H | Enter a written pitch at the selected octave; Auto follows the signature and local accidental state |
| H / B | H selects the international B staff position; Natural makes it B-natural. B always explicitly enters B-flat |
| 1 / 2 / 3 / 4 / 5 | Whole / half / quarter / eighth / sixteenth |
| R | Enter a rest with the chosen duration |
| K / Build chord | Start adding pitches at one position; press Enter or Finish chord to advance |
| Shift+Delete / Shift+Backspace | Remove the selected pitch; removing the last pitch deletes the event |
| Left / Right | Move between insertion positions and measures |
| Up / Down | Change octave; C4 is middle C |
| Backspace at a gap | Delete the preceding event in that measure |
| Delete or Backspace on a selection | Delete the selected chord pitch, or the event if selected as a whole |
| Escape | Return from selected event to the gap before it |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z | Redo |

Click a note/rest to select it. Toolbar controls edit the selection. For chords, click an individual notehead or a pitch chip to choose the pitch to edit. The chosen notehead lights up in blue, and undo/redo restores that pitch selection. Typing a pitch replaces only that selected pitch and advances the cursor; R replaces the entire event with a rest. Delete or Backspace removes a selected chord pitch. The **Delete event** button removes the whole event. Choose a staff from the toolbar or click its notation. Auto is the default accidental setting. In G major, typing F creates an F-position notehead with no local sharp; the key signature supplies F-sharp. Choose Natural to explicitly print ♮ and make it F-natural. Choose Auto to return to inherited accidentals. An explicit accidental selection persists for subsequent entry. H with Flat also spells B-flat. Internal pitch step B uses international pitch spelling, while all user-facing labels follow H/B.

**Build a chord:** press K at a gap and type C E G, then Enter. To extend an existing note/chord, select it and press K. In chord mode, octave and accidental controls apply to new pitches; duration changes the whole chord. Pitch changes do not advance time until you finish. Escape leaves the entered notes intact and returns to the gap before the event. Clicking a chord notehead or pitch chip exits chord mode and edits that existing pitch. Duplicate staff positions (the same step/octave, even with different accidentals) are rejected.

Insertion and deletion shift later events **within the current measure only**. Each voice must fit the current meter or pickup length. Durations use exact rational timing, including tuplets. Entry that fills a measure advances to the next one (creating a measure if necessary). Empty time appears as gray rest placeholders; it is not saved as musical content. Add real rests with R. Scores may contain up to 200 measures, with octave numbers 0–8. Notes outside the acoustic piano range are currently allowed.

## Notation tools

Use **Score & measure** to choose a named key or change the seven signature steps manually. The setting applies from the selected measure until the next change. Changing a signature recalculates automatic pitches while retaining explicit local accidentals. Both staves share the signature and meter; their clefs can differ. Meter changes are rejected if existing events would overflow.

Choose **Voice 1–4** for an independent line. **Note & rhythm** edits the selected event: extended durations, dots, tuplet groups, beams, stems, staff assignment, articulation and ornaments. Pitch chips choose which chord pitch receives a fingering, courtesy sign or staff assignment. A full-measure rest fills an empty voice (or replaces its sole event) and follows subsequent meter changes.

For a tuplet, enter its events, select the first, then choose the ratio and **Group next … events**. Use shorter base durations initially if the ungrouped notes would overflow the bar. Tuplet removal must also fit the measure. For a manual beam, choose Start on the first short note, Continue on intermediate notes, and End on the last.

Use **Marks & spans** for dynamics and expression. Select a note and add a single marking. For a span, select its first note and **Set start**, select its last note and **Set end**, then **Add marking**. Repeat endings can use measure positions. The marking list supports editing and removal. Tempo accepts text or a metronome value such as `quarter = 120` or `Allegro · quarter = 120`. These operations participate in undo/redo.

## PDF download and file compatibility

**Download PDF** creates an A4 portrait PDF from the current score, including unsaved edits. It does not open a print dialog or upload anything. The export uses a snapshot, so editing can continue during export. Use Cancel export to stop it. Exporting does not mark the editable document as saved.

Native-score PDFs have approximately 15 mm margins, a title, page numbers, and automatic system/page breaks. Each grand-staff system stays together. Incomplete measure time is printed as black rests; empty trailing measures are retained. PDF export uses 300 dpi notation images rather than vector notation or selectable musical text. Unusually dense measures that cannot fit legibly produce an error instead of being clipped. Notation and title rendering reuse the browser's locally available fonts; music fonts are bundled.

Native editable files use **version 3**; imported MusicXML documents use **version 4**, as described above. The editor validates and migrates original version-1 single-note and version-2 chord files on opening, preserving pitches, durations, IDs, title, and measures. The older first-milestone application cannot open version-3 files. Files may be up to 10 MB, enough for the supported maximum of 200 measures with 10-pitch chords. Keep the editable TypeNote file as well as your PDF. Imported-score PDFs use the same Verovio A4 pages as the preview, including their approximately 15 mm margins, rasterized at 300 dpi; export is cancellable and stays local.

## Architecture

- `src/domain/types.ts`: version-3 score schema. `timing.ts` computes exact rational durations; `settings.ts` resolves inherited musical settings. Notes/chords contain 1–10 pitches with stable editing order.
- `src/domain/model.ts`: immutable, renderer-independent musical operations.
- `src/domain/validation.ts`: shared structural and musical validation.
- `src/domain/history.ts`: bounded undo/redo snapshots including cursor position.
- `src/domain/storage.ts`: JSON file boundaries, size checks, and version validation.
- `src/notation/engraving.ts`: shared VexFlow notation, accidental handling, and system geometry for SVG editing and Canvas export.
- `src/components/ScoreView.tsx`: responsive SVG grand staff and selection targets. `NotationPanel.tsx` provides notation controls.
- `src/export/`: A4 pagination and PDF generation using `pdf-lib`, loaded when exporting. This dependency packages rendered systems into PDF pages entirely in the browser.
- `src/interchange/musicxml.ts`: native-score MusicXML exporter and restricted compatibility adapter; the UI no longer imports through this reduced model.
- `src/documents/`: version-4 complete MusicXML documents, targeted DOM edits, inspection and local serialization.
- `src/components/ImportedScoreEditor.tsx`: imported-score selection, correction, source editing and bounded history.
- `src/notation/imported.ts` and `imported.worker.ts`: cancellable local Verovio rendering and sanitized SVG output.
- `src/export/importedPdf.ts`: imported-score A4 PDF generation from the same rendered pages.
- `src/App.tsx`: editor controls, keyboard interaction, and file download/open.
- `src/components/PdfImport.tsx` and `src/documents/recognition.ts`: PDF selection, local job progress/cancellation, output selection, and opening complete MusicXML in the existing editor.
- `scripts/recognition/`: loopback-only Vite development/preview API and Python recognition worker, reusing the replaceable local OMR adapter. Private originals/results stay in `.typenote-imports/`; the runtime is configured separately from browser assets.

New schema versions must preserve compatibility or explicitly migrate old scores. Native scores use the version-3 domain model; imported scores retain complete MusicXML inside version-4 TypeNote JSON. Renderer projections are never written back as the authoritative imported score. PDF recognition uses the separate local adapter and opens its complete MusicXML through that same version-4 path.

## Checks

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests cover musical operations, chords, H/B spelling, timing boundaries, migration, persistence validation, undo/redo, and pagination. Browser tests exercise keyboard editing, chord controls, file round trips, direct PDF download, cancellation, and desktop/tablet rendering. Downloaded PDFs are checked for A4 dimensions and page counts. Actual exported pages were also rendered with `pdftoppm` and visually inspected; the PDF metadata checks alone do not establish notation correctness. Playwright starts and stops its own local Vite server. Screenshots, PDFs, and traces are generated under ignored `test-results/`.

The bundled Verovio renderer is LGPL-3.0-or-later. See [third-party notices](THIRD_PARTY_NOTICES.md) for attribution, license copies and upstream source.

## Later milestones

Playback is not implemented. Local PDF import is available as described above; recognition accuracy, structural correction tools and production distribution still need further work. Further notation work should use the explicit gaps in [NOTATION.md](NOTATION.md), rather than assuming exhaustive coverage.

The [local OMR feasibility investigation](docs/omr-feasibility.md) evaluates the 15 supplied PDFs using Audiveris, with source-quality review, hand-checked excerpts and correction/export checks. The [evaluation harness](scripts/omr/README.md) preserves original PDFs, recognition projects, complete MusicXML and diagnostics locally. It requires a separately installed command-line provider, Python and Poppler; it is separate from the browser app. Generated uncompressed MusicXML can be opened using the existing correction workflow. Original PDFs remain alongside the results and are not embedded in saved TypeNote documents.

Recognition needs review and correction before use. A generated XML file or readable preview does not establish that all notes, rhythm, voices or expression were recovered. Local import currently uses Audiveris; an external upload service and packaged application distribution have not been selected. [PROGRESS.md](PROGRESS.md) records completed work and remaining milestones.
