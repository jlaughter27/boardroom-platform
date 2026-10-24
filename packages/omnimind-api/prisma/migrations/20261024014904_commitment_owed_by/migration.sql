-- RD-12: commitment direction. Additive only: existing rows read USER.
-- CreateEnum
CREATE TYPE "CommitmentOwedBy" AS ENUM ('USER', 'STAKEHOLDER');

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN "owed_by" "CommitmentOwedBy" NOT NULL DEFAULT 'USER';
