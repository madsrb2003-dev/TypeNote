import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { editImportedDirection, editImportedMetadata, editImportedNote, inspectMusicXml, openMusicXml, parseMusicXmlDocument, serializeMusicXmlDocument } from '../documents/musicxml';
import type { ImportedNote, ImportedNotePatch, MusicXmlDocument, RenderedMusicDocument, RenderedMusicPage } from '../documents/types';
import type { Alteration, Score, Step } from '../domain/types';
import { MAX_SCORE_FILE_BYTES } from '../domain/types';
import { parseScore } from '../domain/storage';
import './imported.css';

function download(contents: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function noteLabel(note: ImportedNote): string {
  const pitch = note.kind === 'rest' ? 'Rest' : !note.step ? 'Unpitched' : `${note.step === 'B' ? note.alter === -1 ? 'B' : 'H' : note.step}${note.alter === 1 ? '♯' : note.alter === 2 ? '𝄪' : note.alter === -2 ? '𝄫' : note.alter === -1 && note.step !== 'B' ? '♭' : ''}${note.octave}`;
  return `Measure ${note.measure} · staff ${note.staff} · ${pitch}${note.grace ? ' · grace' : ''}${note.hidden ? ' · hidden' : ''}`;
}

function ImportedPage({ page, index, selectedId, onSelect }: { page: RenderedMusicPage; index: number; selectedId: string; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const doc = new DOMParser().parseFromString(page.svg, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return;
    // Pages have already been sanitized by prepareImportedPage for both preview and PDF.
    const svg = doc.documentElement;
    svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', `Score page ${index + 1}`);
    svg.removeAttribute('aria-hidden');
    for (const el of Array.from(svg.querySelectorAll('g.note[id],g.rest[id],g.mRest[id]'))) {
      el.setAttribute('data-note-id', el.id); el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', `Select imported note ${el.id}`);
    }
    ref.current.replaceChildren(document.importNode(svg, true));
  }, [page, index]);
  useEffect(() => {
    ref.current?.querySelectorAll('[data-note-id]').forEach(el => {
      const selected = el.getAttribute('data-note-id') === selectedId;
      el.classList.toggle('imported-selected', selected); el.setAttribute('aria-pressed', String(selected));
    });
  }, [page, selectedId]);
  function select(target: EventTarget) {
    const el = target instanceof Element ? target.closest('[data-note-id]') : null;
    if (el) onSelect(el.getAttribute('data-note-id')!);
  }
  return <div ref={ref} className="imported-page" onClick={e => select(e.target)} onKeyDown={e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(e.target); }
  }} />;
}

interface Props { initial: MusicXmlDocument; onNew: () => void; onNative: (score: Score) => void }
export function ImportedScoreEditor({ initial, onNew, onNative }: Props) {
  const [doc, setDoc] = useState(initial);
  const [saved, setSaved] = useState(() => serializeMusicXmlDocument(initial));
  const [past, setPast] = useState<MusicXmlDocument[]>([]);
  const [future, setFuture] = useState<MusicXmlDocument[]>([]);
  const info = useMemo(() => inspectMusicXml(doc), [doc]);
  const [selectedId, setSelectedId] = useState(() => info.notes.find(n => n.kind === 'note')?.id ?? info.notes[0]?.id ?? '');
  const selected = info.notes.find(n => n.id === selectedId);
  const [rendered, setRendered] = useState<RenderedMusicDocument | null>(null);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState('');
  const [message, setMessage] = useState('Score opened. Select a note to correct its pitch or accidental.');
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const [fingering, setFingering] = useState('');
  const [sourceDraft, setSourceDraft] = useState('');
  const [sourceBase, setSourceBase] = useState('');
  const [exportDiagnostics, setExportDiagnostics] = useState<string[]>([]);
  const editorRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfController = useRef<AbortController | null>(null);
  const fileRequest = useRef(0);
  const serialized = useMemo(() => serializeMusicXmlDocument(doc), [doc]);
  const sourceDirty = sourceBase !== '' && sourceDraft !== sourceBase;
  const dirty = serialized !== saved || sourceDirty;
  const editablePitch = selected?.kind === 'note' && selected.step !== undefined && selected.octave !== undefined && selected.octave >= 0 && selected.octave <= 9;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const fileName = info.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Piano score';
  useEffect(() => setFingering(selected?.fingering ?? ''), [selected?.id, selected?.fingering]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setRendering(true); setRenderError(''); setExportDiagnostics([]);
    const timer = setTimeout(() => {
      void import('../notation/imported').then(({ renderImportedScore }) => renderImportedScore(doc, { signal: controller.signal })).then(result => {
        if (!controller.signal.aborted) setRendered(result);
      }).catch(error => {
        if (!controller.signal.aborted) { setRendered(null); setRenderError(error instanceof Error ? error.message : 'The score could not be engraved.'); }
      }).finally(() => { if (!controller.signal.aborted) setRendering(false); });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [doc]);
  useEffect(() => () => { pdfController.current?.abort(); fileRequest.current++; }, []);
  function report(text: string, error = false) { setMessage(text); setFailed(error); }
  function attempt(action: () => void) { try { action(); } catch (error) { report(error instanceof Error ? error.message : 'The change could not be made.', true); } }
  function trimHistory(history: MusicXmlDocument[]) {
    let bytes = 0;
    return history.slice(-30).reverse().filter(item => { bytes += item.xml.length * 2; return bytes <= 32 * 1024 * 1024; }).reverse();
  }
  function commit(next: MusicXmlDocument) {
    if (next.xml === doc.xml) return;
    serializeMusicXmlDocument(next); // Validate the persisted size before accepting the edit.
    setPast(trimHistory([...past, doc])); setFuture([]); setDoc(next);
    report('Change applied. Surrounding notation retained.');
  }
  function undo() { const next = past.at(-1); if (next) { setFuture([doc, ...future]); setPast(past.slice(0, -1)); setDoc(next); report('Undone.'); } }
  function redo() { const next = future[0]; if (next) { setPast(trimHistory([...past, doc])); setFuture(future.slice(1)); setDoc(next); report('Redone.'); } }
  function select(id: string) { setSelectedId(id); editorRef.current?.focus({ preventScroll: true }); }
  function edit(patch: ImportedNotePatch) { if (selected) attempt(() => commit(editImportedNote(doc, selected.id, patch))); }
  function confirmDiscard() { return !dirtyRef.current || window.confirm('Discard unsaved changes to the current score?'); }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      return;
    }
    if (event.altKey || !selected) return;
    const key = event.key.toUpperCase();
    if (/^[A-H]$/.test(key) && editablePitch) {
      event.preventDefault(); edit({ step: key === 'H' || key === 'B' ? 'B' : key as Step, ...(key === 'B' ? { alter: -1, accidental: 'explicit' } : { accidental: 'auto' }) });
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (editablePitch) { event.preventDefault(); edit({ octave: Math.max(0, Math.min(9, selected.octave! + (event.key === 'ArrowUp' ? 1 : -1))) }); }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); const index = info.notes.findIndex(n => n.id === selectedId);
      setSelectedId(info.notes[Math.max(0, Math.min(info.notes.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))].id);
    }
  }
  async function openFile(file?: File) {
    if (!file) return;
    const request = ++fileRequest.current;
    try {
      if (file.size > MAX_SCORE_FILE_BYTES) throw new Error('Score files must be under 10 MB.');
      const text = await file.text();
      if (request !== fileRequest.current) return;
      if (/^\s*\{/.test(text)) {
        const header = JSON.parse(text);
        if (header.kind !== 'musicxml') { const native = parseScore(text); if (confirmDiscard()) onNative(native); return; }
      }
      const next = /^\s*\{/.test(text) ? parseMusicXmlDocument(text) : openMusicXml(text, file.name);
      if (!confirmDiscard()) return;
      setDoc(next); setSaved(serializeMusicXmlDocument(next)); setPast([]); setFuture([]); setRendered(null);
      setSelectedId(inspectMusicXml(next).notes[0]?.id ?? ''); setSourceDraft(''); setSourceBase(''); report('Score opened with its complete notation.');
    } catch (error) { if (request === fileRequest.current) report(error instanceof Error ? error.message : 'Could not open score.', true); }
  }
  async function exportPdf() {
    if (pdfController.current) return;
    const controller = new AbortController(); pdfController.current = controller; setProgress('Preparing PDF…');
    try {
      const { createImportedPdf } = await import('../export/importedPdf');
      const bytes = await createImportedPdf(doc, { signal: controller.signal, onProgress: (done, total) => setProgress(`Exporting page ${done}/${total}…`), onDiagnostics: setExportDiagnostics });
      controller.signal.throwIfAborted(); download(new Uint8Array(bytes), `${fileName}.pdf`, 'application/pdf'); report('A4 PDF downloaded.');
    } catch (error) { report(controller.signal.aborted ? 'PDF export canceled.' : error instanceof Error ? error.message : 'PDF export failed.', !controller.signal.aborted); }
    finally { pdfController.current = null; setProgress(null); }
  }
  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark" aria-hidden="true">♮</span>TypeNote<span className="brand-tag">PIANO STUDIO</span></div><div className="file-actions">
      <button onClick={() => { if (confirmDiscard()) onNew(); }}>New score</button><button onClick={() => fileRef.current?.click()}>Open file</button>
      <input ref={fileRef} hidden type="file" accept=".xml,.musicxml,.json" aria-label="Open imported score file" onChange={e => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
      <button className="primary" disabled={sourceDirty} onClick={() => attempt(() => { const text = serializeMusicXmlDocument(doc); download(text, `${fileName}.typenote.json`, 'application/json'); setSaved(text); report('Complete editable score saved.'); })}>Save score</button>
      <button disabled={sourceDirty} onClick={() => download(doc.xml, `${fileName}.musicxml`, 'application/vnd.recordare.musicxml+xml')}>Save MusicXML</button>
      <button disabled={!!progress || sourceDirty || rendering || !!renderError} onClick={() => void exportPdf()}>Download PDF</button>
    </div></header>
    <main><div className="workspace-heading"><div><div className="eyebrow">IMPORTED SCORE</div><h1>{info.title || 'Piano score'}</h1><p>Correct notes while retaining the complete score.</p></div><span className="local-badge"><span />Files stay on your device</span></div>
      <section className="editor imported-editor" ref={editorRef} tabIndex={0} aria-label="Imported score editor" onKeyDown={onKeyDown}>
        <div className="document-bar"><div className="document-name"><input aria-label="Score title" value={info.title} onChange={e => attempt(() => commit(editImportedMetadata(doc, { title: e.target.value })))} /><span className={`save-state ${dirty ? 'unsaved' : ''}`}>{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div><div className="history-actions"><button aria-label="Undo" disabled={!past.length} onClick={undo}>↶</button><button aria-label="Redo" disabled={!future.length} onClick={redo}>↷</button><button aria-expanded={guide} onClick={() => setGuide(!guide)}>Keyboard guide</button></div></div>
        <div className="imported-controls">
          <label>Composer<input aria-label="Composer" value={info.composer} onChange={e => attempt(() => commit(editImportedMetadata(doc, { composer: e.target.value })))} /></label>
          <label className="imported-note-picker">Selected note<select aria-label="Selected imported note" value={selected ? selectedId : ''} onChange={e => select(e.target.value)}><option value="" disabled>Choose a note</option>{info.notes.map(n => <option key={n.id} value={n.id}>{noteLabel(n)}</option>)}</select></label>
          {editablePitch && <><label>Pitch<select aria-label="Pitch step" value={selected.step} onChange={e => edit({ step: e.target.value as Step, accidental: 'auto' })}>{['C','D','E','F','G','A','B'].map(step => <option key={step} value={step}>{step === 'B' ? 'H' : step}</option>)}</select></label><label>Octave<select aria-label="Octave" value={selected.octave} onChange={e => edit({ octave: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, i) => <option key={i}>{i}</option>)}</select></label>
            <div><span className="tool-label">ACCIDENTAL</span><div className="imported-accidentals"><button aria-label="Follow signature" onClick={() => edit({ accidental: 'auto' })}>Auto</button>{([-2,-1,0,1,2] as Alteration[]).map((alter, i) => <button key={alter} aria-label={['Double flat','Flat','Natural','Sharp','Double sharp'][i]} onClick={() => edit({ alter, accidental: 'explicit' })}>{['𝄫','♭','♮','♯','𝄪'][i]}</button>)}</div></div>
            <label>Fingering<input aria-label="Fingering" maxLength={30} value={fingering} onChange={e => setFingering(e.target.value)} onBlur={() => { if (fingering !== (selected.fingering ?? '')) edit({ fingering }); }} /></label>
          </>}
        </div>
        {guide && <div className="keyboard-guide"><p>Select a note, then type C D E F G A H to correct its written pitch. H uses the international B position; B explicitly enters B-flat. Auto follows the active signature; Natural writes ♮. ↑ ↓ change octave; ← → select adjacent notes. Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes.</p><p>Pitch corrections preserve the existing rhythm, voices, ornaments and other notation. Tied pitches are checked together. The note selector includes hidden and cue notes. Use the advanced source editor for structural or rhythmic corrections.</p></div>}
        {sourceDirty && <p className="imported-notices" role="status">Apply or discard your source changes before saving or exporting.</p>}
        {exportDiagnostics.length > 0 && <div className="imported-notices"><strong>PDF engraving notes</strong><ul>{exportDiagnostics.map((notice, i) => <li key={i}>{notice}</li>)}</ul></div>}
        {progress && <div className="export-banner" role="status">{progress}<button onClick={() => pdfController.current?.abort()}>Cancel export</button></div>}
        <details className="imported-details"><summary>Notation and expression</summary><p>{info.features.join(' · ') || 'Complete MusicXML retained.'}</p><div className="imported-directions">{info.directions.map(direction => <label key={direction.id}>{direction.kind} · measure {direction.measure}<input aria-label={`Edit ${direction.kind} ${direction.id}`} defaultValue={direction.value} key={`${direction.id}-${direction.value}`} onBlur={e => { if (e.target.value !== direction.value) attempt(() => commit(editImportedDirection(doc, direction.id, e.target.value))); }} /></label>)}</div></details>
        {info.warnings.length > 0 && <div className="imported-notices"><strong>Document notes</strong><ul>{info.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
        {rendered?.diagnostics.length ? <details className="imported-notices" open><summary>Engraving notes — review these before exporting</summary><ul>{rendered.diagnostics.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
        <div className="imported-score" aria-busy={rendering}>
          {rendering && <p role="status">Engraving the complete score…</p>}
          {renderError && <p role="alert">{renderError} The editable document is retained and can still be saved.</p>}
          {rendered?.pages.map((page, i) => <ImportedPage key={i} page={page} index={i} selectedId={selectedId} onSelect={id => { if (!rendering && !renderError) select(id); }} />)}
        </div>
        <details className="imported-details"><summary onClick={() => { if (!sourceBase) { setSourceDraft(doc.xml); setSourceBase(doc.xml); } }}>Advanced MusicXML editing</summary><p>Edit the complete structured document for notation without a dedicated control. Applying checks XML structure and creates an undo step; engraving diagnostics appear above. Unknown notation is retained.</p><textarea aria-label="MusicXML source" spellCheck={false} value={sourceDraft} onChange={e => setSourceDraft(e.target.value)} /><button disabled={!sourceDirty} onClick={() => attempt(() => {
          if (sourceBase !== doc.xml) throw new Error('The score changed after this source draft was opened. Copy your draft if needed, then reload the current source before applying changes.');
          const next = openMusicXml(sourceDraft, doc.filename); commit(next); setSourceDraft(next.xml); setSourceBase(next.xml);
          if (!inspectMusicXml(next).notes.some(note => note.id === selectedId)) setSelectedId('');
        })}>Apply source changes</button><button onClick={() => { if (!sourceDirty || window.confirm('Discard unapplied source changes and reload the current score?')) { setSourceDraft(doc.xml); setSourceBase(doc.xml); } }}>Reload current source</button></details>
        <div className={`status-bar ${failed ? 'error' : ''}`}><span role="status" aria-live="polite">{message}</span><span>{info.notes.length} notes and rests</span></div>
      </section><p className="milestone-note">Full-score editing · Complete MusicXML retained locally. PDF recognition is a separate milestone.</p>
    </main>
  </div>;
}
