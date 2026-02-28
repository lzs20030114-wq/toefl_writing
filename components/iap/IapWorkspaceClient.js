"use client";

import { useEffect, useMemo, useState } from "react";
import LoginGate from "../LoginGate";
import { C, FONT } from "../shared/ui";

function money(priceCents, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
    }).format(Number(priceCents || 0) / 100);
  } catch {
    return `${currency || "USD"} ${(Number(priceCents || 0) / 100).toFixed(2)}`;
  }
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function Block({ title, children }) {
  return (
    <section style={{ background: "#fff", border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 16, color: C.nav }}>{title}</h2>
      {children}
    </section>
  );
}

function ApiMsg({ msg, ok }) {
  if (!msg) return null;
  return <div style={{ marginTop: 8, color: ok ? "#166534" : C.red, fontSize: 12 }}>{msg}</div>;
}

function Workspace({ userCode }) {
  const [config, setConfig] = useState(null);
  const [products, setProducts] = useState([]);
  const [entitlements, setEntitlements] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(true);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  async function loadConfig() {
    const res = await fetch("/api/iap/config", { cache: "no-store" });
    const body = await parseJsonSafe(res);
    if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
    setConfig(body);
  }

  async function loadProducts() {
    const res = await fetch("/api/iap/products", { cache: "no-store" });
    const body = await parseJsonSafe(res);
    if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
    const list = Array.isArray(body?.products) ? body.products : [];
    setProducts(list);
    if (!selectedProductId && list[0]?.id) setSelectedProductId(list[0].id);
  }

  async function loadEntitlements() {
    const q = new URLSearchParams({ userCode: String(userCode || "").trim() }).toString();
    const res = await fetch(`/api/iap/entitlements?${q}`, { cache: "no-store" });
    const body = await parseJsonSafe(res);
    if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
    setEntitlements(Array.isArray(body?.entitlements) ? body.entitlements : []);
  }

  async function bootstrap() {
    setBusy(true);
    setMsg("");
    try {
      await Promise.all([loadConfig(), loadProducts(), loadEntitlements()]);
    } catch (e) {
      setMsgOk(false);
      setMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCode]);

  async function createCheckout() {
    if (!selectedProductId) return;
    setBusy(true);
    setMsg("");
    try {
      const payload = {
        userCode,
        productId: selectedProductId,
        successUrl: "/iap",
        cancelUrl: "/iap",
        metadata: { source: "iap_workspace" },
      };
      const res = await fetch("/api/iap/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await parseJsonSafe(res);
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      setMsgOk(true);
      setMsg(`Checkout created: ${body?.checkout?.checkoutId || "-"}`);
    } catch (e) {
      setMsgOk(false);
      setMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function simulateWebhook() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/iap/mock-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userCode,
          productId: selectedProductId,
        }),
      });
      const body = await parseJsonSafe(res);
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      setMsgOk(true);
      setMsg(`Webhook processed: event ${body?.eventId || "-"}${body?.granted ? " (granted)" : ""}`);
      await loadEntitlements();
    } catch (e) {
      setMsgOk(false);
      setMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <div style={{ background: C.nav, color: "#fff", padding: "0 20px", height: 48, display: "flex", alignItems: "center", borderBottom: "3px solid " + C.navDk }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>IAP Workspace</span>
        <span style={{ opacity: 0.5, margin: "0 12px" }}>|</span>
        <span style={{ fontSize: 12 }}>user: {userCode || "-"}</span>
      </div>

      <main style={{ maxWidth: 920, margin: "24px auto", padding: "0 20px" }}>
        <Block title="IAP Config">
          <div style={{ fontSize: 13, color: C.t2 }}>Enabled: <b style={{ color: C.t1 }}>{String(config?.enabled)}</b></div>
          <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>Provider: <b style={{ color: C.t1 }}>{String(config?.provider || "-")}</b></div>
          <div style={{ fontSize: 13, color: C.t2, marginTop: 4 }}>Mock Webhook Simulation: <b style={{ color: C.t1 }}>{String(config?.allowMockWebhookSimulation)}</b></div>
        </Block>

        <Block title="Products">
          {products.length === 0 ? (
            <div style={{ fontSize: 13, color: C.t2 }}>No active products</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {products.map((p) => {
                const selected = selectedProductId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProductId(p.id)}
                    style={{
                      textAlign: "left",
                      border: "1px solid " + (selected ? C.blue : C.bdr),
                      background: selected ? "#eff6ff" : "#fff",
                      borderRadius: 8,
                      padding: 10,
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.t1 }}>{p.title}</div>
                    <div style={{ fontSize: 12, color: C.t2, marginTop: 2 }}>{p.description}</div>
                    <div style={{ fontSize: 13, color: C.nav, marginTop: 6 }}>{money(p.priceCents, p.currency)} / {p.interval}</div>
                  </button>
                );
              })}
            </div>
          )}
        </Block>

        <Block title="Checkout and Entitlements">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={createCheckout} disabled={busy || !selectedProduct} style={{ border: "1px solid " + C.blue, background: C.blue, color: "#fff", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontFamily: FONT }}>
              Create Checkout
            </button>
            <button onClick={simulateWebhook} disabled={busy || !selectedProduct} style={{ border: "1px solid #92400e", background: "#fef3c7", color: "#92400e", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontFamily: FONT }}>
              Simulate Webhook
            </button>
            <button onClick={loadEntitlements} disabled={busy} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontFamily: FONT }}>
              Refresh Entitlements
            </button>
          </div>
          <ApiMsg msg={msg} ok={msgOk} />
          <div style={{ marginTop: 10, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, marginBottom: 6 }}>Current Entitlements</div>
            {entitlements.length === 0 ? (
              <div style={{ fontSize: 12, color: C.t2 }}>No entitlements yet.</div>
            ) : (
              entitlements.map((e) => (
                <div key={e.id} style={{ fontSize: 12, color: C.t2, padding: "6px 0", borderBottom: "1px dashed #e2e8f0" }}>
                  <b style={{ color: C.t1 }}>{e.productId}</b> | {e.status} | provider={e.provider} | grantedAt={e.grantedAt || "-"}
                </div>
              ))
            )}
          </div>
        </Block>

        <button onClick={bootstrap} disabled={busy} style={{ border: "1px solid #cbd5e1", background: "#fff", color: C.t2, borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontFamily: FONT }}>
          {busy ? "Loading..." : "Reload All"}
        </button>
      </main>
    </div>
  );
}

export default function IapWorkspaceClient() {
  return (
    <LoginGate>
      {({ userCode }) => <Workspace userCode={userCode || "DEV000"} />}
    </LoginGate>
  );
}

