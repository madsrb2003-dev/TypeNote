/** Exact timing: one tick = a sixteenth note. The editor uses fixed 4/4. */
export type Duration = 1 | 2 | 4 | 8 | 16;
export type StaffId = 'treble' | 'bass';
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
/** B here is the international diatonic step. UI H = B/0, UI B = B/-1. */
export interface Pitch { step: Step; alter: -1 | 0 | 1; octave: number }
export type ScoreEvent =
  | { id: string; kind: 'note'; duration: Duration; pitches: Pitch[] }
  | { id: string; kind: 'rest'; duration: Duration };
/** All pitches in a note/chord share its duration. Pitch order is stable for editing. */
export interface Measure { id: string; treble: ScoreEvent[]; bass: ScoreEvent[] }
export interface Score { version: 2; title: string; measures: Measure[] }
export interface Position { measureIndex: number; staff: StaffId; index: number }
export interface Selection extends Position { kind: 'gap' | 'event' }
export const MEASURE_TICKS = 16;
export const MAX_CHORD_PITCHES = 10;
export const MAX_SCORE_FILE_BYTES = 10 * 1024 * 1024;
export const DURATIONS: Duration[] = [16, 8, 4, 2, 1];
export const DURATION_LABELS: Record<Duration, string> = { 16: 'Whole', 8: 'Half', 4: 'Quarter', 2: 'Eighth', 1: 'Sixteenth' };
