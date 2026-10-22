/** Base durations in sixteenth-note units; dotted and tuplet timing is rational. */
export type Duration = 0.125 | 0.25 | 0.5 | 1 | 2 | 4 | 8 | 16 | 32;
export type StaffId = 'treble' | 'bass';
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
/** B here is the international diatonic step. UI H = B/0, UI B = B/-1. */
export type Alteration = -2 | -1 | 0 | 1 | 2;
export type Clef = 'treble' | 'bass' | 'alto' | 'tenor';
export interface Pitch { step: Step; alter: Alteration; octave: number; accidental?: 'auto' | 'explicit' | 'courtesy'; staff?: StaffId; fingering?: string }
export interface TupletSpec { actual: number; normal: number; group: string }
export interface GraceNote { pitches: Pitch[]; duration: Duration; slash: boolean }
export interface EventNotation {
  dots?: 0 | 1 | 2;
  tuplet?: TupletSpec;
  stem?: 'auto' | 'up' | 'down';
  beam?: 'auto' | 'start' | 'continue' | 'end' | 'none';
  displayStaff?: StaffId;
  articulations?: string[];
  ornament?: string;
  tremolo?: number;
  arpeggio?: 'up' | 'down';
  grace?: GraceNote[];
  restLine?: number;
  /** Whole-measure rest: actual length in sixteenth units, independent of glyph. */
  measureRest?: number;
}
export type ScoreEvent =
  | ({ id: string; kind: 'note'; duration: Duration; pitches: Pitch[] } & EventNotation)
  | ({ id: string; kind: 'rest'; duration: Duration } & EventNotation);
export interface KeySignature { name?: string; fifths?: number; alterations: Partial<Record<Step, Alteration>> }
export interface TimeSignature { beats: number; beatType: 1 | 2 | 4 | 8 | 16 | 32; groups?: number[] }
export interface MeasureSettings {
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  clefs?: Partial<Record<StaffId, Clef>>;
  /** Explicit length in sixteenth ticks for pickups or irregular bars. */
  pickup?: number;
  barline?: 'single' | 'double' | 'final' | 'repeatEnd';
  repeatStart?: boolean;
  systemBreak?: boolean;
  pageBreak?: boolean;
}
/** All pitches in a note/chord share its duration. Pitch order is stable for editing. */
export interface Measure extends MeasureSettings { id: string; treble: ScoreEvent[]; bass: ScoreEvent[]; extraVoices?: Partial<Record<StaffId, ScoreEvent[][]>> }
export interface Anchor { measureId: string; staff: StaffId; eventId?: string; pitchIndex?: number }
export type MarkKind = 'dynamic' | 'hairpin' | 'slur' | 'tie' | 'pedal' | 'octave' | 'glissando' | 'text' | 'tempo' | 'rehearsal' | 'ending' | 'navigation' | 'tremolo';
export interface ScoreMark { id: string; kind: MarkKind; start: Anchor; end?: Anchor; value: string; placement: 'above' | 'below' }
export interface Score { version: 3; title: string; measures: Measure[]; composer?: string; marks?: ScoreMark[] }
export interface Position { measureIndex: number; staff: StaffId; index: number; voice?: number }
export interface Selection extends Position {
  kind: 'gap' | 'event';
  /** Stable source-order pitch within a selected event; omitted selects the event. */
  pitchIndex?: number;
}
export const MEASURE_TICKS = 16;
export const MAX_CHORD_PITCHES = 10;
export const MAX_SCORE_FILE_BYTES = 10 * 1024 * 1024;
export const DURATIONS: Duration[] = [16, 8, 4, 2, 1];
export const ALL_DURATIONS: Duration[] = [32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125];
export const DURATION_LABELS: Record<Duration, string> = { 32: 'Breve', 16: 'Whole', 8: 'Half', 4: 'Quarter', 2: 'Eighth', 1: 'Sixteenth', 0.5: 'Thirty-second', 0.25: 'Sixty-fourth', 0.125: '128th' };
export const ARTICULATIONS = ['staccato', 'staccatissimo', 'accent', 'tenuto', 'marcato', 'fermata', 'breath'] as const;
export const ORNAMENTS = ['trill', 'mordent', 'inverted-mordent', 'turn', 'inverted-turn', 'delayed-turn'] as const;
export const DYNAMICS = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sf', 'sfz', 'sffz', 'fp', 'rfz'] as const;
