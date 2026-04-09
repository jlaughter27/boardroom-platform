import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import { Card, Button, Input, Badge, Progress } from '../ui';

interface QuickResult {
  sessionId: string;
  recommendation: string;
  confidence: number;
}

export function QuickTakeWidget() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuickResult | null>(null);
  const navigate = useNavigate();

  async function handleQuickTake() {
    if (!question.trim() || loading) return;

    setLoading(true);
    setResult(null);

    try {
      const session = await api.createSession({
        question: question.trim(),
        mode: 'quick-take' as any,
      });

      let recommendation = '';
      let confidence = 0;

      for await (const event of api.createDispatchStream(session.sessionId)) {
        if (event.type === 'persona_complete' || event.type === 'synthesis_complete') {
          if (typeof event.recommendation === 'string') recommendation = event.recommendation;
          if (typeof event.confidence === 'number') confidence = event.confidence;
        }
        if (event.type === 'done' || event.type === 'complete') break;
      }

      if (!recommendation) {
        const detail = await api.getSession(session.sessionId);
        if (detail.ceoSynthesis && typeof detail.ceoSynthesis === 'object') {
          const synthesis = detail.ceoSynthesis as Record<string, unknown>;
          recommendation = (synthesis.recommendation as string) || 'Analysis complete';
          confidence = (synthesis.confidence as number) || 0;
        }
      }

      setResult({
        sessionId: session.sessionId,
        recommendation: recommendation || 'Analysis complete. View full results.',
        confidence,
      });
      setQuestion('');
    } catch {
      /* silently fail */
    } finally {
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
          {loading ? 'Thinking...' : '\u26A1 Quick Take'}
        </Button>
      </div>

      {result && (
        <Card className="mt-3 bg-card">
          <p className="text-sm text-foreground">{result.recommendation}</p>
          {result.confidence > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">Confidence:</span>
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
