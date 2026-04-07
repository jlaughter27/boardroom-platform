import type { PrismaClient, Prisma } from '@prisma/client';

const DEFAULT_RISK_PROFILE = {
  financial: 0.5,
  technical: 0.5,
  people: 0.5,
  strategic: 0.5,
};

export async function getOrCreateProfile(userId: string, prisma: PrismaClient) {
  const existing = await prisma.userProfile.findUnique({
    where: { userId },
  });

  if (existing) return existing;

  return prisma.userProfile.create({
    data: {
      userId,
      riskProfile: DEFAULT_RISK_PROFILE as Prisma.InputJsonValue,
      valueHierarchy: [],
      cognitivePatterns: '[]' as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updateProfile(
  userId: string,
  data: Record<string, unknown>,
  prisma: PrismaClient
) {
  // Ensure profile exists first
  await getOrCreateProfile(userId, prisma);

  // Convert JSON fields
  if (data.riskProfile) {
    data.riskProfile = data.riskProfile as Prisma.InputJsonValue;
  }
  if (data.cognitivePatterns) {
    data.cognitivePatterns = data.cognitivePatterns as Prisma.InputJsonValue;
  }

  return prisma.userProfile.update({
    where: { userId },
    data: data as any,
  });
}
