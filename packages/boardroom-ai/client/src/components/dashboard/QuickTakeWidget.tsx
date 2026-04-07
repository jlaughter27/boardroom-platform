import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';

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

      // Stream CEO-only dispatch
      let recommendation = '';
      let confidence = 0;

      for await (const event of api.createDispatchStream(session.sessionId)) {
        if (event.type === 'persona_complete' || event.type === 'synthesis_complete') {
          if (typeof event.recommendation === 'string') {
            recommendation = event.recommendation;
          }
          if (typeof event.confidence === 'number') {
            confidence = event.confidence;
          }
        }
        if (event.type === 'done' || event.type === 'complete') {
          break;
        }
      }

      // If we didn't get a recommendation from streaming, fetch the session
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
      /* silently fail — user sees no result */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">Quick Take</h3>

      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleQuickTake()}
          placeholder="Ask a quick question..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          disabled={loading}
        />
        <button
          onClick={handleQuickTake}
          disabled={!question.trim() || loading}
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg whitespace-nowrap transition-colors"
        >
          {loading ? 'Thinking...' : 'Quick Take \u26A1'}
        </button>
      </div>

      {result && (
        <div className="mt-3 bg-gray-800/50 rounded-lg p-3">
          <p className="text-sm text-white">{result.recommendation}</p>
          {result.confidence > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Confidence: {Math.round(result.confidence * 100)}%
            </p>
          )}
          <button
            onClick={() => navigate(`/decisions/${result.sessionId}`)}
            className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block"
          >
            View Full
          </button>
        </div>
      )}
    </div>
  );
}
