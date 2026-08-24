-- Align physical index definitions with the Prisma schema. The AuditLog index
-- was misdeclared in the initial migration, and PostgreSQL truncated the first
-- Conversation external-identity index name.
DROP INDEX IF EXISTS "AuditLog_orgId_createdAt_idx";
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");

DROP INDEX IF EXISTS "Conversation_platform_platformTeamId_platformChannelId_platform";
DROP INDEX IF EXISTS "Conversation_platform_platformTeamId_platformChannelId_plat_key";
CREATE UNIQUE INDEX "Conversation_external_identity_key"
ON "Conversation"("platform", "platformTeamId", "platformChannelId", "platformThreadId");
