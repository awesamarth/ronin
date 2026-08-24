import { authorizeMutation } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  const unauthorized = await authorizeMutation(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json()) as { orgId?: string; profile?: string };
    const orgId = body.orgId?.trim();
    const profile = body.profile?.trim() ?? "";
    if (!orgId) return NextResponse.json({ error: "orgId is required." }, { status: 400 });
    if (profile.length > 8_000) return NextResponse.json({ error: "Profile must be 8,000 characters or less." }, { status: 400 });

    await prisma.$transaction([
      prisma.org.update({ where: { id: orgId }, data: { profile: profile || null } }),
      prisma.auditLog.create({
        data: {
          orgId,
          actorType: "operator",
          action: "org.profile_updated",
          target: orgId,
          metadata: JSON.stringify({ characters: profile.length }),
        },
      }),
    ]);
    revalidatePath("/");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Organization profile update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
