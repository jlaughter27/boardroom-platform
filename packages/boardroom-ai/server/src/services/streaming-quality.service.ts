import type { Response } from 'express';
import { sendSSE } from '../agents/streaming';
import { logger } from '../lib/logger';

/**
 * Real-time quality monitoring during streaming
 * Analyzes deltas as they arrive to detect quality issues
 */

export interface StreamingQualityMetrics {
  coherenceScore: number;      // 0-1 based on flow consistency
  repetitionCount: number;   // Number of repeated phrases detected
  contradictionFlags: string[]; // Real-time contradiction alerts
  estimatedCompleteness: number; // 0-1 based on structure markers
  warnings: string[];
}

// Quality thresholds for real-time alerts
const STREAMING_THRESHOLDS = {
  maxRepetition: 3,          // Alert after 3 repetitions
  minCoherence: 0.3,         // Alert if coherence drops below 30%
  lowCompleteness: 0.4,      // Alert if structure seems incomplete
};

/**
 * Monitor streaming response quality in real-time
 */
export class StreamingQualityMonitor {
  private window: string[] = [];        // Rolling window of recent text
  private windowSize = 200;             // Characters to keep
  private repetitionLog = new Map<string, number>();
  private structureMarkers = {
    hasIntroduction: false,
    hasBody: false,
    hasConclusion: false,
    listItems: 0,
  };

  constructor(private sessionId: string) {}

  /**
   * Process each delta as it arrives
   */
  processDelta(delta: string): StreamingQualityMetrics {
    // Add to rolling window
    this.window.push(delta);
    const combined = this.window.join('');
    if (combined.length > this.windowSize) {
      this.window = [combined.slice(-this.windowSize)];
    }

    // Check for repetitions
    this.detectRepetition(delta);

    // Update structure analysis
    this.analyzeStructure(delta);

    // Calculate coherence
    const coherenceScore = this.calculateCoherence();

    // Check for real-time contradiction patterns
    const contradictionFlags = this.detectContradictionPatterns(combined);

    // Estimate completeness
    const estimatedCompleteness = this.estimateCompleteness();

    // Generate warnings
    const warnings: string[] = [];

    if (this.getRepetitionCount() >= STREAMING_THRESHOLDS.maxRepetition) {
      warnings.push('high_repetition_detected');
    }

    if (coherenceScore < STREAMING_THRESHOLDS.minCoherence) {
      warnings.push('low_coherence');
    }

    if (estimatedCompleteness < STREAMING_THRESHOLDS.lowCompleteness && combined.length > 500) {
      warnings.push('possibly_incomplete');
    }

    return {
      coherenceScore,
      repetitionCount: this.getRepetitionCount(),
      contradictionFlags,
      estimatedCompleteness,
      warnings,
    };
  }

  /**
   * Detect repeated phrases in recent window
   */
  private detectRepetition(delta: string): void {
    const phrases = delta.toLowerCase().match(/\b\w+\s+\w+\s+\w+/g) || [];

    for (const phrase of phrases) {
      const count = (this.repetitionLog.get(phrase) || 0) + 1;
      this.repetitionLog.set(phrase, count);

      // Decay old entries periodically
      if (this.repetitionLog.size > 100) {
        this.decayRepetitionLog();
      }
    }
  }

  private decayRepetitionLog(): void {
    for (const [phrase, count] of this.repetitionLog.entries()) {
      if (count > 1) {
        this.repetitionLog.set(phrase, count * 0.5);
      } else {
        this.repetitionLog.delete(phrase);
      }
    }
  }

  private getRepetitionCount(): number {
    return Array.from(this.repetitionLog.values()).filter(c => c >= 3).length;
  }

  /**
   * Analyze text structure markers
   */
  private analyzeStructure(delta: string): void {
    const text = delta.toLowerCase();

    // Introduction markers
    if (/\b(here are|let me|first|to begin|introduction)\b/i.test(text)) {
      this.structureMarkers.hasIntroduction = true;
    }

    // Body markers
    if (/\b(however|moreover|additionally|second|third|next)\b/i.test(text)) {
      this.structureMarkers.hasBody = true;
    }

    // Conclusion markers
    if (/\b(in conclusion|finally|to summarize|overall|in summary)\b/i.test(text)) {
      this.structureMarkers.hasConclusion = true;
    }

    // List items
    if (/^\s*[-•*\d]\s+/m.test(text)) {
      this.structureMarkers.listItems++;
    }
  }

  /**
   * Calculate coherence based on sentence flow
   */
  private calculateCoherence(): number {
    const text = this.window.join('');

    // Simple coherence: check for sentence boundaries
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length < 2) return 1.0;

    // Check for transition words between sentences
    const transitions = ['however', 'therefore', 'moreover', 'additionally', 'consequently', 'meanwhile'];
    let transitionCount = 0;

    for (let i = 1; i < sentences.length; i++) {
      const start = sentences[i].trim().toLowerCase().split(/\s+/)[0];
      if (transitions.includes(start)) {
        transitionCount++;
      }
    }

    // Coherence ratio: transitions / sentences
    return Math.min(1, 0.3 + (transitionCount / sentences.length));
  }

  /**
   * Detect contradiction patterns in real-time
   */
  private detectContradictionPatterns(text: string): string[] {
    const flags: string[] = [];
    const lower = text.toLowerCase();

    // Immediate contradiction patterns
    const patterns = [
      { pattern: /\b(yes|agree)\b.*\b(but|however|no)\b/i, flag: 'possible_reversal' },
      { pattern: /\b(always|never)\b.*\b(sometimes|occasionally)\b/i, flag: 'absolute_to_relative' },
      { pattern: /\b(increase|grow)\b.*\b(decrease|shrink)\b/i, flag: 'direction_contradiction' },
    ];

    for (const { pattern, flag } of patterns) {
      if (pattern.test(lower)) {
        flags.push(flag);
      }
    }

    return flags;
  }

  /**
   * Estimate response completeness based on structure
   */
  private estimateCompleteness(): number {
    let score = 0.2; // Base score

    if (this.structureMarkers.hasIntroduction) score += 0.2;
    if (this.structureMarkers.hasBody) score += 0.2;
    if (this.structureMarkers.hasConclusion) score += 0.3;
    if (this.structureMarkers.listItems >= 2) score += 0.1;

    return Math.min(1, score);
  }

  /**
   * Send quality alert via SSE
   */
  sendQualityAlert(res: Response, metrics: StreamingQualityMetrics): void {
    if (metrics.warnings.length > 0) {
      sendSSE(res, {
        type: 'error',
        error: `Quality alert: coherence=${Math.round(metrics.coherenceScore * 100)}, warnings=${metrics.warnings.join(', ')}`,
      } as any);

      logger.info('[StreamingQuality] Alert sent', {
        sessionId: this.sessionId,
        warnings: metrics.warnings,
      });
    }
  }
}

/**
 * Wrap streamClaudeResponse with quality monitoring
 */
export async function streamWithQualityMonitoring(
  res: Response,
  streamFn: () => AsyncIterable<{ type: string; delta?: { text?: string } }>,
  sessionId: string
): Promise<string> {
  const monitor = new StreamingQualityMonitor(sessionId);
  let fullResponse = '';
  let lastQualityCheck = Date.now();

  try {
    for await (const event of streamFn()) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        const delta = event.delta.text;
        fullResponse += delta;

        // Check quality every 100ms or 200 chars
        if (Date.now() - lastQualityCheck > 100 || fullResponse.length % 200 < 50) {
          const metrics = monitor.processDelta(delta);
          if (metrics.warnings.length > 0) {
            monitor.sendQualityAlert(res, metrics);
          }
          lastQualityCheck = Date.now();
        }

        sendSSE(res, { type: 'delta', text: delta });
      }
    }

    // Final quality report (sent as comment via SSE)
    const finalMetrics = monitor.processDelta('');
    logger.info('[StreamingQuality] Final metrics', {
      coherence: Math.round(finalMetrics.coherenceScore * 100),
      repetitions: finalMetrics.repetitionCount,
      completeness: Math.round(finalMetrics.estimatedCompleteness * 100),
    });

    sendSSE(res, { type: 'done' });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    sendSSE(res, { type: 'error', error: message });
    res.end();
  }

  return fullResponse;
}
