// POST /onboarding-bootstrap/doc   — single-shot extraction from an uploaded or
//                                     pasted document. Produces everything the
//                                     5-step wizard would normally collect.
// POST /onboarding-bootstrap/voice — transcribe an audio blob with Deepgram or
//                                     Whisper, then pipe through the same
//                                     extraction path.
//
// The heavy lifting is in docs/prompts/onboarding-bootstrap.system.md (priority
// JSON-block path + markdown fallback). This route is just plumbing: receive
// bytes, call Claude, validate with BootstrapExtractionSchema, return.

import { Router } from 'express';
import type { IRouter } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import type { AuthRequest } from '../middleware/auth';
import { MODEL_MAP, BootstrapExtractionSchema } from '@boardroom/shared';
import { loadSystemPrompt } from '../lib/prompt-loader';
import { transcribeAudio } from '../services/transcription.service';
import { logger } from '../lib/logger';

const router: IRouter = Router();

// Up to 5 MB. The briefing prompt produces ~10KB of text; 5MB is enough
// headroom for a PDF and well under Express's body-parser defaults.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Up to 25 MB for audio. Whisper's own limit is 25MB; Deepgram's is higher
// but 25MB covers ~30 minutes of speech which is plenty for an onboarding
// briefing.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * Strip the most common ways Claude wraps JSON (markdown fences, leading
 * prose) and return parseable JSON — or null if we couldn't find any.
 */
function extractJsonBlock(raw: string): string | null {
  // Prefer a fenced ```json block
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced?.[1]) return fenced[1].trim();
  // Fallback: biggest balanced {...} block starting at first {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) return raw.slice(start, end + 1).trim();
  return null;
}

/**
 * Run a text briefing through Claude + the onboarding-bootstrap system
 * prompt. Returns the parsed, validated BootstrapExtraction.
 */
async function extractFromText(text: string): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL_MAP.sonnet, // use sonnet here — this is single-shot and downstream trusts the output
    max_tokens: 3000,
    system: loadSystemPrompt('onboarding-bootstrap'),
    messages: [{ role: 'user', content: text }],
  });

  const output = response.content[0];
  if (output?.type !== 'text') {
    throw new Error('Claude returned no text content');
  }

  const jsonStr = extractJsonBlock(output.text);
  if (!jsonStr) {
    throw new Error('No JSON block found in extraction response');
  }

  const parsed = BootstrapExtractionSchema.safeParse(JSON.parse(jsonStr));
  if (!parsed.success) {
    logger.warn('BootstrapExtractionSchema rejected extraction', {
      issues: parsed.error.issues,
    });
    throw new Error(
      `Extraction did not match schema: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// POST /onboarding-bootstrap/doc
// Accepts a multipart file upload (field name: `file`) OR raw text body
// (Content-Type application/json with { text: "..." }). Either path leads
// to the same extraction.
// ---------------------------------------------------------------------------
router.post('/doc', upload.single('file'), async (req: AuthRequest, res, next) => {
  try {
    let text = '';
    if (req.file) {
      text = req.file.buffer.toString('utf-8');
    } else if (typeof req.body?.text === 'string') {
      text = req.body.text;
    } else {
      res.status(400).json({
        error: 'bad_request',
        message: 'Provide either a `file` upload or a JSON body with `text`.',
      });
      return;
    }

    text = text.trim();
    if (text.length < 20) {
      res.status(400).json({
        error: 'bad_request',
        message: 'Briefing text is too short to extract anything meaningful.',
      });
      return;
    }

    const extraction = await extractFromText(text);
    res.json(extraction);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /onboarding-bootstrap/voice
// Accepts a multipart audio upload (field name: `audio`). Transcribes via
// Deepgram (preferred) or Whisper (fallback), then runs the same extraction.
// Returns { extraction, transcript, provider } so the UI can show the user
// what was heard.
// ---------------------------------------------------------------------------
router.post('/voice', audioUpload.single('audio'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({
        error: 'bad_request',
        message: 'Provide an `audio` file upload.',
      });
      return;
    }

    const { text: transcript, provider, durationMs } = await transcribeAudio(
      req.file.buffer,
      req.file.mimetype,
    );

    if (!transcript.trim()) {
      res.status(422).json({
        error: 'empty_transcript',
        message: 'Transcription returned no text. Try again with clearer audio.',
        provider,
      });
      return;
    }

    const extraction = await extractFromText(transcript);
    res.json({ extraction, transcript, provider, transcriptionMs: durationMs });
  } catch (err) {
    next(err);
  }
});

export const onboardingBootstrapRouter: IRouter = router;
