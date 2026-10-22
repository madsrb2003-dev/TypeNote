import { useEffect, useState } from 'react';
import { deleteScoreMark, getEvents, insertEvent, measureCapacity, newId, patchEvent, setComposer, setMeasureSettings, setScoreMark, updateChordPitch, updateEvent } from '../domain/model';
import { effectiveSettings, KEY_SIGNATURES, keySignatureFor } from '../domain/settings';
import { validateScore } from '../domain/validation';
import { ALL_DURATIONS, ARTICULATIONS, DYNAMICS, DURATION_LABELS, ORNAMENTS } from '../domain/types';
import type { Alteration, Anchor, Clef, Duration, EventNotation, GraceNote, MarkKind, MeasureSettings, Pitch, Score, ScoreMark, Selection, StaffId, Step, TimeSignature } from '../domain/types';

const steps: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const accidentalNames = ['𝄫', '♭', '—', '♯', '𝄪'];
const markNames: Record<MarkKind, string> = { dynamic: 'Dynamic', hairpin: 'Hairpin', slur: 'Slur', tie: 'Tie', pedal: 'Pedal', octave: 'Octave line', glissando: 'Glissando', text: 'Expression / text', tempo: 'Tempo', rehearsal: 'Rehearsal mark', ending: 'Repeat ending', navigation: 'Navigation', tremolo: 'Two-note tremolo' };
const values: Partial<Record<MarkKind, readonly string[]>> = {
  dynamic: DYNAMICS, hairpin: ['crescendo', 'diminuendo'], pedal: ['sustain', 'sostenuto', 'soft'],
  octave: ['8va', '8vb', '15ma', '15mb'], glissando: ['straight', 'wavy'], tremolo: ['1', '2', '3', '4'],
  navigation: ['segno', 'coda', 'fine', 'dc', 'ds', 'dc-al-fine', 'ds-al-fine', 'dc-al-coda', 'ds-al-coda', 'to-coda'],
};
const spans: MarkKind[] = ['hairpin', 'slur', 'tie', 'pedal', 'octave', 'glissando', 'ending', 'tremolo'];
function keyLabel(name: string) { return name.replace(/^B(?=[bm#]|$)/, 'H').replace(/^Bb/, 'B♭').replace(/b/g, '♭').replace(/#/g, '♯').replace(/m$/, ' minor') + (name.endsWith('m') ? '' : ' major'); }
interface Props {
  score: Score; selection: Selection; pitchIndex: number; duration: Duration;
  commit: (score: Score) => void; report: (message: string, error?: boolean) => void;
  onDuration: (duration: Duration) => void; onSelect: (selection: Selection) => void;
}
export function NotationPanel({ score, selection, pitchIndex, duration, commit, report, onDuration, onSelect }: Props) {
  const measure = score.measures[selection.measureIndex];
  const settings = effectiveSettings(score, selection.measureIndex);
  const events = getEvents(measure, selection.staff, selection.voice);
  const event = selection.kind === 'event' ? events[selection.index] : undefined;
  const pitch = event?.kind === 'note' ? event.pitches[pitchIndex] : undefined;
  const [tab, setTab] = useState<'measure' | 'event' | 'marks'>('measure');
  const [beats, setBeats] = useState(String(settings.timeSignature.beats));
  const [beatType, setBeatType] = useState(settings.timeSignature.beatType);
  const [groups, setGroups] = useState('');
  const [actual, setActual] = useState(3);
  const [normal, setNormal] = useState(2);
  const [kind, setKind] = useState<MarkKind>('dynamic');
  const [value, setValue] = useState('mf');
  const [placement, setPlacement] = useState<'above' | 'below'>('below');
  const [start, setStart] = useState<Anchor | null>(null);
  const [end, setEnd] = useState<Anchor | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [graceStep, setGraceStep] = useState<Step>('D');
  const [graceSlash, setGraceSlash] = useState(true);
  const [fingering, setFingering] = useState(pitch?.fingering ?? '');
  useEffect(() => setFingering(pitch?.fingering ?? ''), [event?.id, pitchIndex, pitch?.fingering]);
  useEffect(() => { setBeats(String(settings.timeSignature.beats)); setBeatType(settings.timeSignature.beatType); setGroups(settings.timeSignature.groups?.join('+') ?? ''); }, [selection.measureIndex, settings.timeSignature]);
  function apply(action: () => Score) { try { commit(action()); report('Notation updated.'); } catch (error) { report(error instanceof Error ? error.message : 'Unable to change notation.', true); } }
  function changeMeasure(patch: MeasureSettings) { apply(() => setMeasureSettings(score, selection.measureIndex, patch)); }
  function changeEvent(patch: Partial<EventNotation>) { if (event) apply(() => patchEvent(score, selection, ('dots' in patch || 'tuplet' in patch) ? { ...patch, measureRest: undefined } : patch)); }
  function changePitch(patch: Partial<Pitch>) { if (pitch) apply(() => updateChordPitch(score, selection, pitchIndex, { ...pitch, ...patch })); }
  function changeGrace(index: number, patch: Partial<GraceNote>) { if (event) changeEvent({ grace: event.grace?.map((g, i) => i === index ? { ...g, ...patch } : g) }); }
  function anchor(): Anchor { return { measureId: measure.id, staff: selection.staff, ...(event ? { eventId: event.id, ...(event.kind === 'note' ? { pitchIndex } : {}) } : {}) }; }
  function anchorLabel(a: Anchor | null) {
    if (!a) return 'Not set';
    const index = score.measures.findIndex(m => m.id === a.measureId);
    return index < 0 ? 'Removed position' : `Bar ${index + 1} · ${a.staff}${a.eventId ? ' · selected event' : ''}`;
  }
  function saveMark() {
    const first = start ?? anchor();
    if (spans.includes(kind) && !end) { report('Choose a start, select the last note or measure, then choose Set end.', true); return; }
    apply(() => setScoreMark(score, { id: editingId ?? newId(), kind, start: first, ...(spans.includes(kind) && end ? { end } : {}), value, placement }));
  }
  function editMark(mark: ScoreMark) { setEditingId(mark.id); setKind(mark.kind); setValue(mark.value); setPlacement(mark.placement); setStart(mark.start); setEnd(mark.end ?? null); }
  function tuplet(remove: boolean) {
    if (!event) return;
    apply(() => {
      if (!remove && events.length - selection.index < actual) throw new Error(`Enter at least ${actual} consecutive events starting at this selection first.`);
      const group = newId();
      const next = events.map((current, i) => remove
        ? current.tuplet?.group === event.tuplet?.group ? { ...current, tuplet: undefined } : current
        : i >= selection.index && i < selection.index + actual ? { ...current, tuplet: { actual, normal, group } } : current);
      const edited = structuredClone(score);
      if (!selection.voice) edited.measures[selection.measureIndex][selection.staff] = next;
      else {
        const bar = edited.measures[selection.measureIndex];
        bar.extraVoices ??= {}; bar.extraVoices[selection.staff] ??= [];
        bar.extraVoices[selection.staff]![selection.voice - 1] = next;
      }
      return validateScore(edited);
    });
  }
  return <details className="notation-panel" open>
    <summary>Notation tools <span>Signatures, voices, expression and piano markings</span></summary>
    <div className="notation-tabs" aria-label="Notation categories">{(['measure', 'event', 'marks'] as const).map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name === 'measure' ? 'Score & measure' : name === 'event' ? 'Note & rhythm' : 'Marks & spans'}</button>)}
      <label>Voice <select aria-label="Voice" value={(selection.voice ?? 0) + 1} onChange={e => onSelect({ ...selection, voice: Number(e.target.value) - 1, kind: 'gap', index: 0 })}>{[0, 1, 2, 3].map(v => <option value={v + 1} key={v}>{v + 1}</option>)}</select></label>
    </div>
    {tab === 'measure' && <div className="notation-fields">
      <label>Composer<input aria-label="Composer" maxLength={120} value={score.composer ?? ''} onChange={e => apply(() => setComposer(score, e.target.value))} /></label>
      <fieldset><legend>Key signature · from measure {selection.measureIndex + 1}</legend>
        <label>Named key<select aria-label="Key signature" value={settings.keySignature.name ?? 'custom'} onChange={e => e.target.value !== 'custom' && changeMeasure({ keySignature: keySignatureFor(e.target.value) })}><option value="custom">Manual signature</option>{KEY_SIGNATURES.map(key => <option key={key.name} value={key.name}>{keyLabel(key.name!)}</option>)}</select></label>
        <div className="signature-steps">{steps.map(step => <label key={step}>{step === 'B' ? 'H' : step}<select aria-label={`Signature ${step === 'B' ? 'H' : step}`} value={settings.keySignature.alterations[step] ?? 0} onChange={e => changeMeasure({ keySignature: { alterations: { ...settings.keySignature.alterations, [step]: Number(e.target.value) as Alteration } } })}>{[-2, -1, 0, 1, 2].map((alter, i) => <option key={alter} value={alter}>{accidentalNames[i]}</option>)}</select></label>)}</div>
        <p>Choose a named key or write its accidentals manually. Entry follows the signature without adding local signs. Natural overrides it on a selected note.</p>
        <button disabled={!measure.keySignature} onClick={() => changeMeasure({ keySignature: undefined })}>Remove key change</button>
      </fieldset>
      <fieldset><legend>Meter & pickup</legend><div className="field-row"><label>Beats<input aria-label="Beats per measure" type="number" min="1" max="32" value={beats} onChange={e => setBeats(e.target.value)} /></label><label>Beat unit<select aria-label="Beat unit" value={beatType} onChange={e => setBeatType(Number(e.target.value) as TimeSignature['beatType'])}>{[1, 2, 4, 8, 16, 32].map(v => <option key={v}>{v}</option>)}</select></label><label>Grouping<input aria-label="Beat grouping" placeholder="e.g. 3+2" value={groups} onChange={e => setGroups(e.target.value)} /></label></div>
        <button onClick={() => changeMeasure({ timeSignature: { beats: Number(beats), beatType, ...(groups.trim() ? { groups: groups.split('+').map(Number) } : {}) } })}>Apply meter</button>
        <label>Pickup length (quarter notes)<input aria-label="Pickup length" type="number" step="0.03125" min="0" value={measure.pickup === undefined ? '' : measure.pickup / 4} placeholder="Full measure" onChange={e => changeMeasure({ pickup: e.target.value === '' ? undefined : Number(e.target.value) * 4 })} /></label>
        <button disabled={!measure.timeSignature} onClick={() => changeMeasure({ timeSignature: undefined })}>Remove meter change</button>
      </fieldset>
      <fieldset><legend>Clefs & barlines</legend><div className="field-row">{(['treble', 'bass'] as const).map(staff => <label key={staff}>{staff === 'treble' ? 'Upper' : 'Lower'} staff clef<select aria-label={`${staff} clef`} value={settings.clefs[staff]} onChange={e => changeMeasure({ clefs: { ...measure.clefs, [staff]: e.target.value as Clef } })}>{['treble', 'bass', 'alto', 'tenor'].map(clef => <option key={clef}>{clef}</option>)}</select></label>)}</div>
        <label>End barline<select aria-label="End barline" value={measure.barline ?? 'single'} onChange={e => changeMeasure({ barline: e.target.value as MeasureSettings['barline'] })}>{['single', 'double', 'final', 'repeatEnd'].map(v => <option key={v} value={v}>{v === 'repeatEnd' ? 'End repeat' : v}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={measure.repeatStart ?? false} onChange={e => changeMeasure({ repeatStart: e.target.checked })} />Start repeat</label>
        <label className="check"><input type="checkbox" checked={measure.systemBreak ?? false} onChange={e => changeMeasure({ systemBreak: e.target.checked })} />New system before this measure</label>
        <label className="check"><input type="checkbox" checked={measure.pageBreak ?? false} onChange={e => changeMeasure({ pageBreak: e.target.checked })} />New PDF page before this measure</label>
      </fieldset>
    </div>}
    {tab === 'event' && <div className="notation-fields">
      <label>Duration<select aria-label="Extended duration" value={duration} onChange={e => onDuration(Number(e.target.value) as Duration)}>{ALL_DURATIONS.map(d => <option key={d} value={d}>{DURATION_LABELS[d]}</option>)}</select></label>
      <button disabled={events.length > 1 || (events.length === 1 && !event)} onClick={() => apply(() => { const rest = { id: event?.id ?? newId(), kind: 'rest' as const, duration: 16 as const, measureRest: measureCapacity(score, selection.measureIndex) }; return event ? updateEvent(score, selection, rest) : insertEvent(score, selection, rest); })}>Full-measure rest</button>
      {!event && <p>Select a note or rest to edit its rhythm and markings. Choose a voice above to enter an independent line.</p>}
      {event && <>
        <fieldset><legend>Rhythm</legend><label>Dots<select aria-label="Augmentation dots" value={event.dots ?? 0} onChange={e => changeEvent({ dots: Number(e.target.value) as 0 | 1 | 2 })}>{[0, 1, 2].map(n => <option key={n}>{n}</option>)}</select></label>
          <div className="field-row"><label>Tuplet notes<input aria-label="Tuplet notes" type="number" min="2" max="32" value={actual} onChange={e => setActual(Number(e.target.value))} /></label><label>In the time of<input aria-label="Tuplet normal notes" type="number" min="1" max="32" value={normal} onChange={e => setNormal(Number(e.target.value))} /></label></div>
          <button onClick={() => tuplet(false)}>Group next {actual} events</button><button disabled={!event.tuplet} onClick={() => tuplet(true)}>Remove tuplet group</button>
          <p>Enter the group using shorter notes if the bar is full; then apply the ratio and adjust durations.</p>
          <label>Beam<select aria-label="Beam" value={event.beam ?? 'auto'} onChange={e => changeEvent({ beam: e.target.value as EventNotation['beam'] })}>{['auto', 'start', 'continue', 'end', 'none'].map(v => <option key={v} disabled={event.duration > 2 && ['start', 'continue', 'end'].includes(v)}>{v}</option>)}</select></label>
        </fieldset>
        <fieldset><legend>Voice & staff</legend><label>Stem direction<select aria-label="Stem direction" value={event.stem ?? 'auto'} onChange={e => changeEvent({ stem: e.target.value as EventNotation['stem'] })}>{['auto', 'up', 'down'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>Display event on<select aria-label="Display staff" value={event.displayStaff ?? ''} onChange={e => changeEvent({ displayStaff: e.target.value ? e.target.value as StaffId : undefined })}><option value="">Source staff</option><option value="treble">Upper staff</option><option value="bass">Lower staff</option></select></label>
          {event.kind === 'rest' && <label>Rest staff line<input aria-label="Rest staff line" type="number" min="0" max="5" step="0.5" value={event.restLine ?? 2} onChange={e => changeEvent({ restLine: Number(e.target.value) })} /></label>}
          {pitch && <><label>Selected pitch staff<select aria-label="Pitch staff" value={pitch.staff ?? ''} onChange={e => changePitch({ staff: e.target.value ? e.target.value as StaffId : undefined })}><option value="">Event staff</option><option value="treble">Upper staff</option><option value="bass">Lower staff</option></select></label><label>Fingering<input aria-label="Fingering" maxLength={12} placeholder="e.g. 1 or 3–1" value={fingering} onChange={e => setFingering(e.target.value)} onBlur={() => { if (fingering !== (pitch.fingering ?? '')) { changePitch({ fingering: fingering || undefined }); } }} /></label><label className="check"><input type="checkbox" checked={pitch.accidental === 'courtesy'} onChange={e => changePitch({ accidental: e.target.checked ? 'courtesy' : 'explicit' })} />Courtesy accidental (parenthesized)</label></>}
        </fieldset>
        {event.kind === 'rest' && <fieldset><legend>Rest articulation</legend><label className="check"><input type="checkbox" checked={event.articulations?.includes('fermata') ?? false} onChange={e => changeEvent({ articulations: e.target.checked ? ['fermata'] : undefined })} />Fermata</label></fieldset>}
        {event.kind === 'note' && <>
          <fieldset><legend>Articulation & ornaments</legend><div className="articulation-options">{ARTICULATIONS.map(v => <label className="check" key={v}><input type="checkbox" checked={event.articulations?.includes(v) ?? false} onChange={e => changeEvent({ articulations: e.target.checked ? [...event.articulations ?? [], v] : event.articulations?.filter(a => a !== v) })} />{v}</label>)}</div><label>Ornament<select aria-label="Ornament" value={event.ornament ?? ''} onChange={e => changeEvent({ ornament: e.target.value || undefined })}><option value="">None</option>{ORNAMENTS.map(v => <option key={v}>{v}</option>)}</select></label><label>Arpeggio<select aria-label="Arpeggio" value={event.arpeggio ?? ''} onChange={e => changeEvent({ arpeggio: e.target.value ? e.target.value as 'up' | 'down' : undefined })}><option value="">None</option><option value="up">Up</option><option value="down">Down</option></select></label><label>Tremolo strokes<select aria-label="Tremolo strokes" value={event.tremolo ?? 0} onChange={e => changeEvent({ tremolo: Number(e.target.value) || undefined })}>{[0, 1, 2, 3, 4].map(v => <option key={v}>{v}</option>)}</select></label></fieldset>
          <fieldset><legend>Grace notes before this event</legend><label>Grace pitch<select aria-label="Grace pitch" value={graceStep} onChange={e => setGraceStep(e.target.value as Step)}>{['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(v => <option key={v} value={v}>{v === 'B' ? 'H' : v}</option>)}</select></label><label className="check"><input type="checkbox" checked={graceSlash} onChange={e => setGraceSlash(e.target.checked)} />Slashed grace</label><button onClick={() => changeEvent({ grace: [...event.grace ?? [], { pitches: [{ step: graceStep, octave: pitch?.octave ?? 4, alter: settings.keySignature.alterations[graceStep] ?? 0, accidental: 'auto' }], duration: 2, slash: graceSlash }] })}>Add grace note</button><button disabled={!event.grace?.length} onClick={() => changeEvent({ grace: undefined })}>Remove grace notes</button><p>{event.grace?.length ?? 0} grace notes. New notes use the selected pitch's octave.</p>
            {event.grace?.map((grace, gi) => <div className="grace-editor" key={gi}>
              <label>Grace {gi + 1} duration<select aria-label={`Grace ${gi + 1} duration`} value={grace.duration} onChange={e => changeGrace(gi, { duration: Number(e.target.value) as Duration })}>{ALL_DURATIONS.filter(d => d <= 4).map(d => <option value={d} key={d}>{DURATION_LABELS[d]}</option>)}</select></label>
              <label className="check"><input type="checkbox" checked={grace.slash} onChange={e => changeGrace(gi, { slash: e.target.checked })} />Slash grace {gi + 1}</label>
              {grace.pitches.map((gp, pi) => { const edit = (patch: Partial<Pitch>) => changeGrace(gi, { pitches: grace.pitches.map((p, i) => i === pi ? { ...p, ...patch } : p) }); return <div className="field-row" key={pi}>
                <label>Pitch<select aria-label={`Grace ${gi + 1} pitch ${pi + 1}`} value={gp.step} onChange={e => edit({ step: e.target.value as Step })}>{['C', 'D', 'E', 'F', 'G', 'A', 'B'].map(v => <option value={v} key={v}>{v === 'B' ? 'H' : v}</option>)}</select></label>
                <label>Octave<input aria-label={`Grace ${gi + 1} octave ${pi + 1}`} type="number" min="0" max="8" value={gp.octave} onChange={e => edit({ octave: Number(e.target.value) })} /></label>
                <label>Accidental<select aria-label={`Grace ${gi + 1} accidental ${pi + 1}`} value={gp.accidental === 'auto' ? 'auto' : gp.alter} onChange={e => edit(e.target.value === 'auto' ? { accidental: 'auto' } : { accidental: 'explicit', alter: Number(e.target.value) as Alteration })}><option value="auto">Signature</option>{[-2,-1,0,1,2].map((a,i) => <option value={a} key={a}>{a === 0 ? '♮' : accidentalNames[i]}</option>)}</select></label>
              </div>; })}<button onClick={() => changeEvent({ grace: event.grace?.filter((_, i) => i !== gi) })}>Remove grace {gi + 1}</button>
            </div>)}</fieldset>
        </>}
      </>}
    </div>}
    {tab === 'marks' && <div className="notation-fields">
      <fieldset><legend>{editingId ? 'Edit marking' : 'Add marking'}</legend><label>Marking<select aria-label="Marking type" value={kind} onChange={e => { const next = e.target.value as MarkKind; setKind(next); setValue(values[next]?.[0] ?? (next === 'ending' ? '1.' : '')); setEditingId(null); }}>{Object.entries(markNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {values[kind] ? <label>Value<select aria-label="Marking value" value={value} onChange={e => setValue(e.target.value)}>{values[kind]!.map(v => <option key={v}>{v}</option>)}</select></label> : !['tie', 'slur'].includes(kind) && <label>Text<input aria-label="Marking text" maxLength={120} value={value} onChange={e => setValue(e.target.value)} placeholder={kind === 'tempo' ? 'Allegro · quarter = 120' : 'Expression or label'} /></label>}
        <label>Placement<select aria-label="Marking placement" value={placement} onChange={e => setPlacement(e.target.value as 'above' | 'below')}><option>above</option><option>below</option></select></label>
        <p>{spans.includes(kind) ? 'Select the first event, set start, then select the last event and set end. Repeat endings can use measure positions.' : 'Select the note or measure where the marking belongs.'}</p>
        <div className="field-row"><button onClick={() => setStart(anchor())}>Set start</button><span>{anchorLabel(start)}</span></div>
        {spans.includes(kind) && <div className="field-row"><button onClick={() => setEnd(anchor())}>Set end</button><span>{anchorLabel(end)}</span></div>}
        <button onClick={saveMark}>{editingId ? 'Update marking' : 'Add marking'}</button><button onClick={() => { setEditingId(null); setStart(null); setEnd(null); }}>Clear marking selection</button>
      </fieldset>
      <div className="marks-list" aria-label="Score markings"><h3>Score markings</h3>{!score.marks?.length && <p>No markings yet.</p>}{score.marks?.map(mark => <div className="mark-row" key={mark.id}><button onClick={() => editMark(mark)}>{markNames[mark.kind]} {mark.value} · {anchorLabel(mark.start)}</button><button aria-label={`Remove ${markNames[mark.kind]} ${mark.value}`} onClick={() => apply(() => deleteScoreMark(score, mark.id))}>Remove</button></div>)}</div>
    </div>}
  </details>;
}
