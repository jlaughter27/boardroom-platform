import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface PickerOption {
  id: string;
  label: string;
  hint?: string | null;
}

interface Props {
  options: PickerOption[];
  placeholder: string;
  onPick(option: PickerOption): void;
  /** Ids to hide (already linked, or self). */
  exclude?: Set<string>;
  autoFocus?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** Small searchable select over an entities.store list — type to filter, arrow keys + Enter to pick. */
export function EntityPicker({ options, placeholder, onPick, exclude, autoFocus, className, 'aria-label': ariaLabel }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pool = options.filter((o) => !exclude?.has(o.id));
    const list = s ? pool.filter((o) => o.label.toLowerCase().includes(s)) : pool;
    return list
      .sort((a, b) => {
        const ia = s ? a.label.toLowerCase().indexOf(s) : 0;
        const ib = s ? b.label.toLowerCase().indexOf(s) : 0;
        return ia - ib || a.label.localeCompare(b.label);
      })
      .slice(0, 8);
  }, [q, options, exclude]);

  useEffect(() => { setActive(0); }, [results.length]);

  const pick = (o: PickerOption) => { onPick(o); setQ(''); setOpen(false); };

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && open && results[active]) { e.preventDefault(); pick(results[active]); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open && results.length > 0}
        role="combobox"
        aria-autocomplete="list"
        className="h-8 w-full rounded-md border border-border bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {open && results.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {results.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5 text-sm', i === active && 'bg-muted')}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{o.label}</span>
              {o.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
      {open && q.trim() && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-lg">No matches</div>
      )}
    </div>
  );
}
