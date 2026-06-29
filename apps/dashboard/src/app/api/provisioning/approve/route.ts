import { approveLatestProvisioningPlan } from "@/lib/provisioning";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const run = await approveLatestProvisioningPlan();

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
    const message = error instanceof Error ? error.message : "Provisioning approval failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
