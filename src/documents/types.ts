import type { Alteration, Step } from '../domain/types';

/** The complete MusicXML is authoritative. No reduced score projection is saved. */
export interface MusicXmlDocument {
  version: 4;
  kind: 'musicxml';
  xml: string;
  filename?: string;
}
export interface ImportedNote {
  id: string;
  measure: string;
  part: string;
  staff: string;
  voice: string;
  kind: 'note' | 'rest';
  step?: Step;
  alter?: Alteration;
  octave?: number;
  accidental?: 'auto' | 'explicit' | 'courtesy';
  type: string;
  dots: number;
  grace: boolean;
  cue: boolean;
  hidden: boolean;
  fingering?: string;
}
export interface ImportedDirection { id: string; kind: 'dynamic' | 'words' | 'rehearsal'; value: string; measure: string }
export interface DocumentInfo {
  title: string;
  composer: string;
  notes: ImportedNote[];
  directions: ImportedDirection[];
  features: string[];
  warnings: string[];
}
export interface ImportedNotePatch {
  step?: Step;
  alter?: Alteration;
  octave?: number;
  accidental?: 'auto' | 'explicit' | 'courtesy';
  fingering?: string;
}
export interface RenderedMusicPage { svg: string; width: number; height: number }
export interface RenderedMusicDocument { pages: RenderedMusicPage[]; diagnostics: string[] }
export interface RenderMusicOptions { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void }
