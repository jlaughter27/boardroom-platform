import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { cn } from '../../lib/cn';

interface CopyFieldProps {
  value: string;
  label?: string;
  /** Multi-line code block instead of a single-line field. */
  multiline?: boolean;
  /** Mask the value until the viewer reveals it (used for the raw token). */
  secret?: boolean;
  /** Disable the Copy button (e.g. the value contains a placeholder that must not be pasted anywhere). */
  copyDisabled?: boolean;
  /** Why Copy is disabled — rendered as the button title and under the field. */
  copyDisabledReason?: string;
  className?: string;
  'data-testid'?: string;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Read-only value with a Copy button. Announces "Copied" (or the failure) via
 * aria-live so screen-reader users get the same confirmation as the visual
 * label change. On failure the value is selected so it can be copied by hand.
 */
export function CopyField({
  value, label, multiline = false, secret = false, copyDisabled = false, copyDisabledReason, className, 'data-testid': testId,
}: CopyFieldProps) {
  const [state, setState] = useState<CopyState>('idle');
  const [revealed, setRevealed] = useState(!secret);
  const inputRef = useRef<HTMLInputElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // Size-driven, not scroll-driven: re-measure when the block or its text changes width.
  useEffect(() => {
    const pre = preRef.current;
    if (!multiline || !pre) return;
    const measure = () => setOverflowing(pre.scrollWidth > pre.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(pre);
    return () => ro.disconnect();
  }, [multiline, value, revealed]);

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), state === 'copied' ? 2000 : 6000);
    return () => clearTimeout(t);
  }, [state]);

  function selectValue() {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      return;
    }
    const pre = preRef.current;
    if (pre && typeof window !== 'undefined' && window.getSelection) {
      pre.focus();
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  async function handleCopy() {
    if (copyDisabled) return;
    const ok = await copyToClipboard(value);
    setState(ok ? 'copied' : 'failed');
    if (!ok) { if (!revealed) setRevealed(true); selectValue(); }
  }

  const shown = revealed ? value : '•'.repeat(Math.min(value.length, 40));
  const liveText = state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed — the value is selected, press Ctrl+C or ⌘C to copy it' : '';

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid={testId}>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <div className={cn('flex gap-2', multiline ? 'items-start' : 'items-center')}>
        {multiline ? (
          // A long line (an MCP URL, a bearer header) scrolls inside the block —
          // never the page. While it overflows, a fade on the trailing edge says
          // "there is more"; the extra end padding lets the last character clear
          // the fade once scrolled to the end (M1-D3).
          <div className="relative flex-1 min-w-0" data-overflowing={overflowing || undefined}>
            <pre
              ref={preRef}
              className={cn(
                'w-full overflow-x-auto rounded-xl border border-border bg-muted py-2 pl-3 text-xs font-mono text-foreground whitespace-pre',
                overflowing ? 'pr-8' : 'pr-3'
              )}
              tabIndex={0}
              aria-label={label ? `${label} value` : 'Value'}
            >
              {shown}
            </pre>
            {overflowing && (
              <span
                aria-hidden="true"
                data-testid={testId ? `${testId}-fade` : undefined}
                className="pointer-events-none absolute inset-y-px right-px w-8 rounded-r-xl bg-gradient-to-l from-muted to-transparent"
              />
            )}
          </div>
        ) : (
          <input
            ref={inputRef}
            readOnly
            value={shown}
            aria-label={label ? `${label} value` : 'Value'}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 rounded-xl border border-border bg-muted px-3 h-9 text-xs font-mono text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        )}
        <div className="flex shrink-0 gap-1">
          {secret && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed((r) => !r)} aria-pressed={revealed}>
              {revealed ? 'Hide' : 'Show'}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            disabled={copyDisabled}
            title={copyDisabled ? copyDisabledReason : undefined}
            aria-label={label ? `Copy ${label}` : 'Copy'}
          >
            {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
          </Button>
        </div>
      </div>
      {copyDisabled && copyDisabledReason && (
        <span className="text-xs text-warning" data-testid={testId ? `${testId}-copy-disabled` : undefined}>{copyDisabledReason}</span>
      )}
      {state === 'failed' && (
        <span className="text-xs text-danger">Could not reach the clipboard. The value is selected — press Ctrl+C (⌘C on Mac) to copy it.</span>
      )}
      <span className="sr-only" role="status" aria-live="polite">{liveText}</span>
    </div>
  );
}
