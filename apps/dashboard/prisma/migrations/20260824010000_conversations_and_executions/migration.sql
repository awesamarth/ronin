-- Persist platform conversations separately from agent jobs.
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "channelId" TEXT,
    "scope" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformTeamId" TEXT NOT NULL,
    "platformChannelId" TEXT NOT NULL,
    "platformThreadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Conversation_scope_check" CHECK (
      ("scope" = 'public' AND "orgId" IS NULL AND "channelId" IS NULL)
      OR ("scope" = 'organization' AND "orgId" IS NOT NULL)
    )
);

CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Run" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "Run" ADD COLUMN "sourceMessageId" TEXT;

-- Keep each Centaur invocation independently auditable even when one Run
-- performs analysis and then workspace execution.
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "backend" TEXT,
    "centaurThreadKey" TEXT,
    "centaurExecutionId" TEXT,
    "harness" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "reasoning" TEXT,
    "output" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_platform_platformTeamId_platformChannelId_platformThreadId_key"
ON "Conversation"("platform", "platformTeamId", "platformChannelId", "platformThreadId");
CREATE INDEX "Conversation_orgId_updatedAt_idx" ON "Conversation"("orgId", "updatedAt");
CREATE INDEX "Conversation_channelId_idx" ON "Conversation"("channelId");
CREATE UNIQUE INDEX "ConversationMessage_conversationId_externalMessageId_key"
ON "ConversationMessage"("conversationId", "externalMessageId");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx"
ON "ConversationMessage"("conversationId", "createdAt");
CREATE UNIQUE INDEX "Run_sourceMessageId_key" ON "Run"("sourceMessageId");
CREATE INDEX "Run_conversationId_createdAt_idx" ON "Run"("conversationId", "createdAt");
CREATE UNIQUE INDEX "AgentExecution_runId_idempotencyKey_key"
ON "AgentExecution"("runId", "idempotencyKey");
CREATE INDEX "AgentExecution_orgId_createdAt_idx" ON "AgentExecution"("orgId", "createdAt");
CREATE INDEX "AgentExecution_centaurExecutionId_idx" ON "AgentExecution"("centaurExecutionId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_sourceMessageId_fkey"
FOREIGN KEY ("sourceMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve provenance for historical runs that already reached Centaur.
INSERT INTO "AgentExecution" (
  "id", "orgId", "runId", "purpose", "idempotencyKey", "status", "backend",
  "centaurThreadKey", "centaurExecutionId", "startedAt", "completedAt", "createdAt", "updatedAt"
)
SELECT
  'exec_' || md5("id" || COALESCE("centaurExecutionId", '')),
  "orgId",
  "id",
  'legacy',
  "id" || ':legacy',
  CASE WHEN "status" = 'completed' THEN 'completed' WHEN "status" = 'blocked' THEN 'failed' ELSE "status" END,
  NULL,
  "centaurThreadKey",
  "centaurExecutionId",
  "startedAt",
  "completedAt",
  "createdAt",
  "updatedAt"
FROM "Run"
WHERE "centaurThreadKey" IS NOT NULL OR "centaurExecutionId" IS NOT NULL;
