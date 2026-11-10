export type FactRole =
  | "labor_hours"
  | "labor_rate"
  | "material_line"
  | "supplier_total"
  | "freight";

export type FactStatus = "active" | "retracted";

export type UnitOfMeasure = "QUANTITY" | "HOURS";

export type FactLine = {
  name: string;
  quantity: string;
  unitCents: number;
  unitOfMeasure: UnitOfMeasure;
};

export type Fact = {
  id: string;
  receiptId: string;
  role: FactRole;
  label: string;
  /** Hours for labor_hours. Cents for every money fact. */
  value: number;
  status: FactStatus;
  support: string;
  line?: FactLine;
};

export type Receipt = {
  id: string;
  kicker: string;
  title: string;
  from: string;
  issuedOn: string;
  lines: string[];
  footnote?: string;
};

export type NodeId = "labor" | "materials" | "freight" | "total";

export type NodePass = "initial" | "recomputed" | "held";

export type DerivedNode = {
  id: NodeId;
  label: string;
  valueCents: number | null;
  supported: boolean;
  dependsOn: string[];
  formula: string;
  evaluations: number;
  pass: NodePass;
  signature: string;
  reason: string;
};

export type Derivation = {
  nodes: DerivedNode[];
  byId: Record<NodeId, DerivedNode>;
};

export type Conflict = {
  stampCents: number;
  lineSumCents: number;
  gapCents: number;
};
