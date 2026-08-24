-- Run authorization provenance is retained rather than silently orphaned.
ALTER TABLE "Run" DROP CONSTRAINT "Run_repoId_fkey";
ALTER TABLE "Run" DROP CONSTRAINT "Run_conversationId_fkey";
ALTER TABLE "Run" DROP CONSTRAINT "Run_sourceMessageId_fkey";
ALTER TABLE "Run" DROP CONSTRAINT "Run_actorUserId_fkey";
ALTER TABLE "Run" ADD CONSTRAINT "Run_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ConversationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Run" ADD CONSTRAINT "Run_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
