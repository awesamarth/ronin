-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "githubOrgId" TEXT,
    "githubOrgLogin" TEXT,
    "githubInstallationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "githubRepoId" TEXT,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "latestKnownSha" TEXT,
    "watchedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" TEXT NOT NULL DEFAULT 'docs,pr_review,support_answers',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Repository_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "defaultRepoId" TEXT,
    "platform" TEXT NOT NULL,
    "platformTeamId" TEXT,
    "platformChannelId" TEXT NOT NULL,
    "displayName" TEXT,
    "allowedRepoIds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Channel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Channel_defaultRepoId_fkey" FOREIGN KEY ("defaultRepoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Run_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Run_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GitHubEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "deliveryId" TEXT,
    "eventName" TEXT NOT NULL,
    "action" TEXT,
    "installationId" TEXT,
    "payload" TEXT NOT NULL,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitHubEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GitHubEvent_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "repoId" TEXT,
    "runId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Org_githubOrgLogin_key" ON "Org"("githubOrgLogin");

-- CreateIndex
CREATE UNIQUE INDEX "Org_githubInstallationId_key" ON "Org"("githubInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepoId_key" ON "Repository"("githubRepoId");

-- CreateIndex
CREATE INDEX "Repository_orgId_idx" ON "Repository"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_orgId_fullName_key" ON "Repository"("orgId", "fullName");

-- CreateIndex
CREATE INDEX "Channel_orgId_idx" ON "Channel"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_platform_platformTeamId_platformChannelId_key" ON "Channel"("platform", "platformTeamId", "platformChannelId");

-- CreateIndex
CREATE INDEX "Run_orgId_kind_createdAt_idx" ON "Run"("orgId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Run_repoId_idx" ON "Run"("repoId");

-- CreateIndex
CREATE INDEX "Artifact_orgId_kind_createdAt_idx" ON "Artifact"("orgId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_repoId_idx" ON "Artifact"("repoId");

-- CreateIndex
CREATE INDEX "Artifact_runId_idx" ON "Artifact"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubEvent_deliveryId_key" ON "GitHubEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "GitHubEvent_orgId_eventName_createdAt_idx" ON "GitHubEvent"("orgId", "eventName", "createdAt");

-- CreateIndex
CREATE INDEX "GitHubEvent_repoId_idx" ON "GitHubEvent"("repoId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_repoId_idx" ON "AuditLog"("repoId");

-- CreateIndex
CREATE INDEX "AuditLog_runId_idx" ON "AuditLog"("runId");
