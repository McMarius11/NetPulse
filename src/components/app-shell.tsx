import { useState } from "react";
import { Activity, FileUp, Globe, LayoutGrid, Map, Plug, Timer } from "lucide-react";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { PageAnalyzer } from "@/components/page-analyzer";
import { UrlTiming } from "@/components/url-timing";
import { DnsBench } from "@/components/dns-bench";
import { Monitor } from "@/components/monitor";
import { TcpCheckPanel } from "@/components/tcp-check";
import { HarLab } from "@/components/har-lab";
import { CrawlPanel } from "@/components/crawl-panel";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "page", label: "Seitenanalyse", icon: LayoutGrid },
  { id: "har", label: "HAR", icon: FileUp },
  { id: "crawl", label: "Crawl", icon: Map },
  { id: "timing", label: "URL-Timing", icon: Timer },
  { id: "dns", label: "DNS", icon: Globe },
  { id: "monitor", label: "Monitor", icon: Activity },
  { id: "tcp", label: "TCP", icon: Plug },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AppShell() {
  const [tab, setTab] = useState<TabId>("page");
  const { isPending } = useCurrentUserState();

  return (
    <div className="min-h-svh bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-subtle">Netzwerk</p>
            <h1 className="text-lg font-medium tracking-tight">NetPulse</h1>
          </div>
          <div className="flex items-center gap-3">
            {isPending ? (
              <div className="size-8 animate-pulse rounded-full bg-surface-2" />
            ) : (
              <>
                <SignedOut>
                  <a href="/login" className="text-sm text-muted hover:text-fg">
                    Anmelden
                  </a>
                </SignedOut>
                <SignedIn>
                  <UserButton />
                </SignedIn>
              </>
            )}
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm",
                  active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                <Icon className="size-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {tab === "page" && <PageAnalyzer />}
        {tab === "har" && <HarLab />}
        {tab === "crawl" && <CrawlPanel />}
        {tab === "timing" && <UrlTiming />}
        {tab === "dns" && <DnsBench />}
        {tab === "monitor" && <Monitor />}
        {tab === "tcp" && <TcpCheckPanel />}
      </main>
    </div>
  );
}
