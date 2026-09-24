-- CreateTable
CREATE TABLE "task_creation_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "taskId" TEXT,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_creation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_creation_requests_taskId_key" ON "task_creation_requests"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_creation_requests_organizationId_key_key" ON "task_creation_requests"("organizationId", "key");

-- CreateIndex
CREATE INDEX "task_creation_requests_organizationId_createdAt_idx" ON "task_creation_requests"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "task_creation_requests" ADD CONSTRAINT "task_creation_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_creation_requests" ADD CONSTRAINT "task_creation_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
