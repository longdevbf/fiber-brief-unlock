export const sampleTitle = 'Pay-to-unlock on Fiber: a builder checklist';

export const samplePreview =
  'Five things to get right before you sell data behind a Fiber invoice. The full checklist, with the reason behind each item and a printable card, unlocks after payment.';

export const sampleBody = `Pay-to-unlock on Fiber: a builder checklist

1. Use the AES key as the payment preimage.
The seller cannot claim the payment without revealing the preimage, and the preimage is the key. The buyer checks SHA-256(key) against the payment hash.

2. Bind the public preview to the ciphertext.
This demo passes the listing (title, preview, price, file details) to AES-GCM as additional data. Change one character and the right key no longer opens it.

3. Check the invoice before paying.
Network (Fibt), amount equal to the listed price, and the same payment hash as the offer. A mismatch stops the payment before any funds move.

4. Record the payment attempt before sending.
After a reload, check the saved attempt instead of paying twice. Only a confirmed failure allows a retry.

5. Mind the route's liquidity.
The buyer pays through Bottle. The seller can only receive what Bottle holds on its side of the seller's channel.

What payment does not prove: the key opens this ciphertext, nothing more. It does not prove the brief is accurate. Previews, reputation and refunds cover that part.`;
