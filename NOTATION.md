# Piano notation coverage

TypeNote separates musical content from engraving, interaction and PDF generation. Native version-3 scores use VexFlow and event/measure anchors. Imported version-4 documents retain complete MusicXML and use Verovio 6.3 in a local worker. PDF import uses a local Audiveris process through the development/preview server. There is no external recognition service or playback engine.

Preserving a construct, rendering it correctly, and providing a dedicated editing control are separate capabilities. Full XML preservation does not imply exhaustive professional engraving or full visual authoring.

## Native editor controls and data

| Area | Supported forms | Editing and output |
| --- | --- | --- |
| Piano structure | Two staves, up to four voices each, 1–10 pitches in a chord | Voice selector; per-event/per-pitch display staff; SVG and PDF |
| Pitch spelling | C D E F G A H entry, B-flat shortcut, octave 0–8, double-flat through double-sharp | Auto, explicit and parenthesized courtesy accidentals; local state resets each bar |
| Key signatures | All standard major/minor signatures and manual alterations on seven pitch steps | Shared signature on both staves; changes at measure boundaries; inherited at new systems |
| Meter and clefs | Numerators 1–32, denominators 1/2/4/8/16/32, additive beat grouping, pickups; treble/bass/alto/tenor clefs | Capacity checked per voice; changes at measure boundaries |
| Rhythm | Breve through 128th, one/two dots, non-nested tuplets with ratios up to 32, rests and full-measure rests | Exact rational timing; contiguous tuplet groups; full-measure rests follow meter |
| Beaming and placement | Automatic beat grouping, manual beam groups, stem directions, rest positions, cross-staff notes/beams/chords | Shared SVG/PDF engraving; explicit stem choices retained |
| Connections | Ties, slurs, straight/wavy glissandi | Select two note anchors; ties require matching spelled pitches; continued across systems/pages |
| Dynamics | pppp–ffff, mp/mf, sf/sfz/sffz/fp/rfz, crescendo/diminuendo hairpins | Markings and spans with above/below placement |
| Articulation | Staccato, staccatissimo, accent, tenuto, marcato, fermata, breath | Event checkboxes; fermatas also available on rests |
| Ornaments | Trill, mordent/inverted mordent, turn/inverted turn/delayed turn | Selected-event ornament control |
| Piano details | Finger numbers/substitutions, up/down arpeggios, single-note/two-note tremolos, slashed/unslashed grace notes | Grace pitch/octave/accidental/duration editing; chord pitch fingerings |
| Performance lines | Sustain, sostenuto, soft-pedal; 8va/8vb/15ma/15mb | Spans with continuation and end hooks |
| Directions | Tempo/metronome, expression text, rehearsal marks | Text editor and placement; no playback interpretation |
| Navigation | Start/end repeats, numbered endings, segno/coda/Fine, D.C./D.S. and al Fine/al Coda, To Coda | Visible notation; no repeat unfolding/playback |
| Presentation | Title/composer, measure numbers, single/double/final barlines, system/page breaks | Direct A4 download with automatic pagination and manual break hints |
| Persistence | Version-3 local JSON, migrations from v1/v2, undo/redo | Local JSON preserves supported model data; imported documents validated before replacement |

## Verification

The repository includes domain tests for rational timing, voices, signatures and accidental state, anchors, migration and persistence. Engraving tests cover accidentals, inherited settings, annotation continuation and page breaks. Browser tests exercise notation controls, note/rest conversion, keyboard editing, JSON round trips, MusicXML semantics, and a representative annotated piano study exported to PDF. Actual PDF pages are rasterized and visually inspected after engraving changes.

The MusicXML exporter is also checked against the official MusicXML 4.0 schema on a generated coverage fixture. A schema-valid file alone does not establish visual or semantic fidelity in other notation applications.

## Native model boundaries

The following are outside the version-3 native model or its engraving guarantees. Musical constructs can be retained in imported MusicXML without converting to that model; automatic collision resolution remains a rendering limitation:

- Clef/signature changes within a measure; independent simultaneous key/meter signatures on the two staves; nested tuplets; tuplets spanning barlines.
- Arbitrary engraving offsets, stemless/hidden notes, cue-size passages, special noteheads, multiple ornaments on one event, ornament-specific accidentals, trill extension lines, and complex grace-note timing.
- Separate durations for notes sharing one chord event (use voices), unlimited voices, additional staves, or multiple instruments.
- Open-ended repeat endings, repeat-count semantics, playback tempo maps, half-pedal depth and pedal-change notches. Separate spans can describe pedal releases and re-engagements.
- Fully automatic collision resolution for every dense combination. Explicit breaks and shorter systems help; very dense systems can be rejected by PDF export to preserve readability.

Native markings currently anchor to events or complete measures. An insertion gap is treated as a measure anchor for markings. Exact offsets between events and endpoints after a final event are retained in the full MusicXML document, but have no equivalent native anchor.

## Complete MusicXML documents

The UI imports uncompressed `.musicxml`/`.xml` **score-partwise** files into a separate source-preserving editor. It retains elements and attributes outside the native model, including extra parts/staves/voices, independent staff settings, mid-measure changes, nested and bar-spanning tuplets, hidden/cue/stemless notes, special noteheads, multiple ornaments and ornament accidentals, trill extensions, exact direction offsets, pedal changes, and open repeat endings. Unknown elements are retained too. Serialization can normalize XML formatting and add stable selection IDs; retain the original file when exact original bytes matter.

| Capability | Imported-score behavior |
| --- | --- |
| Display and PDF | Verovio engraving, sanitized SVG pages, local A4 PDF at 300 dpi; rendering diagnostics surfaced |
| Note correction | Individual chord-note selection, pitch/octave/accidental controls, H/B keyboard convention, fingering |
| Note entry | Fill/split a rest; insert using an adjacent rest or unused final-voice time; keyboard Insert/Build chord modes; staff/voice inherited from selection |
| Rhythm and deletion | Breve–128th with up to two dots when exactly representable at source divisions; change whole-chord duration; shorter events leave rests, longer events consume following rests; delete a chord tone or replace a plain note with a rest |
| Bar insertion | Empty aligned bar before/after selection across parts with equal bar lengths; active staves/observed voices receive rests; preserve original bar labels and assign a unique new label |
| Ties | Unambiguous connected pitches edited together; ambiguous/incomplete or cross-staff/voice chains require source editing |
| Directions and metadata | Title/composer; simple dynamics, expression words and rehearsal text |
| Other notation | Complete source retained; advanced XML editor for changes without dedicated controls |
| Save/open | Version-4 TypeNote JSON wraps complete XML; direct MusicXML download retains the same source |
| Undo/redo | Document, note selection and entry mode/position; up to 30 snapshots, bounded by a 32 MB history budget; session-only |

The `full-piano.musicxml` and `nested-rhythm.musicxml` fixtures exercise source retention, extended engraving, pitch corrections and PDF output. Automated SVG element checks establish only that elements reached rendering; visual inspection is still necessary for placement, connections and collisions.

### Imported-score limits

- Compressed `.mxl` and score-timewise documents are not accepted. Files and saved documents are limited to 10 MB.
- Entity declarations and internal DTD subsets are rejected. External DTD declarations are inert; no remote DTD or score resources are fetched.
- Opening checks XML structure, identifiers and document shape, not every MusicXML schema constraint or musical inconsistency.
- The dedicated pitch controls support conventional semitone alterations from double-flat through double-sharp. Other pitches and notation remain in source; they are not silently approximated.
- Complex dynamics, multiple fingerings and ambiguous accidental/tie contexts can require advanced source editing. Source editing is not a substitute for a full visual notation-authoring interface.
- Structural controls work with integer source timing and supported meter; no automatic rescaling of divisions, cross-bar ripple, new voice/staff creation, or tuplet/tie/grace rewriting. Edits to unsupported connected notation, referenced rests, ambiguous chord timing or already overfull bars are rejected. Duration edits retain independent fingerings, basic articulations and fermatas; more complex markings can require source editing. Rhythm changes clear affected explicit beam runs for the engraver to regroup. Original source outside the edited passage remains authoritative.
- Verovio's MusicXML conversion and engraving have their own limits. Preserved source constructs may render differently or incompletely, especially complex interacting beams and tuplets. Diagnostics are useful but are not a complete unsupported-feature detector. A successful render or PDF download is not a guarantee of fidelity.
- PDF output follows the rendered projection, not invisible source semantics. Review preview and exported pages before relying on them.

## Native MusicXML adapter

`src/interchange/musicxml.ts` exports native version-3 scores to standard MusicXML and retains its restricted importer for compatibility tests. The UI's Open MusicXML action uses the complete-document path above, not this reduced adapter. Native MusicXML export does not preserve every TypeNote ID or automatic-versus-explicit display choice; save native TypeNote JSON for continued editing.

PDF-to-score recognition has a separate [local feasibility investigation](docs/omr-feasibility.md) and [evaluation harness](scripts/omr/README.md). **Open PDF** now runs the local recognition adapter from the browser UI through the local development/preview server. Recognition output is retained as complete MusicXML, with the original PDF kept separately in the local job folder. Provider recognition, source preservation, rendering and dedicated correction controls remain separate capabilities; successful export or rendering is not an accuracy guarantee. Multiple documents and partial failures are surfaced for review. Dedicated structural/rhythm repair still requires advanced MusicXML editing or provider-project corrections. No external upload service is configured.
