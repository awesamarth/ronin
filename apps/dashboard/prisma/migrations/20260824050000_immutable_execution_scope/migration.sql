-- A Run is the durable authorization boundary for execution. Its tenant,
-- actor, target, and permission snapshot cannot be rewritten after creation.
CREATE FUNCTION ronin_preserve_run_scope() RETURNS trigger AS $$
BEGIN
    IF NEW."orgId" IS DISTINCT FROM OLD."orgId"
       OR NEW."repoId" IS DISTINCT FROM OLD."repoId"
       OR NEW."conversationId" IS DISTINCT FROM OLD."conversationId"
       OR NEW."sourceMessageId" IS DISTINCT FROM OLD."sourceMessageId"
       OR NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId"
       OR NEW."authorizedAction" IS DISTINCT FROM OLD."authorizedAction"
       OR NEW."authorization" IS DISTINCT FROM OLD."authorization" THEN
        RAISE EXCEPTION 'run execution scope is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER run_execution_scope_immutable BEFORE UPDATE ON "Run"
FOR EACH ROW EXECUTE FUNCTION ronin_preserve_run_scope();
