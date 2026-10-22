import { useEffect, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ImportedScoreEditor } from './components/ImportedScoreEditor';
import type { MusicXmlDocument } from './documents/types';
import { NotationPanel } from './components/NotationPanel';
import { effectiveSettings, resolvePitch } from './domain/settings';
import { measureCapacity } from './domain/timing';
import { ScoreView } from './components/ScoreView';
import { addChordPitch, updateChordPitch, removeChordPitch, appendMeasure, createDemoScore, createScore, deleteEvent, insertEvent, newId, pitchFromKey, pitchLabel, updateEvent, usedTicks, getEvents } from './domain/model';
import { historyReducer, initialHistory } from './domain/history';
import { parseScore, serializeScore } from './domain/storage';
import { DURATIONS, DURATION_LABELS, MAX_SCORE_FILE_BYTES } from './domain/types';
import type { Duration, Pitch, Score, ScoreEvent, Selection, StaffId } from './domain/types';

const firstPosition: Selection = { kind: 'gap', staff: 'treble', measureIndex: 0, index: 0 };
function DurationIcon({ duration }: { duration: Duration }) {
  return <svg className="music-symbol" aria-hidden="true" width="23" height="29" viewBox="0 0 23 29">
    <ellipse cx="9" cy="22" rx={duration === 16 ? 6 : 4.5} ry="3" transform="rotate(-20 9 22)" fill={duration >= 8 ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="1.6" />
    {duration !== 16 && <path d="M13 21V3" stroke="currentColor" strokeWidth="1.6" />}
    {duration <= 2 && <path d="M13 3C13 8 21 8 18 15C19 8 14 10 13 8Z" fill="currentColor" />}
    {duration === 1 && <path d="M13 8C13 13 21 13 18 20C19 13 14 15 13 13Z" fill="currentColor" />}
  </svg>;
}

export default function App() {
  const [imported, setImported] = useState<MusicXmlDocument | null>(null);
  const [nativeInitial, setNativeInitial] = useState<Score | undefined>();
  if (imported) return <ImportedScoreEditor initial={imported} onNew={() => { setNativeInitial(undefined); setImported(null); }} onNative={score => { setNativeInitial(score); setImported(null); }} />;
  return <NativeEditor initialScore={nativeInitial} onImported={setImported} />;
}

function NativeEditor({ initialScore, onImported }: { initialScore?: Score; onImported: (doc: MusicXmlDocument) => void }) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => initialHistory({ score: initialScore ?? createScore(), selection: firstPosition }));
  const { score, selection } = history.present;
  const [entryOctave, setOctave] = useState(4);
  const [entryDuration, setDuration] = useState<Duration>(4);
  const [entryAlter, setAlter] = useState<Pitch['alter'] | 'auto'>('auto');
  const [chordMode, setChordMode] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const [message, setMessage] = useState('Ready. Choose a position and type a note.');
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(() => serializeScore(history.present.score));
  const [helpOpen, setHelpOpen] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);
  const openRequest = useRef(0);
  const dirtyRef = useRef(false);
  const selected = selection.kind === 'event' ? getEvents(score.measures[selection.measureIndex], selection.staff, selection.voice)[selection.index] : undefined;
  const activeIndex = selected?.kind === 'note' ? Math.min(selection.pitchIndex ?? 0, selected.pitches.length - 1) : 0;
  const activePitch = selected?.kind === 'note' ? selected.pitches[activeIndex] : undefined;
  const octave = activePitch && !chordMode ? activePitch.octave : entryOctave;
  const duration = selected?.duration ?? entryDuration;
  const alter = activePitch && !chordMode ? (activePitch.accidental === 'auto' ? 'auto' : activePitch.alter) : entryAlter;
  const meter = effectiveSettings(score, selection.measureIndex).timeSignature;
  const dirty = JSON.stringify(score) + '\n' !== saved;
  dirtyRef.current = dirty;
  const eventCount = score.measures.reduce((sum, bar) => sum + (['treble', 'bass'] as const).reduce((n, staff) => n + [0, 1, 2, 3].reduce((count, voice) => count + getEvents(bar, staff, voice).length, 0), 0), 0);

  useEffect(() => {
    if (!selected) return;
    setDuration(selected.duration);
    if (activePitch && !chordMode) {
      setOctave(activePitch.octave);
      setAlter(activePitch.accidental === 'auto' ? 'auto' : activePitch.alter);
    }
  }, [selected, activePitch, chordMode]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => () => { exportController.current?.abort(); openRequest.current++; }, []);

  function report(text: string, failed = false) { setMessage(text); setError(failed); }
  function focusEditor() { editorRef.current?.focus({ preventScroll: true }); }
  function commit(next: Score, nextSelection = selection) {
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_SCORE_FILE_BYTES - 1) throw new Error('This edit would exceed the 10 MB score limit.');
    dispatch({ type: 'commit', snapshot: { score: next, selection: nextSelection } });
  }
  function attempt(action: () => void) {
    try { action(); } catch (caught) { report(caught instanceof Error ? caught.message : 'The edit could not be completed.', true); }
  }
  function select(next: Selection) {
    setChordMode(false);
    if (next.kind === 'gap') next = { ...next, pitchIndex: undefined };
    dispatch({ type: 'select', selection: next });
    const event = next.kind === 'event' ? getEvents(score.measures[next.measureIndex], next.staff, next.voice)[next.index] : undefined;
    if (event) {
      setDuration(event.duration);
      if (event.kind === 'note') {
        const pitch = event.pitches[next.pitchIndex ?? 0];
        setOctave(pitch.octave); setAlter(pitch.accidental === 'auto' ? 'auto' : pitch.alter);
      }
    }
  }
  function afterEvent(next: Score): { score: Score; selection: Selection } {
    let cursor: Selection = { ...selection, kind: 'gap', pitchIndex: undefined, index: selection.index + 1 };
    const events = getEvents(next.measures[selection.measureIndex], selection.staff, selection.voice);
    if (cursor.index === events.length && usedTicks(events) === measureCapacity(next, selection.measureIndex)) {
      if (selection.measureIndex === next.measures.length - 1 && next.measures.length < 200) next = appendMeasure(next);
      if (selection.measureIndex < next.measures.length - 1) cursor = { ...cursor, measureIndex: selection.measureIndex + 1, index: 0 };
    }
    return { score: next, selection: cursor };
  }
  function finishChord() {
    setChordMode(false);
    if (selected) {
      const next = afterEvent(score);
      if (next.score !== score) commit(next.score, next.selection);
      else dispatch({ type: 'select', selection: next.selection });
    }
    report('Chord finished. The next note starts a new event.');
  }
  function toggleChord() {
    if (chordMode) finishChord();
    else { setChordMode(true); report('Build chord: type pitches, then press Enter. Octave and accidental controls apply to the next pitch.'); }
    focusEditor();
  }
  function enter(key: string) {
    attempt(() => {
      const rawPitch = pitchFromKey(key, octave, alter === 'auto' ? 0 : alter);
      const pitch = rawPitch ? resolvePitch(score, selection, { ...rawPitch, accidental: key.toLowerCase() === 'b' || alter !== 'auto' ? 'explicit' : 'auto' }) : null;
      if (!pitch && key.toLowerCase() !== 'r') return;
      if (chordMode && pitch && selected?.kind === 'note') {
        commit(addChordPitch(score, selection, pitch), { ...selection, pitchIndex: selected.pitches.length });
        report(`Added ${pitchLabel(pitch)} to the chord. Press Enter to finish.`);
        return;
      }
      const shared = selected ? { dots: selected.dots, tuplet: selected.tuplet, stem: selected.stem, beam: selected.beam, displayStaff: selected.displayStaff } : {};
      const event: ScoreEvent = pitch
        ? { ...shared, id: selected?.id ?? newId(), kind: 'note', pitches: [pitch], duration }
        : { ...shared, id: selected?.id ?? newId(), kind: 'rest', duration, ...(selected?.measureRest !== undefined ? { measureRest: selected.measureRest } : {}) };
      const edited = selected?.kind === 'note' && pitch && !chordMode
        ? updateChordPitch(score, selection, activeIndex, { ...activePitch, ...pitch })
        : selected ? updateEvent(score, selection, event) : insertEvent(score, selection, event);
      if (chordMode && pitch) {
        commit(edited, { ...selection, kind: 'event', pitchIndex: 0 });
        report(`Started chord on ${pitchLabel(pitch)}. Add pitches, then press Enter.`);
        return;
      }
      const next = afterEvent(edited);
      commit(next.score, next.selection); setChordMode(false);
      report(`${selected ? 'Updated' : 'Added'} ${pitch ? pitchLabel(pitch) : 'rest'} · ${DURATION_LABELS[duration].toLowerCase()} note.`);
    });
  }
  function remove(backward: boolean) {
    attempt(() => {
      let index = selection.index;
      if (!selected) {
        if (!backward || index === 0) { report('Select an event to delete, or use Backspace after it.'); return; }
        index--;
      }
      const position = { ...selection, index };
      commit(deleteEvent(score, position), { ...position, kind: 'gap', pitchIndex: undefined });
      setChordMode(false);
      report('Event deleted. Later events in this measure moved earlier.');
    });
  }
  function removePitch() {
    if (selected?.kind !== 'note') return;
    attempt(() => {
      const next = removeChordPitch(score, selection, activeIndex);
      commit(next, selected.pitches.length === 1
        ? { ...selection, kind: 'gap', pitchIndex: undefined }
        : { ...selection, pitchIndex: Math.min(activeIndex, selected.pitches.length - 2) });
      setChordMode(false);
      report('Selected pitch removed.');
    });
  }
  function changeDuration(value: Duration) {
    attempt(() => {
      if (selected) commit(updateEvent(score, selection, { ...selected, duration: value, measureRest: undefined }));
      setDuration(value); report(`${DURATION_LABELS[value]} duration selected.`);
    });
  }
  function changePitch(changes: Partial<Pitch>) {
    attempt(() => {
      if (activePitch && !chordMode) commit(updateChordPitch(score, selection, activeIndex, { ...activePitch, ...changes }));
      if (changes.octave !== undefined) setOctave(changes.octave);
      if (changes.accidental === 'auto') setAlter('auto');
      else if (changes.alter !== undefined) setAlter(changes.alter);
      report('Pitch settings updated.');
    });
  }
  function changeOctave(value: number) { changePitch({ octave: Math.max(0, Math.min(8, value)) }); }
  function move(direction: -1 | 1) {
    let index = selection.index + (selection.kind === 'event' ? (direction > 0 ? 1 : 0) : direction);
    let measureIndex = selection.measureIndex;
    if (index < 0 && measureIndex > 0) { measureIndex--; index = getEvents(score.measures[measureIndex], selection.staff, selection.voice).length; }
    if (index > getEvents(score.measures[measureIndex], selection.staff, selection.voice).length && measureIndex < score.measures.length - 1) { measureIndex++; index = 0; }
    select({ ...selection, kind: 'gap', measureIndex, index: Math.max(0, Math.min(index, getEvents(score.measures[measureIndex], selection.staff, selection.voice).length)) });
  }
  function changeStaff(staff: StaffId) {
    select({ ...selection, kind: 'gap', staff, index: Math.min(selection.index, getEvents(score.measures[selection.measureIndex], staff, selection.voice).length) });
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); }
      return;
    }
    if (event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'k') { event.preventDefault(); toggleChord(); }
    else if (key === 'enter' && chordMode) { event.preventDefault(); finishChord(); }
    else if (event.shiftKey && (key === 'delete' || key === 'backspace')) { event.preventDefault(); removePitch(); }
    else if (/^[a-h]$/.test(key) || key === 'r') { event.preventDefault(); enter(key); }
    else if (/^[1-5]$/.test(key)) { event.preventDefault(); changeDuration(DURATIONS[Number(key) - 1]); }
    else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); move(key === 'arrowleft' ? -1 : 1); }
    else if (key === 'arrowup' || key === 'arrowdown') { event.preventDefault(); changeOctave(octave + (key === 'arrowup' ? 1 : -1)); }
    else if (key === 'backspace' || key === 'delete') {
      event.preventDefault();
      if (selected?.kind === 'note' && selection.pitchIndex !== undefined) removePitch();
      else remove(key === 'backspace');
    }
    else if (key === 'escape') { select({ ...selection, kind: 'gap' }); }
  }
  async function exportPdf() {
    if (exportController.current) return;
    const controller = new AbortController();
    exportController.current = controller;
    const snapshot = structuredClone(score);
    setExportProgress('Preparing PDF…');
    try {
      const { createScorePdf } = await import('./export/pdf');
      const bytes = await createScorePdf(snapshot, { signal: controller.signal, onProgress: (done, total) => setExportProgress(`Engraving ${done}/${total}…`) });
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${snapshot.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Untitled score'}.pdf`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      report('A4 PDF downloaded. Save the TypeNote file too to keep an editable copy.');
    } catch (caught) {
      if (controller.signal.aborted) report('PDF export canceled.');
      else report(caught instanceof Error ? caught.message : 'PDF export failed. Your score is unchanged.', true);
    } finally { exportController.current = null; setExportProgress(null); }
  }
  async function exportXml() {
    try {
      const { exportMusicXml } = await import('./interchange/musicxml');
      const url = URL.createObjectURL(new Blob([exportMusicXml(score)], { type: 'application/vnd.recordare.musicxml+xml' }));
      const link = document.createElement('a'); link.href = url; link.download = `${score.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Score'}.musicxml`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); report('MusicXML downloaded.');
    } catch (caught) { report(caught instanceof Error ? caught.message : 'MusicXML export failed.', true); }
  }
  async function openXml(file?: File) {
    if (!file) return;
    const request = ++openRequest.current;
    try {
      if (file.size > MAX_SCORE_FILE_BYTES) throw new Error('MusicXML files must be under 10 MB.');
      const { openMusicXml } = await import('./documents/musicxml');
      const text = await file.text();
      if (request !== openRequest.current) return;
      const next = openMusicXml(text, file.name);
      if (dirtyRef.current && !window.confirm('Discard unsaved changes to the current score?')) return;
      onImported(next);
    } catch (caught) { if (request === openRequest.current) report(caught instanceof Error ? caught.message : 'MusicXML import failed.', true); }
  }
  function save() {
    attempt(() => {
    const text = serializeScore(score);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${score.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Untitled score'}.typenote.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(text); report('Score downloaded as an editable TypeNote file.');
    });
  }
  function reset(next: Score, clean: boolean) {
    if (dirtyRef.current && !window.confirm('Discard unsaved changes to the current score?')) return false;
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_SCORE_FILE_BYTES - 1) throw new Error('This score exceeds the 10 MB editable file limit.');
    openRequest.current++;
    dispatch({ type: 'reset', snapshot: { score: next, selection: firstPosition } });
    setChordMode(false);
    setSaved(clean ? serializeScore(next) : ''); setOctave(4); setDuration(4); setAlter('auto');
    report('Score ready. Click the page or press Enter music to start.');
    return true;
  }
  async function openFile(file?: File) {
    if (!file) return;
    const request = ++openRequest.current;
    try {
      if (file.size > MAX_SCORE_FILE_BYTES) throw new Error('This file is too large. TypeNote files must be under 10 MB.');
      const text = await file.text();
      if (request !== openRequest.current) return;
      let header: { kind?: string } | undefined;
      try { header = JSON.parse(text); } catch { /* parseScore provides the normal file error. */ }
      if (header?.kind === 'musicxml') {
        const { parseMusicXmlDocument } = await import('./documents/musicxml');
        if (request !== openRequest.current) return;
        const next = parseMusicXmlDocument(text);
        if (dirtyRef.current && !window.confirm('Discard unsaved changes to the current score?')) return;
        onImported(next);
      } else reset(parseScore(text), true);
    } catch (caught) {
      if (request === openRequest.current) report(caught instanceof Error ? caught.message : 'Unable to open this score.', true);
    }
  }

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="TypeNote home"><span className="brand-mark" aria-hidden="true">♮</span>TypeNote<span className="brand-tag">PIANO STUDIO</span></a>
      <div className="file-actions">
        <button onClick={() => reset(createScore(), true)}>New score</button>
        <button onClick={() => fileRef.current?.click()}>Open file</button>
        <button className="primary" onClick={save}><span aria-hidden="true">↓</span> Save score</button>
        <button onClick={() => xmlRef.current?.click()}>Open MusicXML</button><button onClick={() => void exportXml()}>Save MusicXML</button>
        <input ref={xmlRef} type="file" accept=".xml,.musicxml" aria-label="Open MusicXML file" hidden onChange={event => { void openXml(event.target.files?.[0]); event.target.value = ''; }} />
        <button onClick={() => void exportPdf()} disabled={exportProgress !== null}>Download PDF</button>
        <input ref={fileRef} type="file" accept=".json,.typenote.json,application/json" aria-label="Open TypeNote file" hidden onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
    </header>

    <main>
      <div className="workspace-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>A little room to compose.</h1><p>Put a melody on the page, one keystroke at a time.</p></div><span className="local-badge"><span /> Files stay on your device</span></div>

      <section className="editor" ref={editorRef} tabIndex={0} aria-label="Score editor" onKeyDown={onKeyDown}>
        <div className="document-bar">
          <div className="document-name"><span aria-hidden="true">♬</span><input aria-label="Score title" maxLength={120} value={score.title} onChange={(event) => attempt(() => commit({ ...score, title: event.target.value }))} /><span className={`save-state ${dirty ? 'unsaved' : ''}`}>{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
          <div className="history-actions"><button aria-label="Undo" title="Undo (Cmd/Ctrl+Z)" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}>↶</button><button aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z)" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}>↷</button><span className="divider" /><button className={helpOpen ? 'active' : ''} aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>Keyboard guide <span aria-hidden="true">⌨</span></button></div>
        </div>

        <div className="toolbar">
          <div className="tool-group duration-group"><span className="tool-label">DURATION</span><div className="duration-buttons">{DURATIONS.map((value, index) => <button key={value} className={duration === value ? 'active' : ''} aria-label={`${DURATION_LABELS[value]} note`} aria-pressed={duration === value} onClick={() => { changeDuration(value); focusEditor(); }}><DurationIcon duration={value} /><kbd>{index + 1}</kbd></button>)}</div></div>
          <div className="tool-group"><label className="tool-label" htmlFor="octave">OCTAVE</label><div className="stepper"><button aria-label="Lower octave" disabled={octave === 0} onClick={() => changeOctave(octave - 1)}>−</button><select id="octave" value={octave} onChange={(event) => changeOctave(Number(event.target.value))}>{Array.from({ length: 9 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select><button aria-label="Higher octave" disabled={octave === 8} onClick={() => changeOctave(octave + 1)}>+</button></div></div>
          <div className="tool-group"><span className="tool-label">ACCIDENTAL</span><div className="accidentals"><button className={alter === 'auto' ? 'active' : ''} aria-label="Follow signature" aria-pressed={alter === 'auto'} title="Follow key signature and local accidental state" onClick={() => changePitch({ accidental: 'auto' })}>Auto</button>{([-2, -1, 0, 1, 2] as const).map((value) => <button key={value} aria-label={value === -2 ? 'Double flat' : value === 2 ? 'Double sharp' : value === -1 ? 'Flat' : value === 1 ? 'Sharp' : 'Natural'} aria-pressed={alter === value} className={alter === value ? 'active' : ''} onClick={() => changePitch({ alter: value, accidental: 'explicit' })}>{value === -2 ? '𝄫' : value === 2 ? '𝄪' : value === -1 ? '♭' : value === 1 ? '♯' : '♮'}</button>)}</div></div>
          <div className="tool-group"><label className="tool-label" htmlFor="staff">STAFF</label><select id="staff" value={selection.staff} onChange={(event) => changeStaff(event.target.value as StaffId)}><option value="treble">Treble · right hand</option><option value="bass">Bass · left hand</option></select></div>
          <div className="tool-group event-tools"><span className="tool-label">EVENT</span><div><button onClick={() => { enter('r'); focusEditor(); }}>Rest <kbd>R</kbd></button><button aria-label="Delete selected event" disabled={!selected} onClick={() => remove(false)}>Delete event</button></div></div>
          <div className="tool-group"><span className="tool-label">CHORD</span><button aria-pressed={chordMode} onClick={toggleChord}>{chordMode ? 'Finish chord' : 'Build chord'} <kbd>{chordMode ? '↵' : 'K'}</kbd></button></div>
        </div>

        {chordMode && <div className="chord-banner" role="status">Building chord · Type pitches at the same position. Octave and accidental controls affect the next pitch; duration affects the whole chord. Press Enter to finish.</div>}
        {exportProgress && <div className="export-banner" role="status">{exportProgress} <button onClick={() => exportController.current?.abort()}>Cancel export</button></div>}

        {helpOpen && <div className="keyboard-guide"><p><strong>Your keyboard is the instrument.</strong> C D E F G A H enter notes; H with Natural is B natural, B always enters B-flat. 1–5 choose whole through sixteenth. R enters a rest. ← → move the insertion position; ↑ ↓ choose octave (C4 is middle C).</p><p>Click a note to select it, then change its controls or type a pitch to replace it. Click a gap to insert. Escape returns to insertion. Backspace deletes the preceding event at a gap; Delete removes a selection. Cmd/Ctrl+Z undoes; add Shift to redo. Shortcuts work while the editor is focused.</p><p><strong>Chords:</strong> press K or Build chord, type pitches, and press Enter to finish. While building, octave and accidental controls affect new pitches only. Click a chord notehead or pitch chip to select and highlight one pitch. Delete or Backspace removes that pitch; Shift+Delete also removes the active pitch. Delete event removes the whole chord. A chord shares one duration.</p><p>Each staff supports four independent voices. Choose a voice in Notation tools. Edits shift events only within their measure; a full measure advances entry. Gray rests mark unused time. Auto follows the key signature and preceding local accidentals in the bar without adding redundant signs. Natural, Flat and Sharp explicitly write a local sign. Selecting a note copies its entry settings; B always enters B-flat. To change a selected B-flat to H, choose Natural.</p></div>}

        <div className="entry-strip"><span className="position-dot" /><strong>{selected ? 'Selected event' : 'Insert position'}</strong><span>Measure {selection.measureIndex + 1} · {selection.staff === 'treble' ? 'Treble' : 'Bass'} · Voice {(selection.voice ?? 0) + 1} · {selected ? `Event ${selection.index + 1}` : `Position ${selection.index + 1}`}</span><span className="entry-summary">{chordMode ? `Next pitch: octave ${octave}` : selected?.kind === 'note' ? selected.pitches.map(pitchLabel).join(' · ') : `Octave ${octave}`} / {DURATION_LABELS[duration]}</span><button className="text-button" onClick={focusEditor}>Enter music →</button></div>

        <NotationPanel score={score} selection={selection} pitchIndex={activeIndex} duration={duration} commit={commit} report={report} onDuration={changeDuration} onSelect={select} />

        <div className="score-desk">
          <article className="score-paper"><div className="score-title"><span className="score-kicker">PIANO</span><h2>{score.title || 'Untitled score'}</h2><span className="score-subtitle">{score.composer ? `${score.composer} · ` : ''}Grand staff</span></div>
            <div onClick={focusEditor}><ScoreView score={score} selection={selection} onSelect={select} /></div>
            <div className="paper-footer"><span>TYPENOTE</span><span>{score.measures.length} measures · Piano</span></div>
          </article>
          <div className="below-score"><span>Click a position on either staff to begin.</span><button disabled={score.measures.length >= 200} onClick={() => attempt(() => { commit(appendMeasure(score)); report('Empty measure added to both staves.'); })}>+ Add measure</button></div>
        </div>

        {selected?.kind === 'note' && <div className="selected-pitch"><div className="pitch-chips" aria-label="Chord pitches">{selected.pitches.map((pitch, index) => <button key={index} aria-label={`Edit pitch ${pitchLabel(pitch)}`} aria-pressed={index === activeIndex && !chordMode} onClick={() => { select({ ...selection, pitchIndex: index }); focusEditor(); }}>{pitchLabel(pitch)}</button>)}</div><label htmlFor="pitch">Selected pitch</label><select id="pitch" disabled={chordMode} value={activePitch!.step} onChange={(event) => changePitch({ step: event.target.value as Pitch['step'] })}>{['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((step) => <option key={step} value={step}>{step === 'B' ? 'H / B (choose accidental above)' : step}</option>)}</select><button disabled={chordMode} onClick={removePitch}>Remove pitch</button><span>Click a notehead or pitch chip to edit it. Delete removes the selected pitch; duration applies to the whole chord.</span></div>}
        <div className={`status-bar ${error ? 'error' : ''}`}><span role="status" aria-live="polite">{message}</span><span>{eventCount} events · {meter.beats}/{meter.beatType}</span></div>
      </section>

      <div className="workspace-footer"><p><kbd>C</kbd> <kbd>D</kbd> <kbd>E</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>A</kbd> <kbd>H</kbd><span>A melody starts with a letter.</span></p><button className="text-button" onClick={() => reset(createDemoScore(), false)}>Try a short example →</button></div>
      <p className="milestone-note">Local piano editor · Save an editable .typenote.json file or download an A4 PDF. Notation tools include signatures, voices and piano expression. PDF recognition is a later milestone.</p>
    </main>
  </div>;
}
