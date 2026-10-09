import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SynthesisReport } from '@boardroom/shared';
import * as api from '../../lib/api';
import { describeSessionError } from '../../stores/session.store';
import { BILLING_SETTINGS_PATH } from '../shared/TrialBanner';
import { Card, Button, Input, Badge, Progress } from '../ui';

interface QuickResult {
  sessionId: string;
  recommendation: string;
  /** Synthesis quality score, normalised to 0..1 (server may emit 0..1 or 0..100). */
  confidence: number;
}

function normaliseScore(score: unknown): number {
  if (typeof score !== 'number' || Number.isNaN(score)) return 0;
  const s = score > 1 ? score / 100 : score;
  return Math.max(0, Math.min(1, s));
}

/**
 * Quick Take (C-110): creates a `quick-take` session and consumes the dispatch
 * stream, which for this mode emits `synthesis_complete` ({ report, qualityScore })
 * followed by `dispatch_complete`. Errors are surfaced, never swallowed.
 */
export function QuickTakeWidget() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuickResult | null>(null);
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  // Abort an in-flight stream if the widget unmounts
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleQuickTake() {
    if (!question.trim() || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const session = await api.createSession({
        question: question.trim(),
        mode: 'quick-take',
      });

      let report: SynthesisReport | null = null;
      let qualityScore = 0;
      let streamError: string | null = null;

      for await (const event of api.createDispatchStream(session.sessionId, controller.signal)) {
        if (event.type === 'synthesis_complete') {
          report = event.report;
          qualityScore = normaliseScore(event.qualityScore);
        } else if (event.type === 'error') {
          streamError = event.error;
        } else if (event.type === 'dispatch_complete' || event.type === 'done') {
          break;
        }
      }

      if (controller.signal.aborted) return;

      if (!report) {
        setError({ message: streamError ?? 'Quick take finished without a recommendation.', status: null });
        return;
      }

      setResult({
        sessionId: session.sessionId,
        recommendation: report.recommendation,
        confidence: qualityScore,
      });
      setQuestion('');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(describeSessionError(err, 'Quick take failed'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
        Quick Take
      </h3>

      <div className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleQuickTake()}
          placeholder="What decision are you facing?"
          disabled={loading}
          className="flex-1"
        />
        <Button
          variant="primary"
          size="md"
          onClick={handleQuickTake}
          disabled={!question.trim() || loading}
        >
          {loading ? 'Thinking...' : '⚡ Quick Take'}
        </Button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger-muted p-3 text-sm">
          <p className="text-foreground">{error.message}</p>
          {error.status === 402 && (
            <Link to={BILLING_SETTINGS_PATH} className="text-primary underline font-medium">
              Upgrade your plan
            </Link>
          )}
        </div>
      )}

      {result && (
        <Card className="mt-3 bg-card">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="accent">Recommendation</Badge>
          </div>
          <p className="text-sm text-foreground">{result.recommendation}</p>
          {result.confidence > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">Quality:</span>
              <Progress value={result.confidence * 100} className="flex-1 h-1.5" />
              <span className="text-xs text-muted-foreground">{Math.round(result.confidence * 100)}%</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/decisions/${result.sessionId}`)}
            className="mt-2"
          >
            View Full Analysis
          </Button>
        </Card>
      )}
    </Card>
  );
}
