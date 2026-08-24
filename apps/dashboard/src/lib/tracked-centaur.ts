import { runCentaurTask, type CentaurExecutionConfig, type CentaurResult } from "./centaur-client";
import { prisma } from "./prisma";

export async function runTrackedCentaurTask(input: {
  runId: string;
  purpose: "support" | "analyze" | "workspace";
  threadKey: string;
  prompt: string;
  idempotencyKey: string;
  timeoutMs?: number;
  config?: CentaurExecutionConfig;
}): Promise<CentaurResult> {
  const run = await prisma.run.findUnique({ where: { id: input.runId }, select: { orgId: true } });
  if (!run) throw new Error(`Run ${input.runId} does not exist.`);

  const execution = await prisma.agentExecution.upsert({
    where: { runId_idempotencyKey: { runId: input.runId, idempotencyKey: input.idempotencyKey } },
    create: {
      orgId: run.orgId,
      runId: input.runId,
      purpose: input.purpose,
      idempotencyKey: input.idempotencyKey,
      status: "running",
      harness: input.config?.harness,
      model: input.config?.model,
      provider: input.config?.provider,
      reasoning: input.config?.reasoning,
      startedAt: new Date(),
    },
    update: {
      status: "running",
      error: null,
      completedAt: null,
      startedAt: new Date(),
    },
  });

  try {
    const result = await runCentaurTask({
      threadKey: input.threadKey,
      prompt: input.prompt,
      idempotencyKey: input.idempotencyKey,
      timeoutMs: input.timeoutMs,
      config: input.config,
      onExecutionStarted: async ({ executionId, threadKey }) => {
        await prisma.$transaction([
          prisma.agentExecution.update({
            where: { id: execution.id },
            data: { centaurExecutionId: executionId, centaurThreadKey: threadKey },
          }),
          // Compatibility fields remain until every reader uses AgentExecution.
          prisma.run.update({
            where: { id: input.runId },
            data: { centaurExecutionId: executionId, centaurThreadKey: threadKey },
          }),
        ]);
      },
    });

    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "completed",
        backend: result.backend,
        centaurExecutionId: result.executionId,
        centaurThreadKey: result.threadKey,
        harness: result.config.harness,
        model: result.config.model,
        provider: result.config.provider,
        reasoning: result.config.reasoning,
        output: result.rawOutput,
        completedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "failed",
        error: (error instanceof Error ? error.message : "Centaur execution failed.").slice(0, 2000),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
