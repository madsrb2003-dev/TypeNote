import type { Score } from './types';
import { MAX_SCORE_FILE_BYTES } from './types';
import { validateScore } from './validation';
export { validateScore } from './validation';

export function serializeScore(score: Score): string {
  // Compact JSON keeps even the largest supported score within the file limit.
  return JSON.stringify(validateScore(score)) + '\n';
}

export function parseScore(text: string): Score {
  if (text.length > MAX_SCORE_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SCORE_FILE_BYTES) {
    throw new Error('This score file exceeds the 10 MB limit.');
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. Open a .typenote.json score file.');
  }
  return validateScore(input);
}
