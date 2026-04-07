import { Router } from 'express';
import type { IRouter } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { AuthRequest } from '../middleware/auth';
import { MODEL_MAP, ExtractedGoalsSchema, ExtractedProjectsSchema } from '@boardroom/shared';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// POST /onboarding/extract-goals — parse goals from freeform text
router.post('/extract-goals', async (req: AuthRequest, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: MODEL_MAP.haiku,
      max_tokens: 500,
      system: loadSystemPrompt('onboarding-goals'),
      messages: [{ role: 'user', content: text }],
    });

    const output = response.content[0];
    if (output?.type === 'text') {
      const jsonStr = output.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      res.json(ExtractedGoalsSchema.parse(JSON.parse(jsonStr)));
    } else {
      res.json([]);
    }
  } catch (err) { next(err); }
});

// POST /onboarding/extract-projects — parse projects from freeform text
router.post('/extract-projects', async (req: AuthRequest, res, next) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: MODEL_MAP.haiku,
      max_tokens: 500,
      system: loadSystemPrompt('onboarding-projects'),
      messages: [{ role: 'user', content: text }],
    });

    const output = response.content[0];
    if (output?.type === 'text') {
      const jsonStr = output.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      res.json(ExtractedProjectsSchema.parse(JSON.parse(jsonStr)));
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
