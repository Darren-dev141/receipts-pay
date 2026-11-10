import { formatCents } from "@/lib/money";
import type { Derivation, Fact } from "@/lib/ledger/types";
import type { Conflict } from "@/lib/ledger/types";
import type { TrailTone } from "@/lib/session/types";

export type StoryBeat = {
  tone: TrailTone;
  title: string;
  detail: string;
};

export function draftStory(facts: Fact[], derivation: Derivation, conflict: Conflict | null): StoryBeat[] {
  const beats: StoryBeat[] = [
    {
      tone: "info",
      title: "Read the receipts",
      detail: `Asserted ${facts.length} facts from timesheet TS-188, rate card RC-2026, Volt & Co. receipt R-441, and Redcart receipt R-442.`,
    },
  ];
  if (conflict) {
    beats.push({
      tone: "conflict",
      title: "Conflict on receipt R-441",
      detail: `Line items sum to ${formatCents(conflict.lineSumCents)}. The stamped total is ${formatCents(conflict.stampCents)}. The gap is ${formatCents(conflict.gapCents)}, cancelled change order CO-19. While that stamp is active, materials follow the stamp and the line items stay unused.`,
    });
  }
  const figures = derivation.nodes
    .map((node) => {
      const value = node.valueCents === null ? "unsupported" : formatCents(node.valueCents);
      return `${node.label} ${value} (${node.formula}, evaluation ${node.evaluations})`;
    })
    .join(". ");
  beats.push({
    tone: "info",
    title: "Derived the invoice",
    detail: `${figures}.`,
  });
  return beats;
}

export function retractionStory(fact: Fact, before: Derivation, after: Derivation): StoryBeat[] {
  const beats: StoryBeat[] = [
    {
      tone: "conflict",
      title: `Retracted ${fact.label}`,
      detail: `${fact.support} That fact is retracted. Only amounts that depended on it are evaluated again.`,
    },
  ];
  for (const node of after.nodes) {
    const prior = before.byId[node.id];
    if (node.pass === "recomputed") {
      const from = prior.valueCents === null ? "unsupported" : formatCents(prior.valueCents);
      const to = node.valueCents === null ? "unsupported" : formatCents(node.valueCents);
      beats.push({
        tone: "recomputed",
        title: `${node.label} recomputed`,
        detail: `${node.label} moved from ${from} to ${to}. ${node.reason} Evaluation ${node.evaluations}.`,
      });
    }
  }
  for (const node of after.nodes) {
    if (node.pass !== "held" || node.valueCents === null) continue;
    beats.push({
      tone: "held",
      title: `${node.label} held`,
      detail: `${node.label} stayed ${formatCents(node.valueCents)}. Inputs did not change, so it was not evaluated again (still ${node.evaluations}).`,
    });
  }
  return beats;
}
