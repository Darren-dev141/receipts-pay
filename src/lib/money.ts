/** Integer cents. Receipt math never uses binary floating point. */

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, "0")}`;
}

export function decimalToCents(value: string): number | null {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [dollars, fraction = ""] = unsigned.split(".");
  if (fraction.length > 2) return null;
  const cents = Number(`${dollars}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function invoiceItemsTotalCents(
  items: readonly { name?: string; quantity: string; unit_amount: { value: string } }[],
): number {
  return items.reduce((sum, item) => {
    const extension = itemExtensionCents(item);
    const next = sum + extension;
    if (!Number.isSafeInteger(next)) {
      throw new Error("Invoice total is outside the safe integer range.");
    }
    return next;
  }, 0);
}

function itemExtensionCents(item: { name?: string; quantity: string; unit_amount: { value: string } }): number {
  const label = item.name ? ` "${item.name}"` : "";
  const unit = decimalToCents(item.unit_amount.value);
  if (unit === null) {
    throw new Error(
      `Invoice item${label} amount ${item.unit_amount.value} is not a dollar value with at most two decimal places.`,
    );
  }
  if (!/^\d+$/.test(item.quantity)) {
    throw new Error(`Invoice item${label} quantity ${item.quantity} is not a whole number.`);
  }
  const total = unit * Number(item.quantity);
  if (!Number.isSafeInteger(total)) {
    throw new Error(`Invoice item${label} total is outside the safe integer range.`);
  }
  return total;
}

export function formatInvoiceDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
