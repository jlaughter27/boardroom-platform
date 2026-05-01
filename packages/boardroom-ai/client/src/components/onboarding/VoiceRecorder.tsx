// Browser voice recorder that captures audio via MediaRecorder, shows a
// live duration/volume meter, and hands the blob back to the parent when
// the user hits Stop. The parent (BootstrapStep) is responsible for
// uploading to POST /onboarding-bootstrap/voice.
//
// Deliberately lightweight — no wavesurfer/wavejs dep, no streaming.
// One record → one blob → one upload.

import { useEffect, useRef, useState } from 'react';

export interface VoiceRecorderProps {
  /** Max recording duration in seconds. Auto-stops at this limit. */
  maxDurationSec?: number;
  /** Called with the recorded audio blob + MIME type when recording stops. */
  onRecorded: (blob: Blob, mimeType: string) => void;
  /** Called when a recording is cleared without being submitted. */
  onReset?: () => void;
  /** Disable the record button (e.g. while uploading). */
  disabled?: boolean;
}

type Phase = 'idle' | 'requesting' | 'recording' | 'recorded' | 'error';

// Pick the best supported mime type in this browser. Chrome prefers webm/opus,
// Safari prefers mp4. We let the browser pick if none of these are supported.
function bestMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceRecorder({
  maxDurationSec = 300,
  onRecorded,
  onReset,
  disabled = false,
}: VoiceRecorderProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickTimerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopEverything();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopEverything() {
    if (tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function startRecording() {
    setErrorMsg(null);
    setPhase('requesting');
    setDuration(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Volume meter (for UI feedback). Not required for the upload.
      const AudioCtor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = bestMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const effectiveMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: effectiveMime });
        chunksRef.current = [];
        stopEverything();
        setPhase('recorded');
        onRecorded(blob, effectiveMime);
      };
      recorder.onerror = (ev) => {
        const msg = (ev as unknown as { error?: { message?: string } }).error?.message ?? 'Recording failed';
        setErrorMsg(msg);
        setPhase('error');
        stopEverything();
      };

      recorder.start(100); // Request chunks every 100ms for smooth data flow
      setPhase('recording');

      // Duration tick
      const startedAt = Date.now();
      tickTimerRef.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        setDuration(sec);
        if (sec >= maxDurationSec) {
          try {
            recorder.stop();
          } catch {
            /* noop */
          }
        }
      }, 250);

      // Volume meter animation
      const meterBuffer = new Uint8Array(analyser.frequencyBinCount);
      const pollVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(meterBuffer);
        const avg = meterBuffer.reduce((a, b) => a + b, 0) / meterBuffer.length;
        setVolumeLevel(Math.min(1, avg / 128));
        rafRef.current = requestAnimationFrame(pollVolume);
      };
      pollVolume();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Microphone access denied';
      setErrorMsg(message);
      setPhase('error');
      stopEverything();
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try {
        recorderRef.current.stop();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to stop recording');
        setPhase('error');
        stopEverything();
      }
    }
  }

  function resetRecording() {
    setPhase('idle');
    setDuration(0);
    setVolumeLevel(0);
    setErrorMsg(null);
    chunksRef.current = [];
    onReset?.();
  }

  // --- UI ---
  const volumePct = Math.round(volumeLevel * 100);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Record your briefing</p>
          <p className="text-xs text-muted-foreground">
            Max {Math.floor(maxDurationSec / 60)} min · we'll transcribe and extract automatically
          </p>
        </div>

        {phase === 'recording' && (
          <span className="flex items-center gap-2 text-sm font-mono">
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" aria-hidden />
            {formatDuration(duration)}
          </span>
        )}

        {phase === 'recorded' && (
          <span className="text-sm font-mono text-muted-foreground">
            {formatDuration(duration)} captured
          </span>
        )}
      </div>

      {/* Volume meter bar */}
      {phase === 'recording' && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden" aria-hidden>
          <div
            className="h-full bg-primary transition-[width] duration-75"
            style={{ width: `${volumePct}%` }}
          />
        </div>
      )}

      {errorMsg && (
        <p className="text-xs text-destructive">
          {errorMsg}
          {errorMsg.toLowerCase().includes('denied') || errorMsg.toLowerCase().includes('permission')
            ? ' · Allow microphone access in your browser, then try again.'
            : null}
        </p>
      )}

      <div className="flex gap-2">
        {phase === 'idle' && (
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Start recording
          </button>
        )}

        {phase === 'requesting' && (
          <button
            type="button"
            disabled
            className="flex-1 rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground"
          >
            Requesting microphone…
          </button>
        )}

        {phase === 'recording' && (
          <button
            type="button"
            onClick={stopRecording}
            className="flex-1 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:opacity-90"
          >
            Stop &amp; upload
          </button>
        )}

        {phase === 'recorded' && (
          <button
            type="button"
            onClick={resetRecording}
            disabled={disabled}
            className="flex-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Re-record
          </button>
        )}

        {phase === 'error' && (
          <button
            type="button"
            onClick={resetRecording}
            className="flex-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
