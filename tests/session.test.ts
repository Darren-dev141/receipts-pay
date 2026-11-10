import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAMP_FACT_ID } from "@/lib/ledger/demo-case";
import { DRAFT_TOTAL_CENTS, REVISED_TOTAL_CENTS } from "@/lib/ledger/demo-case";
import { paypalDecimal } from "@/lib/invoice/plan";
import { toPayPalInvoiceParams, readPaypalInvoice } from "@/lib/paypal/invoice-body";
import { decimalToCents } from "@/lib/money";
import { createMockGateway, resolvePaypalMode } from "@/lib/paypal/mode";
import {
  SessionError,
  cancelCurrentInvoice,
  draftInvoice,
  loadSession,
  resetSession,
  retractAndRevise,
  sendCurrentInvoice,
  type Deps,
} from "@/lib/session/service";
import { createFileStore, createMemoryStore } from "@/lib/session/store";

function harness(store: Deps["store"] = createMemoryStore()) {
  const gateway = createMockGateway();
  const deps: Deps = {
    now: () => new Date("2026-11-10T18:00:00.000Z"),
    gateway,
    mode: "mock",
    warning: null,
    recipientEmail: "buyer@northline.test",
    store,
    invoiceNumber: "RP-NORTHLINE-001",
  };
  return { deps, gateway, store };
}

describe("agent session", () => {
  it("drafts $440, revises to $275, and only then updates PayPal", async () => {
    const { deps, gateway } = harness();
    const ready = await loadSession(deps);
    expect(ready.phase).toBe("ready");
    expect(ready.facts).toEqual([]);
    expect(ready.actions.canDraft).toBe(true);

    const drafted = await draftInvoice(deps);
    expect(drafted.invoice?.totalCents).toBe(DRAFT_TOTAL_CENTS);
    expect(drafted.paypal?.status).toBe("DRAFT");
    expect(drafted.paypal?.lastTool).toBe("create_invoice");
    expect(drafted.paypal?.id).toBe("MOCK-INV-1001");
    expect(drafted.conflict?.gapCents).toBe(16_500);
    expect(drafted.nodes.every((node) => node.evaluations === 1)).toBe(true);

    const revised = await retractAndRevise(deps, STAMP_FACT_ID);
    expect(revised.invoice?.totalCents).toBe(REVISED_TOTAL_CENTS);
    expect(revised.revision).toMatchObject({ fromCents: DRAFT_TOTAL_CENTS, toCents: REVISED_TOTAL_CENTS });
    expect(revised.paypal?.lastTool).toBe("update_invoicing");
    expect(revised.paypal?.totalCents).toBe(REVISED_TOTAL_CENTS);
    expect(gateway.calls).toEqual(["create_invoice", "update_invoicing:silent"]);

    const byId = Object.fromEntries(revised.nodes.map((node) => [node.id, node]));
    expect(byId.labor).toMatchObject({ pass: "held", evaluations: 1, display: "$125.00" });
    expect(byId.freight).toMatchObject({ pass: "held", evaluations: 1, display: "$40.00" });
    expect(byId.materials).toMatchObject({
      pass: "recomputed",
      evaluations: 2,
      display: "$110.00",
      formula: "sum of material line items",
    });
    expect(byId.total).toMatchObject({ pass: "recomputed", evaluations: 2, display: "$275.00" });
    expect(revised.invoice?.lines.map((line) => line.amountCents)).toEqual([12_500, 8_000, 3_000, 4_000]);
    expect(revised.trail.some((beat) => beat.title === "Labor held")).toBe(true);
    expect(revised.trail.some((beat) => beat.title === "Freight held")).toBe(true);
    expect(revised.trail.some((beat) => beat.detail.includes("update_invoicing"))).toBe(true);
  });

  it("keeps the billed total when a line that is not on the invoice is retracted", async () => {
    const { deps, gateway } = harness();
    await draftInvoice(deps);
    const next = await retractAndRevise(deps, "led_panels");
    expect(next.paypal?.totalCents).toBe(DRAFT_TOTAL_CENTS);
    expect(next.facts.find((fact) => fact.id === "led_panels")?.status).toBe("retracted");
    expect(next.nodes.find((node) => node.id === "materials")).toMatchObject({
      pass: "held",
      evaluations: 1,
      display: "$275.00",
    });
    expect(next.nodes.find((node) => node.id === "total")?.pass).toBe("held");
    expect(gateway.calls[0]).toBe("create_invoice");
    expect(gateway.calls.at(-1)).toBe("update_invoicing:silent");
  });

  it("refuses to revise PayPal when retraction leaves a number unsupported", async () => {
    const { deps, gateway, store } = harness();
    await draftInvoice(deps);
    await expect(retractAndRevise(deps, "labor_rate")).rejects.toBeInstanceOf(SessionError);
    expect(gateway.calls).toEqual(["create_invoice"]);
    const stored = store.read();
    expect(stored?.facts.find((fact) => fact.id === "labor_rate")?.status).toBe("active");
    expect(stored?.paypal?.totalCents).toBe(DRAFT_TOTAL_CENTS);
  });

  it("sends a draft and cancels it after send", async () => {
    const { deps, gateway } = harness();
    await draftInvoice(deps);
    await retractAndRevise(deps, STAMP_FACT_ID);
    const sent = await sendCurrentInvoice(deps);
    expect(sent.paypal?.status).toBe("SENT");
    expect(sent.phase).toBe("sent");
    const cancelled = await cancelCurrentInvoice(deps);
    expect(cancelled.paypal?.status).toBe("CANCELLED");
    expect(cancelled.paypal?.lastTool).toBe("cancel_sent_invoice");
    expect(gateway.calls).toEqual([
      "create_invoice",
      "update_invoicing:silent",
      "send_invoice",
      "cancel_sent_invoice",
    ]);
  });

  it("deletes a draft instead of cancelling it", async () => {
    const { deps } = harness();
    await draftInvoice(deps);
    const deleted = await cancelCurrentInvoice(deps);
    expect(deleted.paypal?.status).toBe("DELETED");
    expect(deleted.paypal?.lastTool).toBe("delete_invoice");
    expect(deleted.actions.canDraft).toBe(false);
  });

  it("notifies the recipient when a sent invoice is revised", async () => {
    const { deps, gateway } = harness();
    await draftInvoice(deps);
    await sendCurrentInvoice(deps);
    await retractAndRevise(deps, STAMP_FACT_ID);
    expect(gateway.calls).toContain("update_invoicing:notify");
  });

  it("builds a PayPal invoice body whose line extensions equal the ledger total", async () => {
    const { deps, store } = harness();
    const drafted = await draftInvoice(deps);
    const state = store.read();
    const params = toPayPalInvoiceParams(state!.invoice!, {
      recipientEmail: "buyer@northline.test",
    });
    expect(params.currency_code).toBe("USD");
    expect(params.invoice_number).toBe("RP-NORTHLINE-001");
    expect(params.invoice_date).toBe("2026-11-10");
    expect(params.primary_recipients[0].billing_info.email_address).toBe("buyer@northline.test");
    expect(params.invoicer_business_name).toBe("Harbor Fieldwork");
    const total = params.items.reduce((sum, item) => {
      return sum + Math.round(decimalToCents(item.unit_amount.value)! * Number(item.quantity));
    }, 0);
    expect(total).toBe(drafted.invoice?.totalCents);
    expect(params.items[0].unit_amount.value).toBe(paypalDecimal(2_500));
    expect(params.items[0].quantity).toBe("5");
    expect(params.theme_color).toBe("#1F4D3A");
  });
});

describe("paypal mode", () => {
  it("stays in mock mode without credentials and refuses live", () => {
    const mock = resolvePaypalMode({});
    expect(mock).toMatchObject({ mode: "mock" });
    if ("warning" in mock) expect(mock.warning).toMatch(/Mock mode/);

    const partial = resolvePaypalMode({ PAYPAL_CLIENT_ID: "id-only" });
    expect(partial).toMatchObject({ mode: "mock" });
    if ("warning" in partial) expect(partial.warning).toMatch(/missing/);

    const sandbox = resolvePaypalMode({
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
      PAYPAL_RECIPIENT_EMAIL: "sb-buyer@personal.example.com",
    });
    expect(sandbox).toMatchObject({ mode: "sandbox", recipientEmail: "sb-buyer@personal.example.com" });

    const live = resolvePaypalMode({
      PAYPAL_ENVIRONMENT: "live",
      PAYPAL_CLIENT_ID: "client",
      PAYPAL_CLIENT_SECRET: "secret",
    });
    expect(live).toHaveProperty("error");
  });

  it("reads an invoice id from a PayPal create response", () => {
    expect(
      readPaypalInvoice({
        rel: "self",
        href: "https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST-ID",
        method: "GET",
      }),
    ).toMatchObject({ id: "INV2-TEST-ID" });
  });

  it("round-trips the session file", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "receipts-pay-"));
    const file = path.join(directory, "session.json");
    const { deps, store } = harness(createFileStore(file));
    await draftInvoice(deps);
    const reloaded = createFileStore(file).read();
    expect(reloaded?.paypal?.totalCents).toBe(DRAFT_TOTAL_CENTS);
    await resetSession(deps);
    expect(store.read()?.phase).toBe("ready");
  });
});
