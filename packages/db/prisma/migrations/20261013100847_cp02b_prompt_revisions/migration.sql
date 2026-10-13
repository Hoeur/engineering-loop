-- CreateTable
CREATE TABLE "public"."prompt_templates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "public"."AgentRole" NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."prompt_revisions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_templates_projectId_createdAt_id_idx" ON "public"."prompt_templates"("projectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_revisions_templateId_revision_key" ON "public"."prompt_revisions"("templateId", "revision");

-- AddForeignKey
ALTER TABLE "public"."prompt_templates" ADD CONSTRAINT "prompt_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."prompt_revisions" ADD CONSTRAINT "prompt_revisions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
