import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptBundle, encryptBundle, sha256Hex, toHex } from './lib/crypto.ts';
import { listingAad, normalizeListing, priceShannons } from './lib/listing.ts';

const listing = {
  title: 'Sample brief',
  preview: 'Free summary.',
  priceCkb: 2,
  wordCount: 3,
  attachment: { name: 'card.txt', type: 'text/plain', size: 5 },
};
const bundle = { body: 'Full brief text', file: { name: 'card.txt', type: 'text/plain', base64: btoa('hello') } };

test('the seller key opens the brief and its file', async () => {
  const { key, payload } = await encryptBundle(bundle, listingAad(listing));
  assert.deepEqual(await decryptBundle(payload, key, listingAad(listing)), bundle);
});

test('a guessed key is rejected', async () => {
  const { payload } = await encryptBundle(bundle, listingAad(listing));
  const guess = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await assert.rejects(decryptBundle(payload, guess, listingAad(listing)), { name: 'OperationError' });
});

test('editing any public listing field breaks decryption with the right key', async () => {
  const { key, payload } = await encryptBundle(bundle, listingAad(listing));
  for (const change of [{ title: 'Other' }, { preview: 'Free summary!' }, { priceCkb: 1 }, { wordCount: 4 },
    { attachment: { ...listing.attachment, name: 'other.txt' } }, { attachment: null }]) {
    await assert.rejects(decryptBundle(payload, key, listingAad({ ...listing, ...change })), { name: 'OperationError' });
  }
});

test('SHA-256 of the key is a 32-byte payment hash', async () => {
  const { key } = await encryptBundle(bundle, listingAad(listing));
  assert.match(await sha256Hex(key), /^0x[0-9a-f]{64}$/);
  assert.equal(await sha256Hex('0x'), '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('listings from untrusted JSON are validated and stripped to known fields', () => {
  assert.deepEqual(normalizeListing({ ...listing, extra: 'dropped' }), listing);
  assert.throws(() => normalizeListing({ ...listing, priceCkb: 3 }), /price/);
  assert.throws(() => normalizeListing({ ...listing, title: '' }), /Title/);
  assert.throws(() => normalizeListing({ ...listing, preview: 'x'.repeat(401) }), /preview/i);
  assert.throws(() => normalizeListing({ ...listing, attachment: { ...listing.attachment, size: 300 * 1024 } }), /size/);
  assert.equal(priceShannons(5), 500_000_000n);
});
