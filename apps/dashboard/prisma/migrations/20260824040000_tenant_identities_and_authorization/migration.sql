CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "lastActiveOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "login" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubInstallationAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitHubInstallationAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrgMembership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrgMembership_role_check" CHECK ("role" IN ('owner', 'admin', 'member', 'external')),
    CONSTRAINT "OrgMembership_status_check" CHECK ("status" IN ('active', 'suspended'))
);

ALTER TABLE "Channel" ADD COLUMN "accessMode" TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_accessMode_check" CHECK ("accessMode" IN ('internal', 'external'));
ALTER TABLE "ConversationMessage" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "Run" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "Run" ADD COLUMN "authorizedAction" TEXT;
ALTER TABLE "Run" ADD COLUMN "authorization" TEXT;

CREATE TABLE "ChannelRepository" (
    "channelId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelRepository_pkey" PRIMARY KEY ("channelId", "repoId")
);

INSERT INTO "ChannelRepository" ("channelId", "repoId", "orgId")
SELECT c."id", repo_id, c."orgId"
FROM "Channel" c
CROSS JOIN LATERAL unnest(string_to_array(c."allowedRepoIds", ',')) AS repo_id
JOIN "Repository" r ON r."id" = repo_id AND r."orgId" = c."orgId"
WHERE c."allowedRepoIds" IS NOT NULL AND c."allowedRepoIds" <> ''
ON CONFLICT DO NOTHING;

INSERT INTO "ChannelRepository" ("channelId", "repoId", "orgId")
SELECT c."id", c."defaultRepoId", c."orgId"
FROM "Channel" c
JOIN "Repository" r ON r."id" = c."defaultRepoId" AND r."orgId" = c."orgId"
WHERE c."defaultRepoId" IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE "Channel" DROP COLUMN "allowedRepoIds";

CREATE UNIQUE INDEX "UserIdentity_provider_providerAccountId_key" ON "UserIdentity"("provider", "providerAccountId");
CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");
CREATE UNIQUE INDEX "GitHubInstallationAccess_userId_installationId_key" ON "GitHubInstallationAccess"("userId", "installationId");
CREATE INDEX "GitHubInstallationAccess_installationId_idx" ON "GitHubInstallationAccess"("installationId");
CREATE UNIQUE INDEX "OrgMembership_orgId_userId_key" ON "OrgMembership"("orgId", "userId");
CREATE INDEX "OrgMembership_userId_status_idx" ON "OrgMembership"("userId", "status");
CREATE INDEX "ConversationMessage_actorUserId_idx" ON "ConversationMessage"("actorUserId");
CREATE INDEX "Run_actorUserId_idx" ON "Run"("actorUserId");
CREATE INDEX "ChannelRepository_orgId_idx" ON "ChannelRepository"("orgId");
CREATE INDEX "ChannelRepository_repoId_idx" ON "ChannelRepository"("repoId");

ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallationAccess" ADD CONSTRAINT "GitHubInstallationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrgMembership" ADD CONSTRAINT "OrgMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelRepository" ADD CONSTRAINT "ChannelRepository_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelRepository" ADD CONSTRAINT "ChannelRepository_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelRepository" ADD CONSTRAINT "ChannelRepository_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense in depth: application filters are not allowed to create cross-tenant references.
CREATE FUNCTION ronin_enforce_same_org() RETURNS trigger AS $$
DECLARE
    child_org TEXT := to_jsonb(NEW)->>'orgId';
    parent_id TEXT := to_jsonb(NEW)->>TG_ARGV[1];
    parent_org TEXT;
BEGIN
    IF parent_id IS NULL THEN RETURN NEW; END IF;
    EXECUTE format('SELECT "orgId" FROM %I WHERE "id" = $1', TG_ARGV[0]) INTO parent_org USING parent_id;
    IF parent_org IS NULL OR child_org IS DISTINCT FROM parent_org THEN
        RAISE EXCEPTION 'cross-organization reference from % to %', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER channel_default_repo_same_org BEFORE INSERT OR UPDATE ON "Channel"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Repository', 'defaultRepoId');
CREATE TRIGGER channel_repo_channel_same_org BEFORE INSERT OR UPDATE ON "ChannelRepository"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Channel', 'channelId');
CREATE TRIGGER channel_repo_repo_same_org BEFORE INSERT OR UPDATE ON "ChannelRepository"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Repository', 'repoId');
CREATE TRIGGER conversation_channel_same_org BEFORE INSERT OR UPDATE ON "Conversation"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Channel', 'channelId');
CREATE TRIGGER run_repo_same_org BEFORE INSERT OR UPDATE ON "Run"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Repository', 'repoId');
CREATE TRIGGER run_conversation_same_org BEFORE INSERT OR UPDATE ON "Run"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Conversation', 'conversationId');
CREATE TRIGGER execution_run_same_org BEFORE INSERT OR UPDATE ON "AgentExecution"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Run', 'runId');
CREATE TRIGGER artifact_repo_same_org BEFORE INSERT OR UPDATE ON "Artifact"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Repository', 'repoId');
CREATE TRIGGER artifact_run_same_org BEFORE INSERT OR UPDATE ON "Artifact"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Run', 'runId');
CREATE TRIGGER github_event_repo_same_org BEFORE INSERT OR UPDATE ON "GitHubEvent"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Repository', 'repoId');
CREATE TRIGGER audit_repo_same_org BEFORE INSERT OR UPDATE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Repository', 'repoId');
CREATE TRIGGER audit_run_same_org BEFORE INSERT OR UPDATE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_same_org('Run', 'runId');

CREATE FUNCTION ronin_enforce_run_actor() RETURNS trigger AS $$
BEGIN
    IF NEW."actorUserId" IS NULL THEN RETURN NEW; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "OrgMembership" m
        WHERE m."orgId" = NEW."orgId" AND m."userId" = NEW."actorUserId" AND m."status" = 'active'
    ) THEN
        RAISE EXCEPTION 'run actor is not an active member of the organization' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER run_actor_membership BEFORE INSERT OR UPDATE ON "Run"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_run_actor();

CREATE FUNCTION ronin_enforce_run_source_message() RETURNS trigger AS $$
DECLARE
    message_org TEXT;
    message_conversation TEXT;
BEGIN
    IF NEW."sourceMessageId" IS NULL THEN RETURN NEW; END IF;
    SELECT c."orgId", c."id" INTO message_org, message_conversation
    FROM "ConversationMessage" m JOIN "Conversation" c ON c."id" = m."conversationId"
    WHERE m."id" = NEW."sourceMessageId";
    IF message_org IS NULL OR message_org IS DISTINCT FROM NEW."orgId"
       OR (NEW."conversationId" IS NOT NULL AND NEW."conversationId" IS DISTINCT FROM message_conversation) THEN
        RAISE EXCEPTION 'run source message crosses organization or conversation boundary' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER run_source_message_same_tenant BEFORE INSERT OR UPDATE ON "Run"
FOR EACH ROW EXECUTE FUNCTION ronin_enforce_run_source_message();
