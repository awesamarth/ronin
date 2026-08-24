ALTER TABLE "Org" ADD COLUMN "profile" TEXT;

CREATE TABLE "SlackInstallation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "orgId" TEXT,
    "teamName" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SlackInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HostedInferenceUsage" (
    "id" TEXT NOT NULL,
    "slackInstallationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HostedInferenceUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlackInstallation_teamId_key" ON "SlackInstallation"("teamId");
CREATE INDEX "SlackInstallation_orgId_idx" ON "SlackInstallation"("orgId");
CREATE UNIQUE INDEX "HostedInferenceUsage_installation_request_key" ON "HostedInferenceUsage"("slackInstallationId", "requestId");
CREATE INDEX "HostedInferenceUsage_installation_actor_created_idx" ON "HostedInferenceUsage"("slackInstallationId", "actorId", "createdAt");
CREATE INDEX "HostedInferenceUsage_installation_status_created_idx" ON "HostedInferenceUsage"("slackInstallationId", "status", "createdAt");

ALTER TABLE "SlackInstallation" ADD CONSTRAINT "SlackInstallation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HostedInferenceUsage" ADD CONSTRAINT "HostedInferenceUsage_slackInstallationId_fkey" FOREIGN KEY ("slackInstallationId") REFERENCES "SlackInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing single-org Slack channel mappings establish the workspace installation.
INSERT INTO "SlackInstallation" ("id", "teamId", "orgId", "installedAt", "lastSeenAt", "createdAt", "updatedAt")
SELECT 'slack_' || md5(c."platformTeamId"), c."platformTeamId", MIN(c."orgId"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Channel" c
WHERE c."platform" = 'slack' AND c."platformTeamId" IS NOT NULL AND c."platformTeamId" <> ''
GROUP BY c."platformTeamId"
HAVING COUNT(DISTINCT c."orgId") = 1
ON CONFLICT ("teamId") DO NOTHING;
