import { createProvisioningPlan } from "@/lib/provisioning";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      budgetDollars?: number;
      provider?: string;
      purpose?: string;
      resource?: string;
    };

    const run = await createProvisioningPlan({
      budgetCents: Math.round(Number(body.budgetDollars ?? 5) * 100),
      provider: body.provider ?? "vercel",
      purpose: body.purpose ?? "",
      resource: body.resource ?? "",
    });

    return NextResponse.json({
      ok: true,
      run: {
        id: run?.id,
        status: run?.status,
        summary: run?.summary,
        artifacts: run?.artifacts.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provisioning plan failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
