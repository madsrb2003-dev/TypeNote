import { describe, expect, it } from 'vitest';
import { createScore, insertEvent } from './model';
import { historyReducer, initialHistory } from './history';
import type { Selection } from './types';

describe('editing history', () => {
  const selection: Selection = { kind: 'gap', staff: 'treble', measureIndex: 0, index: 0 };
  it('restores content and cursor across undo/redo and drops redo after a new edit', () => {
    const score = createScore();
    const start = initialHistory({ score, selection });
    const edited = insertEvent(score, selection, { id: 'rest-a', kind: 'rest', duration: 4 });
    const next = historyReducer(start, { type: 'commit', snapshot: { score: edited, selection: { ...selection, index: 1 } } });
    const undone = historyReducer(next, { type: 'undo' });
    expect(undone.present).toEqual(start.present);
    expect(historyReducer(undone, { type: 'redo' }).present).toEqual(next.present);
    const branched = historyReducer(undone, { type: 'commit', snapshot: { score: { ...score, title: 'New branch' }, selection } });
    expect(branched.future).toHaveLength(0);
    expect(historyReducer(branched, { type: 'redo' })).toBe(branched);
  });
  it('navigation does not create undo steps and reset clears history', () => {
    const start = initialHistory({ score: createScore(), selection });
    const moved = historyReducer(start, { type: 'select', selection: { ...selection, staff: 'bass' } });
    expect(moved.past).toHaveLength(0);
    const committed = historyReducer(moved, { type: 'commit', snapshot: { ...moved.present, score: { ...moved.present.score, title: 'Piano' } } });
    expect(historyReducer(committed, { type: 'reset', snapshot: start.present })).toEqual(start);
  });
});
