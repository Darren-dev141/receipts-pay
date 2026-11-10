import type { InvoiceDraft } from "@/lib/invoice/plan";
import type { Derivation, Fact, FactStatus, NodeId, NodePass, Receipt } from "@/lib/ledger/types";
import type { PayPalSnapshot } from "@/lib/paypal/invoice-body";

export type Phase = "ready" | "drafted" | "revised" | "sent" | "cancelled";

export type TrailTone = "info" | "conflict" | "recomputed" | "held" | "paypal" | "error";

export type TrailEntry = {
  id: string;
  at: string;
  tone: TrailTone;
  title: string;
  detail: string;
};

export type PublicFact = {
  id: string;
  receiptId: string;
  label: string;
  display: string;
  status: FactStatus;
  support: string;
  role: Fact["role"];
};

export type PublicNode = {
  id: NodeId;
  label: string;
  display: string;
  supported: boolean;
  formula: string;
  evaluations: number;
  pass: NodePass;
  reason: string;
  dependsOn: { id: string; label: string; status: FactStatus }[];
};

export type PublicLine = {
  id: string;
  name: string;
  description: string;
  quantity: string;
  unitDisplay: string;
  amountDisplay: string;
  amountCents: number;
  evidence: string[];
  changed: boolean;
  unitOfMeasure: "QUANTITY" | "HOURS";
};

export type PublicSession = {
  mode: "mock" | "sandbox";
  warning: string | null;
  error: string | null;
  phase: Phase;
  receipts: Receipt[];
  facts: PublicFact[];
  nodes: PublicNode[];
  conflict: {
    stampDisplay: string;
    lineSumDisplay: string;
    gapDisplay: string;
    gapCents: number;
  } | null;
  invoice: {
    invoiceNumber: string;
    invoiceDate: string;
    note: string;
    lines: PublicLine[];
    totalCents: number;
    totalDisplay: string;
    blockedReason: string | null;
  } | null;
  paypal: (PayPalSnapshot & { totalDisplay: string }) | null;
  trail: TrailEntry[];
  stampFactId: string;
  revision: { fromDisplay: string; toDisplay: string; fromCents: number; toCents: number } | null;
  actions: {
    canDraft: boolean;
    canRetractStamp: boolean;
    canSend: boolean;
    canCancel: boolean;
    cancelLabel: string;
  };
};

export type SessionState = {
  phase: Phase;
  facts: Fact[];
  derivation: Derivation | null;
  invoice: InvoiceDraft | null;
  paypal: PayPalSnapshot | null;
  trail: TrailEntry[];
  error: string | null;
  mode: "mock" | "sandbox";
  notice: string | null;
  revision: { fromCents: number; toCents: number } | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
};
