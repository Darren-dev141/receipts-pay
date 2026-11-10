"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PublicSession } from "@/lib/session/types";

type ErrorBody = { error?: string; session?: PublicSession | null };

export function DemoApp() {
  const [session, setSession] = useState<PublicSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const apply = useCallback((data: PublicSession | ErrorBody) => {
    if ("phase" in data && "receipts" in data) {
      setSession(data);
      return;
    }
    if (data.session) setSession(data.session);
    if (data.error) setActionError(data.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then(async (response) => {
        const data = (await response.json()) as PublicSession | ErrorBody;
        if (cancelled) return;
        if (!response.ok) {
          setLoadError("error" in data && data.error ? data.error : "The demo session did not load.");
          if ("session" in data && data.session) setSession(data.session);
          return;
        }
        apply(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("The demo server did not respond.");
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function post(path: string, label: string, body?: unknown) {
    setBusy(label);
    setActionError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await response.json()) as PublicSession | ErrorBody;
      apply(data);
      if (!response.ok) {
        setActionError(data && "error" in data && data.error ? data.error : "That action failed.");
      }
    } catch {
      setActionError("The demo server did not respond.");
    } finally {
      setBusy(null);
      setCancelOpen(false);
    }
  }

  if (!session && loadError) {
    return (
      <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
        <p className="font-display text-3xl text-foreground">Receipts Pay</p>
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-3 px-6 py-16">
        <p className="text-sm tracking-[0.18em] text-muted-foreground uppercase">Harbor Fieldwork</p>
        <h1 className="font-display text-4xl text-foreground">Loading the Northline Studio job…</h1>
        <p className="text-sm text-muted-foreground">Receipts, ledger, and the PayPal invoice will land together.</p>
      </main>
    );
  }

  const step = session.phase === "ready" ? 1 : session.phase === "drafted" ? 2 : 3;
  const banner = actionError ?? loadError;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">Harbor Fieldwork bills Northline Studio</p>
          <h1 className="font-display mt-2 text-4xl leading-none text-foreground sm:text-5xl">Receipts Pay</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            The agent drafts a PayPal invoice from the receipts below. Every number keeps its evidence. Retract the
            bad Volt &amp; Co. total and the bill moves from $440.00 to $275.00. Labor and freight stay put.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={session.mode === "sandbox" ? "default" : "outline"}>
            {session.mode === "sandbox" ? "PayPal sandbox" : "Mock mode"}
          </Badge>
          <Button variant="outline" disabled={Boolean(busy)} onClick={() => post("/api/session/reset", "Reset")}>
            {busy === "Reset" ? "Resetting…" : "Reset demo"}
          </Button>
        </div>
      </header>

      {session.warning ? (
        <p role="status" className="rounded-xl border border-amber-700/30 bg-amber-100/80 px-4 py-3 text-sm text-amber-950">
          {session.warning}
        </p>
      ) : null}
      {banner ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {banner}
        </p>
      ) : null}

      <ol className="grid gap-2 text-sm sm:grid-cols-3">
        <Step n={1} current={step} title="Draft the invoice" body="Assert the receipts and create the PayPal draft at $440.00." />
        <Step n={2} current={step} title="Retract the stamp" body="Drop the $275.00 supplier total. Materials and the total recompute." />
        <Step n={3} current={step} title="Send or cancel" body="Send the sandbox invoice, or cancel it once it has been sent." />
      </ol>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr_1fr]">
        <ReceiptColumn receipts={session.receipts} />
        <LedgerColumn session={session} />
        <InvoiceColumn
          session={session}
          busy={busy}
          onDraft={() => post("/api/session/draft", "Draft")}
          onRetract={() => post("/api/session/retract", "Retract", { factId: session.stampFactId })}
          onSend={() => post("/api/session/send", "Send")}
          onCancel={() => setCancelOpen(true)}
        />
      </section>

      <Trail trail={session.trail} />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {session.paypal?.status === "DRAFT" ? "Delete this PayPal draft?" : "Cancel the sent invoice?"}
            </DialogTitle>
            <DialogDescription>
              {session.paypal?.status === "DRAFT"
                ? "PayPal cancels invoices only after they are sent. This draft will be deleted. The receipt trail stays on this page until you reset."
                : "PayPal will mark the invoice cancelled and can email the recipient. Nothing here records a refund."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep the invoice
            </Button>
            <Button variant="destructive" disabled={Boolean(busy)} onClick={() => post("/api/session/cancel", "Cancel")}>
              {busy === "Cancel" ? "Working…" : session.actions.cancelLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Step({ n, current, title, body }: { n: number; current: number; title: string; body: string }) {
  const state = current === n ? "Now" : current > n ? "Done" : "Next";
  return (
    <li className={`rounded-xl border px-3 py-3 ${current === n ? "border-primary bg-card" : "border-border bg-card/60"}`}>
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {state} · {n}
      </p>
      <p className="mt-1 font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </li>
  );
}

function ReceiptColumn({ receipts }: { receipts: PublicSession["receipts"] }) {
  return (
    <section aria-label="Receipts" className="flex flex-col gap-3">
      <h2 className="font-display text-2xl text-foreground">Receipts</h2>
      {receipts.map((receipt) => (
        <article key={receipt.id} className="rounded-xl bg-[#f7f3ea] px-4 py-4 text-sm text-[#2a241c] shadow-sm ring-1 ring-[#d9d0c0]">
          <p className="text-[11px] tracking-[0.16em] text-[#7a6a55] uppercase">{receipt.kicker}</p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <h3 className="font-display text-xl leading-tight">{receipt.title}</h3>
            <span className="font-mono text-xs">{receipt.id}</span>
          </div>
          <p className="mt-1 text-[#5c5146]">
            {receipt.from} · {receipt.issuedOn}
          </p>
          <ul className="mt-3 space-y-1 border-t border-dashed border-[#d9d0c0] pt-3 font-mono text-[13px] leading-5">
            {receipt.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {receipt.footnote ? <p className="mt-3 text-xs leading-5 text-[#7a3b2e]">{receipt.footnote}</p> : null}
        </article>
      ))}
    </section>
  );
}

function LedgerColumn({ session }: { session: PublicSession }) {
  return (
    <section aria-label="Evidence ledger" className="flex flex-col gap-3">
      <h2 className="font-display text-2xl text-foreground">Evidence ledger</h2>
      {session.facts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-sm leading-6 text-muted-foreground">
          The agent has not read these receipts yet. Draft the invoice to assert each figure, including the conflict
          between the Volt &amp; Co. line sum and the stamped total.
        </p>
      ) : (
        <>
          {session.conflict ? (
            <p className="rounded-xl border border-amber-700/30 bg-amber-100/80 px-4 py-3 text-sm leading-6 text-amber-950">
              Receipt R-441 disagrees with itself. Lines sum to {session.conflict.lineSumDisplay}. The stamp says{" "}
              {session.conflict.stampDisplay}. Gap {session.conflict.gapDisplay}. The agent bills the stamp until you
              retract it.
            </p>
          ) : (
            <p className="rounded-xl border border-emerald-800/20 bg-emerald-100/70 px-4 py-3 text-sm leading-6 text-emerald-950">
              The stamped total is retracted. Materials now follow the line items that are still active.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {session.facts.map((fact) => (
              <li
                key={fact.id}
                className={`rounded-xl bg-card px-3 py-3 ring-1 ring-foreground/10 ${fact.status === "retracted" ? "opacity-70" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className={`font-medium ${fact.status === "retracted" ? "text-destructive line-through" : ""}`}>
                    {fact.label}
                  </p>
                  <p className="font-display text-lg tabular-nums">{fact.display}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fact.receiptId} · {fact.status === "retracted" ? "Retracted" : "Active"}
                </p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{fact.support}</p>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2">
            {session.nodes.map((node) => (
              <li key={node.id} className="rounded-xl bg-card px-3 py-3 ring-1 ring-foreground/10">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{node.label}</p>
                  <p className="font-display text-xl tabular-nums" aria-live={node.id === "total" ? "polite" : undefined}>
                    {node.display}
                  </p>
                </div>
                <p className="mt-1 text-xs tracking-wide text-muted-foreground">
                  {node.pass === "held" ? "Held" : node.pass === "recomputed" ? "Recomputed" : "First pass"} ·{" "}
                  {node.formula} · evaluation {node.evaluations}
                </p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{node.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Depends on {node.dependsOn.map((item) => item.label).join(", ") || "nothing active"}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function InvoiceColumn({
  session,
  busy,
  onDraft,
  onRetract,
  onSend,
  onCancel,
}: {
  session: PublicSession;
  busy: string | null;
  onDraft: () => void;
  onRetract: () => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const total = session.invoice?.totalDisplay ?? "$0.00";
  return (
    <section aria-label="PayPal invoice" className="flex flex-col gap-3">
      <h2 className="font-display text-2xl text-foreground">PayPal invoice</h2>
      <div className="rounded-xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">
          {session.paypal ? session.paypal.status : "Not created"}
        </p>
        <p className="font-display mt-2 text-5xl tabular-nums text-foreground" aria-live="polite">
          {session.invoice ? total : "—"}
        </p>
        {session.revision ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Revised from <span className="line-through">{session.revision.fromDisplay}</span> to {session.revision.toDisplay}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {session.invoice ? "Drafted from the stamped supplier total." : "Waiting for the agent to draft $440.00."}
          </p>
        )}
        {session.paypal ? (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Invoice</dt>
            <dd className="font-mono text-xs sm:text-sm">{session.paypal.id}</dd>
            <dt className="text-muted-foreground">Number</dt>
            <dd>{session.paypal.invoiceNumber}</dd>
            <dt className="text-muted-foreground">Last tool</dt>
            <dd className="font-mono text-xs sm:text-sm">{session.paypal.lastTool}</dd>
            <dt className="text-muted-foreground">Bill to</dt>
            <dd className="break-all">{session.paypal.recipientEmail}</dd>
          </dl>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            No PayPal invoice yet. Drafting calls <span className="font-mono text-xs">create_invoice</span>
            {session.mode === "sandbox" ? " on the PayPal sandbox." : " on the labeled mock account."}
          </p>
        )}
        {session.paypal?.amountWarning ? (
          <p role="status" className="mt-3 text-sm text-destructive">
            {session.paypal.amountWarning}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          <Button size="lg" disabled={!session.actions.canDraft || Boolean(busy)} onClick={onDraft}>
            {busy === "Draft" ? "Creating the PayPal draft…" : "Draft PayPal invoice"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            disabled={!session.actions.canRetractStamp || Boolean(busy)}
            onClick={onRetract}
          >
            {busy === "Retract" ? "Retracting and revising…" : "Retract stamped total"}
          </Button>
          <Button size="lg" variant="outline" disabled={!session.actions.canSend || Boolean(busy)} onClick={onSend}>
            {busy === "Send"
              ? "Sending…"
              : session.mode === "sandbox"
                ? "Send sandbox invoice"
                : "Send invoice (mock)"}
          </Button>
          <Button size="lg" variant="destructive" disabled={!session.actions.canCancel || Boolean(busy)} onClick={onCancel}>
            {session.actions.cancelLabel}
          </Button>
        </div>
      </div>
      {session.invoice ? (
        <div className="rounded-xl bg-card px-4 py-4 ring-1 ring-foreground/10">
          <h3 className="font-medium">Line items on the invoice</h3>
          <ul className="mt-3 flex flex-col gap-3">
            {session.invoice.lines.map((line) => (
              <li key={line.id} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">
                    {line.name}{" "}
                    {line.changed ? <span className="text-xs font-normal text-primary">revised</span> : null}
                  </p>
                  <p className="font-display tabular-nums">{line.amountDisplay}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {line.quantity} × {line.unitDisplay}
                  {line.unitOfMeasure === "HOURS" ? " · hours" : ""}
                </p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">{line.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">Evidence: {line.evidence.join(", ")}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Note on the PayPal invoice: {session.invoice.note}</p>
        </div>
      ) : null}
    </section>
  );
}

function Trail({ trail }: { trail: PublicSession["trail"] }) {
  return (
    <section aria-label="Receipt trail" className="rounded-xl bg-card px-4 py-4 ring-1 ring-foreground/10">
      <h2 className="font-display text-2xl text-foreground">Receipt trail</h2>
      {trail.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">The trail starts when the agent drafts. Each PayPal action is recorded here.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {trail.map((entry, index) => (
            <li key={entry.id} className="grid grid-cols-[auto_1fr] gap-3 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <p className="font-medium">{entry.title}</p>
                <p className="mt-1 leading-6 text-muted-foreground">{entry.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
