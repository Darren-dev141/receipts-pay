import { buildInvoice, invoiceSignature } from "@/lib/invoice/plan";
import { formatCents, formatInvoiceDate } from "@/lib/money";
import { DEMO_RECEIPTS, STAMP_FACT_ID, demoFacts } from "@/lib/ledger/demo-case";
import { derive, findFact, materialConflict, retractFact } from "@/lib/ledger/engine";
import type { Fact } from "@/lib/ledger/types";
import type { PayPalGateway } from "@/lib/paypal/gateway";
import { isDraftStatus, isSentStatus, toPayPalInvoiceParams } from "@/lib/paypal/invoice-body";
import { draftStory, retractionStory, type StoryBeat } from "@/lib/session/explain";
import type { Store } from "@/lib/session/store";
import type { Phase, PublicSession, SessionState, TrailEntry } from "@/lib/session/types";

export class SessionError extends Error {
  status: number;
  session: PublicSession | null;

  constructor(message: string, status: number, session: PublicSession | null = null) {
    super(message);
    this.name = "SessionError";
    this.status = status;
    this.session = session;
  }
}

export type Deps = {
  now: () => Date;
  gateway: PayPalGateway;
  mode: "mock" | "sandbox";
  warning: string | null;
  recipientEmail: string;
  invoicerEmail?: string;
  store: Store;
  invoiceNumber?: string;
};

function freshState(deps: Deps): SessionState {
  return {
    phase: "ready",
    facts: demoFacts(),
    derivation: null,
    invoice: null,
    paypal: null,
    trail: [],
    error: null,
    mode: deps.mode,
    notice: null,
    revision: null,
    invoiceNumber: null,
    invoiceDate: null,
  };
}

function loadState(deps: Deps): SessionState {
  return deps.store.read() ?? freshState(deps);
}

function save(deps: Deps, state: SessionState): SessionState {
  deps.store.write(state);
  return state;
}

function parties(deps: Deps) {
  return { recipientEmail: deps.recipientEmail, invoicerEmail: deps.invoicerEmail };
}

function withBeats(state: SessionState, deps: Deps, beats: StoryBeat[]): TrailEntry[] {
  const at = deps.now().toISOString();
  return [
    ...state.trail,
    ...beats.map((beat, index) => ({
      id: `t${state.trail.length + index + 1}`,
      at,
      ...beat,
    })),
  ];
}

function assertMode(state: SessionState, deps: Deps): void {
  if (state.paypal && state.mode !== deps.mode) {
    throw new SessionError(
      `This invoice was created in ${state.mode} mode and the server is now in ${deps.mode} mode. Reset, then draft again.`,
      409,
      toPublic(state, deps),
    );
  }
}

function factDisplay(fact: Fact): string {
  if (fact.role === "labor_hours") return `${fact.value} hours`;
  return formatCents(fact.value);
}

export function toPublic(state: SessionState, deps: Deps): PublicSession {
  const paypal = state.paypal;
  const mismatch =
    paypal && state.mode !== deps.mode
      ? `Invoice ${paypal.id} belongs to ${state.mode} mode. Reset before drafting in ${deps.mode} mode.`
      : null;
  const warning = [deps.warning, state.notice, mismatch].filter(Boolean).join(" ") || null;
  const conflict = state.derivation ? materialConflict(state.facts) : null;
  const stamp = state.facts.find((fact) => fact.id === STAMP_FACT_ID);
  const live = paypal && (isDraftStatus(paypal.status) || isSentStatus(paypal.status));

  return {
    mode: deps.mode,
    warning,
    error: state.error,
    phase: state.phase,
    receipts: DEMO_RECEIPTS,
    facts: state.derivation
      ? state.facts.map((fact) => ({
          id: fact.id,
          receiptId: fact.receiptId,
          label: fact.label,
          display: factDisplay(fact),
          status: fact.status,
          support: fact.support,
          role: fact.role,
        }))
      : [],
    nodes: state.derivation
      ? state.derivation.nodes.map((node) => ({
          id: node.id,
          label: node.label,
          display: node.valueCents === null ? "Unsupported" : formatCents(node.valueCents),
          supported: node.supported,
          formula: node.formula,
          evaluations: node.evaluations,
          pass: node.pass,
          reason: node.reason,
          dependsOn: node.dependsOn.map((id) => {
            const fact = state.facts.find((item) => item.id === id);
            return {
              id,
              label: fact?.label ?? id,
              status: fact?.status ?? "retracted",
            };
          }),
        }))
      : [],
    conflict: conflict
      ? {
          stampDisplay: formatCents(conflict.stampCents),
          lineSumDisplay: formatCents(conflict.lineSumCents),
          gapDisplay: formatCents(conflict.gapCents),
          gapCents: conflict.gapCents,
        }
      : null,
    invoice: state.invoice
      ? {
          invoiceNumber: state.invoice.invoiceNumber,
          invoiceDate: state.invoice.invoiceDate,
          note: state.invoice.note,
          totalCents: state.invoice.totalCents,
          totalDisplay: formatCents(state.invoice.totalCents),
          blockedReason: state.invoice.blockedReason,
          lines: state.invoice.lines.map((line) => ({
            id: line.id,
            name: line.name,
            description: line.description,
            quantity: line.quantity,
            unitDisplay:
              line.unitOfMeasure === "HOURS"
                ? `${formatCents(line.unitCents)} / hour`
                : formatCents(line.unitCents),
            amountDisplay: formatCents(line.amountCents),
            amountCents: line.amountCents,
            evidence: line.evidenceIds.map((id) => state.facts.find((fact) => fact.id === id)?.label ?? id),
            changed: line.changed,
            unitOfMeasure: line.unitOfMeasure,
          })),
        }
      : null,
    paypal: paypal
      ? {
          ...paypal,
          totalDisplay: formatCents(paypal.totalCents),
        }
      : null,
    trail: state.trail,
    stampFactId: STAMP_FACT_ID,
    revision: state.revision
      ? {
          fromCents: state.revision.fromCents,
          toCents: state.revision.toCents,
          fromDisplay: formatCents(state.revision.fromCents),
          toDisplay: formatCents(state.revision.toCents),
        }
      : null,
    actions: {
      canDraft: state.phase === "ready",
      canRetractStamp: Boolean(live && stamp?.status === "active" && state.derivation),
      canSend: Boolean(paypal && isDraftStatus(paypal.status)),
      canCancel: Boolean(live),
      cancelLabel:
        paypal && isDraftStatus(paypal.status)
          ? "Delete PayPal draft"
          : paypal && isSentStatus(paypal.status)
            ? "Cancel sent invoice"
            : "Cancel invoice",
    },
  };
}

function phaseAfterPaypal(status: string, stampRetracted: boolean): Phase {
  if (status === "DELETED" || status === "CANCELLED") return "cancelled";
  if (isSentStatus(status)) return "sent";
  if (stampRetracted) return "revised";
  return "drafted";
}

export async function loadSession(deps: Deps): Promise<PublicSession> {
  const existing = deps.store.read();
  const state = existing ?? save(deps, freshState(deps));
  return toPublic(state, deps);
}

export async function draftInvoice(deps: Deps): Promise<PublicSession> {
  const state = loadState(deps);
  if (state.phase !== "ready") {
    throw new SessionError("Reset the demo before creating another PayPal invoice.", 409, toPublic(state, deps));
  }
  const derivation = derive(state.facts);
  const invoiceNumber = deps.invoiceNumber ?? `RP-${formatInvoiceDate(deps.now()).replaceAll("-", "")}-${deps.now().getTime().toString(36).toUpperCase()}`;
  const invoiceDate = formatInvoiceDate(deps.now());
  const invoice = buildInvoice({ facts: state.facts, derivation, invoiceNumber, invoiceDate });
  if (invoice.blockedReason || !invoice.lines.length) {
    throw new SessionError(invoice.blockedReason || "The ledger could not build an invoice.", 409, toPublic(state, deps));
  }
  const paypal = await callPaypal(state, deps, () =>
    deps.gateway.create(toPayPalInvoiceParams(invoice, parties(deps))),
  );
  const conflict = materialConflict(state.facts);
  const next = save(deps, {
    ...state,
    phase: "drafted",
    derivation,
    invoice,
    paypal,
    mode: deps.mode,
    error: null,
    invoiceNumber,
    invoiceDate,
    revision: null,
    trail: withBeats(state, deps, [
      ...draftStory(state.facts, derivation, conflict),
      {
        tone: "paypal",
        title: "Created the PayPal invoice",
        detail: `Tool create_invoice on the ${deps.mode === "sandbox" ? "PayPal sandbox" : "mock PayPal account"}. Invoice ${paypal.id} is ${paypal.status}. Total ${formatCents(paypal.totalCents)}.`,
      },
    ]),
  });
  return toPublic(next, deps);
}

export async function retractAndRevise(deps: Deps, factId: string): Promise<PublicSession> {
  const state = loadState(deps);
  assertMode(state, deps);
  if (!state.derivation || !state.invoice || !state.paypal) {
    throw new SessionError("Draft the PayPal invoice before retracting a fact.", 409, toPublic(state, deps));
  }
  if (!isDraftStatus(state.paypal.status) && !isSentStatus(state.paypal.status)) {
    throw new SessionError("This PayPal invoice is closed. Reset the demo to start again.", 409, toPublic(state, deps));
  }
  const fact = namedFact(state, deps, factId);
  if (fact.status === "retracted") {
    throw new SessionError(`${fact.label} is already retracted.`, 409, toPublic(state, deps));
  }
  const facts = retractFact(state.facts, factId);
  const derivation = derive(facts, state.derivation);
  const invoice = buildInvoice({
    facts,
    derivation,
    invoiceNumber: state.invoice.invoiceNumber,
    invoiceDate: state.invoice.invoiceDate,
    previous: state.invoice,
  });
  if (invoice.blockedReason) {
    throw new SessionError(
      `Did not revise the PayPal invoice. ${invoice.blockedReason}`,
      409,
      toPublic(state, deps),
    );
  }

  const beats = retractionStory(fact, state.derivation, derivation);
  let paypal = state.paypal;
  if (invoiceSignature(invoice) !== invoiceSignature(state.invoice)) {
    const notify = isSentStatus(state.paypal.status);
    paypal = await callPaypal(state, deps, () =>
      deps.gateway.update(state.paypal!, toPayPalInvoiceParams(invoice, parties(deps)), notify),
    );
    beats.push({
      tone: "paypal",
      title: "Revised the PayPal invoice",
      detail: `Tool update_invoicing replaced invoice ${paypal.id}. Total ${formatCents(paypal.totalCents)}. Status ${paypal.status}. ${notify ? "PayPal will notify the recipient." : "The draft was updated without sending a notice."}`,
    });
  } else {
    beats.push({
      tone: "held",
      title: "PayPal invoice unchanged",
      detail: `No billed amount depends on ${fact.label}. Invoice ${paypal.id} stays ${formatCents(paypal.totalCents)}.`,
    });
  }

  const stampRetracted = facts.find((item) => item.id === STAMP_FACT_ID)?.status === "retracted";
  const revision =
    state.invoice.totalCents !== invoice.totalCents
      ? { fromCents: state.invoice.totalCents, toCents: invoice.totalCents }
      : state.revision;
  const next = save(deps, {
    ...state,
    facts,
    derivation,
    invoice,
    paypal,
    revision,
    error: null,
    phase: phaseAfterPaypal(paypal.status, stampRetracted),
    trail: withBeats(state, deps, beats),
  });
  return toPublic(next, deps);
}

export async function sendCurrentInvoice(deps: Deps): Promise<PublicSession> {
  const state = loadState(deps);
  assertMode(state, deps);
  if (!state.paypal || !state.invoice) {
    throw new SessionError("There is no PayPal invoice to send.", 409, toPublic(state, deps));
  }
  if (!isDraftStatus(state.paypal.status)) {
    throw new SessionError("Only a draft invoice can be sent.", 409, toPublic(state, deps));
  }
  const paypal = await callPaypal(state, deps, () => deps.gateway.send(state.paypal!));
  const next = save(deps, {
    ...state,
    paypal: { ...state.paypal, ...paypal, totalCents: state.paypal.totalCents, invoiceNumber: state.paypal.invoiceNumber },
    phase: "sent",
    error: null,
    trail: withBeats(state, deps, [
      {
        tone: "paypal",
        title: "Sent the PayPal invoice",
        detail: `Tool send_invoice. ${paypal.id} is now ${paypal.status}. The recipient is ${state.paypal.recipientEmail}.`,
      },
    ]),
  });
  return toPublic(next, deps);
}

export async function cancelCurrentInvoice(deps: Deps): Promise<PublicSession> {
  const state = loadState(deps);
  assertMode(state, deps);
  if (!state.paypal) {
    throw new SessionError("There is no PayPal invoice to cancel.", 409, toPublic(state, deps));
  }
  const paypal = await callPaypal(state, deps, () => deps.gateway.cancelOrDelete(state.paypal!));
  const deleted = paypal.status === "DELETED";
  const next = save(deps, {
    ...state,
    paypal: {
      ...state.paypal,
      ...paypal,
      totalCents: state.paypal.totalCents,
      invoiceNumber: state.paypal.invoiceNumber,
      recipientEmail: state.paypal.recipientEmail,
    },
    phase: "cancelled",
    error: null,
    trail: withBeats(state, deps, [
      {
        tone: "paypal",
        title: deleted ? "Deleted the PayPal draft" : "Cancelled the sent invoice",
        detail: deleted
          ? `Tool delete_invoice. PayPal only cancels invoices that have been sent, so draft ${paypal.id} was deleted.`
          : `Tool cancel_sent_invoice. ${paypal.id} is ${paypal.status}.`,
      },
    ]),
  });
  return toPublic(next, deps);
}

export async function resetSession(deps: Deps): Promise<PublicSession> {
  const state = loadState(deps);
  const leftover =
    state.paypal && state.mode === "sandbox" && isSentStatus(state.paypal.status)
      ? `Left sent sandbox invoice ${state.paypal.id} in the PayPal account. Cancel it there if the buyer should not pay it.`
      : null;
  const next = save(deps, { ...freshState(deps), notice: leftover });
  return toPublic(next, deps);
}

function namedFact(state: SessionState, deps: Deps, factId: string): Fact {
  try {
    return findFact(state.facts, factId);
  } catch {
    throw new SessionError(`No receipt fact with id ${factId}.`, 400, toPublic(state, deps));
  }
}

async function callPaypal<T>(state: SessionState, deps: Deps, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "PayPal request failed.";
    throw new SessionError(message, 502, toPublic(state, deps));
  }
}
