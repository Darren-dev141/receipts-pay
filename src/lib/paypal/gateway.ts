import type { PayPalInvoiceParams, PayPalSnapshot } from "@/lib/paypal/invoice-body";

export interface PayPalGateway {
  mode: "mock" | "sandbox";
  create(params: PayPalInvoiceParams): Promise<PayPalSnapshot>;
  update(current: PayPalSnapshot, params: PayPalInvoiceParams, notify: boolean): Promise<PayPalSnapshot>;
  send(current: PayPalSnapshot): Promise<PayPalSnapshot>;
  cancelOrDelete(current: PayPalSnapshot): Promise<PayPalSnapshot>;
}
