import { useEffect, useState } from 'react';
import { Button } from '../ui';
import { cn } from '../../lib/cn';

interface CopyFieldProps {
  value: string;
  label?: string;
  /** Multi-line code block instead of a single-line field. */
  multiline?: boolean;
  /** Mask the value until the viewer reveals it (used for the raw token). */
  secret?: boolean;
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

/**
 * Read-only value with a Copy button. Announces "Copied" via aria-live so
 * screen-reader users get the same confirmation as the visual label change.
 */
export function CopyField({ value, label, multiline = false, secret = false, className, 'data-testid': testId }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function handleCopy() {
    const ok = await copyToClipboard(value);
    setCopied(ok);
  }

  const shown = revealed ? value : '•'.repeat(Math.min(value.length, 40));

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid={testId}>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      <div className={cn('flex gap-2', multiline ? 'items-start' : 'items-center')}>
        {multiline ? (
          <pre
            className="flex-1 min-w-0 overflow-x-auto rounded-xl border border-border bg-muted px-3 py-2 text-xs font-mono text-foreground whitespace-pre"
            tabIndex={0}
            aria-label={label ? `${label} value` : 'Value'}
          >
            {shown}
          </pre>
        ) : (
          <input
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
          <Button type="button" variant="secondary" size="sm" onClick={handleCopy} aria-label={label ? `Copy ${label}` : 'Copy'}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
    </div>
  );
}
