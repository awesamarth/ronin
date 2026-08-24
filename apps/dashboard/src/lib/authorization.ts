import { getOperatorSession, validateRequestOrigin, type OperatorSession } from "./auth";
import { prisma } from "./prisma";

export const permissions = {
  dashboardRead: "dashboard.read",
  orgManage: "org.manage",
  membersManage: "members.manage",
  integrationsManage: "integrations.manage",
  reposManage: "repos.manage",
  runsExecute: "runs.execute",
  prsCreate: "prs.create",
  supportInternal: "support.internal",
  supportExternal: "support.external",
} as const;

export type Permission = (typeof permissions)[keyof typeof permissions];
export type OrgRole = "owner" | "admin" | "member" | "external";

const rolePermissions: Record<OrgRole, ReadonlySet<Permission>> = {
  owner: new Set(Object.values(permissions)),
  admin: new Set(Object.values(permissions)),
  member: new Set([
    permissions.dashboardRead,
    permissions.runsExecute,
    permissions.prsCreate,
    permissions.supportInternal,
    permissions.supportExternal,
  ]),
  external: new Set([permissions.supportExternal]),
};

export type OperatorContext = {
  session: OperatorSession;
  memberships: Array<{ orgId: string; orgName: string; orgSlug: string; role: OrgRole }>;
  activeMembership: { orgId: string; orgName: string; orgSlug: string; role: OrgRole } | null;
};

export function roleHasPermission(role: string, permission: Permission) {
  return isOrgRole(role) && rolePermissions[role].has(permission);
}

export async function getOperatorContext(): Promise<OperatorContext | null> {
  const session = await getOperatorSession();
  if (!session) return null;

  if (session.id === "development") {
    const org = process.env.RONIN_DEV_ORG_SLUG
      ? await prisma.org.findUnique({ where: { slug: process.env.RONIN_DEV_ORG_SLUG } })
      : await onlyOrg();
    const storedMembership = org
      ? await prisma.orgMembership.findFirst({ where: { orgId: org.id, status: "active", role: { in: ["owner", "admin"] } }, orderBy: { createdAt: "asc" } })
      : null;
    const membership = org ? { orgId: org.id, orgName: org.name, orgSlug: org.slug, role: (storedMembership?.role === "admin" ? "admin" : "owner") as OrgRole } : null;
    return {
      session: storedMembership ? { ...session, id: storedMembership.userId, activeOrgId: org?.id } : session,
      memberships: membership ? [membership] : [],
      activeMembership: membership,
    };
  }

  const memberships = await prisma.orgMembership.findMany({
    where: { userId: session.id, status: "active" },
    include: { org: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const normalized = memberships
    .filter((membership): membership is typeof membership & { role: OrgRole } => isOrgRole(membership.role))
    .map((membership) => ({
      orgId: membership.org.id,
      orgName: membership.org.name,
      orgSlug: membership.org.slug,
      role: membership.role,
    }));
  const requestedOrgId = session.activeOrgId;
  const activeMembership =
    (requestedOrgId ? normalized.find((membership) => membership.orgId === requestedOrgId) : null) ??
    (normalized.length === 1 ? normalized[0] : null) ??
    null;

  return { session, memberships: normalized, activeMembership };
}

export async function authorizeOrgRequest(request: Request, permission: Permission) {
  const originError = validateRequestOrigin(request);
  if (originError) return { ok: false as const, response: originError };
  const operator = await getOperatorContext();
  if (!operator) {
    return { ok: false as const, response: Response.json({ ok: false, error: "Authentication required." }, { status: 401 }) };
  }
  if (!operator.activeMembership) {
    return { ok: false as const, response: Response.json({ ok: false, error: "Select an organization first." }, { status: 403 }) };
  }
  if (!roleHasPermission(operator.activeMembership.role, permission)) {
    return { ok: false as const, response: Response.json({ ok: false, error: "Permission denied." }, { status: 403 }) };
  }
  return { ok: true as const, operator, org: operator.activeMembership };
}

export async function authorizeSlackActor(input: {
  orgId: string;
  appTeamId: string;
  userId: string;
  profileTeamId?: string;
  displayName?: string;
  avatarUrl?: string;
  isGuest: boolean;
  accessMode: "internal" | "external";
}) {
  const user = await upsertUserIdentity({
    provider: "slack",
    providerAccountId: `${input.profileTeamId ?? input.appTeamId}:${input.userId}`,
    login: input.userId,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
  });
  let membership = await prisma.orgMembership.findUnique({ where: { orgId_userId: { orgId: input.orgId, userId: user.id } } });
  if (!membership) {
    const isHomeMember = input.profileTeamId === input.appTeamId && !input.isGuest;
    const role = isHomeMember ? "member" : input.accessMode === "external" ? "external" : null;
    if (!role) throw new Error("This Slack user is not authorized for the connected organization.");
    membership = await prisma.orgMembership.upsert({
      where: { orgId_userId: { orgId: input.orgId, userId: user.id } },
      create: { orgId: input.orgId, userId: user.id, role },
      update: {},
    });
  }
  if (membership.status !== "active") throw new Error("This organization membership is suspended.");
  const permission = input.accessMode === "external" ? permissions.supportExternal : permissions.supportInternal;
  if (!roleHasPermission(membership.role, permission)) throw new Error("This Slack user is not permitted in this conversation.");
  return { userId: user.id, role: membership.role, permission };
}

export async function authorizeTelegramActor(input: {
  orgId: string;
  botUsername: string;
  userId: string;
  displayName?: string;
  accessMode: "internal" | "external";
}) {
  const user = await upsertUserIdentity({
    provider: "telegram",
    providerAccountId: `${input.botUsername}:${input.userId}`,
    login: input.userId,
    displayName: input.displayName,
  });
  let membership = await prisma.orgMembership.findUnique({ where: { orgId_userId: { orgId: input.orgId, userId: user.id } } });
  if (!membership) {
    membership = await prisma.orgMembership.upsert({
      where: { orgId_userId: { orgId: input.orgId, userId: user.id } },
      create: { orgId: input.orgId, userId: user.id, role: input.accessMode === "internal" ? "member" : "external" },
      update: {},
    });
  }
  if (membership.status !== "active") throw new Error("This Telegram user is not authorized for the connected organization.");
  const permission = input.accessMode === "external" ? permissions.supportExternal : permissions.supportInternal;
  if (!roleHasPermission(membership.role, permission)) throw new Error("This Telegram user is not permitted in this conversation.");
  return { userId: user.id, role: membership.role, permission };
}

export async function upsertUserIdentity(input: {
  provider: string;
  providerAccountId: string;
  login?: string;
  displayName?: string;
  avatarUrl?: string;
}) {
  const identity = await prisma.userIdentity.upsert({
    where: { provider_providerAccountId: { provider: input.provider, providerAccountId: input.providerAccountId } },
    update: {
      login: input.login,
      user: { update: { displayName: input.displayName, avatarUrl: input.avatarUrl } },
    },
    create: {
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      login: input.login,
      user: { create: { displayName: input.displayName, avatarUrl: input.avatarUrl } },
    },
    include: { user: { include: { memberships: true } } },
  });
  return identity.user;
}

function isOrgRole(role: string): role is OrgRole {
  return role === "owner" || role === "admin" || role === "member" || role === "external";
}

async function onlyOrg() {
  const orgs = await prisma.org.findMany({ take: 2, orderBy: { createdAt: "asc" } });
  return orgs.length === 1 ? orgs[0] : null;
}
