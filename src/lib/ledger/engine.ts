import { formatCents } from "@/lib/money";
import type {
  Conflict,
  Derivation,
  DerivedNode,
  Fact,
  NodeId,
} from "@/lib/ledger/types";

const NODE_ORDER: NodeId[] = ["labor", "materials", "freight", "total"];

export function findFact(facts: Fact[], id: string): Fact {
  const fact = facts.find((item) => item.id === id);
  if (!fact) {
    throw new Error(`No receipt fact with id ${id}.`);
  }
  return fact;
}

export function retractFact(facts: Fact[], factId: string): Fact[] {
  findFact(facts, factId);
  return facts.map((fact) =>
    fact.id === factId ? { ...fact, status: "retracted" } : fact,
  );
}

export function materialLineSum(facts: Fact[]): number {
  return facts
    .filter((fact) => fact.role === "material_line" && fact.status === "active")
    .reduce((sum, fact) => sum + fact.value, 0);
}

export function materialConflict(facts: Fact[]): Conflict | null {
  const stamp = facts.find((fact) => fact.role === "supplier_total");
  if (!stamp || stamp.status !== "active") return null;
  const lineSumCents = materialLineSum(facts);
  if (lineSumCents === stamp.value) return null;
  return {
    stampCents: stamp.value,
    lineSumCents,
    gapCents: stamp.value - lineSumCents,
  };
}

type Computed = Omit<DerivedNode, "evaluations" | "pass">;

function laborNode(facts: Fact[]): Computed {
  const hours = findFact(facts, "labor_hours");
  const rate = findFact(facts, "labor_rate");
  const signature = `labor|${hours.status}:${hours.value}|${rate.status}:${rate.value}`;
  const supported = hours.status === "active" && rate.status === "active";
  return {
    id: "labor",
    label: "Labor",
    valueCents: supported ? hours.value * rate.value : null,
    supported,
    dependsOn: [hours.id, rate.id],
    formula: "hours × rate",
    signature,
    reason: supported
      ? `${hours.value} hours on ${hours.receiptId} × ${formatCents(rate.value)} on ${rate.receiptId}.`
      : "Labor needs an active timesheet and an active rate card.",
  };
}

function materialsNode(facts: Fact[]): Computed {
  const stamp = facts.find((fact) => fact.role === "supplier_total");
  const lines = facts
    .filter((fact) => fact.role === "material_line" && fact.status === "active")
    .sort((a, b) => a.id.localeCompare(b.id));

  if (stamp?.status === "active") {
    return {
      id: "materials",
      label: "Materials",
      valueCents: stamp.value,
      supported: true,
      dependsOn: [stamp.id],
      formula: "stamped supplier total",
      signature: `materials|stamp|${stamp.status}:${stamp.value}`,
      reason: `Stamped total on ${stamp.receiptId} is ${formatCents(stamp.value)}. Active line items on that receipt sum to ${formatCents(materialLineSum(facts))} and are not used while the stamp is active.`,
    };
  }

  if (lines.length === 0) {
    return {
      id: "materials",
      label: "Materials",
      valueCents: null,
      supported: false,
      dependsOn: [],
      formula: "sum of material line items",
      signature: "materials|unsupported",
      reason: "The stamped total is retracted and no material line is still active.",
    };
  }

  const valueCents = lines.reduce((sum, fact) => sum + fact.value, 0);
  return {
    id: "materials",
    label: "Materials",
    valueCents,
    supported: true,
    dependsOn: lines.map((fact) => fact.id),
    formula: "sum of material line items",
    signature: `materials|lines|${lines.map((fact) => `${fact.id}:${fact.value}`).join(",")}`,
    reason: `Stamped total is retracted. Materials are ${lines
      .map((fact) => `${fact.label} ${formatCents(fact.value)}`)
      .join(" + ")}.`,
  };
}

function freightNode(facts: Fact[]): Computed {
  const freight = facts.find((fact) => fact.role === "freight");
  if (!freight || freight.status !== "active") {
    return {
      id: "freight",
      label: "Freight",
      valueCents: null,
      supported: false,
      dependsOn: freight ? [freight.id] : [],
      formula: "carrier receipt",
      signature: `freight|${freight?.status ?? "missing"}:${freight?.value ?? "none"}`,
      reason: "Freight needs an active carrier receipt.",
    };
  }
  return {
    id: "freight",
    label: "Freight",
    valueCents: freight.value,
    supported: true,
    dependsOn: [freight.id],
    formula: "carrier receipt",
    signature: `freight|${freight.status}:${freight.value}`,
    reason: `${formatCents(freight.value)} on ${freight.receiptId}.`,
  };
}

function totalNode(parts: Computed[]): Computed {
  const labor = parts.find((node) => node.id === "labor")!;
  const materials = parts.find((node) => node.id === "materials")!;
  const freight = parts.find((node) => node.id === "freight")!;
  const supported = labor.supported && materials.supported && freight.supported;
  const valueCents =
    supported && labor.valueCents !== null && materials.valueCents !== null && freight.valueCents !== null
      ? labor.valueCents + materials.valueCents + freight.valueCents
      : null;
  return {
    id: "total",
    label: "Invoice total",
    valueCents,
    supported,
    dependsOn: [...labor.dependsOn, ...materials.dependsOn, ...freight.dependsOn],
    formula: "labor + materials + freight",
    signature: `total|${labor.signature}|${materials.signature}|${freight.signature}`,
    reason: supported
      ? `${formatCents(labor.valueCents!)} labor + ${formatCents(materials.valueCents!)} materials + ${formatCents(freight.valueCents!)} freight.`
      : "The total stays unsupported until labor, materials, and freight each have active evidence.",
  };
}

function settle(computed: Computed, previous?: DerivedNode): DerivedNode {
  if (previous && previous.signature === computed.signature) {
    return { ...previous, pass: "held" };
  }
  return {
    ...computed,
    evaluations: (previous?.evaluations ?? 0) + 1,
    pass: previous ? "recomputed" : "initial",
  };
}

export function derive(facts: Fact[], previous?: Derivation): Derivation {
  const computed = [laborNode(facts), materialsNode(facts), freightNode(facts)];
  computed.push(totalNode(computed));
  const nodes = NODE_ORDER.map((id) => {
    const next = computed.find((node) => node.id === id);
    if (!next) throw new Error(`Missing derived node ${id}.`);
    return settle(next, previous?.byId[id]);
  });
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node])) as Derivation["byId"];
  return { nodes, byId };
}
