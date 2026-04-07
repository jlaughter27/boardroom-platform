// Ported from boardroom-ai/server/src/deepgram.ts (April 2026)
// Deepgram WebSocket proxy for real-time transcription
// BOOKMARKED: This is Phase 3+ functionality. Preserved as working code.

import WebSocket from 'ws';

export interface TranscriptEntry {
  speaker: number;
  text: string;
  timestamp: string;
  isFinal: boolean;
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
}

interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramResult {
  type: string;
  channel: DeepgramChannel;
  is_final: boolean;
  speech_final: boolean;
  from_finalize?: boolean;
}

export const createDeepgramProxy = (
  apiKey: string,
  onTranscript: (entry: TranscriptEntry) => void,
  onError: (error: string) => void,
  onClose: () => void
): {
  send: (audio: Buffer | ArrayBuffer) => void;
  close: () => void;
} => {
  const dgUrl = new URL('wss://api.deepgram.com/v1/listen');
  dgUrl.searchParams.set('model', 'nova-2');
  dgUrl.searchParams.set('smart_format', 'true');
  dgUrl.searchParams.set('diarize', 'true');
  dgUrl.searchParams.set('interim_results', 'true');
  dgUrl.searchParams.set('encoding', 'opus');
  dgUrl.searchParams.set('sample_rate', '48000');
  dgUrl.searchParams.set('channels', '1');

  const dgWs = new WebSocket(dgUrl.toString(), {
    headers: { Authorization: `Token ${apiKey}` },
  });

  dgWs.on('open', () => {
    console.log('[Deepgram] Connected');
  });

  dgWs.on('message', (data: WebSocket.Data) => {
    try {
      const response = JSON.parse(data.toString()) as DeepgramResult;
      if (response.type !== 'Results') return;

      const alt = response.channel?.alternatives?.[0];
      if (!alt || !alt.transcript) return;

      const speaker = alt.words?.[0]?.speaker ?? 0;

      onTranscript({
        speaker,
        text: alt.transcript,
        timestamp: new Date().toISOString(),
        isFinal: response.is_final,
      });
    } catch {
      // Ignore non-JSON messages (metadata, etc.)
    }
  });

  dgWs.on('error', (err) => {
    console.error('[Deepgram] Error:', err.message);
    onError(err.message);
  });

  dgWs.on('close', (code, reason) => {
    console.log(`[Deepgram] Closed: ${code} ${reason.toString()}`);
    onClose();
  });

  return {
    send: (audio: Buffer | ArrayBuffer) => {
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(audio);
      }
    },
    close: () => {
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(JSON.stringify({ type: 'CloseStream' }));
        dgWs.close();
      }
    },
  };
};
