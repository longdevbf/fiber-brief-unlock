/**
 * A listing is the public part of a brief: what the buyer sees before paying.
 * It travels in the offer JSON and is bound to the ciphertext as AES-GCM
 * additional data, so editing the title, preview, price or file details makes
 * decryption fail even with the right key.
 */
export type Attachment = { name: string; type: string; size: number };

export type Listing = {
  title: string;
  preview: string;
  priceCkb: number;
  wordCount: number;
  attachment: Attachment | null;
};

export const priceOptions = [1, 2, 5] as const;
export const maxTitleLength = 80;
export const maxPreviewLength = 400;
export const maxAttachmentBytes = 256 * 1024;
export const shannonsPerCkb = 100_000_000n;

export const priceShannons = (priceCkb: number) => BigInt(priceCkb) * shannonsPerCkb;

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing.`);
  if (value.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return value;
}

function attachment(value: unknown): Attachment | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Attachment details are malformed.');
  const { name, type, size } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name || name.length > 120) throw new Error('Attachment name is malformed.');
  if (typeof type !== 'string' || type.length > 100) throw new Error('Attachment type is malformed.');
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > maxAttachmentBytes) {
    throw new Error('Attachment size is malformed.');
  }
  return { name, type, size };
}

/** Validates a listing from untrusted JSON and returns only the known fields. */
export function normalizeListing(value: unknown): Listing {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Listing is missing.');
  const raw = value as Record<string, unknown>;
  const priceCkb = raw.priceCkb;
  if (typeof priceCkb !== 'number' || !(priceOptions as readonly number[]).includes(priceCkb)) {
    throw new Error(`Listing price must be one of ${priceOptions.join(', ')} CKB.`);
  }
  const wordCount = raw.wordCount;
  if (typeof wordCount !== 'number' || !Number.isSafeInteger(wordCount) || wordCount < 1) {
    throw new Error('Listing word count is malformed.');
  }
  return {
    title: text(raw.title, 'Title', maxTitleLength),
    preview: text(raw.preview, 'Free preview', maxPreviewLength),
    priceCkb,
    wordCount,
    attachment: attachment(raw.attachment),
  };
}

/** Canonical bytes of the listing, used as AES-GCM additional authenticated data. */
export function listingAad(listing: Listing) {
  const a = listing.attachment;
  return new TextEncoder().encode(JSON.stringify([
    'brief-unlock/listing/v1',
    listing.title,
    listing.preview,
    listing.priceCkb,
    listing.wordCount,
    a ? [a.name, a.type, a.size] : null,
  ]));
}
