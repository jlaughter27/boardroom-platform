import { useEffect, useState } from 'react';
import type { MemoryBudgetReport } from '@boardroom/shared';
import { getMemoryBudget } from '../../lib/api';
import { Badge, Card, Progress, Skeleton } from '../ui';

/**
 * RD-4 — read-only view of the per-domain memory budgets. The limits are
 * soft: going past one never blocks a write (OmniMind answers with a
 * `budget` warning instead of a 422), so this panel is where the user sees
 * which domain is crowded and could use a clean-up.
 */
export function MemoryBudgetPanel() {
  const [report, setReport] = useState<MemoryBudgetReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await getMemoryBudget();
        if (alive) setReport(r);
      } catch {
        if (alive) setFailed(true);
      }
    }
    void load();
    return () => { alive = false; };
  }, []);

  // Domains with nothing in them and no pressure add noise; keep them out.
  const domains = report?.domains.filter((d) => d.count > 0) ?? [];

  return (
    <Card className="p-6">
      <h2 className="text-lg font-medium text-foreground mb-1">Memory budget</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Live memories per domain against its soft limit. Going over never blocks a save; it flags the domain for a clean-up.
      </p>

      {failed && <p className="text-sm text-muted-foreground">Memory budget is unavailable right now.</p>}

      {!failed && !report && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      )}

      {report && domains.length === 0 && <p className="text-sm text-muted-foreground">No memories yet.</p>}

      {domains.length > 0 && (
        <ul className="space-y-4">
          {domains.map((d) => (
            <li key={d.domain}>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="text-sm font-medium text-foreground capitalize">{d.domain}</span>
                <span className="flex items-center gap-2">
                  {d.over && <Badge variant="warning">Over limit</Badge>}
                  <span className="tnum text-sm text-muted-foreground">
                    {d.count} / {d.limit}
                  </span>
                </span>
              </div>
              <Progress value={(d.count / d.limit) * 100} label={`${d.domain}: ${d.count} of ${d.limit} memories`} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
