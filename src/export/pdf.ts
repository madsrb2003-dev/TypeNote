import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { CanvasContext } from 'vexflow/bravura';
import type { Score } from '../domain/types';
import { validateScore } from '../domain/validation';
import { drawSystem, minimumMeasureWidth, systemGeometry } from '../notation/engraving';
import { A4, CONTENT_WIDTH, MARGIN, paginate } from './layout';

interface ExportOptions { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void }
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function canvasFor(width: number, height: number, scale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the PDF drawing surface.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  return { canvas, context };
}

async function png(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not encode the PDF notation.')), 'image/png'));
  return blob.arrayBuffer();
}

export async function createScorePdf(input: Score, options: ExportOptions = {}): Promise<Uint8Array> {
  const score = validateScore(input);
  const check = () => options.signal?.throwIfAborted();
  check();
  await document.fonts.ready;
  const systems = [];
  for (let index = 0; index < score.measures.length;) {
    check();
    const minimum = minimumMeasureWidth(score.measures[index], true, index === 0);
    let count = 1;
    let width = Math.max(850, minimum + 45);
    if (width > 1120) throw new Error(`Measure ${index + 1} is too dense for a readable A4 page. Reduce its notation density before exporting.`);
    if (index + 1 < score.measures.length) {
      const next = minimumMeasureWidth(score.measures[index + 1], false, false);
      if (Math.max(minimum, next) * 2 + 45 <= width) count = 2;
    }
    const measures = score.measures.slice(index, index + count);
    systems.push({ firstIndex: index, measures, width, height: systemGeometry(measures).height });
    index += count;
    await yieldToBrowser();
  }
  const placements = paginate(systems);
  const pdf = await PDFDocument.create();
  pdf.setTitle(score.title || 'Untitled score'); pdf.setCreator('TypeNote'); pdf.setProducer('TypeNote');
  const pages = Array.from({ length: Math.max(1, ...placements.map(p => p.page + 1)) }, () => pdf.addPage([A4.width, A4.height]));
  // Rasterize title too, so Unicode titles do not rely on PDF's limited standard fonts.
  const title = canvasFor(CONTENT_WIDTH, 70, 300 / 72);
  title.context.fillStyle = '#26352d'; title.context.textAlign = 'center';
  const characters = Array.from(score.title || 'Untitled score');
  let lines: string[] = [];
  let fontSize = 20;
  do {
    title.context.font = `${fontSize}px Georgia`;
    lines = []; let line = '';
    for (const char of characters) {
      if (title.context.measureText(line + char).width > CONTENT_WIDTH - 20 && line) { lines.push(line); line = ''; }
      line += char;
    }
    if (line) lines.push(line);
    if (lines.length <= 2 || fontSize <= 12) break;
    fontSize--;
  } while (true);
  lines.forEach((text, index) => title.context.fillText(text, CONTENT_WIDTH / 2, 20 + index * (fontSize + 3), CONTENT_WIDTH - 20));
  title.context.font = '9px Arial'; title.context.fillText('PIANO · 4/4', CONTENT_WIDTH / 2, 66);
  const titleImage = await pdf.embedPng(await png(title.canvas));
  pages[0].drawImage(titleImage, { x: MARGIN, y: A4.height - MARGIN - 70, width: CONTENT_WIDTH, height: 70 });
  await titleImage.embed();
  title.canvas.width = 0; title.canvas.height = 0;
  for (const placement of placements) {
    check();
    const system = systems[placement.index];
    const { canvas, context } = canvasFor(system.width, system.height, placement.scale * 300 / 72);
    drawSystem(new CanvasContext(context), system.measures, system.firstIndex, system.width, undefined, true);
    const image = await pdf.embedPng(await png(canvas));
    pages[placement.page].drawImage(image, { x: MARGIN, y: A4.height - placement.top - placement.height, width: CONTENT_WIDTH, height: placement.height });
    await image.embed();
    canvas.width = 0; canvas.height = 0;
    options.onProgress?.(placement.index + 1, systems.length);
    await yieldToBrowser();
  }
  check();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pages.forEach((page, index) => page.drawText(`${index + 1} / ${pages.length}`, { x: A4.width / 2 - 12, y: 25, size: 9, font, color: rgb(.4, .4, .4) }));
  const bytes = await pdf.save();
  check();
  return bytes;
}
