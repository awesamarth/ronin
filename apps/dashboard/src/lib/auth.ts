import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "ronin_session";
export const OAUTH_STATE_COOKIE = "ronin_oauth_state";

export type OperatorSession = {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  activeOrgId?: string;
};

function authDisabled() {
  const disabled = process.env.RONIN_AUTH_DISABLED === "true";
  if (disabled && process.env.NODE_ENV === "production") {
    throw new Error("RONIN_AUTH_DISABLED cannot be enabled in production.");
  }
  return disabled;
}

function secret() {
  const value = process.env.RONIN_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("RONIN_SESSION_SECRET must be at least 32 characters.");
  return new TextEncoder().encode(value);
}

export function allowedGithubLogin(login: string) {
  const allowed = process.env.RONIN_ALLOWED_GITHUB_USERS?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return !allowed?.length || allowed.includes(login.toLowerCase());
}

export async function signOperatorSession(operator: OperatorSession, expiresIn = "12h") {
  return new SignJWT({ ...operator, token_use: "ronin_session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

export async function verifyOperatorSession(token: string): Promise<OperatorSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.token_use !== "ronin_session" || typeof payload.id !== "string" || typeof payload.login !== "string") return null;
    return {
      id: payload.id,
      login: payload.login,
      name: typeof payload.name === "string" ? payload.name : undefined,
      avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined,
      activeOrgId: typeof payload.activeOrgId === "string" ? payload.activeOrgId : undefined,
    };
  } catch {
    return null;
  }
}

export async function signOAuthState(nonce: string, pendingInstallationId?: string) {
  return new SignJWT({ nonce, pendingInstallationId, token_use: "ronin_oauth_state" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret());
}

export async function verifyOAuthState(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.token_use !== "ronin_oauth_state" || typeof payload.nonce !== "string") return null;
    return {
      nonce: payload.nonce,
      pendingInstallationId: typeof payload.pendingInstallationId === "string" ? payload.pendingInstallationId : undefined,
    };
  } catch {
    return null;
  }
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  if (authDisabled()) return { id: "development", login: "development" };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifyOperatorSession(token) : null;
}

export async function authorizeMutation(request: Request): Promise<Response | null> {
  if (!(await getOperatorSession())) {
    return Response.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }
  return validateRequestOrigin(request);
}

export function validateRequestOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.RONIN_BASE_URL || request.url).origin;
  return origin && origin !== expected
    ? Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 })
    : null;
}

export function secureCookie() {
  return process.env.NODE_ENV === "production";
}
