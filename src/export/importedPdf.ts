import { PDFDocument } from 'pdf-lib';
import type { MusicXmlDocument, RenderMusicOptions } from '../documents/types';
import { renderImportedScore } from '../notation/imported';
import { A4 } from './layout';
import { inspectMusicXml } from '../documents/musicxml';

const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function svgImage(svg: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    const cleanup = () => { URL.revokeObjectURL(url); signal?.removeEventListener('abort', abort); };
    const abort = () => { image.src = ''; cleanup(); reject(signal?.reason ?? new DOMException('PDF export canceled.', 'AbortError')); };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('The browser could not prepare an imported notation page for PDF export.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    image.src = url;
  });
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The browser could not encode a PDF page.')), 'image/png'));
  return blob.arrayBuffer();
}

/** Export the same complete, locally engraved A4 pages displayed by the imported editor. */
export async function createImportedPdf(document: MusicXmlDocument, options: RenderMusicOptions & { onDiagnostics?: (diagnostics: string[]) => void } = {}): Promise<Uint8Array> {
  const check = () => options.signal?.throwIfAborted();
  check();
  const rendered = await renderImportedScore(document, { signal: options.signal, onProgress: (completed, total) => options.onProgress?.(completed, total * 2) });
  check();
  const pdf = await PDFDocument.create();
  options.onDiagnostics?.(rendered.diagnostics);
  const { title, composer } = inspectMusicXml(document);
  pdf.setTitle(title); if (composer) pdf.setAuthor(composer);
  pdf.setCreator('TypeNote'); pdf.setProducer('TypeNote · Verovio');
  const rasterWidth = Math.ceil(A4.width * 300 / 72), rasterHeight = Math.ceil(A4.height * 300 / 72);
  for (let index = 0; index < rendered.pages.length; index++) {
    check();
    const page = rendered.pages[index];
    if (Math.abs(page.width / page.height - A4.width / A4.height) > 0.002) throw new Error(`Page ${index + 1} is not A4 portrait. Export stopped to avoid cropping or stretching the notation.`);
    const image = await svgImage(page.svg, options.signal);
    check();
    const canvas = window.document.createElement('canvas');
    canvas.width = rasterWidth; canvas.height = rasterHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not create the PDF drawing surface.');
    try {
      context.fillStyle = '#fff'; context.fillRect(0, 0, rasterWidth, rasterHeight);
      context.drawImage(image, 0, 0, rasterWidth, rasterHeight);
      const png = await pdf.embedPng(await canvasPng(canvas));
      check();
      // Margins are part of the SVG page. Do not add a second margin or crop it.
      pdf.addPage([A4.width, A4.height]).drawImage(png, { x: 0, y: 0, width: A4.width, height: A4.height });
      await png.embed();
    } finally {
      canvas.width = 0; canvas.height = 0;
    }
    options.onProgress?.(rendered.pages.length + index + 1, rendered.pages.length * 2);
    await yieldToBrowser();
  }
  check();
  const bytes = await pdf.save();
  check();
  return bytes;
}
