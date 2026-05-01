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

// Small step-number badge used to mark the two major sections.
function StepBadge({ n }: { n: number }): JSX.Element {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
      aria-hidden
    >
      {n}
    </span>
  );
}

// Inline SVG icons — avoid pulling a dependency for 4 glyphs.
function IconClipboard({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="3" width="6" height="3" rx="1" />
      <path d="M15 4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
function IconUpload({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}
function IconPen({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}
function IconMic({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePasteSubmit = async () => {
    const text = pastedText.trim();
    if (text.length < 20) return;
    const file = new File([text], 'pasted-briefing.md', { type: 'text/markdown' });
    await onUploadDoc(file);
  };

  const pasteLength = pastedText.trim().length;
  const pasteDisabled = isProcessing || pasteLength < 20;

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Optional · 2 min
        </div>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
          {BOOTSTRAP_STEP_COPY.title}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {BOOTSTRAP_STEP_COPY.subtitle}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Section 1 — copy the prompt */}
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <header className="flex items-start gap-3">
          <StepBadge n={1} />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">
              {BOOTSTRAP_STEP_COPY.promptSectionTitle}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {BOOTSTRAP_STEP_COPY.promptSectionHelp}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyPrompt}
            className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              copied
                ? 'bg-success/15 text-success'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
            aria-live="polite"
          >
            {copied ? <IconCheck className="h-4 w-4" /> : <IconClipboard className="h-4 w-4" />}
            {copied ? BOOTSTRAP_STEP_COPY.copiedButton : BOOTSTRAP_STEP_COPY.copyButton}
          </button>
        </header>

        <details className="group rounded-lg bg-muted/40 px-4 py-3 text-xs">
          <summary className="cursor-pointer select-none list-none font-medium text-foreground flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Preview the prompt · {MEGA_PROMPT.length.toLocaleString()} characters
          </summary>
          <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/50 bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {MEGA_PROMPT}
          </pre>
        </details>
      </section>

      {/* Section 2 — deliver the response */}
      <section className="flex flex-col gap-4">
        <header className="flex items-start gap-3">
          <StepBadge n={2} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {BOOTSTRAP_STEP_COPY.uploadSectionTitle}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {BOOTSTRAP_STEP_COPY.uploadSectionHelp}
            </p>
          </div>
        </header>

        {/* File upload */}
        <label
          htmlFor="bootstrap-file-input"
          className={`group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card px-6 py-10 text-center transition-all hover:border-primary/60 hover:bg-primary/5 ${
            isProcessing ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:-translate-y-0.5">
            <IconUpload className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Upload briefing</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Drop a .md, .txt, or .pdf file here — or click to choose
            </p>
          </div>
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

        <OrDivider />

        {/* Paste */}
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconPen className="h-4 w-4" />
            </div>
            <label htmlFor="bootstrap-paste">Paste the response text</label>
          </div>
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
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isProcessing ? 'Processing…' : BOOTSTRAP_STEP_COPY.pasteSubmit}
            </button>
          </div>
        </div>

        <OrDivider />

        {/* Voice */}
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconMic className="h-4 w-4" />
            </div>
            <span>{BOOTSTRAP_STEP_COPY.voiceLabel}</span>
          </div>
          <VoiceRecorder
            onRecorded={(blob, mimeType) => onUploadVoice(blob, mimeType)}
            disabled={isProcessing}
          />
        </div>
      </section>

      {/* Skip */}
      <div className="flex flex-col items-center gap-2 pt-2">
        <Button variant="ghost" onClick={onSkip} disabled={isProcessing}>
          {BOOTSTRAP_STEP_COPY.skipButton}
        </Button>
        <p className="text-xs text-muted-foreground">
          5 quick questions · takes about 3 minutes
        </p>
      </div>
    </div>
  );
}

function OrDivider(): JSX.Element {
  return (
    <div className="flex items-center gap-4" aria-hidden>
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Or
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
