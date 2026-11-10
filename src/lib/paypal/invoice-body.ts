import type { InvoiceDraft } from "@/lib/invoice/plan";
import { paypalDecimal } from "@/lib/invoice/plan";

export type PayPalInvoiceItem = {
  name: string;
  description: string;
  quantity: string;
  unit_amount: { currency_code: "USD"; value: string };
  unit_of_measure: "QUANTITY" | "HOURS";
};

export type PayPalInvoiceParams = {
  currency_code: "USD";
  invoice_number: string;
  invoice_date: string;
  reference: string;
  note: string;
  invoicer_business_name: string;
  primary_recipients: [
    {
      billing_info: {
        business_name: string;
        email_address: string;
        name: { given_name: string; surname: string };
      };
    },
  ];
  items: PayPalInvoiceItem[];
  theme_color: "#1F4D3A";
  invoicer_email_address?: string;
};

export type PayPalToolName =
  | "create_invoice"
  | "update_invoicing"
  | "send_invoice"
  | "cancel_sent_invoice"
  | "delete_invoice"
  | "get_invoice";

export type PayPalSnapshot = {
  mode: "mock" | "sandbox";
  id: string;
  status: string;
  invoiceNumber: string;
  totalCents: number;
  paypalAmount: string | null;
  lastTool: PayPalToolName;
  href: string | null;
  recipientEmail: string;
  amountWarning: string | null;
};

export const INVOICER_BUSINESS = "Harbor Fieldwork";
export const RECIPIENT_BUSINESS = "Northline Studio";
export const RECIPIENT_GIVEN = "Northline";
export const RECIPIENT_SURNAME = "Studio";
export const PLACEHOLDER_RECIPIENT_EMAIL = "buyer@northline.test";
export const INVOICE_THEME = "#1F4D3A";

export function toPayPalInvoiceParams(
  invoice: InvoiceDraft,
  parties: { recipientEmail: string; invoicerEmail?: string },
): PayPalInvoiceParams {
  const params: PayPalInvoiceParams = {
    currency_code: "USD",
    invoice_number: invoice.invoiceNumber,
    invoice_date: invoice.invoiceDate,
    reference: invoice.reference,
    note: invoice.note,
    invoicer_business_name: INVOICER_BUSINESS,
    primary_recipients: [
      {
        billing_info: {
          business_name: RECIPIENT_BUSINESS,
          email_address: parties.recipientEmail,
          name: { given_name: RECIPIENT_GIVEN, surname: RECIPIENT_SURNAME },
        },
      },
    ],
    items: invoice.lines.map((line) => ({
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unit_amount: { currency_code: "USD", value: paypalDecimal(line.unitCents) },
      unit_of_measure: line.unitOfMeasure,
    })),
    theme_color: INVOICE_THEME,
  };
  if (parties.invoicerEmail) {
    params.invoicer_email_address = parties.invoicerEmail;
  }
  return params;
}

export type ParsedPaypalInvoice = {
  id?: string;
  status?: string;
  amount?: string;
  href?: string;
};

export function readPaypalInvoice(data: unknown): ParsedPaypalInvoice {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  const href = typeof record.href === "string" ? record.href : undefined;
  const links = Array.isArray(record.links) ? record.links : [];
  const self = links.find((link) => {
    return Boolean(link && typeof link === "object" && (link as { rel?: string }).rel === "self");
  }) as { href?: string } | undefined;
  const linkHref = href ?? (typeof self?.href === "string" ? self.href : undefined);
  const idFromHref = linkHref?.split("/").filter(Boolean).pop();
  const amountRecord = record.amount as { value?: unknown } | undefined;
  const dueRecord = record.due_amount as { value?: unknown } | undefined;
  const amount =
    typeof amountRecord?.value === "string"
      ? amountRecord.value
      : typeof dueRecord?.value === "string"
        ? dueRecord.value
        : undefined;
  return {
    id: typeof record.id === "string" ? record.id : idFromHref,
    status: typeof record.status === "string" ? record.status : undefined,
    amount,
    href: linkHref,
  };
}

export function isDraftStatus(status: string): boolean {
  return status === "DRAFT" || status === "SCHEDULED";
}

export function isSentStatus(status: string): boolean {
  return status === "SENT" || status === "UNPAID" || status === "PAYMENT_PENDING";
}

export function paypalErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "PayPal request failed.";
}
