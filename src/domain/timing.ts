import type { Score, ScoreEvent } from './types';
import { effectiveSettings } from './settings';

export interface Fraction { numerator: number; denominator: number }
function reduced(numerator: bigint, denominator: bigint): Fraction {
  if (denominator <= 0n) throw new Error('Timing denominator must be positive.');
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b) [a, b] = [b, a % b];
  const n = numerator / (a || 1n), d = denominator / (a || 1n);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER) || d > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Timing is too complex to represent safely.');
  return { numerator: Number(n), denominator: Number(d) };
}
export function numberFraction(value: number): Fraction {
  if (!Number.isFinite(value)) throw new Error('Timing must be finite.');
  // Supported durations, time signatures and pickup lengths use eighth-tick units.
  if (!Number.isSafeInteger(value * 8)) throw new Error('Timing must use multiples of one 128th note.');
  return reduced(BigInt(value * 8), 8n);
}
export function addFractions(a: Fraction, b: Fraction): Fraction {
  return reduced(BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator), BigInt(a.denominator) * BigInt(b.denominator));
}
export function sumFractions(values: Fraction[]): Fraction { return values.reduce(addFractions, { numerator: 0, denominator: 1 }); }
export function compareFractions(a: Fraction, b: Fraction): number {
  const difference = BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
export function fractionNumber(value: Fraction): number { return value.numerator / value.denominator; }
export function eventFraction(event: ScoreEvent): Fraction {
  if (event.measureRest !== undefined) return numberFraction(event.measureRest);
  const base = numberFraction(event.duration);
  const dots = event.dots ?? 0;
  const numerator = BigInt(base.numerator) * BigInt(dots === 2 ? 7 : dots === 1 ? 3 : 1) * BigInt(event.tuplet?.normal ?? 1);
  const denominator = BigInt(base.denominator) * BigInt(dots === 2 ? 4 : dots === 1 ? 2 : 1) * BigInt(event.tuplet?.actual ?? 1);
  return reduced(numerator, denominator);
}
export function usedTicks(events: ScoreEvent[]): number { return fractionNumber(sumFractions(events.map(eventFraction))); }
export function measureCapacity(score: Score, index: number): number {
  const measure = score.measures[index];
  if (!measure) throw new Error('Choose an existing measure.');
  const time = effectiveSettings(score, index).timeSignature;
  return measure.pickup ?? time.beats * 16 / time.beatType;
}
