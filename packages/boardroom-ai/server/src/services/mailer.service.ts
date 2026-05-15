// Lightweight mailer (Wave 3 Track E). Sends password-reset and email-verify
// transactional mail through whatever SMTP transport is configured in env.
// Mirrors the optional-nodemailer pattern used by omnimind-api/.../weekly-digest.service.ts.
// If SMTP_HOST is unset, we log + no-op (dev) — never throw, so the auth
// flow always returns success to the user.

import { logger } from '../lib/logger';

interface SendInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendTransactional(input: SendInput): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    // Dev passthrough — log the body for local testing. Do NOT include tokens
    // in plain logs in production; this branch is dev-only by definition.
    logger.info('[mailer:dev] would send email', { to: input.to, subject: input.subject });
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodemailer = require('nodemailer') as typeof import('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@boardroom.local',
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    // Never log the message body (it contains the reset/verify token).
    logger.info('Transactional email sent', { to: input.to, subject: input.subject });
  } catch (err) {
    // Don't surface email errors to the caller — failing the reset/verify
    // request would leak the existence of the email and frustrate UX.
    logger.error('Transactional email send failed', {
      to: input.to,
      subject: input.subject,
      error: (err as Error).message,
    });
  }
}
