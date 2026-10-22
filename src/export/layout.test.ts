import { describe, expect, it } from 'vitest';
import { A4, CONTENT_WIDTH, MARGIN, paginate } from './layout';

describe('A4 pagination', () => {
  it('preserves each system exactly once within margins across pages', () => {
    const boxes = Array.from({ length: 20 }, () => ({ width: 850, height: 330 }));
    const placements = paginate(boxes);
    expect(placements.map(p => p.index)).toEqual(boxes.map((_, i) => i));
    expect(placements.at(-1)!.page).toBeGreaterThan(0);
    for (const p of placements) {
      expect(p.top).toBeGreaterThanOrEqual(MARGIN);
      expect(p.top + p.height).toBeLessThanOrEqual(A4.height - MARGIN - 22);
      expect(p.scale * 850).toBeCloseTo(CONTENT_WIDTH);
    }
  });
  it('honors explicit page breaks without creating a blank first page', () => {
    const placements = paginate([{ width: 850, height: 100, pageBreak: true }, { width: 850, height: 100, pageBreak: true }]);
    expect(placements.map(p => p.page)).toEqual([0, 1]);
    expect(placements[1].top).toBe(MARGIN);
  });
  it('rejects a system that cannot fit instead of cropping it', () => {
    expect(() => paginate([{ width: 850, height: 2000 }])).toThrow(/too tall/);
  });
});
