import type { FiberBrowserNode, SendPaymentParams } from '@fiber-pay/sdk/browser';
import type { EncryptedOffer } from './offer';
import { priceShannons } from './listing.ts';
import { assertEncryptedInvoiceNotExpired, EncryptedPaymentRejectedError, submitEncryptedPayment } from './payment-submission.ts';

/** Checks the decoded Invoice against the listing: Testnet, the advertised price, the same payment hash. */
export async function validateOffer(node: FiberBrowserNode, offer: Pick<EncryptedOffer, 'invoice' | 'paymentHash' | 'listing'>) {
  const { invoice } = await node.parseInvoice({ invoice: offer.invoice });
  if (invoice.currency !== 'Fibt' || BigInt(invoice.amount ?? '0x0') !== priceShannons(offer.listing.priceCkb)
    || invoice.data.payment_hash.toLowerCase() !== offer.paymentHash.toLowerCase()) {
    throw new Error(`The Invoice does not match this ${offer.listing.priceCkb} CKB listing.`);
  }
  return invoice;
}

export async function payForOffer(node: FiberBrowserNode, offer: EncryptedOffer, attempt: string,
  recordAttempt: (hash: string) => void, retry = false) {
  const invoice = await validateOffer(node, offer);
  if (attempt) {
    if (attempt.toLowerCase() !== offer.paymentHash.toLowerCase()) throw new Error('Restore the offer for the previous payment.');
    const previous = await node.getPayment({ payment_hash: offer.paymentHash });
    if (!retry || previous.status !== 'Failed') return previous;
  }
  assertEncryptedInvoiceNotExpired(invoice);
  // A storage failure aborts before a payment can be submitted.
  recordAttempt(offer.paymentHash);
  try {
    return await submitEncryptedPayment(node, offer.paymentHash, { invoice: offer.invoice,
      hop_hints: [offer.lastHop] as unknown as NonNullable<SendPaymentParams['hop_hints']>,
      max_fee_amount: '0x5f5e100', max_parts: '0x1' });
  } catch (error) {
    if (error instanceof EncryptedPaymentRejectedError) recordAttempt('');
    throw error;
  }
}
