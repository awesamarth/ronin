-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "githubOrgId" TEXT,
    "githubOrgLogin" TEXT,
    "githubInstallationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "githubRepoId" TEXT,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "latestKnownSha" TEXT,
    "watchedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" TEXT NOT NULL DEFAULT 'docs,pr_review,support_answers,try_fix,auto_report_pr',
    "harnessType" TEXT NOT NULL DEFAULT 'pi',
    "model" TEXT,
    "provider" TEXT,
    "reasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Repository_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "defaultRepoId" TEXT,
    "platform" TEXT NOT NULL,
    "platformTeamId" TEXT,
    "platformChannelId" TEXT NOT NULL,
    "displayName" TEXT,
    "allowedRepoIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Channel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Channel_defaultRepoId_fkey" FOREIGN KEY ("defaultRepoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "centaurThreadKey" TEXT,
    "centaurExecutionId" TEXT,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Run_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Artifact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "GitHubEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "deliveryId" TEXT,
    "eventName" TEXT NOT NULL,
    "action" TEXT,
    "installationId" TEXT,
    "payload" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitHubEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GitHubEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GitHubEvent_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "runId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");
CREATE UNIQUE INDEX "Org_githubOrgLogin_key" ON "Org"("githubOrgLogin");
CREATE UNIQUE INDEX "Org_githubInstallationId_key" ON "Org"("githubInstallationId");
CREATE UNIQUE INDEX "Repository_githubRepoId_key" ON "Repository"("githubRepoId");
CREATE INDEX "Repository_orgId_idx" ON "Repository"("orgId");
CREATE UNIQUE INDEX "Repository_orgId_fullName_key" ON "Repository"("orgId", "fullName");
CREATE INDEX "Channel_orgId_idx" ON "Channel"("orgId");
CREATE UNIQUE INDEX "Channel_platform_platformTeamId_platformChannelId_key" ON "Channel"("platform", "platformTeamId", "platformChannelId");
CREATE INDEX "Run_orgId_kind_createdAt_idx" ON "Run"("orgId", "kind", "createdAt");
CREATE INDEX "Run_repoId_idx" ON "Run"("repoId");
CREATE INDEX "Artifact_orgId_kind_createdAt_idx" ON "Artifact"("orgId", "kind", "createdAt");
CREATE INDEX "Artifact_repoId_idx" ON "Artifact"("repoId");
CREATE INDEX "Artifact_runId_idx" ON "Artifact"("runId");
CREATE UNIQUE INDEX "GitHubEvent_deliveryId_key" ON "GitHubEvent"("deliveryId");
CREATE INDEX "GitHubEvent_orgId_eventName_createdAt_idx" ON "GitHubEvent"("orgId", "eventName", "createdAt");
CREATE INDEX "GitHubEvent_repoId_idx" ON "GitHubEvent"("repoId");
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId");
CREATE INDEX "AuditLog_repoId_idx" ON "AuditLog"("repoId");
CREATE INDEX "AuditLog_runId_idx" ON "AuditLog"("runId");
