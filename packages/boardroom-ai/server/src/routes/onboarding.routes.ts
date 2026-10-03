import { Router } from 'express';
import type { IRouter } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicClient } from '../lib/anthropic-client';
import type { AuthRequest } from '../middleware/auth';
import { MODEL_IDS, ExtractedGoalsSchema, ExtractedProjectsSchema } from '@boardroom/shared';
import { buildSystemBlocks, stripJsonFences, firstText, assertNotTruncated, EFFORT } from '../lib/llm-request';
import { recordUsage } from '../lib/llm-usage';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { llmRateLimiter } from '../middleware/llm-rate-limiter';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// POST /onboarding/extract-goals — parse goals from freeform text
router.post('/extract-goals', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = createAnthropicClient(apiKey);

    const startedAt = Date.now();
    const response = await client.messages.create({
      model: MODEL_IDS.haiku,
      max_tokens: 500,
      system: buildSystemBlocks({ prompt: loadSystemPrompt('onboarding-goals') }),
      output_config: { effort: EFFORT.extractor },
      messages: [{ role: 'user', content: text }],
    });
    recordUsage({ purpose: 'extraction:onboarding-goals', model: MODEL_IDS.haiku, usage: response.usage, durationMs: Date.now() - startedAt, userId: req.auth!.userId });

    const output = firstText(response); // R-B-03
    if (output !== null) {
      assertNotTruncated(response);
      res.json(ExtractedGoalsSchema.parse(JSON.parse(stripJsonFences(output))));
    } else {
      res.json([]);
    }
  } catch (err) { next(err); }
});

// POST /onboarding/extract-projects — parse projects from freeform text
router.post('/extract-projects', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = createAnthropicClient(apiKey);

    const startedAt = Date.now();
    const response = await client.messages.create({
      model: MODEL_IDS.haiku,
      max_tokens: 500,
      system: buildSystemBlocks({ prompt: loadSystemPrompt('onboarding-projects') }),
      output_config: { effort: EFFORT.extractor },
      messages: [{ role: 'user', content: text }],
    });
    recordUsage({ purpose: 'extraction:onboarding-projects', model: MODEL_IDS.haiku, usage: response.usage, durationMs: Date.now() - startedAt, userId: req.auth!.userId });

    const output = firstText(response); // R-B-03
    if (output !== null) {
      assertNotTruncated(response);
      res.json(ExtractedProjectsSchema.parse(JSON.parse(stripJsonFences(output))));
    } else {
      res.json([]);
    }
  } catch (err) { next(err); }
});

// POST /onboarding/complete — marks onboarding done
router.post('/complete', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.updateUserProfile(req.auth!.userId, { onboardingComplete: true });
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

export const onboardingRouter: IRouter = router;
