import { useEffect, useRef, useState } from 'react';
import { cancelRecognition, getRecognition, MAX_PDF_IMPORT_BYTES, recognizedDocument, recognitionAvailability, recognitionOutputUrl, recognitionUrl, startRecognition } from '../documents/recognition';
import type { RecognitionJob, RecognitionOutput, RecognitionSource } from '../documents/recognition';
import type { MusicXmlDocument } from '../documents/types';
import './pdf-import.css';

export function PdfImport({ onOpen, source }: { onOpen: (document: MusicXmlDocument, source: RecognitionSource) => boolean; source?: RecognitionSource }) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState('');
  const [pages, setPages] = useState('');
  const [job, setJob] = useState<RecognitionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<{ available: boolean; message: string } | null>(null);
  const activeId = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const mounted = useRef(true);
  const onOpenRef = useRef(onOpen); onOpenRef.current = onOpen;
  const busy = starting || job?.status === 'validating' || job?.status === 'recognizing';
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (activeId.current) void cancelRecognition(activeId.current).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  async function choose(selected?: File) {
    if (!selected) return;
    setFile(selected); setFilename(selected.name); setPages(''); setJob(null); setError(''); setAvailability(null);
    dialog.current?.showModal();
    if (selected.size > MAX_PDF_IMPORT_BYTES) { setError('PDF files must be at most 100 MB.'); return; }
    if (!selected.size) { setError('This PDF is empty. Choose another file.'); return; }
    try { const status = await recognitionAvailability(); if (mounted.current) setAvailability(status); }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'Local PDF recognition is unavailable.'); }
  }
  async function openResult(current: RecognitionJob, output: RecognitionOutput) {
    setOpening(true); setError('');
    try {
      const doc = await recognizedDocument(current.id, output);
      if (!mounted.current) return;
      const provenance = { jobId: current.id, filename, diagnostics: current.diagnostics, partial: current.status !== 'completed' };
      if (onOpenRef.current(doc, provenance)) dialog.current?.close();
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'Could not open the recognized score.'); }
    finally { if (mounted.current) setOpening(false); }
  }
  async function recognize() {
    if (!file || busy) return;
    setStarting(true); setError(''); setJob(null); cancelRequested.current = false;
    try {
      const { id } = await startRecognition(file, pages);
      activeId.current = id;
      if (!mounted.current) { await cancelRecognition(id); return; }
      setStarting(false);
      // Poll serially; only the active job can update or replace the editor.
      while (mounted.current && activeId.current === id) {
        const next = await getRecognition(id);
        if (!mounted.current || activeId.current !== id) break;
        setJob(next);
        if (!['validating', 'recognizing'].includes(next.status)) {
          activeId.current = null;
          if (!cancelRequested.current && next.status === 'completed' && next.outputs.length === 1) await openResult(next, next.outputs[0]);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (caught) {
      const id = activeId.current; activeId.current = null;
      if (id) void cancelRecognition(id).catch(() => {});
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : 'PDF recognition failed.');
        setJob(current => current ? { ...current, status: 'failed', message: 'Recognition could not be completed. The current score is unchanged.' } : null);
      }
    } finally { if (mounted.current) setStarting(false); }
  }
  async function cancel() {
    const id = activeId.current;
    if (!id) return;
    cancelRequested.current = true;
    try { await cancelRecognition(id); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Cancellation could not be confirmed.'); }
  }
  async function showResults() {
    if (!source) return;
    setFile(null); setFilename(source.filename); setJob(null); setError(''); setAvailability(null);
    dialog.current?.showModal();
    try { setJob(await getRecognition(source.jobId)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The saved recognition results could not be read.'); }
  }
  return <>
    <button onClick={() => input.current?.click()} disabled={busy}>Open PDF</button>
    {source && <button disabled={busy} onClick={() => void showResults()}>Recognition results</button>}
    <input ref={input} type="file" hidden accept=".pdf,application/pdf" aria-label="Open PDF file" onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
    <dialog ref={dialog} className="pdf-import-dialog" aria-labelledby="pdf-import-title" onCancel={event => { if (busy || opening) event.preventDefault(); }}>
      <div className="pdf-import-heading"><h2 id="pdf-import-title">Open a PDF as an editable score</h2><button aria-label="Close PDF import" disabled={busy || opening} onClick={() => dialog.current?.close()}>×</button></div>
      <p className="pdf-import-filename">{filename}</p>
      <p>Recognition runs on this computer. The PDF stays local, and the result opens as editable MusicXML. Use <strong>Save score</strong> to download a <strong>.typenote.json</strong> file.</p>
      {file && <label className="pdf-import-pages">Pages to recognize<input placeholder="All pages, or e.g. 2–5, 8" value={pages} disabled={busy} onChange={event => setPages(event.target.value.replace(/[–—]/g, '-'))} /></label>}
      <p className="pdf-import-hint">Skip covers or select a few pages for a faster first import. Recognition can miss notes, rhythm and markings; compare the result with the original.</p>
      {!availability && !error && !job && <p role="status">Checking local recognition…</p>}
      {availability && !availability.available && <p role="alert">{availability.message}</p>}
      {error && <p className="pdf-import-error" role="alert">{error}</p>}
      {starting && <p role="status">Copying the PDF to local recognition…</p>}
      {job && <div className="pdf-import-result">
        <p role="status">{job.message}</p>
        <div className="pdf-import-links"><a href={recognitionUrl(job.id, 'original')} target="_blank" rel="noreferrer">View original PDF</a><a href={recognitionUrl(job.id, 'log')} download>Download recognition log</a></div>
        {job.diagnostics.length > 0 && <details><summary>Recognition diagnostics ({job.diagnostics.length})</summary><ul>{job.diagnostics.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
        {job.outputs.length > 1 && <p>Recognition created several documents. Review each result; none has been merged or omitted.</p>}
        {job.status !== 'completed' && job.outputs.length > 0 && <p>Only partial results are available. Review them against the original before using them.</p>}
        {!busy && job.outputs.map(output => <div className="pdf-import-output" key={output.id}><span>{output.name}</span><button disabled={opening} onClick={() => void openResult(job, output)}>{job.status === 'completed' ? 'Open result' : 'Open partial result'}</button><a href={recognitionOutputUrl(job.id, output.id)} download>Download MusicXML</a></div>)}
      </div>}
      <div className="pdf-import-actions">{busy ? <button onClick={() => void cancel()} disabled={starting}>Cancel recognition</button> : <button className="primary" onClick={() => void recognize()} disabled={!availability?.available || !file?.size || file.size > MAX_PDF_IMPORT_BYTES || opening}>{job ? 'Recognize again' : 'Recognize PDF'}</button>}<button disabled={busy || opening} onClick={() => dialog.current?.close()}>Close</button></div>
    </dialog>
  </>;
}
