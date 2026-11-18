export type EncryptedPayload = {
  ciphertext: `0x${string}`;
  iv: `0x${string}`;
};

/** What the seller sells: the full brief text and an optional file. */
export type Bundle = {
  body: string;
  file: { name: string; type: string; base64: string } | null;
};

export const toHex = (bytes: Uint8Array) =>
  `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

export const fromHex = (value: string) =>
  Uint8Array.from(value.replace(/^0x/, '').match(/.{2}/g) ?? [], (part) =>
    Number.parseInt(part, 16),
  );

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/**
 * Encrypts the bundle with a fresh AES-256 key. The listing bytes go in as
 * additional data: they stay public, but any change to them breaks decryption.
 * The key is returned so the seller can use it as the invoice preimage.
 */
export async function encryptBundle(bundle: Bundle, additionalData: Uint8Array) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array(additionalData) },
    key,
    new TextEncoder().encode(JSON.stringify(bundle)),
  );
  return {
    key: toHex(keyBytes),
    payload: { ciphertext: toHex(new Uint8Array(ciphertext)), iv: toHex(iv) } satisfies EncryptedPayload,
  };
}

/** Throws a DOMException (OperationError) when the key or the listing does not match. */
export async function decryptBundle(payload: EncryptedPayload, keyHex: string, additionalData: Uint8Array): Promise<Bundle> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(fromHex(keyHex)), { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(fromHex(payload.iv)), additionalData: new Uint8Array(additionalData) },
    key,
    new Uint8Array(fromHex(payload.ciphertext)),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  const value = parsed as Partial<Bundle>;
  if (typeof value?.body !== 'string') throw new Error('Decrypted brief is malformed.');
  const file = value.file && typeof value.file.name === 'string' && typeof value.file.base64 === 'string'
    ? { name: value.file.name, type: typeof value.file.type === 'string' ? value.file.type : '', base64: value.file.base64 }
    : null;
  return { body: value.body, file };
}

/** SHA-256 of the key bytes, the same fingerprint Fiber uses as the payment hash. */
export async function sha256Hex(hex: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(fromHex(hex)))));
}
