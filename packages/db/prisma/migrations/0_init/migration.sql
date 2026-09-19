-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('BACKLOG', 'PLANNING', 'PLAN_READY', 'QUEUED', 'IMPLEMENTING', 'IMPLEMENTATION_READY', 'TESTING', 'TEST_FAILED', 'REVIEWING', 'CHANGES_REQUESTED', 'FIXING', 'APPROVED', 'PR_READY', 'PR_CREATED', 'MERGED', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'NEEDS_HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "public"."TaskType" AS ENUM ('FEATURE', 'BUG', 'REFACTOR', 'TEST', 'DOCUMENTATION', 'SECURITY', 'PERFORMANCE', 'UI', 'DEVOPS', 'INVESTIGATION');

-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "public"."RiskLevel" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "public"."Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "public"."TaskDependencyType" AS ENUM ('BLOCKS', 'RELATES_TO', 'DUPLICATES');

-- CreateEnum
CREATE TYPE "public"."AgentRole" AS ENUM ('PRODUCT', 'ARCHITECT', 'PLANNER', 'IMPLEMENTER', 'BACKEND_DEVELOPER', 'FRONTEND_DEVELOPER', 'DATABASE_ENGINEER', 'DEVOPS_ENGINEER', 'QA', 'UI_REVIEWER', 'CODE_REVIEWER', 'SECURITY_REVIEWER', 'PERFORMANCE_REVIEWER', 'DOCUMENTATION');

-- CreateEnum
CREATE TYPE "public"."AgentProviderKind" AS ENUM ('CODEX', 'CLAUDE_CODE', 'GEMINI', 'OPENAI_API', 'ANTHROPIC_API', 'LOCAL_LLM', 'CUSTOM_CLI', 'MOCK');

-- CreateEnum
CREATE TYPE "public"."AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'BUDGET_EXCEEDED');

-- CreateEnum
CREATE TYPE "public"."AgentMessageRole" AS ENUM ('SYSTEM', 'USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "public"."WorkflowStepKey" AS ENUM ('ANALYZE_REPOSITORY', 'PLAN', 'CREATE_TASKS', 'CREATE_WORKTREE', 'IMPLEMENT', 'RUN_TESTS', 'REVIEW', 'FIX', 'RETEST', 'FINAL_REVIEW', 'PREPARE_PR', 'COMPLETE');

-- CreateEnum
CREATE TYPE "public"."RunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED', 'WAITING_FOR_HUMAN');

-- CreateEnum
CREATE TYPE "public"."CheckType" AS ENUM ('LINT', 'TYPECHECK', 'UNIT', 'INTEGRATION', 'BUILD', 'E2E', 'SECURITY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."CheckStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "public"."ReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ReviewCategory" AS ENUM ('CORRECTNESS', 'ARCHITECTURE', 'SECURITY', 'PERFORMANCE', 'TESTING', 'MAINTAINABILITY', 'UI', 'ACCESSIBILITY', 'DOCUMENTATION');

-- CreateEnum
CREATE TYPE "public"."FindingStatus" AS ENUM ('OPEN', 'FIXING', 'RESOLVED', 'WONT_FIX', 'ACCEPTED_RISK');

-- CreateEnum
CREATE TYPE "public"."ReviewKind" AS ENUM ('CODE', 'SECURITY', 'PERFORMANCE', 'UI', 'ARCHITECTURE');

-- CreateEnum
CREATE TYPE "public"."Viewport" AS ENUM ('DESKTOP', 'TABLET', 'MOBILE');

-- CreateEnum
CREATE TYPE "public"."UiFindingCategory" AS ENUM ('LAYOUT', 'SPACING', 'TYPOGRAPHY', 'RESPONSIVE', 'OVERFLOW', 'ACCESSIBILITY', 'CONTRAST', 'NAVIGATION', 'EMPTY_STATE', 'LOADING_STATE', 'ERROR_STATE', 'INTERACTION', 'CONSOLE_ERROR', 'NETWORK_ERROR');

-- CreateEnum
CREATE TYPE "public"."RepositoryProvider" AS ENUM ('GITHUB', 'GITLAB', 'BITBUCKET', 'LOCAL');

-- CreateEnum
CREATE TYPE "public"."RepositoryStatus" AS ENUM ('CONNECTED', 'SYNCING', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "public"."PullRequestStatus" AS ENUM ('DRAFT', 'OPEN', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."WorktreeStatus" AS ENUM ('CREATING', 'ACTIVE', 'DIRTY', 'RELEASED', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."PermissionLevel" AS ENUM ('LEVEL_0_OBSERVE', 'LEVEL_1_PLAN', 'LEVEL_2_CODE', 'LEVEL_3_PR', 'LEVEL_4_MERGE', 'LEVEL_5_DEPLOY');

-- CreateEnum
CREATE TYPE "public"."OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MAINTAINER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."ApprovalKind" AS ENUM ('PLAN', 'IMPLEMENTATION', 'PULL_REQUEST', 'MERGE', 'DEPLOY', 'BUDGET_OVERRIDE');

-- CreateEnum
CREATE TYPE "public"."ScheduleType" AS ENUM ('REPOSITORY_REVIEW', 'TECH_DEBT_ANALYSIS', 'SECURITY_SCAN', 'DEPENDENCY_REVIEW', 'TEST_SUITE', 'BACKLOG_ANALYSIS', 'ARCHITECTURE_REVIEW', 'UI_QUALITY_REVIEW', 'TASK_EXECUTION');

-- CreateEnum
CREATE TYPE "public"."ArtifactKind" AS ENUM ('DIFF', 'LOG', 'REPORT', 'SCREENSHOT', 'COVERAGE', 'PLAN', 'TRACE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('TASK_FAILED', 'TEST_FAILED', 'REVIEW_REQUIRED', 'HUMAN_APPROVAL_REQUIRED', 'AGENT_FAILED', 'PR_READY', 'COST_LIMIT_REACHED', 'WORKFLOW_COMPLETED');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SLACK', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "public"."AuditAction" AS ENUM ('AGENT_STARTED', 'AGENT_STOPPED', 'COMMAND_EXECUTED', 'TASK_TRANSITIONED', 'GIT_ACTION', 'APPROVAL_DECISION', 'REVIEW_DECISION', 'CONFIGURATION_CHANGED', 'SCHEDULE_CHANGED', 'SECRET_ACCESSED');

-- CreateEnum
CREATE TYPE "public"."ArchitectureDecisionStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DEPRECATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "public"."MemoryKind" AS ENUM ('ARCHITECTURE', 'TECH_STACK', 'CONVENTIONS', 'API_CONVENTIONS', 'UI_CONVENTIONS', 'TEST_COMMANDS', 'DEPLOYMENT', 'TECH_DEBT', 'KNOWN_BUGS', 'COMPLETED_FEATURES', 'IMPORTANT_MODULES', 'DECISIONS');

-- CreateEnum
CREATE TYPE "public"."EpicStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."ProjectStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultProviderKey" TEXT NOT NULL DEFAULT 'mock',
    "costBudgetUsd" DECIMAL(12,4) NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organization_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."OrgRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissionLevel" "public"."PermissionLevel" NOT NULL DEFAULT 'LEVEL_3_PR',
    "maxReviewCycles" INTEGER NOT NULL DEFAULT 3,
    "maxTaskAttempts" INTEGER NOT NULL DEFAULT 3,
    "costBudgetUsd" DECIMAL(12,4) NOT NULL DEFAULT 50,
    "roleAssignments" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "taskSequence" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repositories" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "public"."RepositoryProvider" NOT NULL DEFAULT 'LOCAL',
    "status" "public"."RepositoryStatus" NOT NULL DEFAULT 'CONNECTED',
    "remoteUrl" TEXT,
    "localPath" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "primaryLanguage" TEXT,
    "frameworks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "packageManager" TEXT NOT NULL DEFAULT 'pnpm',
    "commands" JSONB NOT NULL DEFAULT '{}',
    "installationId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastAnalyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."repository_credentials" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."epics" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."EpicStatus" NOT NULL DEFAULT 'PLANNED',
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "epics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."features" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "epicId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."EpicStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "epicId" TEXT,
    "featureId" TEXT,
    "parentTaskId" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "objective" TEXT NOT NULL DEFAULT '',
    "type" "public"."TaskType" NOT NULL DEFAULT 'FEATURE',
    "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIUM',
    "severity" "public"."Severity",
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'BACKLOG',
    "riskLevel" "public"."RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "acceptanceCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "implementationNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredChecks" "public"."CheckType"[] DEFAULT ARRAY[]::"public"."CheckType"[],
    "assignedAgentId" TEXT,
    "branchName" TEXT,
    "worktreePath" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "reviewCycle" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "planSummary" TEXT,
    "plan" JSONB,
    "blockedReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."task_dependencies" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "type" "public"."TaskDependencyType" NOT NULL DEFAULT 'BLOCKS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "agentRunId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_providers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "public"."AgentProviderKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultModel" TEXT,
    "availableModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "encryptedCredential" TEXT,
    "credentialIv" TEXT,
    "credentialAuthTag" TEXT,
    "pricing" JSONB NOT NULL DEFAULT '{}',
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "public"."AgentRole" NOT NULL,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "systemPrompt" TEXT,
    "maxTokens" INTEGER NOT NULL DEFAULT 200000,
    "maxCostUsd" DECIMAL(12,4) NOT NULL DEFAULT 5,
    "timeoutMs" INTEGER NOT NULL DEFAULT 900000,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "permissionLevel" "public"."PermissionLevel" NOT NULL DEFAULT 'LEVEL_3_PR',
    "allowedCommands" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_configurations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "values" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_runs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "workflowRunId" TEXT,
    "workflowStepId" TEXT,
    "agentId" TEXT,
    "providerId" TEXT,
    "role" "public"."AgentRole" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "model" TEXT,
    "status" "public"."AgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "sessionId" TEXT,
    "input" JSONB,
    "output" JSONB,
    "rawOutput" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "workspacePath" TEXT,
    "traceId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."agent_messages" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "role" "public"."AgentMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "tokens" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_runs" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT,
    "definitionKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "status" "public"."RunStatus" NOT NULL DEFAULT 'PENDING',
    "state" JSONB NOT NULL DEFAULT '{}',
    "currentStepKey" "public"."WorkflowStepKey",
    "reviewCycle" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "traceId" TEXT,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_steps" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stepKey" "public"."WorkflowStepKey" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "public"."RunStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."git_worktrees" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "taskId" TEXT,
    "path" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "status" "public"."WorktreeStatus" NOT NULL DEFAULT 'CREATING',
    "clean" BOOLEAN NOT NULL DEFAULT true,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_worktrees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."git_branches" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "headSha" TEXT,
    "ahead" INTEGER NOT NULL DEFAULT 0,
    "behind" INTEGER NOT NULL DEFAULT 0,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."commits" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branchId" TEXT,
    "taskId" TEXT,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pull_requests" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "branchId" TEXT,
    "taskId" TEXT,
    "number" INTEGER,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "public"."PullRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "url" TEXT,
    "headBranch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "local" BOOLEAN NOT NULL DEFAULT true,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."test_runs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "workflowStepId" TEXT,
    "status" "public"."CheckStatus" NOT NULL DEFAULT 'QUEUED',
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "worktreePath" TEXT,
    "commitSha" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "totalChecks" INTEGER NOT NULL DEFAULT 0,
    "passedChecks" INTEGER NOT NULL DEFAULT 0,
    "failedChecks" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "coverage" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."test_results" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "checkType" "public"."CheckType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."CheckStatus" NOT NULL DEFAULT 'QUEUED',
    "command" TEXT NOT NULL,
    "exitCode" INTEGER,
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_runs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "workflowStepId" TEXT,
    "agentRunId" TEXT,
    "kind" "public"."ReviewKind" NOT NULL DEFAULT 'CODE',
    "decision" "public"."ReviewDecision" NOT NULL DEFAULT 'COMMENTED',
    "status" "public"."RunStatus" NOT NULL DEFAULT 'PENDING',
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "score" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '',
    "coverageAssessment" TEXT,
    "architectureAssessment" TEXT,
    "securityAssessment" TEXT,
    "performanceAssessment" TEXT,
    "diffSha" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_findings" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT NOT NULL,
    "taskId" TEXT,
    "fixTaskId" TEXT,
    "severity" "public"."Severity" NOT NULL,
    "category" "public"."ReviewCategory" NOT NULL,
    "uiCategory" "public"."UiFindingCategory",
    "viewport" "public"."Viewport",
    "screenshotId" TEXT,
    "file" TEXT,
    "line" INTEGER,
    "problem" TEXT NOT NULL,
    "requiredFix" TEXT NOT NULL,
    "evidence" TEXT,
    "status" "public"."FindingStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."screenshots" (
    "id" TEXT NOT NULL,
    "reviewRunId" TEXT,
    "taskId" TEXT,
    "page" TEXT NOT NULL,
    "viewport" "public"."Viewport" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "dataUri" TEXT,
    "consoleErrors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedRequests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."artifacts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "agentRunId" TEXT,
    "testRunId" TEXT,
    "kind" "public"."ArtifactKind" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'text/plain',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "content" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."schedules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "name" TEXT NOT NULL,
    "type" "public"."ScheduleType" NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" "public"."RunStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_memories" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "public"."MemoryKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."architecture_decisions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "alternatives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consequences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "public"."ArchitectureDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
    "supersededById" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "architecture_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "agentRunId" TEXT,
    "providerKey" TEXT NOT NULL,
    "model" TEXT,
    "role" "public"."AgentRole",
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredOn" DATE NOT NULL,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cost_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "agentRunId" TEXT,
    "providerKey" TEXT NOT NULL,
    "model" TEXT,
    "estimatedCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(12,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredOn" DATE NOT NULL,

    CONSTRAINT "cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "public"."NotificationType" NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "severity" "public"."Severity" NOT NULL DEFAULT 'INFO',
    "readAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."approvals" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "workflowRunId" TEXT,
    "kind" "public"."ApprovalKind" NOT NULL,
    "status" "public"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "note" TEXT,
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "action" "public"."AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "userId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT,
    "status" "public"."WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "public"."organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "public"."organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "public"."organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "public"."organization_members"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "projects_organizationId_status_idx" ON "public"."projects"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organizationId_slug_key" ON "public"."projects"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organizationId_key_key" ON "public"."projects"("organizationId", "key");

-- CreateIndex
CREATE INDEX "repositories_projectId_status_idx" ON "public"."repositories"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_projectId_name_key" ON "public"."repositories"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "repository_credentials_repositoryId_name_key" ON "public"."repository_credentials"("repositoryId", "name");

-- CreateIndex
CREATE INDEX "epics_projectId_status_idx" ON "public"."epics"("projectId", "status");

-- CreateIndex
CREATE INDEX "features_projectId_status_idx" ON "public"."features"("projectId", "status");

-- CreateIndex
CREATE INDEX "features_epicId_idx" ON "public"."features"("epicId");

-- CreateIndex
CREATE INDEX "tasks_projectId_status_idx" ON "public"."tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "tasks_repositoryId_status_idx" ON "public"."tasks"("repositoryId", "status");

-- CreateIndex
CREATE INDEX "tasks_status_priority_idx" ON "public"."tasks"("status", "priority");

-- CreateIndex
CREATE INDEX "tasks_assignedAgentId_idx" ON "public"."tasks"("assignedAgentId");

-- CreateIndex
CREATE INDEX "tasks_lastActivityAt_idx" ON "public"."tasks"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_projectId_key_key" ON "public"."tasks"("projectId", "key");

-- CreateIndex
CREATE INDEX "task_dependencies_dependsOnTaskId_idx" ON "public"."task_dependencies"("dependsOnTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnTaskId_key" ON "public"."task_dependencies"("taskId", "dependsOnTaskId");

-- CreateIndex
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "public"."task_comments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_providers_organizationId_enabled_idx" ON "public"."agent_providers"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "agent_providers_organizationId_key_key" ON "public"."agent_providers"("organizationId", "key");

-- CreateIndex
CREATE INDEX "agents_organizationId_role_idx" ON "public"."agents"("organizationId", "role");

-- CreateIndex
CREATE INDEX "agents_projectId_role_idx" ON "public"."agents"("projectId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "agents_organizationId_projectId_role_name_key" ON "public"."agents"("organizationId", "projectId", "role", "name");

-- CreateIndex
CREATE INDEX "agent_configurations_agentId_active_idx" ON "public"."agent_configurations"("agentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "agent_configurations_agentId_version_key" ON "public"."agent_configurations"("agentId", "version");

-- CreateIndex
CREATE INDEX "agent_runs_taskId_createdAt_idx" ON "public"."agent_runs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_workflowRunId_idx" ON "public"."agent_runs"("workflowRunId");

-- CreateIndex
CREATE INDEX "agent_runs_status_createdAt_idx" ON "public"."agent_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_role_status_idx" ON "public"."agent_runs"("role", "status");

-- CreateIndex
CREATE INDEX "agent_messages_agentRunId_idx" ON "public"."agent_messages"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_messages_agentRunId_sequence_key" ON "public"."agent_messages"("agentRunId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_key_version_key" ON "public"."workflow_definitions"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_idempotencyKey_key" ON "public"."workflow_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "workflow_runs_projectId_status_idx" ON "public"."workflow_runs"("projectId", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_taskId_createdAt_idx" ON "public"."workflow_runs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_runs_status_createdAt_idx" ON "public"."workflow_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "workflow_steps_workflowRunId_status_idx" ON "public"."workflow_steps"("workflowRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_steps_workflowRunId_sequence_key" ON "public"."workflow_steps"("workflowRunId", "sequence");

-- CreateIndex
CREATE INDEX "git_worktrees_taskId_idx" ON "public"."git_worktrees"("taskId");

-- CreateIndex
CREATE INDEX "git_worktrees_status_idx" ON "public"."git_worktrees"("status");

-- CreateIndex
CREATE UNIQUE INDEX "git_worktrees_repositoryId_path_key" ON "public"."git_worktrees"("repositoryId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "git_branches_repositoryId_name_key" ON "public"."git_branches"("repositoryId", "name");

-- CreateIndex
CREATE INDEX "commits_taskId_idx" ON "public"."commits"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "commits_repositoryId_sha_key" ON "public"."commits"("repositoryId", "sha");

-- CreateIndex
CREATE INDEX "pull_requests_taskId_idx" ON "public"."pull_requests"("taskId");

-- CreateIndex
CREATE INDEX "pull_requests_status_idx" ON "public"."pull_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repositoryId_number_key" ON "public"."pull_requests"("repositoryId", "number");

-- CreateIndex
CREATE INDEX "test_runs_taskId_createdAt_idx" ON "public"."test_runs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "test_runs_status_idx" ON "public"."test_runs"("status");

-- CreateIndex
CREATE INDEX "test_results_testRunId_checkType_idx" ON "public"."test_results"("testRunId", "checkType");

-- CreateIndex
CREATE INDEX "test_results_status_idx" ON "public"."test_results"("status");

-- CreateIndex
CREATE INDEX "review_runs_taskId_createdAt_idx" ON "public"."review_runs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "review_runs_decision_idx" ON "public"."review_runs"("decision");

-- CreateIndex
CREATE INDEX "review_findings_reviewRunId_status_idx" ON "public"."review_findings"("reviewRunId", "status");

-- CreateIndex
CREATE INDEX "review_findings_taskId_status_idx" ON "public"."review_findings"("taskId", "status");

-- CreateIndex
CREATE INDEX "review_findings_severity_status_idx" ON "public"."review_findings"("severity", "status");

-- CreateIndex
CREATE INDEX "screenshots_taskId_idx" ON "public"."screenshots"("taskId");

-- CreateIndex
CREATE INDEX "screenshots_reviewRunId_idx" ON "public"."screenshots"("reviewRunId");

-- CreateIndex
CREATE INDEX "artifacts_taskId_kind_idx" ON "public"."artifacts"("taskId", "kind");

-- CreateIndex
CREATE INDEX "artifacts_agentRunId_idx" ON "public"."artifacts"("agentRunId");

-- CreateIndex
CREATE INDEX "schedules_enabled_nextRunAt_idx" ON "public"."schedules"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_projectId_name_key" ON "public"."schedules"("projectId", "name");

-- CreateIndex
CREATE INDEX "project_memories_projectId_kind_active_idx" ON "public"."project_memories"("projectId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "project_memories_projectId_kind_version_key" ON "public"."project_memories"("projectId", "kind", "version");

-- CreateIndex
CREATE INDEX "architecture_decisions_projectId_status_idx" ON "public"."architecture_decisions"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "architecture_decisions_projectId_number_key" ON "public"."architecture_decisions"("projectId", "number");

-- CreateIndex
CREATE INDEX "usage_records_organizationId_occurredOn_idx" ON "public"."usage_records"("organizationId", "occurredOn");

-- CreateIndex
CREATE INDEX "usage_records_projectId_occurredOn_idx" ON "public"."usage_records"("projectId", "occurredOn");

-- CreateIndex
CREATE INDEX "usage_records_providerKey_occurredOn_idx" ON "public"."usage_records"("providerKey", "occurredOn");

-- CreateIndex
CREATE INDEX "cost_records_organizationId_occurredOn_idx" ON "public"."cost_records"("organizationId", "occurredOn");

-- CreateIndex
CREATE INDEX "cost_records_projectId_occurredOn_idx" ON "public"."cost_records"("projectId", "occurredOn");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "public"."notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_createdAt_idx" ON "public"."notifications"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "approvals_projectId_status_idx" ON "public"."approvals"("projectId", "status");

-- CreateIndex
CREATE INDEX "approvals_taskId_idx" ON "public"."approvals"("taskId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "public"."audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_projectId_createdAt_idx" ON "public"."audit_logs"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_taskId_createdAt_idx" ON "public"."audit_logs"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "public"."audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_events_organizationId_createdAt_idx" ON "public"."webhook_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "public"."webhook_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_externalId_key" ON "public"."webhook_events"("source", "externalId");

-- AddForeignKey
ALTER TABLE "public"."organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."repositories" ADD CONSTRAINT "repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."repository_credentials" ADD CONSTRAINT "repository_credentials_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."epics" ADD CONSTRAINT "epics_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."features" ADD CONSTRAINT "features_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."features" ADD CONSTRAINT "features_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "public"."epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "public"."epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "public"."features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "public"."agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_comments" ADD CONSTRAINT "task_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_comments" ADD CONSTRAINT "task_comments_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "public"."agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_providers" ADD CONSTRAINT "agent_providers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agents" ADD CONSTRAINT "agents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."agent_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_configurations" ADD CONSTRAINT "agent_configurations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_runs" ADD CONSTRAINT "agent_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_runs" ADD CONSTRAINT "agent_runs_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_runs" ADD CONSTRAINT "agent_runs_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "public"."workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_runs" ADD CONSTRAINT "agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_runs" ADD CONSTRAINT "agent_runs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "public"."agent_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."agent_messages" ADD CONSTRAINT "agent_messages_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "public"."agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_runs" ADD CONSTRAINT "workflow_runs_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "public"."workflow_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_runs" ADD CONSTRAINT "workflow_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_runs" ADD CONSTRAINT "workflow_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_steps" ADD CONSTRAINT "workflow_steps_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."git_worktrees" ADD CONSTRAINT "git_worktrees_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."git_worktrees" ADD CONSTRAINT "git_worktrees_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."git_branches" ADD CONSTRAINT "git_branches_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commits" ADD CONSTRAINT "commits_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commits" ADD CONSTRAINT "commits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."git_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."commits" ADD CONSTRAINT "commits_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pull_requests" ADD CONSTRAINT "pull_requests_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pull_requests" ADD CONSTRAINT "pull_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "public"."git_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pull_requests" ADD CONSTRAINT "pull_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."test_runs" ADD CONSTRAINT "test_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."test_runs" ADD CONSTRAINT "test_runs_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."test_runs" ADD CONSTRAINT "test_runs_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "public"."workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."test_results" ADD CONSTRAINT "test_results_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "public"."test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_runs" ADD CONSTRAINT "review_runs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_runs" ADD CONSTRAINT "review_runs_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_runs" ADD CONSTRAINT "review_runs_workflowStepId_fkey" FOREIGN KEY ("workflowStepId") REFERENCES "public"."workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_runs" ADD CONSTRAINT "review_runs_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "public"."agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_findings" ADD CONSTRAINT "review_findings_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "public"."review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_findings" ADD CONSTRAINT "review_findings_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "public"."screenshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."screenshots" ADD CONSTRAINT "screenshots_reviewRunId_fkey" FOREIGN KEY ("reviewRunId") REFERENCES "public"."review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."artifacts" ADD CONSTRAINT "artifacts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."artifacts" ADD CONSTRAINT "artifacts_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "public"."agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."artifacts" ADD CONSTRAINT "artifacts_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "public"."test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."schedules" ADD CONSTRAINT "schedules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."schedules" ADD CONSTRAINT "schedules_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_memories" ADD CONSTRAINT "project_memories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."architecture_decisions" ADD CONSTRAINT "architecture_decisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."architecture_decisions" ADD CONSTRAINT "architecture_decisions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_records" ADD CONSTRAINT "usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_records" ADD CONSTRAINT "usage_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_records" ADD CONSTRAINT "usage_records_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_records" ADD CONSTRAINT "usage_records_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "public"."agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cost_records" ADD CONSTRAINT "cost_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cost_records" ADD CONSTRAINT "cost_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cost_records" ADD CONSTRAINT "cost_records_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cost_records" ADD CONSTRAINT "cost_records_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "public"."agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."approvals" ADD CONSTRAINT "approvals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_events" ADD CONSTRAINT "webhook_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

