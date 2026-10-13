-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "teamRequiredRoles" "public"."AgentRole"[] DEFAULT ARRAY[]::"public"."AgentRole"[];

-- CreateTable
CREATE TABLE "public"."project_team_members" (
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_team_members_pkey" PRIMARY KEY ("projectId","agentId")
);

-- CreateIndex
CREATE INDEX "project_team_members_agentId_idx" ON "public"."project_team_members"("agentId");

-- AddForeignKey
ALTER TABLE "public"."project_team_members" ADD CONSTRAINT "project_team_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_team_members" ADD CONSTRAINT "project_team_members_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
