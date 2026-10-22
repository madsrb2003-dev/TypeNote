export const A4 = { width: 595.28, height: 841.89 };
export const MARGIN = 42.52;
export const CONTENT_WIDTH = A4.width - MARGIN * 2;
export interface SystemBox { width: number; height: number; pageBreak?: boolean }
export interface Placement { index: number; page: number; top: number; height: number; scale: number }

/** Keep systems whole, with fixed margins and a reserved title/footer area. */
export function paginate(systems: SystemBox[]): Placement[] {
  let page = 0;
  let top = MARGIN + 76;
  return systems.map((system, index) => {
    const scale = CONTENT_WIDTH / system.width;
    const height = system.height * scale;
    if (!Number.isFinite(height) || system.width <= 0 || height <= 0 || height > A4.height - MARGIN * 2 - 22) {
      throw new Error(`System ${index + 1} is too tall for A4. Reduce the pitch range before exporting.`);
    }
    if ((system.pageBreak && index > 0) || top + height > A4.height - MARGIN - 22) {
      page++; top = MARGIN;
    }
    const result = { index, page, top, height, scale };
    top += height + 8;
    return result;
  });
}
