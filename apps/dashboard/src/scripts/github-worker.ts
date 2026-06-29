import "dotenv/config";

import { processQueuedGithubRun } from "../lib/github-run-processor";
import { prisma } from "../lib/prisma";

const pollMs = Number(process.env.RONIN_GITHUB_WORKER_POLL_MS ?? 5000);
const staleRunningMs = Number(process.env.RONIN_GITHUB_WORKER_STALE_RUNNING_MS ?? 120000);
let isShuttingDown = false;

async function main() {
  console.log(
    JSON.stringify({
      event: "github.worker_started",
      pollMs,
      staleRunningMs,
    }),
  );

  while (!isShuttingDown) {
    const run = await nextRunnableGithubRun();
    if (!run) {
      await sleep(pollMs);
      continue;
    }

    console.log(JSON.stringify({ event: "github.worker_processing", runId: run.id, status: run.status }));
    try {
      const processed = await processQueuedGithubRun(run.id);
      console.log(
        JSON.stringify({
          event: "github.worker_completed",
          repo: processed?.repo?.fullName,
          runId: run.id,
          status: processed?.status,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : "GitHub worker processing failed.",
          event: "github.worker_failed",
          runId: run.id,
        }),
      );
    }
  }
}

async function nextRunnableGithubRun() {
  const staleBefore = new Date(Date.now() - staleRunningMs);
  return prisma.run.findFirst({
    orderBy: {
      createdAt: "asc",
    },
    where: {
      kind: {
        startsWith: "github.",
      },
      OR: [
        { status: "queued" },
        {
          status: "running",
          completedAt: null,
          createdAt: {
            lt: staleBefore,
          },
        },
      ],
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(signal: string) {
  isShuttingDown = true;
  console.log(`Received ${signal}; stopping GitHub worker.`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
