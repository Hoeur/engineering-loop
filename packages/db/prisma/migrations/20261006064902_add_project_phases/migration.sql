-- AlterTable
ALTER TABLE "public"."tasks" ADD COLUMN     "phaseId" TEXT;

-- CreateTable
CREATE TABLE "public"."project_phases" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_phases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_phases_id_projectId_key" ON "public"."project_phases"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_phases_projectId_position_key" ON "public"."project_phases"("projectId", "position");

-- CreateIndex
CREATE INDEX "tasks_projectId_phaseId_status_idx" ON "public"."tasks"("projectId", "phaseId", "status");

-- AddForeignKey
ALTER TABLE "public"."project_phases" ADD CONSTRAINT "project_phases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_phaseId_projectId_fkey" FOREIGN KEY ("phaseId", "projectId") REFERENCES "public"."project_phases"("id", "projectId") ON DELETE NO ACTION ON UPDATE NO ACTION;

