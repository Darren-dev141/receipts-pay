import type { Fact, Receipt } from "@/lib/ledger/types";

export const STAMP_FACT_ID = "supplier_stamped_total";

export const DRAFT_TOTAL_CENTS = 44_000;
export const REVISED_TOTAL_CENTS = 27_500;
export const LABOR_CENTS = 12_500;
export const FREIGHT_CENTS = 4_000;
export const STAMP_CENTS = 27_500;
export const LINE_SUM_CENTS = 11_000;
export const GAP_CENTS = 16_500;

export const DEMO_RECEIPTS: Receipt[] = [
  {
    id: "TS-188",
    kicker: "Timesheet",
    title: "Gallery lighting install",
    from: "Harbor Fieldwork crew",
    issuedOn: "2026-11-02",
    lines: [
      "Job: Northline Studio",
      "Hours on site: 5",
      "Work: hang and aim the gallery track",
    ],
  },
  {
    id: "RC-2026",
    kicker: "Rate card",
    title: "Field labor rate",
    from: "Harbor Fieldwork",
    issuedOn: "2026-01-01",
    lines: ["Gallery lighting labor", "$25.00 per hour", "Effective all of 2026"],
  },
  {
    id: "R-441",
    kicker: "Supplier receipt",
    title: "Volt & Co.",
    from: "Volt & Co.",
    issuedOn: "2026-11-03",
    lines: [
      "Sold to Harbor Fieldwork",
      "LED panels            2 × $40.00      $80.00",
      "Mounting hardware     1 × $30.00      $30.00",
      "Line sum                              $110.00",
      "STAMPED TOTAL                         $275.00",
    ],
    footnote:
      "The total box still includes cancelled change order CO-19 ($165.00) for a fixture run that was not delivered.",
  },
  {
    id: "R-442",
    kicker: "Carrier receipt",
    title: "Delivery",
    from: "Redcart Freight",
    issuedOn: "2026-11-04",
    lines: [
      "Delivered to Northline Studio",
      "Freight charge $40.00",
      "Prepaid by Harbor Fieldwork",
    ],
  },
];

export const DEMO_FACTS: Fact[] = [
  {
    id: "labor_hours",
    receiptId: "TS-188",
    role: "labor_hours",
    label: "Hours on site",
    value: 5,
    status: "active",
    support: "Timesheet TS-188 records 5 hours at Northline Studio.",
  },
  {
    id: "labor_rate",
    receiptId: "RC-2026",
    role: "labor_rate",
    label: "Labor rate",
    value: 2_500,
    status: "active",
    support: "Rate card RC-2026 prices gallery lighting labor at $25.00 per hour.",
  },
  {
    id: "led_panels",
    receiptId: "R-441",
    role: "material_line",
    label: "LED panels",
    value: 8_000,
    status: "active",
    support: "Volt & Co. receipt R-441 lists 2 LED panels at $40.00.",
    line: {
      name: "LED panels",
      quantity: "2",
      unitCents: 4_000,
      unitOfMeasure: "QUANTITY",
    },
  },
  {
    id: "mounting_hardware",
    receiptId: "R-441",
    role: "material_line",
    label: "Mounting hardware",
    value: 3_000,
    status: "active",
    support: "Volt & Co. receipt R-441 lists mounting hardware at $30.00.",
    line: {
      name: "Mounting hardware",
      quantity: "1",
      unitCents: 3_000,
      unitOfMeasure: "QUANTITY",
    },
  },
  {
    id: STAMP_FACT_ID,
    receiptId: "R-441",
    role: "supplier_total",
    label: "Stamped supplier total",
    value: STAMP_CENTS,
    status: "active",
    support:
      "The total box on Volt & Co. receipt R-441 says $275.00. That box still includes cancelled change order CO-19.",
  },
  {
    id: "freight_fee",
    receiptId: "R-442",
    role: "freight",
    label: "Freight",
    value: FREIGHT_CENTS,
    status: "active",
    support: "Redcart Freight receipt R-442 charges $40.00 to deliver to Northline Studio.",
  },
];

export function demoFacts(): Fact[] {
  return structuredClone(DEMO_FACTS);
}
