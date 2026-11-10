import { centsToDecimal, formatCents } from "@/lib/money";
import { materialConflict } from "@/lib/ledger/engine";
import type { Derivation, Fact } from "@/lib/ledger/types";
import type { UnitOfMeasure } from "@/lib/ledger/types";

export type InvoiceLine = {
  id: string;
  name: string;
  description: string;
  quantity: string;
  unitCents: number;
  amountCents: number;
  unitOfMeasure: UnitOfMeasure;
  evidenceIds: string[];
  changed: boolean;
};

export type InvoiceDraft = {
  invoiceNumber: string;
  invoiceDate: string;
  currency: "USD";
  note: string;
  reference: string;
  lines: InvoiceLine[];
  totalCents: number;
  blockedReason: string | null;
};

export const INVOICE_REFERENCE = "JOB-NORTHLINE-LIGHTING";

function lineAmount(quantity: string, unitCents: number): number {
  if (!/^\d+$/.test(quantity)) {
    throw new Error(`Quantity ${quantity} is not a whole number.`);
  }
  return Number(quantity) * unitCents;
}

function changedAmount(previous: InvoiceDraft | null | undefined, id: string, amountCents: number): boolean {
  if (!previous) return false;
  const prior = previous.lines.find((line) => line.id === id);
  return !prior || prior.amountCents !== amountCents;
}

export function buildInvoice(input: {
  facts: Fact[];
  derivation: Derivation;
  invoiceNumber: string;
  invoiceDate: string;
  previous?: InvoiceDraft | null;
}): InvoiceDraft {
  const { facts, derivation, invoiceNumber, invoiceDate, previous } = input;
  const labor = derivation.byId.labor;
  const materials = derivation.byId.materials;
  const freight = derivation.byId.freight;
  const total = derivation.byId.total;
  const unsupported = [labor, materials, freight, total].filter((node) => !node.supported);

  if (unsupported.length > 0 || total.valueCents === null) {
    return {
      invoiceNumber,
      invoiceDate,
      currency: "USD",
      note: "",
      reference: INVOICE_REFERENCE,
      lines: [],
      totalCents: 0,
      blockedReason: unsupported.map((node) => node.reason).join(" "),
    };
  }

  const lines: InvoiceLine[] = [];
  const hours = facts.find((fact) => fact.id === "labor_hours");
  const rate = facts.find((fact) => fact.id === "labor_rate");
  if (!hours || !rate || labor.valueCents === null) {
    throw new Error("Labor is supported but its facts are missing.");
  }
  lines.push({
    id: "labor",
    name: "Gallery lighting labor",
    description: `${hours.value} hours from timesheet ${hours.receiptId} at ${formatCents(rate.value)} per hour on rate card ${rate.receiptId}.`,
    quantity: String(hours.value),
    unitCents: rate.value,
    amountCents: labor.valueCents,
    unitOfMeasure: "HOURS",
    evidenceIds: ["labor_hours", "labor_rate"],
    changed: changedAmount(previous, "labor", labor.valueCents),
  });

  if (materials.formula === "stamped supplier total") {
    const stamp = facts.find((fact) => fact.role === "supplier_total" && fact.status === "active");
    if (!stamp || materials.valueCents === null) {
      throw new Error("Materials follow a stamp that is not active.");
    }
    lines.push({
      id: "materials-stamp",
      name: "Volt & Co. materials",
      description: `Stamped total on receipt ${stamp.receiptId}. Line items on that receipt are not billed while the stamp is active.`,
      quantity: "1",
      unitCents: stamp.value,
      amountCents: materials.valueCents,
      unitOfMeasure: "QUANTITY",
      evidenceIds: [stamp.id],
      changed: changedAmount(previous, "materials-stamp", materials.valueCents),
    });
  } else {
    for (const factId of materials.dependsOn) {
      const fact = facts.find((item) => item.id === factId);
      if (!fact?.line) throw new Error(`Material fact ${factId} has no line.`);
      const amountCents = lineAmount(fact.line.quantity, fact.line.unitCents);
      if (amountCents !== fact.value) {
        throw new Error(`Material fact ${fact.id} does not match its line extension.`);
      }
      lines.push({
        id: fact.id,
        name: fact.line.name,
        description:
          materials.pass === "recomputed"
            ? `Volt & Co. receipt ${fact.receiptId}. Billed because the stamped total was retracted.`
            : `Volt & Co. receipt ${fact.receiptId} line item.`,
        quantity: fact.line.quantity,
        unitCents: fact.line.unitCents,
        amountCents,
        unitOfMeasure: fact.line.unitOfMeasure,
        evidenceIds: [fact.id],
        changed: changedAmount(previous, fact.id, amountCents),
      });
    }
  }

  const freightFact = facts.find((fact) => fact.role === "freight" && fact.status === "active");
  if (!freightFact || freight.valueCents === null) {
    throw new Error("Freight is supported but the carrier fact is missing.");
  }
  lines.push({
    id: "freight",
    name: "Delivery",
    description: `Redcart Freight receipt ${freightFact.receiptId}, delivery to Northline Studio.`,
    quantity: "1",
    unitCents: freightFact.value,
    amountCents: freight.valueCents,
    unitOfMeasure: "QUANTITY",
    evidenceIds: [freightFact.id],
    changed: changedAmount(previous, "freight", freight.valueCents),
  });

  const summed = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (summed !== total.valueCents) {
    throw new Error(`Invoice lines sum to ${summed} cents but the ledger total is ${total.valueCents}.`);
  }

  return {
    invoiceNumber,
    invoiceDate,
    currency: "USD",
    note: invoiceNote(total.valueCents, facts),
    reference: INVOICE_REFERENCE,
    lines,
    totalCents: total.valueCents,
    blockedReason: null,
  };
}

export function invoiceNote(totalCents: number, facts: Fact[]): string {
  const conflict = materialConflict(facts);
  if (conflict) {
    return `Gallery lighting for Northline Studio. Total ${formatCents(totalCents)}. Materials use Volt & Co. receipt R-441 stamped total ${formatCents(conflict.stampCents)}. Line items on R-441 sum to ${formatCents(conflict.lineSumCents)} (gap ${formatCents(conflict.gapCents)}, cancelled change order CO-19) and are not billed while that stamp is active. Labor is timesheet TS-188 at rate card RC-2026. Freight is Redcart receipt R-442.`;
  }
  return `Revised PayPal invoice for Northline Studio gallery lighting. Retracted the Volt & Co. stamped total on R-441. Materials recomputed from the remaining line items. Labor and freight were not recomputed. Total ${formatCents(totalCents)}.`;
}

export function invoiceSignature(invoice: InvoiceDraft): string {
  const lines = invoice.lines
    .map((line) => `${line.id}:${line.quantity}:${line.amountCents}`)
    .join("|");
  return `${invoice.totalCents}|${invoice.note}|${lines}`;
}

export function paypalDecimal(cents: number): string {
  return centsToDecimal(cents);
}
