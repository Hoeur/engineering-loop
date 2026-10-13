-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "teamConfigured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "teamVersion" INTEGER NOT NULL DEFAULT 0;
