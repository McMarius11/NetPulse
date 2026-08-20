import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-svh place-items-center bg-bg px-6 text-fg">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-surface p-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">NetPulse</p>
          <h1 className="mt-1 text-xl font-medium">Anmelden</h1>
          <p className="mt-1 text-sm text-muted">Optional. Die Diagnose-Tools funktionieren auch ohne Konto.</p>
        </div>
        {authEnabled ? (
          <div className="space-y-2">
            {GROK_PROVIDERS.map((p) => (
              <Button
                key={p.providerId}
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              >
                Weiter mit {p.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Anmeldung ist deaktiviert.</p>
        )}
        <a href="/" className="block text-center text-sm text-muted hover:text-fg">
          Zurück zur Diagnose
        </a>
      </div>
    </main>
  );
}
