import { secureCookie, SESSION_COOKIE, signOperatorSession, validateRequestOrigin } from "@/lib/auth";
import { getOperatorContext } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const originError = validateRequestOrigin(request);
  if (originError) return originError;
  const operator = await getOperatorContext();
  if (!operator) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { orgId?: string } | null;
  const membership = operator.memberships.find((item) => item.orgId === body?.orgId);
  if (!membership) return Response.json({ error: "Organization membership required." }, { status: 403 });

  await prisma.user.update({ where: { id: operator.session.id }, data: { lastActiveOrgId: membership.orgId } });
  const session = await signOperatorSession({ ...operator.session, activeOrgId: membership.orgId });
  (await cookies()).set(SESSION_COOKIE, session, {
    httpOnly: true,
    maxAge: 43_200,
    path: "/",
    sameSite: "lax",
    secure: secureCookie(),
  });
  return Response.json({ ok: true });
}
