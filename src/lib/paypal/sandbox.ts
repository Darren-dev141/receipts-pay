import { decimalToCents, formatCents } from "@/lib/money";
import type { PayPalGateway } from "@/lib/paypal/gateway";
import {
  isDraftStatus,
  isSentStatus,
  paypalErrorMessage,
  readPaypalInvoice,
  type PayPalInvoiceParams,
  type PayPalSnapshot,
} from "@/lib/paypal/invoice-body";

type RunnableTool = {
  execute?: (input: unknown) => Promise<unknown>;
};

type ToolkitBundle = {
  tools: Record<string, RunnableTool>;
  baseUrl: string;
};

let bundlePromise: Promise<ToolkitBundle> | null = null;

async function toolkit(): Promise<ToolkitBundle> {
  if (!bundlePromise) {
    bundlePromise = loadToolkit();
  }
  return bundlePromise;
}

async function loadToolkit(): Promise<ToolkitBundle> {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("PayPal sandbox credentials are not set.");
  }
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/ai-sdk");
  const agent = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      actions: {
        invoices: {
          create: true,
          update: true,
          send: true,
          cancel: true,
          delete: true,
          get: true,
        },
      },
      context: { sandbox: true },
    },
  });
  const baseUrl = agent.client.getBaseUrl();
  if (!baseUrl.includes("sandbox.paypal.com")) {
    throw new Error(`Refusing to call PayPal at ${baseUrl}. Receipts Pay is sandbox-only.`);
  }
  return { tools: agent.getTools() as Record<string, RunnableTool>, baseUrl };
}

async function callTool(name: string, args: unknown): Promise<unknown> {
  const { tools } = await toolkit();
  const tool = tools[name];
  if (!tool?.execute) {
    throw new Error(`PayPal Agent Toolkit did not enable ${name}.`);
  }
  try {
    return await tool.execute(args);
  } catch (error) {
    throw new Error(paypalErrorMessage(error));
  }
}

function billedCents(params: PayPalInvoiceParams): number {
  return params.items.reduce((sum, item) => {
    const unit = decimalToCents(item.unit_amount.value);
    const quantity = Number(item.quantity);
    if (unit === null || !Number.isFinite(quantity)) {
      throw new Error(`PayPal item ${item.name} has an amount the ledger cannot read.`);
    }
    return sum + Math.round(unit * quantity);
  }, 0);
}

function amountWarning(totalCents: number, paypalAmount: string | undefined): string | null {
  if (!paypalAmount) return null;
  const reported = decimalToCents(paypalAmount);
  if (reported === null || reported !== totalCents) {
    return `PayPal reported ${paypalAmount}, which does not match the ledger total ${formatCents(totalCents)}.`;
  }
  return null;
}

async function readBack(id: string, fallback: PayPalSnapshot): Promise<PayPalSnapshot> {
  try {
    const raw = await callTool("get_invoice", { invoice_id: id });
    const parsed = readPaypalInvoice(raw);
    return {
      ...fallback,
      status: parsed.status ?? fallback.status,
      paypalAmount: parsed.amount ?? fallback.paypalAmount,
      href: parsed.href ?? fallback.href,
      amountWarning: amountWarning(fallback.totalCents, parsed.amount),
    };
  } catch (error) {
    return {
      ...fallback,
      amountWarning: `PayPal accepted the change, but reading the invoice back failed: ${paypalErrorMessage(error)}`,
    };
  }
}

export function createSandboxGateway(): PayPalGateway {
  return {
    mode: "sandbox",
    async create(params) {
      const created = readPaypalInvoice(await callTool("create_invoice", params));
      if (!created.id) {
        throw new Error("PayPal created an invoice but did not return an id.");
      }
      const totalCents = billedCents(params);
      return readBack(created.id, {
        mode: "sandbox",
        id: created.id,
        status: created.status ?? "DRAFT",
        invoiceNumber: params.invoice_number,
        totalCents,
        paypalAmount: created.amount ?? null,
        lastTool: "create_invoice",
        href: created.href ?? null,
        recipientEmail: params.primary_recipients[0].billing_info.email_address,
        amountWarning: amountWarning(totalCents, created.amount),
      });
    },
    async update(current, params, notify) {
      const updated = readPaypalInvoice(
        await callTool("update_invoicing", {
          resource_type: "invoice",
          invoice_update: {
            ...params,
            invoice_id: current.id,
            send_to_recipient: notify,
            send_to_invoicer: notify,
          },
        }),
      );
      const totalCents = billedCents(params);
      return readBack(updated.id ?? current.id, {
        mode: "sandbox",
        id: updated.id ?? current.id,
        status: updated.status ?? current.status,
        invoiceNumber: params.invoice_number,
        totalCents,
        paypalAmount: updated.amount ?? null,
        lastTool: "update_invoicing",
        href: updated.href ?? null,
        recipientEmail: params.primary_recipients[0].billing_info.email_address,
        amountWarning: amountWarning(totalCents, updated.amount),
      });
    },
    async send(current) {
      await callTool("send_invoice", {
        invoice_id: current.id,
        send_to_recipient: true,
        note: "Invoice from Harbor Fieldwork for the Northline Studio lighting install.",
      });
      const read = await readBack(current.id, { ...current, status: "SENT", lastTool: "send_invoice" });
      return { ...current, ...read, lastTool: "send_invoice", totalCents: current.totalCents };
    },
    async cancelOrDelete(current) {
      const existing = readPaypalInvoice(await callTool("get_invoice", { invoice_id: current.id }));
      const status = existing.status ?? current.status;
      if (isDraftStatus(status)) {
        await callTool("delete_invoice", { invoice_id: current.id });
        return {
          ...current,
          status: "DELETED",
          lastTool: "delete_invoice",
          href: existing.href ?? current.href,
          paypalAmount: existing.amount ?? current.paypalAmount,
        };
      }
      if (isSentStatus(status)) {
        await callTool("cancel_sent_invoice", {
          invoice_id: current.id,
          send_to_recipient: true,
          note: "This invoice was cancelled after a receipt correction.",
        });
        return {
          ...current,
          status: "CANCELLED",
          lastTool: "cancel_sent_invoice",
          href: existing.href ?? current.href,
          paypalAmount: existing.amount ?? current.paypalAmount,
        };
      }
      throw new Error(
        `PayPal invoice ${current.id} is ${status || "in an unknown status"} and cannot be cancelled from here.`,
      );
    },
  };
}
