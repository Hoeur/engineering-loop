-- CreateEnum
CREATE TYPE "public"."ProjectPhaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ACCEPTED');

-- AlterTable
ALTER TABLE "public"."project_phases" ADD COLUMN     "status" "public"."ProjectPhaseStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "project_phases_projectId_status_idx" ON "public"."project_phases"("projectId", "status");
