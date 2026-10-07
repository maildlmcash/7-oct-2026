import { createFileRoute } from "@tanstack/react-router";

const explorers: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
};

export const Route = createFileRoute("/api/wallets/activity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const chain = params.get("chain") ?? "";
        const address = params.get("address") ?? "";
        if (!(chain in explorers) || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return Response.json(
            { ok: false, error: "Choose Ethereum or Base and provide a valid EVM address." },
            { status: 400, headers: { "cache-control": "no-store" } },
          );
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
          const upstreamUrl = new URL(`/api/v2/addresses/${address}/transactions`, explorers[chain]);
          upstreamUrl.searchParams.set("filter", "to-or-from");
          const upstream = await fetch(upstreamUrl, {
            headers: { accept: "application/json" },
            signal: controller.signal,
          });
          if (!upstream.ok) {
            return Response.json(
              { ok: false, error: `Explorer returned HTTP ${upstream.status}.` },
              { status: 502, headers: { "cache-control": "no-store" } },
            );
          }
          const payload: unknown = await upstream.json();
          const items =
            payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
              ? (payload as { items: unknown[] }).items
              : [];
          const transactions = items.slice(0, 50).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const tx = item as Record<string, unknown>;
            if (typeof tx.hash !== "string") return [];
            const from = tx.from as Record<string, unknown> | undefined;
            const to = tx.to as Record<string, unknown> | undefined;
            return [
              {
                hash: tx.hash,
                from: typeof from?.hash === "string" ? from.hash : null,
                to: typeof to?.hash === "string" ? to.hash : null,
                timestamp: typeof tx.timestamp === "string" ? tx.timestamp : null,
                status: typeof tx.status === "string" ? tx.status : "unknown",
                method: typeof tx.method === "string" ? tx.method : null,
              },
            ];
          });
          return Response.json(
            {
              ok: true,
              chain,
              address,
              source: "Blockscout public address activity",
              observedAt: new Date().toISOString(),
              transactions,
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "AbortError";
          return Response.json(
            { ok: false, error: timedOut ? "Wallet activity request timed out." : "Explorer data is unavailable." },
            { status: 502, headers: { "cache-control": "no-store" } },
          );
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  },
});
