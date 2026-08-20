import { useState } from "react";
import { Loader2, Plug } from "lucide-react";
import { toast } from "sonner";
import { tcpCheckFn } from "@/lib/net/fns";
import type { TcpCheck as TcpResult } from "@/lib/net/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMs } from "@/components/format";

export function TcpCheckPanel() {
  const [host, setHost] = useState("1.1.1.1");
  const [port, setPort] = useState("443");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<TcpResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      setData(await tcpCheckFn({ data: { host, port: Number(port) } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "TCP-Check fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input value={host} onChange={(e) => setHost(e.target.value)} className="font-mono" aria-label="Host" />
        <Input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="font-mono sm:w-28"
          aria-label="Port"
          inputMode="numeric"
        />
        <Button type="submit" disabled={busy} className="sm:w-44">
          {busy ? <Loader2 className="animate-spin" /> : <Plug />}
          Prüfen
        </Button>
      </form>

      {data && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2">
            <Badge tone={data.ok ? "ok" : "bad"}>{data.ok ? "offen" : "fehlgeschlagen"}</Badge>
            <span className="font-mono text-sm">
              {data.host}:{data.port}
            </span>
          </div>
          <p className="mt-3 font-mono text-sm text-muted">
            {data.ip ?? "—"} · {formatMs(data.ms)}
          </p>
          {data.error && <p className="mt-2 text-sm text-bad">{data.error}</p>}
        </div>
      )}
    </div>
  );
}
