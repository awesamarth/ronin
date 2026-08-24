import { afterAll, describe, expect, test } from "bun:test";
import { ensureSlackInstallation, extractHostedText, HostedInferenceLimitError, reserveHostedInference } from "./hosted-inference";
import { prisma } from "./prisma";

const teamId = `T-${crypto.randomUUID()}`;

afterAll(async () => {
  await prisma.slackInstallation.deleteMany({ where: { teamId } });
  await prisma.$disconnect();
});

describe("hosted inference", () => {
  test("extracts Responses API text", () => {
    expect(extractHostedText({ output_text: "  hello  " })).toBe("hello");
    expect(extractHostedText({ output: [{ content: [{ text: "fallback" }] }] })).toBe("fallback");
  });

  test("deduplicates reservations and enforces workspace concurrency", async () => {
    if (!process.env.DATABASE_URL) return;
    const installation = await ensureSlackInstallation(teamId);
    const limits = { userPerMinute: 10, userPerDay: 10, workspacePerDay: 10, workspaceConcurrency: 1 };
    const first = await reserveHostedInference({
      installationId: installation.id,
      actorId: "U1",
      requestId: "message-1",
      limits,
    });
    const duplicate = await reserveHostedInference({
      installationId: installation.id,
      actorId: "U1",
      requestId: "message-1",
      limits,
    });

    expect(duplicate.id).toBe(first.id);
    await expect(
      reserveHostedInference({ installationId: installation.id, actorId: "U2", requestId: "message-2", limits }),
    ).rejects.toBeInstanceOf(HostedInferenceLimitError);
  });
});
