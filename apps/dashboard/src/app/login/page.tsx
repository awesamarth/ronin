import { getOperatorSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getOperatorSession()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <section className="w-full max-w-md border border-ronin-border bg-ronin-background/95 p-7">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-ronin-muted">Operator access</p>
        <h1 className="mt-3 font-ronin-display text-6xl leading-none">Ronin</h1>
        <p className="mt-5 text-sm leading-6 text-ronin-muted">
          Sign in with an allowlisted GitHub account to open the operator console.
        </p>
        {error ? <p className="mt-4 border border-ronin-danger p-3 text-sm text-ronin-danger">Authentication failed.</p> : null}
        <a className="ronin-button ronin-button-primary mt-6 w-full" href="/api/auth/github">
          Continue with GitHub
        </a>
      </section>
    </main>
  );
}
