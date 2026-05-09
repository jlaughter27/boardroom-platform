import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface DigestStats {
  userId: string;
  weekStart: Date;
  weekEnd: Date;
  memoriesCreated: number;
  memoriesUpdated: number;
  decisionsLogged: number;
  tasksCompleted: number;
  topDomains: string[];
  highlights: string[];
}

export async function buildWeeklyDigest(userId: string, weekStart: Date, weekEnd: Date, prisma: PrismaClient): Promise<DigestStats> {
  const [memoriesCreated, memoriesUpdated, decisionsLogged, tasksCompleted, domainCounts] = await Promise.all([
    prisma.memoryEntry.count({ where: { userId, createdAt: { gte: weekStart, lt: weekEnd }, deletedAt: null } }),
    prisma.memoryEntry.count({ where: { userId, updatedAt: { gte: weekStart, lt: weekEnd }, createdAt: { lt: weekStart }, deletedAt: null } }),
    prisma.decision.count({ where: { createdAt: { gte: weekStart, lt: weekEnd } } }),
    prisma.task.count({ where: { completedAt: { gte: weekStart, lt: weekEnd } } }),
    prisma.memoryEntry.groupBy({
      by: ['domain'],
      where: { userId, createdAt: { gte: weekStart, lt: weekEnd }, deletedAt: null },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 3,
    }),
  ]);

  const topDomains = domainCounts.map(d => d.domain);

  const highlights: string[] = [];
  if (memoriesCreated > 0) highlights.push(`${memoriesCreated} new memor${memoriesCreated === 1 ? 'y' : 'ies'} captured`);
  if (decisionsLogged > 0) highlights.push(`${decisionsLogged} decision${decisionsLogged === 1 ? '' : 's'} logged`);
  if (tasksCompleted > 0) highlights.push(`${tasksCompleted} task${tasksCompleted === 1 ? '' : 's'} completed`);
  if (topDomains.length > 0) highlights.push(`Top domains: ${topDomains.join(', ')}`);

  return { userId, weekStart, weekEnd, memoriesCreated, memoriesUpdated, decisionsLogged, tasksCompleted, topDomains, highlights };
}

export async function saveAndSendDigest(stats: DigestStats, prisma: PrismaClient): Promise<void> {
  const digest = await prisma.weeklyDigest.create({
    data: {
      userId: stats.userId,
      weekStart: stats.weekStart,
      weekEnd: stats.weekEnd,
      memoriesCreated: stats.memoriesCreated,
      memoriesUpdated: stats.memoriesUpdated,
      decisionsLogged: stats.decisionsLogged,
      tasksCompleted: stats.tasksCompleted,
      topDomains: stats.topDomains,
      highlights: stats.highlights,
    },
  });

  // Email send: log for now; wire nodemailer/SendGrid when SMTP env vars present
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    try {
      await sendDigestEmail(stats, smtpHost);
      await prisma.weeklyDigest.update({ where: { id: digest.id }, data: { sentAt: new Date() } });
    } catch (err) {
      logger.error('Digest email send failed', { userId: stats.userId, error: (err as Error).message });
    }
  } else {
    logger.info('Weekly digest built (no SMTP configured — skipping email)', {
      userId: stats.userId,
      memoriesCreated: stats.memoriesCreated,
      highlights: stats.highlights,
    });
  }
}

async function sendDigestEmail(stats: DigestStats, smtpHost: string): Promise<void> {
  // Dynamic import — nodemailer is optional; avoids hard dep if not installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodemailer = require('nodemailer') as typeof import('nodemailer');

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  const weekLabel = stats.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const to = process.env.DIGEST_EMAIL_TO ?? process.env.SMTP_USER ?? '';
  if (!to) return;

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: `OmniMind Weekly Digest — week of ${weekLabel}`,
    text: [
      `OmniMind Weekly Summary (${stats.weekStart.toDateString()} – ${stats.weekEnd.toDateString()})`,
      '',
      ...stats.highlights,
      '',
      `Total memories created: ${stats.memoriesCreated}`,
      `Total memories updated: ${stats.memoriesUpdated}`,
      `Decisions logged: ${stats.decisionsLogged}`,
      `Tasks completed: ${stats.tasksCompleted}`,
      `Active domains: ${stats.topDomains.join(', ') || 'none'}`,
    ].join('\n'),
  });
}
