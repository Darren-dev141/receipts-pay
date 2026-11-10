import { describe, expect, it } from "vitest";
import {
  DRAFT_TOTAL_CENTS,
  FREIGHT_CENTS,
  GAP_CENTS,
  LABOR_CENTS,
  LINE_SUM_CENTS,
  REVISED_TOTAL_CENTS,
  STAMP_CENTS,
  STAMP_FACT_ID,
  demoFacts,
} from "@/lib/ledger/demo-case";
import { derive, materialConflict, materialLineSum, retractFact } from "@/lib/ledger/engine";

describe("demo case retraction", () => {
  it("builds the invoice at $440 from the stamped supplier total", () => {
    const facts = demoFacts();
    const derived = derive(facts);
    expect(derived.byId.labor.valueCents).toBe(LABOR_CENTS);
    expect(derived.byId.materials.valueCents).toBe(STAMP_CENTS);
    expect(derived.byId.freight.valueCents).toBe(FREIGHT_CENTS);
    expect(derived.byId.total.valueCents).toBe(DRAFT_TOTAL_CENTS);
    expect(derived.nodes.every((node) => node.pass === "initial" && node.evaluations === 1)).toBe(true);
    expect(derived.byId.materials.dependsOn).toEqual([STAMP_FACT_ID]);
    const conflict = materialConflict(facts);
    expect(conflict).toEqual({
      stampCents: STAMP_CENTS,
      lineSumCents: LINE_SUM_CENTS,
      gapCents: GAP_CENTS,
    });
    expect(materialLineSum(facts)).toBe(LINE_SUM_CENTS);
  });

  it("revises to $275 and recomputes only materials and the total", () => {
    const first = derive(demoFacts());
    const retracted = retractFact(demoFacts(), STAMP_FACT_ID);
    const next = derive(retracted, first);

    expect(next.byId.materials.valueCents).toBe(LINE_SUM_CENTS);
    expect(next.byId.materials.pass).toBe("recomputed");
    expect(next.byId.materials.evaluations).toBe(2);
    expect(next.byId.materials.formula).toBe("sum of material line items");
    expect(next.byId.materials.dependsOn).toEqual(["led_panels", "mounting_hardware"]);

    expect(next.byId.total.valueCents).toBe(REVISED_TOTAL_CENTS);
    expect(next.byId.total.pass).toBe("recomputed");
    expect(next.byId.total.evaluations).toBe(2);

    expect(next.byId.labor.valueCents).toBe(LABOR_CENTS);
    expect(next.byId.labor.pass).toBe("held");
    expect(next.byId.labor.evaluations).toBe(1);
    expect(next.byId.freight.valueCents).toBe(FREIGHT_CENTS);
    expect(next.byId.freight.pass).toBe("held");
    expect(next.byId.freight.evaluations).toBe(1);
    expect(materialConflict(retracted)).toBeNull();
  });

  it("does not recompute when a retracted fact is not an input", () => {
    const first = derive(demoFacts());
    const next = derive(retractFact(demoFacts(), "led_panels"), first);
    expect(next.byId.materials.valueCents).toBe(STAMP_CENTS);
    expect(next.byId.materials.pass).toBe("held");
    expect(next.byId.materials.evaluations).toBe(1);
    expect(next.byId.total.pass).toBe("held");
    expect(next.byId.total.evaluations).toBe(1);
    expect(next.byId.labor.evaluations).toBe(1);
    expect(next.byId.freight.evaluations).toBe(1);
  });

  it("is idempotent when the same retraction is derived twice", () => {
    const first = derive(demoFacts());
    const onceFacts = retractFact(demoFacts(), STAMP_FACT_ID);
    const once = derive(onceFacts, first);
    const twice = derive(retractFact(onceFacts, STAMP_FACT_ID), once);
    expect(twice.byId.materials.evaluations).toBe(2);
    expect(twice.byId.materials.pass).toBe("held");
    expect(twice.byId.total.evaluations).toBe(2);
    expect(twice.byId.total.valueCents).toBe(REVISED_TOTAL_CENTS);
  });

  it("recomputes labor and the total when the rate is retracted, and leaves materials alone", () => {
    const first = derive(demoFacts());
    const next = derive(retractFact(demoFacts(), "labor_rate"), first);
    expect(next.byId.labor.supported).toBe(false);
    expect(next.byId.labor.pass).toBe("recomputed");
    expect(next.byId.total.supported).toBe(false);
    expect(next.byId.total.pass).toBe("recomputed");
    expect(next.byId.materials.pass).toBe("held");
    expect(next.byId.materials.evaluations).toBe(1);
    expect(next.byId.freight.pass).toBe("held");
    expect(next.byId.freight.evaluations).toBe(1);
  });
});
