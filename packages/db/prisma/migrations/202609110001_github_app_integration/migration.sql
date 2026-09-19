-- AddTable: durable tenant ownership for GitHub App installations.
CREATE TABLE "public"."github_installations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountAvatarUrl" TEXT,
    "repositorySelection" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suspendedAt" TIMESTAMP(3),
    "connectedByUserId" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."github_authorization_attempts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_authorization_attempts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."repositories"
    ADD COLUMN "githubInstallationRecordId" TEXT,
    ADD COLUMN "githubRepositoryId" TEXT,
    ADD COLUMN "githubNodeId" TEXT,
    ADD COLUMN "githubOwner" TEXT,
    ADD COLUMN "githubFullName" TEXT,
    ADD COLUMN "githubPrivate" BOOLEAN,
    ADD COLUMN "githubArchived" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "githubHtmlUrl" TEXT;

CREATE UNIQUE INDEX "github_installations_externalId_key" ON "public"."github_installations"("externalId");
CREATE UNIQUE INDEX "github_authorization_attempts_stateHash_key" ON "public"."github_authorization_attempts"("stateHash");
CREATE INDEX "github_authorization_attempts_organizationId_userId_consumedAt_idx" ON "public"."github_authorization_attempts"("organizationId", "userId", "consumedAt");
CREATE INDEX "github_authorization_attempts_expiresAt_idx" ON "public"."github_authorization_attempts"("expiresAt");
CREATE INDEX "github_installations_organizationId_accountLogin_idx" ON "public"."github_installations"("organizationId", "accountLogin");
CREATE INDEX "github_installations_organizationId_suspendedAt_idx" ON "public"."github_installations"("organizationId", "suspendedAt");
CREATE UNIQUE INDEX "repositories_githubInstallationRecordId_githubRepositoryId_key" ON "public"."repositories"("githubInstallationRecordId", "githubRepositoryId");
CREATE INDEX "repositories_installationId_githubRepositoryId_idx" ON "public"."repositories"("installationId", "githubRepositoryId");

ALTER TABLE "public"."github_installations" ADD CONSTRAINT "github_installations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."github_installations" ADD CONSTRAINT "github_installations_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."github_authorization_attempts" ADD CONSTRAINT "github_authorization_attempts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."github_authorization_attempts" ADD CONSTRAINT "github_authorization_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."repositories" ADD CONSTRAINT "repositories_githubInstallationRecordId_fkey" FOREIGN KEY ("githubInstallationRecordId") REFERENCES "public"."github_installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
