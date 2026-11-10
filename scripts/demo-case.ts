import { createMockGateway } from "@/lib/paypal/mode";
import { createMemoryStore } from "@/lib/session/store";
import {
  cancelCurrentInvoice,
  draftInvoice,
  retractAndRevise,
  sendCurrentInvoice,
  type Deps,
} from "@/lib/session/service";
import { DRAFT_TOTAL_CENTS, REVISED_TOTAL_CENTS, STAMP_FACT_ID } from "@/lib/ledger/demo-case";

const gateway = createMockGateway();
const deps: Deps = {
  now: () => new Date("2026-11-10T18:00:00.000Z"),
  gateway,
  mode: "mock",
  warning: null,
  recipientEmail: "buyer@northline.test",
  store: createMemoryStore(),
  invoiceNumber: "RP-NORTHLINE-001",
};

async function main() {
  const drafted = await draftInvoice(deps);
  if (drafted.invoice?.totalCents !== DRAFT_TOTAL_CENTS) {
    console.error(`Expected draft total ${DRAFT_TOTAL_CENTS}, got ${drafted.invoice?.totalCents}`);
    process.exit(1);
  }

  const revised = await retractAndRevise(deps, STAMP_FACT_ID);
  if (revised.invoice?.totalCents !== REVISED_TOTAL_CENTS) {
    console.error(`Expected revised total ${REVISED_TOTAL_CENTS}, got ${revised.invoice?.totalCents}`);
    process.exit(1);
  }

  const labor = revised.nodes.find((node) => node.id === "labor");
  const materials = revised.nodes.find((node) => node.id === "materials");
  const freight = revised.nodes.find((node) => node.id === "freight");
  const total = revised.nodes.find((node) => node.id === "total");
  if (
    labor?.pass !== "held" ||
    freight?.pass !== "held" ||
    labor?.evaluations !== 1 ||
    freight?.evaluations !== 1
  ) {
    console.error("Labor or freight was recomputed.");
    process.exit(1);
  }
  if (
    materials?.pass !== "recomputed" ||
    total?.pass !== "recomputed" ||
    materials?.evaluations !== 2 ||
    total?.evaluations !== 2
  ) {
    console.error("Materials or total did not recompute.");
    process.exit(1);
  }

  console.log("Receipts Pay demo case");
  console.log(
    `Draft ${drafted.invoice?.totalDisplay} via ${drafted.paypal?.lastTool} ${drafted.paypal?.id} (${drafted.paypal?.status})`,
  );
  console.log(
    `Revised ${revised.invoice?.totalDisplay} via ${revised.paypal?.lastTool} ${revised.paypal?.id} (${revised.paypal?.status})`,
  );
  console.log(
    `Materials ${materials?.display} recomputed. Labor ${labor?.display} held. Freight ${freight?.display} held.`,
  );
  console.log("");
  for (const beat of revised.trail) {
    console.log(beat.title);
    console.log(`  ${beat.detail}`);
  }

  const sent = await sendCurrentInvoice(deps);
  const closed = await cancelCurrentInvoice(deps);
  console.log("");
  console.log(`Sent ${sent.paypal?.status}, then ${closed.paypal?.lastTool} → ${closed.paypal?.status}.`);
  console.log(`PayPal tools: ${gateway.calls.join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
