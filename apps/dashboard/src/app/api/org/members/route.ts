import { authorizeOrgRequest, permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

const roles = new Set(["owner", "admin", "member", "external"]);
const statuses = new Set(["active", "suspended"]);

export async function GET(request: Request) {
  const auth = await authorizeOrgRequest(request, permissions.dashboardRead);
  if (!auth.ok) return auth.response;
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId: auth.org.orgId },
    include: { user: { include: { identities: { select: { provider: true, login: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({
    memberships: memberships.map((membership) => ({
      userId: membership.userId,
      displayName: membership.user.displayName,
      identities: membership.user.identities,
      role: membership.role,
      status: membership.status,
    })),
  });
}

export async function PATCH(request: Request) {
  const auth = await authorizeOrgRequest(request, permissions.membersManage);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { userId?: string; role?: string; status?: string } | null;
  if (!body?.userId || (body.role && !roles.has(body.role)) || (body.status && !statuses.has(body.status))) {
    return Response.json({ error: "Valid userId, role, and status are required." }, { status: 400 });
  }
  const userId = body.userId;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`membership:${auth.org.orgId}`}))`;
    const [actor, target] = await Promise.all([
      tx.orgMembership.findUnique({ where: { orgId_userId: { orgId: auth.org.orgId, userId: auth.operator.session.id } } }),
      tx.orgMembership.findUnique({ where: { orgId_userId: { orgId: auth.org.orgId, userId } } }),
    ]);
    if (!actor || !target) return { error: "Membership not found.", status: 404 as const };
    if (actor.role !== "owner" && (target.role === "owner" || target.role === "admin" || body.role === "owner" || body.role === "admin")) {
      return { error: "Only owners can manage owners and admins.", status: 403 as const };
    }
    const removesOwner = target.role === "owner" && (Boolean(body.role && body.role !== "owner") || body.status === "suspended");
    if (removesOwner) {
      const activeOwners = await tx.orgMembership.count({ where: { orgId: auth.org.orgId, role: "owner", status: "active" } });
      if (activeOwners <= 1) return { error: "An organization must retain at least one active owner.", status: 409 as const };
    }

    const membership = await tx.orgMembership.update({
      where: { id: target.id },
      data: { ...(body.role ? { role: body.role } : {}), ...(body.status ? { status: body.status } : {}) },
    });
    await tx.auditLog.create({
      data: {
        orgId: auth.org.orgId,
        actorType: "user",
        actorId: auth.operator.session.id,
        action: "org.membership_updated",
        target: userId,
        metadata: JSON.stringify({ from: { role: target.role, status: target.status }, to: { role: membership.role, status: membership.status } }),
      },
    });
    return { membership };
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, membership: { userId: result.membership.userId, role: result.membership.role, status: result.membership.status } });
}
