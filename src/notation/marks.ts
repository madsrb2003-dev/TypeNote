import type { RenderContext } from 'vexflow/bravura';
import type { Anchor, Score, ScoreMark, StaffId } from '../domain/types';

export interface AnchorPoint { x: number; ys: number[]; top: number; bottom: number }
export interface MarkSegment { mark: ScoreMark; startsHere: boolean; endsHere: boolean; lane: number }
const pitchedSpans = new Set(['tie', 'slur', 'glissando', 'tremolo']);

/** Allocate independent annotation lanes, including spans continued from prior systems. */
export function markSegments(score: Score, first: number, count: number): MarkSegment[] {
  const lanes = new Map<string, number[]>();
  const result: MarkSegment[] = [];
  for (const mark of score.marks ?? []) {
    const start = score.measures.findIndex(m => m.id === mark.start.measureId);
    const end = mark.end ? score.measures.findIndex(m => m.id === mark.end!.measureId) : start;
    if (start < 0 || end < first || start >= first + count) continue;
    const key = `${mark.start.staff}-${mark.placement}`;
    const occupied = lanes.get(key) ?? [];
    let lane = occupied.findIndex(last => last < Math.max(first, start));
    if (lane < 0) lane = occupied.length;
    // Pitch-attached curves have their own geometry and don't consume text lanes.
    if (!pitchedSpans.has(mark.kind)) occupied[lane] = end;
    lanes.set(key, occupied);
    result.push({ mark, startsHere: start >= first, endsHere: end < first + count, lane });
  }
  return result;
}

const metronomeGlyphs: Record<string, string> = { whole: '\uECA2', half: '\uECA3', quarter: '\uECA5', eighth: '\uECA7', sixteenth: '\uECA9', '32nd': '\uECAB', '64th': '\uECAD', '128th': '\uECAF' };
export function parseMetronome(value: string): { prefix: string; glyph: string; bpm: number } | null {
  const match = /^(.*?)(?:(double-dotted|dotted)\s+)?(whole|half|quarter|eighth|sixteenth|32nd|64th|128th)\s*=\s*(\d{1,3})(?:\s*bpm)?$/i.exec(value.trim());
  if (!match || Number(match[4]) < 1) return null;
  const dots = match[2]?.toLowerCase() === 'double-dotted' ? 2 : match[2] ? 1 : 0;
  return { prefix: match[1].replace(/[\s·,;:]+$/, ''), glyph: metronomeGlyphs[match[3].toLowerCase()] + '\uECB7'.repeat(dots), bpm: Number(match[4]) };
}

function markHeight(mark: ScoreMark): number {
  return mark.kind === 'text' || mark.kind === 'tempo' ? Math.max(26, Math.ceil(Array.from(mark.value).length / 32) * 15 + (mark.kind === 'tempo' ? 30 : 10)) : 26;
}
function laneHeights(segments: MarkSegment[]): number[] {
  const heights: number[] = [];
  for (const segment of segments) if (!pitchedSpans.has(segment.mark.kind)) heights[segment.lane] = Math.max(heights[segment.lane] ?? 26, markHeight(segment.mark));
  return heights;
}

export function annotationSpace(score: Score, first: number, count: number, staff: StaffId, placement: 'above' | 'below'): number {
  const segments = markSegments(score, first, count).filter(s => s.mark.start.staff === staff && s.mark.placement === placement && !pitchedSpans.has(s.mark.kind));
  return segments.length ? laneHeights(segments).reduce((sum, height) => sum + (height ?? 26), 0) + 15 : 0;
}

const dynamicGlyphs: Record<string, string> = { p: '\uE520', m: '\uE521', f: '\uE522', r: '\uE523', s: '\uE524', z: '\uE525' };
const navigation: Record<string, string> = { fine: 'Fine', dc: 'D.C.', ds: 'D.S.', 'dc-al-fine': 'D.C. al Fine', 'ds-al-fine': 'D.S. al Fine', 'dc-al-coda': 'D.C. al Coda', 'ds-al-coda': 'D.S. al Coda', 'to-coda': 'To Coda' };

export function drawMarks(context: RenderContext, score: Score, first: number, count: number, width: number,
  staffBounds: Record<StaffId, { top: number; bottom: number }>, anchors: Map<string, AnchorPoint>, measureBounds: Map<string, { left: number; right: number }>) {
  const point = (anchor: Anchor, end: boolean): AnchorPoint | undefined => {
    if (anchor.eventId) return anchors.get(anchor.eventId);
    const measure = measureBounds.get(anchor.measureId);
    if (!measure) return undefined;
    const bounds = staffBounds[anchor.staff];
    return { x: end ? measure.right - 12 : measure.left + 12, ys: [(bounds.top + bounds.bottom) / 2], ...bounds };
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => context.beginPath().moveTo(x1, y1).lineTo(x2, y2).stroke();
  const segments = markSegments(score, first, count);
  for (const { mark, startsHere, endsHere, lane } of segments) {
    const bounds = staffBounds[mark.start.staff];
    const start = startsHere ? point(mark.start, false) : undefined;
    const end = endsHere ? point(mark.end ?? mark.start, true) : undefined;
    const x1 = start?.x ?? 38;
    const x2 = Math.max(x1 + 12, end?.x ?? width - 20);
    const below = mark.placement === 'below';
    const heights = laneHeights(segments.filter(s => s.mark.start.staff === mark.start.staff && s.mark.placement === mark.placement));
    const laneOffset = heights.slice(0, lane).reduce((sum, height) => sum + (height ?? 26), 0);
    const y = below ? bounds.bottom + 25 + laneOffset : bounds.top - 18 - laneOffset;
    const text = (value: string, x = x1, baseline = y, size = 12, italic = false) => {
      context.setFont('Arial', size, 'normal', italic ? 'italic' : 'normal');
      // Break long unspaced strings too, with geometry reserved by markHeight.
      const maximum = Math.min(250, width - 55);
      const lines: string[] = []; let lineText = '';
      for (const char of Array.from(value)) {
        if (lineText && (Array.from(lineText).length >= 32 || context.measureText(lineText + char).width > maximum)) { lines.push(lineText); lineText = ''; }
        lineText += char;
      }
      if (lineText) lines.push(lineText);
      const longest = Math.max(0, ...lines.map(line => context.measureText(line).width));
      const left = Math.max(15, Math.min(x, width - longest - 18));
      const firstLine = below ? baseline : baseline - (lines.length - 1) * 15;
      lines.forEach((line, row) => context.fillText(line, left, firstLine + row * 15));
    };
    context.save(); context.setLineWidth(1.15);
    context.openGroup(`score-mark score-mark-${mark.kind}`, mark.id);
    switch (mark.kind) {
      case 'dynamic':
        context.setFont('Bravura', 22); { const value = [...mark.value].map(c => dynamicGlyphs[c] ?? c).join(''); context.fillText(value, Math.min(x1, width - context.measureText(value).width - 18), y); } break;
      case 'hairpin': {
        const crescendo = mark.value === 'crescendo';
        const left = crescendo ? (startsHere ? 0 : 3) : 6;
        const right = crescendo ? 6 : (endsHere ? 0 : 3);
        line(x1, y - left, x2, y - right); line(x1, y + left, x2, y + right); break;
      }
      case 'tie': case 'slur': {
        const direction = below ? 1 : -1;
        const sy = start ? (start.ys[mark.start.pitchIndex ?? 0] ?? start.ys[0]) + direction * 8 : end ? (end.ys[mark.end?.pitchIndex ?? 0] ?? end.ys[0]) + direction * 8 : (bounds.top + bounds.bottom) / 2;
        const ey = end ? (end.ys[mark.end?.pitchIndex ?? 0] ?? end.ys[0]) + direction * 8 : sy;
        const rise = direction * Math.min(mark.kind === 'tie' ? 16 : 30, (x2 - x1) / 4);
        const intervening = [...anchors.values()].filter(anchor => anchor.x >= x1 && anchor.x <= x2).flatMap(anchor => anchor.ys).filter(noteY => noteY >= bounds.top && noteY <= bounds.bottom);
        const crest = mark.kind === 'slur' && intervening.length ? (below ? Math.max(...intervening) + 35 : Math.min(...intervening) - 45) : undefined;
        context.beginPath().moveTo(x1 + 5, sy).bezierCurveTo(x1 + (x2-x1)/3, crest ?? sy + rise, x2 - (x2-x1)/3, crest ?? ey + rise, x2 - 3, ey).stroke(); break;
      }
      case 'pedal': {
        const label = mark.value === 'sostenuto' ? 'Sost. Ped.' : mark.value === 'soft' ? 'una corda' : 'Ped.';
        if (startsHere) text(label, x1, y, 12, true);
        const begin = startsHere ? x1 + (mark.value === 'sustain' ? 30 : 64) : x1;
        line(Math.min(begin, x2 - 5), y + 4, x2, y + 4);
        if (endsHere) line(x2, y + 4, x2, y - 6);
        if (!startsHere) line(x1, y + 4, x1, y - 2);
        break;
      }
      case 'octave': {
        text(startsHere ? mark.value : `(${mark.value})`, x1, y, 12, true);
        context.setLineDash([5, 4]); if (x2 > x1 + 38) line(x1 + 35, y - 4, x2, y - 4); context.setLineDash([]);
        if (endsHere) line(x2, y - 4, x2, y + (below ? -11 : 3)); break;
      }
      case 'glissando': {
        const sy = start?.ys[mark.start.pitchIndex ?? 0] ?? y;
        const ey = end?.ys[mark.end?.pitchIndex ?? 0] ?? sy;
        if (mark.value === 'wavy') {
          context.beginPath().moveTo(x1 + 12, sy);
          const length = Math.max(1, x2 - x1 - 18);
          for (let dx = 0; dx <= length; dx += 3) context.lineTo(x1 + 12 + dx, sy + (ey-sy) * dx/length + Math.sin(dx / 3) * 2);
          context.stroke();
        } else line(x1 + 12, sy, x2 - 6, ey);
        break;
      }
      case 'ending':
        if (startsHere) { line(x1, y + 8, x1, y - 7); text(mark.value.endsWith('.') ? mark.value : `${mark.value}.`, x1 + 5, y + 7, 11); }
        line(x1, y - 7, x2, y - 7); if (endsHere) line(x2, y - 7, x2, y + 8); break;
      case 'rehearsal': {
        context.setFont('Arial', 12, 'bold'); const box = Math.max(20, context.measureText(mark.value).width + 12);
        context.rect(x1 - 5, y - 16, box, 22).stroke(); context.fillText(mark.value, x1 + 1, y); break;
      }
      case 'navigation':
        if (mark.value === 'segno' || mark.value === 'coda') { context.setFont('Bravura', 25); context.fillText(mark.value === 'segno' ? '\uE047' : '\uE048', x1, y); }
        else text(navigation[mark.value] ?? mark.value); break;
      case 'tremolo': {
        const sy = start ? Math.min(...start.ys) - 26 : y;
        const ey = end ? Math.min(...end.ys) - 26 : sy;
        context.setLineWidth(3);
        for (let i = 0; i < Number(mark.value); i++) line(x1 + 13, sy + i * 6, x2 - 2, ey + i * 6);
        break;
      }
      case 'tempo': {
        const metronome = parseMetronome(mark.value);
        if (!metronome) { text(mark.value, x1, y, 12, true); break; }
        context.setFont('Arial', 12, 'normal', 'italic');
        const prefixWidth = metronome.prefix ? context.measureText(metronome.prefix).width + 14 : 0;
        context.setFont('Bravura', 20); const glyphWidth = context.measureText(metronome.glyph).width;
        context.setFont('Arial', 12); const suffix = ` = ${metronome.bpm}`, suffixWidth = context.measureText(suffix).width;
        const totalWidth = prefixWidth + glyphWidth + suffixWidth;
        let left = Math.max(15, Math.min(x1, width - Math.min(totalWidth, 250) - 18)), baseline = y;
        if (totalWidth > Math.min(250, width - 55) && metronome.prefix) {
          text(metronome.prefix, left, below ? y : y - 30, 12, true);
          if (below) baseline += Math.ceil(Array.from(metronome.prefix).length / 32) * 15 + 24;
        } else if (metronome.prefix) { context.setFont('Arial', 12, 'normal', 'italic').fillText(metronome.prefix, left, y); left += prefixWidth; }
        context.setFont('Bravura', 20).fillText(metronome.glyph, left, baseline);
        context.setFont('Arial', 12).fillText(suffix, left + glyphWidth, baseline);
        break;
      }
      case 'text': text(mark.value); break;
    }
    context.closeGroup(); context.restore();
  }
}
