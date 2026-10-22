# TypeNote — agent instructions

## Established implementation

- Browser app: React 19, TypeScript, Vite 7, VexFlow 5 SVG with embedded Bravura fonts for native scores, Verovio 6.3 WebAssembly in a local worker for imported MusicXML; npm and package-lock.json.
- Run `npm ci`, then `npm run dev`. Checks: `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` (requires `npx playwright install chromium`). No lint command is configured.
- Structured version-3 score lives in `src/domain/`. Timing uses reduced rational sixteenth-note units for dots/tuplets; meter and pickup determine capacity. Four voices per staff, breve through 128th durations, octave 0–8, measure-boundary signature/meter/clef changes. `NOTATION.md` records supported notation and limits.
- Confirmed input convention: default Auto follows key signature and in-bar accidental state without redundant local signs. H selects international step B; explicit Natural makes it B-natural. B always enters explicit B-flat. Named or manually assembled signatures are supported. Local Natural/Sharp/Flat/courtesy choices preserve display intent separately from pitch alteration.
- Version-3 notes/chords contain 1–10 pitches sharing one duration; pitch order is stable for individual editing. Duplicate step/octave positions are rejected. K/Build chord starts entry at one position; Enter finishes. Chord noteheads and pitch chips select individual pitches with a blue highlight; Delete/Backspace removes an explicitly selected pitch, while Delete event removes the whole event. Shift+Delete removes the active pitch. Pitch selection is included in undo/redo snapshots. Version-1 single-note and version-2 chord files are validated and migrated to version 3. File size limit is 10 MB.
- Validated `.typenote.json` files are downloaded and opened locally. No automatic persistence across reloads, backend, hosting, accounts, or PDF recognition is implemented.
- Direct PDF download uses pdf-lib and shared VexFlow engraving in `src/notation/`. A4 portrait, automatic pagination, ~15mm margins, and 300 dpi images of notation; no print dialog or external service. `src/export/` isolates pagination/export. Visually inspect actual rendered PDF pages after notation/export changes.
- UI MusicXML import uses `src/documents/`: complete score-partwise XML is authoritative in version-4 `{ kind: "musicxml" }` documents, with targeted pitch/fingering/metadata/direction edits and advanced source editing. Unknown source notation is retained, independently of renderer support. Imported history has up to 30 snapshots with a 32 MB budget. Compressed/timewise files are unsupported. `src/interchange/musicxml.ts` remains the native exporter and restricted compatibility adapter, not the UI import path.
- Imported rendering uses `src/notation/imported.ts` and `imported.worker.ts`; `src/export/importedPdf.ts` exports the same A4 pages at 300 dpi locally. Surface diagnostics, preserve source if rendering fails, and never replace original MusicXML with a renderer projection. Document source preservation, rendering and dedicated editing as separate capabilities. No PDF recognition provider is selected.
- `README.md` documents keyboard controls, measure editing semantics, architecture, and known scope limits.

## Product purpose and confirmed requirements

TypeNote helps musicians create and edit sheet music, motivated by playing piano.
The intended workflow is:
- Create a score from scratch by entering notes using the computer keyboard.
- Use letter-based pitch entry, including C, D, E, F, G, A and H.
- Import an existing sheet-music PDF and convert recognized notation into an editable score.
- Edit the musical content and export the result as a PDF.

The motivation includes reading music on an iPad while playing. This does not yet
establish the application platform or require a native iPad app.

These product goals do not imply that every feature exists. The confirmed implementation is recorded above; hosting, accounts and a recognition provider remain undecided. Do not silently turn suggestions into approved requirements.

## First steps in a code repository

- Read this file, relevant nested AGENTS.md files, the README, manifests and existing code.
- Establish what already works before changing it. Preserve unrelated user changes.
- Discover the actual install, development, build, lint, typecheck and test commands
  from project configuration. Do not invent commands or assume a package manager.
- If starting from an empty repository, propose a minimal architecture and explain
  major platform or dependency choices before committing to a substantial implementation.
  Ask only about decisions that materially change the product; handle routine details autonomously.
- For substantial tasks, state a short plan with concrete acceptance criteria and
  implement in small, verifiable steps. A request for one feature is not permission
  to implement the entire roadmap.

## Musical model and architecture

- Keep editable musical content separate from rendering, keyboard interaction,
  import recognition, storage and PDF export.
- Use a structured score as the source of truth. A PDF or rendered image alone is
  not an editable musical model.
- Reuse established music formats and notation libraries where suitable. Evaluate
  MusicXML as an interchange option; do not assume it is the chosen internal format.
- Model supported pitches, octaves, durations, rests, chords, measures, staves,
  voices, clefs, key signatures and time signatures explicitly as scope requires.
  Do not implement unsupported musical features merely to fill out the model.
- Represent musical timing exactly, such as rational durations or integer ticks,
  rather than accumulating floating-point rounding errors.
- Keep pitch spelling and sounding pitch distinguishable where needed: enharmonic
  equivalents can sound identical while requiring different notation.
- Clarify the intended H/B convention before implementing ambiguous input. The
  requested H notation must not silently become English B notation.
- Define how octave, duration, rests, accidentals, chords and cursor movement work
  before implementing their shortcuts. Letter entry alone does not specify them.
- Keep domain operations testable without rendering the entire UI.

## Editing experience

- Make the selected note, insertion position, octave and duration clear.
- Ensure editing shortcuts do not intercept typing in ordinary text inputs.
- Provide visible controls or help for keyboard actions; avoid undocumented shortcuts.
- Design changes as operations that can support undo/redo. Preserve existing undo behavior.
- Keep the notation readable when zoomed and on tablet-sized screens where applicable.
- Follow accessibility practices for controls, focus, labels and keyboard navigation.
- Distinguish implemented behavior from mockups, placeholders and future features.

## PDF import and export

- Treat PDF-to-score conversion as optical music recognition (OMR), not ordinary
  text extraction. Distinguish scanned pages from digitally generated PDFs.
- Isolate recognition behind an interface so a provider can be replaced without
  rewriting the editor. Investigate feasibility before promising import accuracy.
- Preserve the original PDF and keep recognition results editable for correction.
- Surface unsupported notation, incomplete recognition and uncertainty where the
  recognition system provides it. Do not silently fabricate musical content.
- Handle invalid, encrypted, oversized or unsupported files with useful errors.
  Keep expensive recognition work from blocking interaction and support cancellation
  where the selected platform permits it.
- Do not upload user scores to an external service without an explicit product
  decision and appropriate disclosure. Keep test documents small and licensed for use.
- Export from the current structured score. Check page breaks, margins, clipping,
  staff alignment and notation readability through rendered output inspection.
- Never report import or export as complete based only on a successful function call.

## Implementation conventions

- Follow the repository's language, formatting and architectural conventions.
- Prefer focused changes and existing dependencies. Explain significant new dependencies.
- Keep shared types and interfaces explicit; avoid duplicated musical logic.
- Avoid speculative abstractions and unrelated refactors.
- Protect saved scores. Validate imported data and preserve compatibility or provide
  a migration when changing an established persisted format.
- Never commit credentials, private scores or secrets, or expose them in logs.
- Do not delete user data, rewrite repository history, publish the app or incur paid
  services unless the user's instructions authorize it.

## Multiple agents

Use subagents for independent work when that improves speed or quality and the
runtime supports delegation. This instruction authorizes delegation; it does not
install or enable tooling that the runtime lacks. Complete small tasks with one agent.

The main agent owns the plan, architecture, shared contracts, integration and final
verification. Before parallel implementation:
1. Define task boundaries, acceptance criteria and dependencies.
2. Agree on shared score types and interfaces that cross task boundaries.
3. Give each subagent explicit file or directory ownership. Assign one owner to
   shared types, manifests, lockfiles, migrations and central configuration.
4. Tell each agent that other agents may be working concurrently and that it must
   preserve their changes. Communicate interface changes before dependent work proceeds.

Possible task divisions, when appropriate to the actual repository:
- Musical domain model and editing operations.
- Editor UI and keyboard interaction.
- Import/export adapters after their contracts are agreed.
- Independent review, test analysis or notation verification.

Do not launch parallel agents whose work depends on unresolved design decisions.
Use separate worktrees when supported and useful for overlapping edits; otherwise
serialize edits to shared files. Never have agents run conflicting Git operations
or competing dependency installations in one workspace.

Each subagent must return what changed, files affected, checks actually run, remaining
issues and integration notes. The main agent reviews the combined diff, resolves
conflicts deliberately and runs relevant checks against the integrated result.
Subagent completion alone is not evidence that the application works.

## Verification and completion

Use the checks actually configured by the repository. For behavior changes, add or
update focused tests where they provide meaningful protection. Prioritize:
- Correct pitch, octave, duration, accidentals and H/B mapping for supported input.
- Measure timing, supported chord/voice operations and undo/redo behavior.
- Save/load preservation of supported musical content, where persistence exists.
- Import failure handling and correction of recognized content.
- Exported PDF readability and preservation of supported notation.

For UI changes, exercise the affected workflow and inspect the rendered result when
possible. For notation and PDF changes, pair semantic checks with visual inspection;
a passing build cannot establish that a score is musically or visually correct.
Do not introduce a large test framework for a documentation-only or trivial change.

Before finishing, review for unrelated changes and report concisely:
- What works or changed.
- What was tested and the actual result.
- Known limitations, assumptions and any checks that could not run.

Never claim that tests, recognition accuracy, visual inspection or full-app behavior
were verified unless they actually were. Keep this file current as the project's
stack, commands and architecture become established; record confirmed facts only.
