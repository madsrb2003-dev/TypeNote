import { useEffect, useRef, useState } from 'react';
import { Renderer } from 'vexflow/bravura';
import { drawSystem, systemGeometry, isSelected, minimumMeasureWidth } from '../notation/engraving';
import type { HitTarget } from '../notation/engraving';
import type { Measure, Score, Selection } from '../domain/types';
import './score.css';

interface ScoreViewProps {
  score: Score;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

function PianoSystem({ score, measures, firstIndex, width, selection, onSelect }: {
  score: Score;
  measures: Measure[];
  firstIndex: number;
  width: number;
  selection: Selection;
  onSelect: ScoreViewProps['onSelect'];
}) {
  const drawing = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<HitTarget[]>([]);
  const [drawingError, setDrawingError] = useState(false);
  const { height } = systemGeometry(measures, score, firstIndex);

  useEffect(() => {
    let cancelled = false;
    // The Bravura VexFlow bundle supplies embedded fonts. Wait for their initial load.
    void document.fonts.ready.then(() => {
      if (cancelled || !drawing.current) return;
      drawing.current.replaceChildren();
      try {
        const renderer = new Renderer(drawing.current, Renderer.Backends.SVG);
        renderer.resize(width, height);
        const context = renderer.getContext();
        const nextTargets = drawSystem(context, measures, firstIndex, width, selection, false, score);
        drawing.current.querySelector('svg')?.setAttribute('aria-hidden', 'true');
        setTargets(nextTargets);
        setDrawingError(false);
      } catch (error) {
        console.error('Unable to draw notation', error);
        setTargets([]);
        setDrawingError(true);
      }
    });
    return () => { cancelled = true; };
  }, [score, measures, firstIndex, width, height, selection]);

  return <div className="score-system-scroll">
    {drawingError && <p role="alert" className="score-render-error">The notation could not be drawn. Your score is still available to save.</p>}
    <div className="score-system" style={{ width, height }}>
      <div ref={drawing} className="score-engraving" />
      {targets.map(target => <button
        key={target.key}
        type="button"
        className={`score-hit ${target.selection.pitchIndex !== undefined ? 'score-pitch' : target.key.endsWith('-gap') ? 'score-gap' : 'score-event'}${
          isSelected(selection, target.selection) && !target.placeholder ? ' is-selected' : ''}`}
        style={{ left: target.left, top: target.top, width: target.width, height: target.height }}
        aria-label={target.label}
        aria-pressed={isSelected(selection, target.selection) && !target.placeholder}
        title={target.description}
        onClick={() => onSelect(target.selection)}
      >{target.key.endsWith('-gap') && <span aria-hidden="true">+</span>}</button>)}
    </div>
  </div>;
}

export function ScoreView({ score, selection, onSelect }: ScoreViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(800);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setAvailableWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const minimumBarWidth = Math.max(290, ...score.measures.map((measure, index) => minimumMeasureWidth(measure, true, index === 0, score, index)));
  const barsPerSystem = availableWidth >= Math.max(740, minimumBarWidth * 2 + 45) ? 2 : 1;
  const width = Math.max(availableWidth, minimumBarWidth * barsPerSystem + 45);
  const systems = [];
  for (let index = 0; index < score.measures.length;) {
    const next = score.measures[index + 1];
    const count = barsPerSystem === 2 && next && !next.systemBreak && !next.pageBreak ? 2 : 1;
    systems.push(<PianoSystem key={index} score={score} measures={score.measures.slice(index, index + count)}
      firstIndex={index} width={width} selection={selection} onSelect={onSelect} />);
    index += count;
  }
  return <div ref={container} className="score-view" aria-label="Piano score">{systems}</div>;
}
