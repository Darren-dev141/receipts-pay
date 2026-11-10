import { decimalToCents, formatCents } from "@/lib/money";
import type { PayPalGateway } from "@/lib/paypal/gateway";
import {
  PLACEHOLDER_RECIPIENT_EMAIL,
  type PayPalInvoiceParams,
  type PayPalSnapshot,
} from "@/lib/paypal/invoice-body";
import { isDraftStatus, isSentStatus } from "@/lib/paypal/invoice-body";

export type PaypalMode =
  | { mode: "mock" | "sandbox"; warning: string | null; recipientEmail: string; invoicerEmail?: string }
  | { error: string };

export function resolvePaypalMode(env: Record<string, string | undefined>): PaypalMode {
  const environment = (env.PAYPAL_ENVIRONMENT ?? "sandbox").trim().toLowerCase();
  if (environment !== "sandbox") {
    return {
      error:
        "Receipts Pay only talks to the PayPal sandbox. Unset PAYPAL_ENVIRONMENT or set it to sandbox. Live payments are refused.",
    };
  }

  const clientId = env.PAYPAL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() ?? "";
  const recipientEmail = env.PAYPAL_RECIPIENT_EMAIL?.trim() || PLACEHOLDER_RECIPIENT_EMAIL;
  const invoicerEmail = env.PAYPAL_INVOICER_EMAIL?.trim() || undefined;
  const warnings: string[] = [];

  if (Boolean(clientId) !== Boolean(clientSecret)) {
    warnings.push(
      "One of PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is missing, so Receipts Pay stayed in mock mode.",
    );
  }

  const mode = clientId && clientSecret ? "sandbox" : "mock";
  if (mode === "mock" && !warnings.length) {
    warnings.push(
      "Mock mode. No PayPal credentials are set. Invoices stay on this machine and are labeled mock.",
    );
  }
  if (mode === "sandbox" && recipientEmail === PLACEHOLDER_RECIPIENT_EMAIL) {
    warnings.push(
      "PAYPAL_RECIPIENT_EMAIL is still the placeholder. Set it to a PayPal sandbox personal account before sending.",
    );
  }

  return {
    mode,
    warning: warnings.join(" "),
    recipientEmail,
    invoicerEmail,
  };
}

export function createMockGateway(): PayPalGateway & { calls: string[] } {
  const calls: string[] = [];
  let sequence = 1001;

  function amountWarning(params: PayPalInvoiceParams, paypalAmount: string): string | null {
    const reported = decimalToCents(paypalAmount);
    const billed = params.items.reduce((sum, item) => {
      const unit = decimalToCents(item.unit_amount.value);
      const quantity = Number(item.quantity);
      if (unit === null || !Number.isFinite(quantity)) return sum;
      return sum + Math.round(unit * quantity);
    }, 0);
    if (reported === null || reported !== billed) {
      return `PayPal reported ${paypalAmount}, which does not match the ledger total ${formatCents(billed)}.`;
    }
    return null;
  }

  return {
    mode: "mock",
    calls,
    async create(params) {
      calls.push("create_invoice");
      const id = `MOCK-INV-${sequence++}`;
      const totalCents = params.items.reduce((sum, item) => {
        return sum + Math.round(decimalToCents(item.unit_amount.value)! * Number(item.quantity));
      }, 0);
      const paypalAmount = (totalCents / 100).toFixed(2);
      const snapshot: PayPalSnapshot = {
        mode: "mock",
        id,
        status: "DRAFT",
        invoiceNumber: params.invoice_number,
        totalCents,
        paypalAmount,
        lastTool: "create_invoice",
        href: null,
        recipientEmail: params.primary_recipients[0].billing_info.email_address,
        amountWarning: amountWarning(params, paypalAmount),
      };
      return snapshot;
    },
    async update(current, params, notify) {
      calls.push(`update_invoicing:${notify ? "notify" : "silent"}`);
      if (!isDraftStatus(current.status) && !isSentStatus(current.status)) {
        throw new Error(`Mock PayPal cannot update an invoice in status ${current.status}.`);
      }
      const totalCents = params.items.reduce((sum, item) => {
        return sum + Math.round(decimalToCents(item.unit_amount.value)! * Number(item.quantity));
      }, 0);
      const paypalAmount = (totalCents / 100).toFixed(2);
      return {
        ...current,
        invoiceNumber: params.invoice_number,
        totalCents,
        paypalAmount,
        lastTool: "update_invoicing",
        recipientEmail: params.primary_recipients[0].billing_info.email_address,
        amountWarning: amountWarning(params, paypalAmount),
      };
    },
    async send(current) {
      calls.push("send_invoice");
      if (!isDraftStatus(current.status)) {
        throw new Error("This invoice was already sent. PayPal does not send it again.");
      }
      return { ...current, status: "SENT", lastTool: "send_invoice" };
    },
    async cancelOrDelete(current) {
      if (isDraftStatus(current.status)) {
        calls.push("delete_invoice");
        return { ...current, status: "DELETED", lastTool: "delete_invoice" };
      }
      if (isSentStatus(current.status)) {
        calls.push("cancel_sent_invoice");
        return { ...current, status: "CANCELLED", lastTool: "cancel_sent_invoice" };
      }
      throw new Error(`Mock PayPal cannot cancel an invoice in status ${current.status}.`);
    },
  };
}
