import { authorizeOrgRequest, permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  const auth = await authorizeOrgRequest(request, permissions.orgManage);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { orgId?: string; profile?: string };
    if (body.orgId && body.orgId !== auth.org.orgId) return NextResponse.json({ error: "Organization mismatch." }, { status: 403 });
    const profile = body.profile?.trim() ?? "";
    if (profile.length > 8_000) return NextResponse.json({ error: "Profile must be 8,000 characters or less." }, { status: 400 });

    await prisma.$transaction([
      prisma.org.update({ where: { id: auth.org.orgId }, data: { profile: profile || null } }),
      prisma.auditLog.create({
        data: {
          orgId: auth.org.orgId,
          actorType: "user",
          actorId: auth.operator.session.id,
          action: "org.profile_updated",
          target: auth.org.orgId,
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
