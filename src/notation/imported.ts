import type { MusicXmlDocument, RenderedMusicDocument, RenderedMusicPage, RenderMusicOptions } from '../documents/types';
import { prepareMusicXmlForRendering } from './importedCompatibility';
import { prepareImportedLayout, applyImportedLayout } from './importedLayout';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const safeElements = new Set(['svg', 'g', 'defs', 'path', 'use', 'text', 'tspan', 'rect', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'style', 'title', 'desc', 'clipPath', 'image']);
const inlineFont = /^data:(?:application\/(?:font-woff2?|x-font-ttf|vnd\.ms-fontobject|octet-stream)|font\/(?:woff2?|ttf|otf))(?:;charset=[\w-]+)?;base64,[A-Za-z\d+/=]+$/i;
const inlineImage = /^data:image\/(?:png|jpe?g);base64,[A-Za-z\d+/=]+$/i;

function safeReference(value: string): boolean { const compact = value.replace(/\s+/g, ''); return /^#[^\s]+$/.test(value) || inlineFont.test(compact) || inlineImage.test(compact); }
function safeCss(value: string): boolean {
  if (/@import|expression\s*\(|-moz-binding|behavior\s*:/i.test(value)) return false;
  // The toolkit emits regular CSS. Reject escapes so obfuscated URLs cannot be
  // interpreted differently by the CSS parser and this resource check.
  if (value.includes('\\')) return false;
  for (const match of value.matchAll(/url\(\s*(["']?)([\s\S]*?)\1\s*\)/gi)) if (!safeReference(match[2].trim())) return false;
  return true;
}

/** Keep note IDs and embedded glyph/font resources; disallow executable SVG or network references. */
export function prepareImportedPage(page: RenderedMusicPage): { page: RenderedMusicPage; diagnostics: string[] } {
  const parsed = new DOMParser().parseFromString(page.svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('The notation engine returned an invalid SVG page.');
  const root = parsed.documentElement;
  let removed = false;
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (element.namespaceURI !== SVG_NAMESPACE || !safeElements.has(element.localName)) { element.remove(); removed = true; continue; }
    if (element.localName === 'style' && !safeCss(element.textContent ?? '')) { element.remove(); removed = true; continue; }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase(), value = attribute.value;
      if (name.startsWith('on') || name === 'base' || (name === 'href' && !safeReference(value)) || ((name === 'style' || /url\s*\(/i.test(value)) && !safeCss(value))) {
        element.removeAttributeNode(attribute); removed = true;
      }
    }
    if (element.localName === 'g' && /(?:^|\s)(?:note|rest|mRest)(?:\s|$)/.test(element.getAttribute('class') ?? '') && element.id) element.setAttribute('data-note-id', element.id);
  }
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error('The notation page has invalid dimensions.');
  root.setAttribute('width', String(viewBox[2])); root.setAttribute('height', String(viewBox[3]));
  root.setAttribute('overflow', 'hidden');
  return {
    page: { svg: new XMLSerializer().serializeToString(root), width: viewBox[2], height: viewBox[3] },
    diagnostics: removed ? ['External or executable SVG content was omitted from the preview. The MusicXML source remains unchanged.'] : [],
  };
}

type WorkerReply = { type: 'progress'; completed: number; total: number }
  | { type: 'complete'; result: RenderedMusicDocument }
  | { type: 'error'; message: string; diagnostics: string[] };

export function renderImportedScore(document: MusicXmlDocument, options: RenderMusicOptions = {}): Promise<RenderedMusicDocument> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new DOMException('Rendering canceled.', 'AbortError'));
  if (document.kind !== 'musicxml' || !document.xml.trim()) return Promise.reject(new Error('Open a MusicXML document before rendering it.'));
  if (new TextEncoder().encode(document.xml).length > 10 * 1024 * 1024) return Promise.reject(new Error('MusicXML documents must be smaller than 10 MB.'));
  return new Promise((resolve, reject) => {
    const input = prepareMusicXmlForRendering(document.xml);
    const layout = prepareImportedLayout(input.xml);
    let worker: Worker;
    try { worker = new Worker(new URL('./imported.worker.ts', import.meta.url), { type: 'module', name: 'typenote-musicxml' }); }
    catch { reject(new Error('Your browser could not start the local notation worker. Reload the editor and try again.')); return; }
    let settled = false;
    const cleanup = () => { worker.terminate(); options.signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(options.signal?.reason ?? new DOMException('Rendering canceled.', 'AbortError'));
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => fail(new Error('The local notation worker could not finish. Reload the editor, or try a smaller MusicXML document.'));
    worker.onmessageerror = () => fail(new Error('The browser could not receive the rendered notation pages.'));
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (settled || options.signal?.aborted) return;
      if (data.type === 'progress') { options.onProgress?.(data.completed, data.total); return; }
      if (data.type === 'error') { fail(new Error([data.message, ...data.diagnostics].join('\n'))); return; }
      try {
        const prepared = data.result.pages.map(prepareImportedPage);
        const diagnostics = [...new Set([...input.diagnostics, ...layout.diagnostics, ...data.result.diagnostics, ...prepared.flatMap(item => item.diagnostics)])];
        const pages = prepared.map((item, index) => applyImportedLayout(item.page, index, layout));
        settled = true; cleanup(); resolve({ pages, diagnostics });
      } catch (error) { fail(error); }
    };
    // Each request owns its worker. Canceling an obsolete render terminates its
    // WASM computation, and its late messages can never resolve a newer request.
    worker.postMessage({ xml: layout.xml, positionedCredits: layout.positionedCredits, fillPage: layout.fillPage });
  });
}
