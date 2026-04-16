// Step 0 of the onboarding wizard — an optional bootstrap path.
//
// Flow:
//   1. Copy the MEGA_PROMPT to clipboard
//   2. Paste it into ChatGPT/Claude/etc.
//   3. Come back and either upload the file, paste the text response, or
//      record themselves reading it.
//   4. We ship it to /onboarding-bootstrap/doc or /voice, which returns a
//      BootstrapExtraction that populates the whole wizard in one shot.
//
// Users who want to fill out the 5-step wizard manually can skip.

import { useRef, useState } from 'react';
import { BOOTSTRAP_STEP_COPY, MEGA_PROMPT } from '../bootstrap-content';
import { VoiceRecorder } from '../VoiceRecorder';
import { Button } from '../../ui';

export interface BootstrapStepProps {
  /** Called when the user uploads a doc or pastes text. */
  onUploadDoc: (file: File) => Promise<void>;
  /** Called when the user records a voice briefing. */
  onUploadVoice: (blob: Blob, mimeType: string) => Promise<void>;
  /** Skip to the manual 5-step wizard. */
  onSkip: () => void;
  /** True while an upload is in flight. */
  isProcessing?: boolean;
  /** Error surfaced from the most recent upload attempt. */
  error?: string | null;
}

export function BootstrapStep({
  onUploadDoc,
  onUploadVoice,
  onSkip,
  isProcessing = false,
  error = null,
}: BootstrapStepProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(MEGA_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: select the text (user copies manually). Rare in 2026 but cheap.
      const el = document.createElement('textarea');
      el.value = MEGA_PROMPT;
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } finally {
        document.body.removeChild(el);
      }
    }
  };

  const handleFileChosen = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    await onUploadDoc(file);
    // Reset so the same file can be re-selected if the server rejects it.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePasteSubmit = async () => {
    const text = pastedText.trim();
    if (text.length < 20) return;
    // Synthesize a File so we can reuse the existing upload path.
    const file = new File([text], 'pasted-briefing.md', { type: 'text/markdown' });
    await onUploadDoc(file);
  };

  const pasteLength = pastedText.trim().length;
  const pasteDisabled = isProcessing || pasteLength < 20;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">{BOOTSTRAP_STEP_COPY.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{BOOTSTRAP_STEP_COPY.subtitle}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Step 1: copy the prompt */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {BOOTSTRAP_STEP_COPY.promptSectionTitle}
            </h3>
            <p className="text-xs text-muted-foreground">
              {BOOTSTRAP_STEP_COPY.promptSectionHelp}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {copied ? BOOTSTRAP_STEP_COPY.copiedButton : BOOTSTRAP_STEP_COPY.copyButton}
          </button>
        </div>
        <details className="rounded-lg bg-muted/50 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-foreground">
            Preview the prompt ({MEGA_PROMPT.length.toLocaleString()} characters)
          </summary>
          <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
            {MEGA_PROMPT}
          </pre>
        </details>
      </section>

      {/* Step 2: upload the response */}
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {BOOTSTRAP_STEP_COPY.uploadSectionTitle}
          </h3>
          <p className="text-xs text-muted-foreground">{BOOTSTRAP_STEP_COPY.uploadSectionHelp}</p>
        </div>

        {/* File upload */}
        <label
          htmlFor="bootstrap-file-input"
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-6 py-8 text-center transition-colors hover:border-primary/60 hover:bg-muted/30 ${
            isProcessing ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="h-8 w-8 text-muted-foreground"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-sm font-medium text-foreground">{BOOTSTRAP_STEP_COPY.fileDropLabel}</p>
          <input
            id="bootstrap-file-input"
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.pdf"
            className="hidden"
            onChange={handleFileChosen}
            disabled={isProcessing}
          />
        </label>

        {/* OR divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground">{BOOTSTRAP_STEP_COPY.orDivider}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Paste textarea */}
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card p-5">
          <label htmlFor="bootstrap-paste" className="text-sm font-medium text-foreground">
            {BOOTSTRAP_STEP_COPY.pasteLabel}
          </label>
          <textarea
            id="bootstrap-paste"
            rows={8}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={BOOTSTRAP_STEP_COPY.pastePlaceholder}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isProcessing}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {pasteLength.toLocaleString()} characters
              {pasteLength > 0 && pasteLength < 20 ? ' · need at least 20' : null}
            </span>
            <button
              type="button"
              onClick={handlePasteSubmit}
              disabled={pasteDisabled}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isProcessing ? 'Processing…' : BOOTSTRAP_STEP_COPY.pasteSubmit}
            </button>
          </div>
        </div>

        {/* OR divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground">{BOOTSTRAP_STEP_COPY.orDivider}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Voice */}
        <div>
          <p className="mb-2 text-xs text-muted-foreground">{BOOTSTRAP_STEP_COPY.voiceLabel}</p>
          <VoiceRecorder
            onRecorded={(blob, mimeType) => onUploadVoice(blob, mimeType)}
            disabled={isProcessing}
          />
        </div>
      </section>

      {/* Skip button */}
      <div className="flex justify-center pt-2">
        <Button variant="ghost" onClick={onSkip} disabled={isProcessing}>
          {BOOTSTRAP_STEP_COPY.skipButton}
        </Button>
      </div>
    </div>
  );
}
