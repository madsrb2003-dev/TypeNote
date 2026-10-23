import { openMusicXml } from './musicxml';
import type { MusicXmlDocument } from './types';

const base = '/api/pdf-recognition';
const headers = { 'X-TypeNote-Request': 'pdf-import' };
export const MAX_PDF_IMPORT_BYTES = 100 * 1024 * 1024;
export type RecognitionMode = 'standard' | 'piano-scan';
export interface RecognitionOutput { id: string; name: string; noteCount?: number }
export interface RecognitionJob {
  id: string;
  status: 'validating' | 'recognizing' | 'completed' | 'failed' | 'cancelled';
  message: string;
  pages?: number;
  diagnostics: string[];
  outputs: RecognitionOutput[];
}
export interface RecognitionSource { jobId: string; filename: string; diagnostics: string[]; partial: boolean }
export function recognitionUrl(jobId: string, file: 'original' | 'log'): string {
  return `${base}/jobs/${encodeURIComponent(jobId)}/${file}`;
}
export function recognitionOutputUrl(jobId: string, outputId: string): string {
  return `${base}/jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(outputId)}`;
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`${base}${path}`, { ...options, headers: { ...headers, ...options.headers } }); }
  catch { throw new Error('The local recognition service could not be reached. Keep TypeNote running and try again.'); }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(detail?.error ?? detail?.message ?? 'Local PDF recognition is unavailable. Run TypeNote locally with npm run dev or npm run preview.');
  }
  try { return await response.json() as T; }
  catch { throw new Error('Local PDF recognition is unavailable. Run TypeNote locally with npm run dev or npm run preview.'); }
}
export const recognitionAvailability = () => request<{ available: boolean; message: string }>('/status');
export function startRecognition(file: File, pages: string, signal?: AbortSignal, mode: RecognitionMode = 'standard') {
  const parameters = new URLSearchParams();
  if (pages.trim()) parameters.set('pages', pages.trim());
  if (mode !== 'standard') parameters.set('mode', mode);
  return request<{ id: string }>(`/jobs${parameters.size ? `?${parameters}` : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-TypeNote-Filename': encodeURIComponent(file.name) }, body: file, signal,
  });
}
export const getRecognition = (id: string, signal?: AbortSignal) => request<RecognitionJob>(`/jobs/${encodeURIComponent(id)}`, { signal });
export const cancelRecognition = (id: string) => request<unknown>(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', keepalive: true });
export async function recognizedDocument(jobId: string, output: RecognitionOutput): Promise<MusicXmlDocument> {
  const response = await fetch(recognitionOutputUrl(jobId, output.id), { headers });
  if (!response.ok) throw new Error('The recognized MusicXML could not be read. The original PDF and recognition files are retained locally.');
  return openMusicXml(await response.text(), output.name);
}
