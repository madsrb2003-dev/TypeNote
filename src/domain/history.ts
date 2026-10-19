import type { Score, Selection } from './types';

export interface Snapshot { score: Score; selection: Selection }
export interface History { past: Snapshot[]; present: Snapshot; future: Snapshot[] }
export type HistoryAction =
  | { type: 'commit'; snapshot: Snapshot }
  | { type: 'select'; selection: Selection }
  | { type: 'reset'; snapshot: Snapshot }
  | { type: 'undo' | 'redo' };
export function initialHistory(snapshot: Snapshot): History {
  return { past: [], present: snapshot, future: [] };
}
export function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'reset': return initialHistory(action.snapshot);
    case 'select': return { ...state, present: { ...state.present, selection: action.selection } };
    case 'commit': return { past: [...state.past.slice(-99), state.present], present: action.snapshot, future: [] };
    case 'undo': {
      const previous = state.past.at(-1);
      return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
    }
    case 'redo': {
      const next = state.future[0];
      return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
    }
  }
}
