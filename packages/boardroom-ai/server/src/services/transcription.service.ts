// Transcription service for the onboarding bootstrap voice flow.
// Primary: Deepgram Nova-3 (fast + accurate).
// Fallback: OpenAI Whisper (uses existing OPENAI_API_KEY).
//
// The service picks the provider at call time based on env vars, so
// adding DEEPGRAM_API_KEY later automatically upgrades the pipeline
// without code changes.

import { logger } from '../lib/logger';

export interface TranscriptionResult {
  text: string;
  provider: 'deepgram' | 'whisper';
  durationMs: number;
}

export interface TranscriptionError extends Error {
  provider?: 'deepgram' | 'whisper';
  status?: number;
}

/**
 * Transcribe an audio buffer using the best available provider.
 * Throws if no provider is configured or the upstream call fails.
 */
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
): Promise<TranscriptionResult> {
  const start = Date.now();

  // Prefer Deepgram if configured.
  if (process.env.DEEPGRAM_API_KEY) {
    try {
      const text = await transcribeWithDeepgram(audio, mimeType);
      return { text, provider: 'deepgram', durationMs: Date.now() - start };
    } catch (err) {
      logger.warn('Deepgram transcription failed, falling back to Whisper', {
        error: (err as Error).message,
      });
      // Fall through to Whisper.
    }
  }

  if (process.env.OPENAI_API_KEY) {
    const text = await transcribeWithWhisper(audio, mimeType);
    return { text, provider: 'whisper', durationMs: Date.now() - start };
  }

  const err = new Error(
    'No transcription provider configured. Set DEEPGRAM_API_KEY or OPENAI_API_KEY.',
  ) as TranscriptionError;
  throw err;
}

// ---------------------------------------------------------------------------
// Deepgram — POST raw audio body to /v1/listen with nova-3 model.
// Docs: https://developers.deepgram.com/reference/pre-recorded
// ---------------------------------------------------------------------------
async function transcribeWithDeepgram(audio: Buffer, mimeType: string): Promise<string> {
  const params = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    punctuate: 'true',
    paragraphs: 'true',
    language: 'en',
  });

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': mimeType || 'audio/webm',
    },
    body: new Uint8Array(audio),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Deepgram ${res.status}: ${body}`) as TranscriptionError;
    err.provider = 'deepgram';
    err.status = res.status;
    throw err;
  }

  const json = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  if (!transcript.trim()) {
    throw new Error('Deepgram returned empty transcript');
  }
  return transcript;
}

// ---------------------------------------------------------------------------
// OpenAI Whisper — multipart upload to /v1/audio/transcriptions.
// Docs: https://platform.openai.com/docs/api-reference/audio/createTranscription
// ---------------------------------------------------------------------------
async function transcribeWithWhisper(audio: Buffer, mimeType: string): Promise<string> {
  const form = new FormData();
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'ogg';
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: mimeType || 'audio/webm' }),
    `audio.${ext}`,
  );
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Whisper ${res.status}: ${body}`) as TranscriptionError;
    err.provider = 'whisper';
    err.status = res.status;
    throw err;
  }

  const json = (await res.json()) as { text?: string };
  if (!json.text?.trim()) {
    throw new Error('Whisper returned empty transcript');
  }
  return json.text;
}
