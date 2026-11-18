# Quest 1: tutorial screenshots

These come from the browser tutorial
[Unlock Encrypted Data with a Fiber Payment](https://www.fiber.world/docs/build/encrypted-data-payment)
on CKB Testnet, run on 2026-11-18. The seller encrypted a custom sample report.

| Proof | File |
| --- | --- |
| Setup: both nodes funded from the faucet | [01a-setup-nodes-funded.png](01a-setup-nodes-funded.png) |
| Setup: both channels at `CHANNEL_READY` | [01b-setup-channels-ready.png](01b-setup-channels-ready.png) |
| Seller's original text, ciphertext and the 1 CKB invoice | [02-seller-encrypt-and-invoice.png](02-seller-encrypt-and-invoice.png) |
| Before payment: encrypted offer on the buyer side and **Decryption rejected** | [03-buyer-offer-decryption-rejected.png](03-buyer-offer-decryption-rejected.png) |
| After payment: receipt with **1 CKB** and the **payment hash** | [04-payment-receipt.png](04-payment-receipt.png) |
| After decryption: buyer's result matches the seller's text | [05-decrypted-result.png](05-decrypted-result.png) |
| Chapter check question answered | [06-quiz.png](06-quiz.png) |

Payment hash: `0x70d7984839f33494ec896657e28589377f0c2843881712d097422d6db7fa66fc`
(1 CKB to the seller, 0.001 CKB routing fee, 1.001 CKB in total).
