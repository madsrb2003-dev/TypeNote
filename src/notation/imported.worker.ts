import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import type { RenderedMusicPage } from '../documents/types';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ xml: string }>) => void) | null;
  postMessage(message: unknown): void;
};

workerScope.onmessage = async ({ data }) => {
  const diagnostics: string[] = [];
  const collect = (...values: unknown[]) => {
    const message = values.map(value => typeof value === 'string' ? value : String(value)).join(' ').trim();
    if (message && !diagnostics.includes(message) && diagnostics.length < 100) diagnostics.push(message.slice(0,2000));
  };
  // Verovio's WASM runtime binds console.error at initialization. Capture it in
  // this isolated worker so import/engraving warnings reach the document UI.
  console.error = collect;
  console.warn = collect;
  let toolkit: VerovioToolkit | undefined;
  try {
    const module = await createVerovioModule();
    toolkit = new VerovioToolkit(module);
    const hasEncodedBreaks = /<(?:[\w.-]+:)?print\b[^>]*\bnew-(?:system|page)\s*=\s*["']yes["']/i.test(data.xml);
    toolkit.setOptions({
      // 210 × 297 mm, with 15 mm margins. Scaling changes SVG coordinates only.
      pageWidth: 2100, pageHeight: 2970, scale: 40,
      pageMarginTop: 150, pageMarginBottom: 150, pageMarginLeft: 150, pageMarginRight: 150,
      adjustPageHeight: false, adjustPageWidth: false, scaleToPageSize: false,
      breaks: hasEncodedBreaks ? 'smart' : 'auto', breaksSmartSb: 0,
      font: 'Bravura', fontTextLiberation: true, smuflTextFont: 'embedded',
      svgViewBox: true, svgHtml5: false, svgFormatRaw: true,
      svgRemoveXlink: false, xmlIdChecksum: true, removeIds: false,
      condense: 'none', showHidden: false, shrinkToFit: true,
    });
    // MusicXML is only input to the renderer. Never serialize the internal MEI
    // projection back into the user's authoritative document.
    if (!toolkit.loadData(data.xml)) throw new Error('The notation engine could not read this MusicXML document.');
    const total = toolkit.getPageCount();
    if (!Number.isSafeInteger(total) || total < 1) throw new Error('This MusicXML document did not produce any printable notation pages.');
    workerScope.postMessage({ type: 'progress', completed: 0, total });
    const pages: RenderedMusicPage[] = [];
    for (let page = 1; page <= total; page++) {
      const svg = toolkit.renderToSVG(page);
      if (!svg.includes('<svg')) throw new Error(`The notation engine could not draw page ${page}.`);
      pages.push({ svg, width: 840, height: 1188 });
      workerScope.postMessage({ type: 'progress', completed: page, total });
    }
    const log = toolkit.getLog();
    if (log.trim()) log.split('\n').forEach(collect);
    workerScope.postMessage({ type: 'complete', result: { pages, diagnostics } });
  } catch (error) {
    workerScope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The notation engine stopped while drawing this MusicXML document.', diagnostics });
  } finally {
    toolkit?.destroy();
  }
};
