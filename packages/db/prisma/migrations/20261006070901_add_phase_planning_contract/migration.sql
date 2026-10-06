-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "contractAcceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "contractNonGoals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "contractObjective" TEXT,
ADD COLUMN     "contractRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "public"."project_phases" ADD COLUMN     "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "requiredRoles" "public"."AgentRole"[] DEFAULT ARRAY[]::"public"."AgentRole"[];

-- CreateTable
CREATE TABLE "public"."project_phase_dependencies" (
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "dependsOnPhaseId" TEXT NOT NULL,

    CONSTRAINT "project_phase_dependencies_pkey" PRIMARY KEY ("phaseId","dependsOnPhaseId")
);

-- Prisma does not model CHECK constraints; retain this defense in forward SQL.
ALTER TABLE "public"."project_phase_dependencies"
  ADD CONSTRAINT "project_phase_dependencies_no_self"
  CHECK ("phaseId" <> "dependsOnPhaseId");

-- CreateIndex
CREATE INDEX "project_phase_dependencies_projectId_phaseId_idx" ON "public"."project_phase_dependencies"("projectId", "phaseId");

-- CreateIndex
CREATE INDEX "project_phase_dependencies_projectId_dependsOnPhaseId_idx" ON "public"."project_phase_dependencies"("projectId", "dependsOnPhaseId");

-- AddForeignKey
ALTER TABLE "public"."project_phase_dependencies" ADD CONSTRAINT "project_phase_dependencies_phaseId_projectId_fkey" FOREIGN KEY ("phaseId", "projectId") REFERENCES "public"."project_phases"("id", "projectId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."project_phase_dependencies" ADD CONSTRAINT "project_phase_dependencies_dependsOnPhaseId_projectId_fkey" FOREIGN KEY ("dependsOnPhaseId", "projectId") REFERENCES "public"."project_phases"("id", "projectId") ON DELETE NO ACTION ON UPDATE NO ACTION;

