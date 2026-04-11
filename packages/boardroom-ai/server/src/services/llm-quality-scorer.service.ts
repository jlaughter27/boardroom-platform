import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger';

/**
 * LLM-powered quality scoring for synthesis outputs
 * Uses a lightweight Haiku model to evaluate content quality
 */

export interface LLMQualityScore {
  overall: number;           // 0-100
  coherence: number;         // 0-100
  usefulness: number;        // 0-100
  accuracy: number;          // 0-100
  reasoning: number;       // 0-100
  critique: string;          // Brief critique
  improvementSuggestions: string[];
}

const QUALITY_EVALUATION_PROMPT = `You are a quality evaluator for AI-generated business strategy synthesis. 

Evaluate the following synthesis output and provide scores (0-100) for:
1. **coherence**: Does it flow logically? Is it well-structured?
2. **usefulness**: Are the recommendations actionable? Is it practical?
3. **accuracy**: Are the facts and assumptions correct and consistent?
4. **reasoning**: Is the reasoning sound? Are conclusions well-supported?

Also provide:
- **overall**: Overall quality score (weighted average)
- **critique**: One sentence describing the main strength or weakness
- **improvements**: 1-2 specific suggestions for improvement

Respond in this exact JSON format:
{
  "coherence": number,
  "usefulness": number,
  "accuracy": number,
  "reasoning": number,
  "overall": number,
  "critique": "string",
  "improvements": ["string"]
}

Synthesis to evaluate:
`;

/**
 * Score synthesis quality using LLM evaluation
 * Uses Haiku model for cost-effectiveness
 */
export async function scoreWithLLM(
  synthesis: {
    recommendation?: string;
    nextActions?: string[];
    disagreementMap?: string;
    topRisks?: string[];
    assumptionsToMonitor?: string[];
  },
  client: Anthropic,
  options?: {
    model?: string;
    timeout?: number;
  }
): Promise<LLMQualityScore | null> {
  const model = options?.model || 'claude-3-haiku-20240307';
  const timeout = options?.timeout || 5000; // 5 second timeout for real-time use

  // Format synthesis for evaluation
  const synthesisText = formatSynthesisForEvaluation(synthesis);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await client.messages.create({
      model,
      max_tokens: 500,
      temperature: 0,
      system: QUALITY_EVALUATION_PROMPT,
      messages: [{ role: 'user', content: synthesisText }],
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    const content = response.content[0];
    if (content?.type !== 'text') {
      throw new Error('Unexpected response type from LLM');
    }

    // Parse JSON response
    const jsonStr = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // Validate and normalize scores
    const score: LLMQualityScore = {
      coherence: clampScore(parsed.coherence),
      usefulness: clampScore(parsed.usefulness),
      accuracy: clampScore(parsed.accuracy),
      reasoning: clampScore(parsed.reasoning),
      overall: clampScore(parsed.overall),
      critique: parsed.critique || 'No critique provided',
      improvementSuggestions: Array.isArray(parsed.improvements)
        ? parsed.improvements.slice(0, 3)
        : [],
    };

    logger.info('[LLM Quality] Scored synthesis', {
      model,
      overall: score.overall,
      critique: score.critique.substring(0, 50),
    });

    return score;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('[LLM Quality] Scoring timed out', { model, timeout });
    } else {
      logger.error('[LLM Quality] Scoring failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
    return null; // Return null to allow fallback to heuristic scoring
  }
}

/**
 * Format synthesis for LLM evaluation
 */
function formatSynthesisForEvaluation(synthesis: {
  recommendation?: string;
  nextActions?: string[];
  disagreementMap?: string;
  topRisks?: string[];
  assumptionsToMonitor?: string[];
}): string {
  const parts: string[] = [];

  if (synthesis.recommendation) {
    parts.push(`## Recommendation\n${synthesis.recommendation}`);
  }

  if (synthesis.nextActions?.length) {
    parts.push(`## Next Actions\n${synthesis.nextActions.join('\n')}`);
  }

  if (synthesis.disagreementMap) {
    parts.push(`## Disagreement Analysis\n${synthesis.disagreementMap}`);
  }

  if (synthesis.topRisks?.length) {
    parts.push(`## Top Risks\n${synthesis.topRisks.join('\n')}`);
  }

  if (synthesis.assumptionsToMonitor?.length) {
    parts.push(`## Assumptions to Monitor\n${synthesis.assumptionsToMonitor.join('\n')}`);
  }

  return parts.join('\n\n') || 'No synthesis content provided';
}

/**
 * Clamp score to 0-100 range
 */
function clampScore(score: unknown): number {
  if (typeof score !== 'number') return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Compare LLM score with heuristic score
 * Returns a blended score with confidence
 */
export function blendQualityScores(
  heuristic: { final: number; semantic: number; dissentHandled: boolean },
  llm: LLMQualityScore | null
): {
  final: number;
  confidence: number;
  method: 'llm' | 'heuristic' | 'blended';
  details: Record<string, number | boolean>;
} {
  if (!llm) {
    // Fallback to heuristic only
    return {
      final: heuristic.final,
      confidence: 0.6,
      method: 'heuristic',
      details: {
        heuristic: heuristic.final,
        semantic: heuristic.semantic,
        dissentHandled: heuristic.dissentHandled,
      },
    };
  }

  // Blend scores: 50% LLM overall, 30% heuristic, 20% semantic
  const blended = Math.round(
    llm.overall * 0.1 +     // LLM score scaled to 0-10
    heuristic.final * 0.6 +   // Heuristic
    heuristic.semantic * 10 * 0.3 // Semantic coverage
  );

  // High confidence if LLM and heuristic agree closely
  const agreement = 1 - Math.abs(llm.overall / 10 - heuristic.final) / 10;
  const confidence = 0.7 + agreement * 0.3;

  return {
    final: Math.max(0, Math.min(10, blended)),
    confidence: Math.round(confidence * 100) / 100,
    method: 'blended',
    details: {
      llmOverall: llm.overall / 10,
      llmCoherence: llm.coherence,
      llmUsefulness: llm.usefulness,
      heuristic: heuristic.final,
      semantic: heuristic.semantic,
      agreement: Math.round(agreement * 100),
    },
  };
}
