import { authorizeMutation } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

const harnesses = new Set(["pi", "codex", "claudecode", "amp", "nanocodex", "hermes"]);
const reasoningLevels = new Set(["", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await authorizeMutation(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { harnessType?: unknown; model?: unknown; provider?: unknown; reasoning?: unknown } | null;
  if (!body || Object.values(body).some((value) => value !== undefined && typeof value !== "string")) {
    return Response.json({ error: "Invalid agent settings." }, { status: 400 });
  }
  const settings = body as { harnessType?: string; model?: string; provider?: string; reasoning?: string };
  const harnessType = settings.harnessType?.trim().toLowerCase() || "pi";
  const reasoning = settings.reasoning?.trim().toLowerCase() || "";
  const model = settings.model?.trim() || null;
  const provider = settings.provider?.trim() || null;
  if (!harnesses.has(harnessType)) return Response.json({ error: "Unsupported harness." }, { status: 400 });
  if (!reasoningLevels.has(reasoning)) return Response.json({ error: "Unsupported reasoning level." }, { status: 400 });
  if ((model?.length ?? 0) > 200 || (provider?.length ?? 0) > 200) return Response.json({ error: "Agent setting is too long." }, { status: 400 });

  const repo = await prisma.repository.update({
    where: { id },
    data: {
      harnessType,
      model,
      provider,
      reasoning: reasoning || null,
    },
  });
  await prisma.auditLog.create({
    data: {
      action: "repository.agent_configured",
      actorType: "operator",
      orgId: repo.orgId,
      repoId: repo.id,
      target: repo.fullName,
      metadata: JSON.stringify({ harnessType, model: repo.model, provider: repo.provider, reasoning: repo.reasoning }),
    },
  });
  revalidatePath("/");
  return Response.json({ ok: true });
}
