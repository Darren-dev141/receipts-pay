import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decimalToCents, invoiceItemsTotalCents } from "@/lib/money";
import type { PayPalInvoiceItem, PayPalInvoiceParams } from "@/lib/paypal/invoice-body";
import { createMockGateway } from "@/lib/paypal/mode";

function item(value: string, quantity: string): PayPalInvoiceItem {
  return {
    name: "Line",
    description: "Billed line",
    quantity,
    unit_amount: { currency_code: "USD", value },
    unit_of_measure: "QUANTITY",
  };
}

function params(items: PayPalInvoiceItem[]): PayPalInvoiceParams {
  return {
    currency_code: "USD",
    invoice_number: "RP-TEST",
    invoice_date: "2026-11-10",
    reference: "JOB-TEST",
    note: "Test invoice",
    invoicer_business_name: "Harbor Fieldwork",
    primary_recipients: [
      {
        billing_info: {
          business_name: "Northline Studio",
          email_address: "buyer@northline.test",
          name: { given_name: "Northline", surname: "Studio" },
        },
      },
    ],
    items,
    theme_color: "#1F4D3A",
  };
}

describe("decimal amounts", () => {
  it("rejects a bad amount", () => {
    expect(decimalToCents("abc")).toBeNull();
    expect(decimalToCents("12.3.4")).toBeNull();
    expect(decimalToCents("$1.00")).toBeNull();
    expect(decimalToCents("")).toBeNull();
    expect(decimalToCents("1.")).toBeNull();
  });

  it("rejects 1.999 instead of truncating it to 199 cents", () => {
    expect(decimalToCents("1.999")).toBeNull();
    expect(decimalToCents("1.999")).not.toBe(199);
    expect(decimalToCents("-1.999")).toBeNull();
    expect(decimalToCents("10.999")).toBeNull();
    expect(decimalToCents("1.990")).toBeNull();
  });

  it("parses a dollar amount into integer cents", () => {
    expect(decimalToCents("0")).toBe(0);
    expect(decimalToCents("1")).toBe(100);
    expect(decimalToCents("1.9")).toBe(190);
    expect(decimalToCents("1.99")).toBe(199);
    expect(decimalToCents("10.50")).toBe(1_050);
    expect(decimalToCents("-2.05")).toBe(-205);
  });
});

describe("invoice item totals", () => {
  const lines = [item("40.00", "2"), item("30.10", "1")];
  const expectedCents = 8_000 + 3_010;

  it("uses one integer-cent total at every call site", async () => {
    expect(invoiceItemsTotalCents(lines)).toBe(expectedCents);

    const gateway = createMockGateway();
    const created = await gateway.create(params(lines));
    expect(created.totalCents).toBe(expectedCents);
    expect(created.paypalAmount).toBe("110.10");
    expect(created.amountWarning).toBeNull();

    const updated = await gateway.update(created, params(lines), false);
    expect(updated.totalCents).toBe(expectedCents);
    expect(updated.paypalAmount).toBe("110.10");
    expect(updated.amountWarning).toBeNull();

    for (const file of ["src/lib/paypal/mode.ts", "src/lib/paypal/sandbox.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("invoiceItemsTotalCents");
      expect(source).not.toMatch(/Math\.round\(/);
      expect(source).not.toMatch(/\.toFixed\(2\)/);
    }
  });

  it("rejects a bad amount instead of billing zero", async () => {
    const bad = [item("abc", "1")];
    expect(() => invoiceItemsTotalCents(bad)).toThrow(/abc/);
    const gateway = createMockGateway();
    await expect(gateway.create(params(bad))).rejects.toThrow(/abc/);
    const current = await gateway.create(params(lines));
    await expect(gateway.update(current, params(bad), false)).rejects.toThrow(/abc/);
  });

  it("rejects 1.999 instead of billing $1.99", async () => {
    const bad = [item("1.999", "1")];
    expect(() => invoiceItemsTotalCents(bad)).toThrow(/1\.999/);
    const gateway = createMockGateway();
    await expect(gateway.create(params(bad))).rejects.toThrow(/1\.999/);
    expect(gateway.calls).toEqual([]);
  });
});
