import type { RenderedMusicPage } from '../documents/types';

const svgNS = 'http://www.w3.org/2000/svg';
const sourceTypes = new Set(['typenote-source-header', 'typenote-source-footer', 'typenote-source-direction']);
const children = (node: Element, name: string) => Array.from(node.children).filter(e => e.localName === name && e.namespaceURI === node.namespaceURI);
const content = (node: Element, name: string) => children(node, name)[0]?.textContent ?? '';
const number = (value: string | null, fallback = NaN) => value === null || !value.trim() ? fallback : Number(value);
function screenMatrix(element: SVGGraphicsElement): DOMMatrix {
  const m = element.getScreenCTM();
  if (!m) throw new Error('Page layout geometry is unavailable.');
  return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
}
function safePng(value: string): boolean {
  if (!/^data:image\/png;base64,[A-Za-z\d+/]+={0,2}$/.test(value) || value.length > 2800000) return false;
  try {
    const bytes = atob(value.slice(22, 86));
    if (!bytes.startsWith('\x89PNG\r\n\x1a\n') || bytes.slice(12, 16) !== 'IHDR') return false;
    const integer = (i: number) => bytes.charCodeAt(i) * 16777216 + bytes.charCodeAt(i + 1) * 65536 + bytes.charCodeAt(i + 2) * 256 + bytes.charCodeAt(i + 3);
    const w = integer(16), h = integer(20);
    return w > 0 && h > 0 && w <= 30000 && h <= 30000 && w * h <= 32000000;
  } catch { return false; }
}
export interface PageCredit {
  page: number; x: number; y: number; width: number; height: number;
  image?: string; text?: string; size?: number; anchor?: string; weight?: string; italic?: boolean;
  kind: string;
}
export interface ImportedLayout {
  xml: string; credits: PageCredit[]; positionedCredits: boolean; fillPage: boolean; compactPage?: number; diagnostics: string[];
}

export function hasOriginalPageText(xml: string): boolean {
  const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  return children(root, 'credit').some(e => sourceTypes.has(content(e, 'credit-type')));
}
export function removeOriginalPageText(xml: string): string {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  for (const credit of children(parsed.documentElement, 'credit')) if (sourceTypes.has(content(credit, 'credit-type'))) credit.remove();
  return new XMLSerializer().serializeToString(parsed);
}

/** Read page furniture separately from musical content. Coordinates are page fractions. */
export function prepareImportedLayout(xml: string): ImportedLayout {
  const result: ImportedLayout = { xml, credits: [], positionedCredits: false, fillPage: false, diagnostics: [] };
  const parsed = new DOMParser().parseFromString(xml, 'application/xml'), root = parsed.documentElement;
  if (root.localName !== 'score-partwise' || parsed.querySelector('parsererror')) return result;
  const defaults = children(root, 'defaults')[0], page = defaults && children(defaults, 'page-layout')[0];
  const width = page ? number(content(page, 'page-width')) : NaN;
  const height = page ? number(content(page, 'page-height')) : NaN;
  const firstPart = children(root, 'part')[0];
  const systems = [1];
  for (const measure of firstPart ? children(firstPart, 'measure') : []) {
    const print = children(measure, 'print')[0];
    if (print?.getAttribute('new-page') === 'yes') systems.push(1);
    else if (print?.getAttribute('new-system') === 'yes') systems[systems.length - 1]++;
  }
  const lastSystems = systems.at(-1)!;
  if (systems.length > 1 && lastSystems <= 3 && lastSystems < Math.max(...systems)) result.compactPage = systems.length;
  result.fillPage = systems.every(n => n >= 3) && !result.compactPage;
  if (!(width > 0 && width < 60000 && height > 0 && height < 60000)) return result;
  const credits = children(root, 'credit');
  const imagePages = new Set(credits.filter(e => sourceTypes.has(content(e, 'credit-type'))).map(e => number(e.getAttribute('page'), 1)));
  const scaling = defaults && children(defaults, 'scaling')[0];
  const mmPerTenth = scaling ? number(content(scaling, 'millimeters')) / number(content(scaling, 'tenths')) : 7 / 40;
  let incomplete = false, totalImages = 0;
  for (const credit of credits) {
    const pageNumber = number(credit.getAttribute('page'), 1), kind = content(credit, 'credit-type');
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 200) { incomplete = true; continue; }
    if (imagePages.has(pageNumber) && !sourceTypes.has(kind)) continue;
    for (const element of Array.from(credit.children)) {
      if (!['credit-words', 'credit-image'].includes(element.localName)) continue;
      let x = number(element.getAttribute('default-x')), y = number(element.getAttribute('default-y'));
      if (!(x >= 0 && x <= width && y >= 0 && y <= height)) { incomplete = true; continue; }
      if (element.localName === 'credit-image') {
        const image = element.getAttribute('source') ?? '';
        const w = number(element.getAttribute('width')), h = number(element.getAttribute('height'));
        // Embedded PNG only: never fetch an image or allow executable SVG.
        if (!safePng(image) || (totalImages += image.length) > 11200000
          || !(w > 0 && h > 0 && w <= width && h <= height)) { incomplete = true; continue; }
        if (element.getAttribute('halign') === 'center') x -= w / 2;
        if (element.getAttribute('halign') === 'right') x -= w;
        y = height - y - (element.getAttribute('valign') === 'top' ? 0 : element.getAttribute('valign') === 'middle' ? h / 2 : h);
        if (x < -.001 || y < -.001 || x + w > width + .001 || y + h > height + .001) { incomplete = true; continue; }
        x = Math.max(0, x); y = Math.max(0, y);
        result.credits.push({ page: pageNumber, kind, x: x / width, y: y / height, width: w / width, height: h / height, image });
      } else {
        const size = number(element.getAttribute('font-size'), 10);
        if (!(size > 0 && size <= 100 && mmPerTenth > 0)) { incomplete = true; continue; }
        let text = element.textContent ?? '';
        if (kind === 'composer') text = Array.from(root.getElementsByTagNameNS(root.namespaceURI ?? '*', 'creator')).find(e => e.getAttribute('type') === 'composer')?.textContent ?? text;
        if (kind === 'title') text = content(root, 'movement-title') || (children(root, 'work')[0] && content(children(root, 'work')[0], 'work-title')) || text;
        result.credits.push({ page: pageNumber, kind, x: x / width, y: (height - y) / height, width: 0, height: size * 25.4 / 72 / mmPerTenth / height,
          text, size: size * 25.4 / 72 / mmPerTenth / width, anchor: element.getAttribute('justify') || element.getAttribute('halign') || 'left',
          weight: element.getAttribute('font-weight') === 'bold' ? 'bold' : 'normal', italic: element.getAttribute('font-style') === 'italic' });
      }
    }
  }
  if (incomplete && !imagePages.size) { result.credits = []; return result; }
  if (!result.credits.length) return result;
  if (!imagePages.has(1)) {
    const title = content(root, 'movement-title') || (children(root, 'work')[0] && content(children(root, 'work')[0], 'work-title'));
    if (title && !result.credits.some(c => c.page === 1 && c.kind === 'title')) {
      result.credits.push({ page: 1, kind: 'title', x: .5, y: .065, width: 0, height: .03,
        text: title, size: Math.min(.026, .026 * 65 / title.length), anchor: 'center', weight: 'bold' });
    }
  }
  result.positionedCredits = true;
  if (incomplete) result.diagnostics.push('Some page text could not be positioned safely. The complete source remains available.');
  // Credits are drawn at their encoded positions, not aggregated into a heading.
  for (const credit of credits) credit.remove();
  result.xml = new XMLSerializer().serializeToString(parsed);
  return result;
}

/** Place systems between the page's text areas without stretching musical glyphs. */
export function applyImportedLayout(page: RenderedMusicPage, index: number, layout: ImportedLayout): RenderedMusicPage {
  if (!layout.positionedCredits) return page;
  const parsed = new DOMParser().parseFromString(page.svg, 'image/svg+xml'), root = parsed.documentElement;
  const viewBox = root.getAttribute('viewBox')!.split(/\s+/).map(Number), width = viewBox[2], height = viewBox[3];
  const credits = layout.credits.filter(c => c.page === index + 1);
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  document.body.append(host); host.append(root);
  try {
    const graphics = root as unknown as SVGSVGElement;
    const inverse = screenMatrix(graphics).inverse();
    const systems = Array.from(root.querySelectorAll<SVGGElement>('g.system'));
    const boxes = systems.map(system => {
      const box = system.getBBox(), matrix = inverse.multiply(screenMatrix(system));
      const a = new DOMPoint(box.x, box.y).matrixTransform(matrix), b = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
      return { system, top: a.y, height: b.y - a.y, matrix: inverse.multiply(screenMatrix(system.parentNode as SVGGraphicsElement)) };
    });
    let top = height * 150 / 2970, bottom = height * (1 - 150 / 2970);
    for (const c of credits) {
      if (c.kind === 'typenote-source-header' || c.kind === 'typenote-source-direction' || (!sourceTypes.has(c.kind) && c.y < .25)) {
        top = Math.max(top, (c.y + c.height) * height + 10);
      } else if (c.kind === 'typenote-source-footer' || c.y > .82) bottom = Math.min(bottom, c.y * height - 10);
    }
    const total = boxes.reduce((sum, box) => sum + box.height, 0), minGap = 18;
    const scale = Math.min(1, (bottom - top - Math.max(0, boxes.length - 1) * minGap) / Math.max(1, total));
    if (scale < .65) throw new Error('The recognized systems cannot fit legibly between the original page text. Choose editable page text or correct the source layout.');
    const availableGap = boxes.length > 1 ? (bottom - top - total * scale) / (boxes.length - 1) : 0;
    // Short excerpts should retain their natural spacing instead of putting
    // their second system at the bottom of an otherwise empty page.
    const naturalGap = boxes.length > 1 ? (boxes.at(-1)!.top - boxes[0].top - total + boxes.at(-1)!.height) / (boxes.length - 1) : 0;
    const gap = boxes.length >= 3 && layout.compactPage !== index + 1 ? availableGap : Math.min(availableGap, Math.max(minGap, naturalGap));
    let y = top;
    for (const box of boxes) {
      const transform = new DOMMatrix().translate(width / 2, y).scale(scale).translate(-width / 2, -box.top);
      const local = box.matrix.inverse().multiply(transform).multiply(box.matrix);
      const wrapper = parsed.createElementNS(svgNS, 'g');
      wrapper.setAttribute('transform', `matrix(${local.a} ${local.b} ${local.c} ${local.d} ${local.e} ${local.f})`);
      box.system.before(wrapper); wrapper.append(box.system); y += box.height * scale + gap;
    }
    const furniture = parsed.createElementNS(svgNS, 'g'); furniture.setAttribute('class', 'source-page-text'); furniture.setAttribute('pointer-events', 'none');
    for (const c of credits) {
      const element = parsed.createElementNS(svgNS, c.image ? 'image' : 'text');
      element.setAttribute('x', String(c.x * width)); element.setAttribute('y', String(c.y * height));
      if (c.image) {
        element.setAttribute('width', String(c.width * width)); element.setAttribute('height', String(c.height * height));
        element.setAttribute('href', c.image); element.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      } else {
        element.setAttribute('font-size', String(c.size! * width)); element.setAttribute('font-family', 'Liberation Serif, serif');
        element.setAttribute('font-weight', c.weight!); element.setAttribute('font-style', c.italic ? 'italic' : 'normal');
        element.setAttribute('text-anchor', c.anchor === 'center' ? 'middle' : c.anchor === 'right' ? 'end' : 'start');
        element.textContent = c.text!;
      }
      furniture.append(element);
    }
    root.append(furniture);
    return { ...page, svg: new XMLSerializer().serializeToString(root) };
  } finally { host.remove(); }
}
