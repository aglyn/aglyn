/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto'

/**
 * A SECRET BOX: a short secret sealed at rest with AES-256-GCM.
 *
 * For a value the platform must be able to read back — a provider refresh
 * token, a webhook signing key — and must never store in the clear. Hashing
 * is the right tool for a secret that is only ever COMPARED (an API key);
 * this is for one that is USED.
 *
 * ## Server-only, and never on the barrel
 *
 * It imports `node:crypto`, so it is reached by its own subpath —
 * `@aglyn/shared-util-tools/secret-box` — and the library index does not
 * re-export it. A browser bundle that pulled this in would fail to build,
 * and one that did not fail would be shipping key handling to a page.
 *
 * It reads no environment. The caller resolves its key material from wherever
 * that caller's credential lives and hands it in, so which process may hold a
 * key is decided by the caller's location, not by this module.
 *
 * ## The sealed form
 *
 *     sb1.<keyId>.<iv>.<ciphertext>.<tag>
 *
 * Each part after the key id is base64url. The IV is 12 random bytes per seal
 * and the tag is GCM's full 16 bytes. The version and the key id are bound
 * into the tag as additional authenticated data, so neither can be rewritten
 * to make a sealed value open under a different key or scheme.
 *
 * ## Context
 *
 * A caller may bind a sealed value to where it belongs — a document path, a
 * purpose — by passing the same `context` to seal and open. The context is
 * authenticated, never stored, so a value copied from one record into another
 * refuses to open there, even under the right key.
 *
 * ## Rotation
 *
 * A key carries an id, and a sealed value names the id it was sealed under. A
 * keyring holds the current key, which seals, and any number of earlier keys,
 * which only open. Rotating is: put the new key first, keep the old one after
 * it until nothing sealed under it remains, then drop it. {@link openSecret}
 * reports which key opened a value, so a reader can reseal under the current
 * key as it goes ({@link needsReseal}).
 *
 * ## Refusals
 *
 * Every failure throws {@link SecretBoxError} with a stable code and a message
 * that never contains the plaintext, the ciphertext or key material.
 * Authentication failure is one code, `refused`, whether the ciphertext was
 * altered, the key is wrong or the context differs: GCM cannot tell those
 * apart, and a caller has no business treating them differently.
 */

/** The version tag every sealed value starts with. */
export const SECRET_BOX_VERSION = 'sb1'

/** Bytes of key material: AES-256. */
export const SECRET_BOX_KEY_BYTES = 32

const IV_BYTES = 12
const TAG_BYTES = 16
const ALGORITHM = 'aes-256-gcm'

/** A key id: short, URL-safe and free of the separator. */
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/

/** Standard or URL-safe base64, padded or not. */
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/

/** Unpadded base64url, the only alphabet a sealed value uses. */
const BASE64URL = /^[A-Za-z0-9_-]+$/

/** Why a key could not be parsed or a value could not be sealed or opened. */
export type SecretBoxErrorCode =
  /** Key material that is not 32 bytes of base64, or an unusable key id. */
  | 'invalid-key'
  /** Not a sealed value at all: wrong shape, bad encoding, wrong lengths. */
  | 'malformed'
  /** A sealed value from a scheme version this module does not open. */
  | 'unsupported-version'
  /** Sealed under a key id the keyring does not hold. */
  | 'unknown-key'
  /** Authentication failed: altered, wrong key, or a different context. */
  | 'refused'

export class SecretBoxError extends Error {
  readonly code: SecretBoxErrorCode

  constructor(code: SecretBoxErrorCode, message: string) {
    super(message)
    this.name = 'SecretBoxError'
    this.code = code
  }
}

/** One key: its id and its 32 bytes. */
export interface SecretBoxKey {
  readonly id: string
  readonly material: Uint8Array
}

/**
 * The keys a reader holds. `current` seals; every entry of `keys` — `current`
 * included, first — opens.
 */
export interface SecretBoxKeyring {
  readonly current: SecretBoxKey
  readonly keys: readonly SecretBoxKey[]
}

/** What opening a sealed value produced. */
export interface OpenedSecret {
  readonly plaintext: string
  /** The id of the key that opened it. */
  readonly keyId: string
}

const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64url')

function decodeBase64Url(part: string, expectedBytes?: number): Buffer {
  if (!BASE64URL.test(part)) {
    throw new SecretBoxError('malformed', 'The sealed value is not valid base64url.')
  }
  const bytes = Buffer.from(part, 'base64url')
  // Re-encoding catches a part with trailing bits Node's decoder silently
  // dropped, which would otherwise be two spellings of one value.
  if (toBase64Url(bytes) !== part) {
    throw new SecretBoxError('malformed', 'The sealed value is not canonical base64url.')
  }
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new SecretBoxError('malformed', 'A part of the sealed value has the wrong length.')
  }
  return bytes
}

/**
 * The id a key is known by when none is given: eight characters derived from
 * the key itself with HMAC, so it names the key without being a hash of it
 * anyone could test a guess against.
 */
export function deriveSecretBoxKeyId(material: Uint8Array): string {
  return createHmac('sha256', Buffer.from(material))
    .update('secret-box:key-id')
    .digest()
    .subarray(0, 6)
    .toString('base64url')
}

/**
 * A key from base64 material (standard or URL-safe), with an explicit id or
 * the derived one.
 */
export function createSecretBoxKey(
  material: Uint8Array | string,
  id?: string,
): SecretBoxKey {
  let bytes: Buffer
  if (typeof material === 'string') {
    const trimmed = material.trim()
    if (!BASE64.test(trimmed)) {
      throw new SecretBoxError('invalid-key', 'A secret box key must be base64.')
    }
    bytes = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  } else {
    bytes = Buffer.from(material)
  }
  if (bytes.length !== SECRET_BOX_KEY_BYTES) {
    throw new SecretBoxError(
      'invalid-key',
      `A secret box key must be ${SECRET_BOX_KEY_BYTES} bytes.`,
    )
  }
  const keyId = id ?? deriveSecretBoxKeyId(bytes)
  if (!KEY_ID.test(keyId)) {
    throw new SecretBoxError(
      'invalid-key',
      'A secret box key id must be 1-32 letters, digits, "-" or "_".',
    )
  }
  return { id: keyId, material: bytes }
}

/**
 * A keyring from one configuration value: keys separated by commas or
 * whitespace, the first the current one. Each entry is base64 material, or
 * `id:material` to name it explicitly.
 *
 * Refuses an empty value, any unparseable entry and two entries with one id —
 * a reader could not know which of the two a sealed value meant.
 */
export function parseSecretBoxKeyring(value: string): SecretBoxKeyring {
  const entries = String(value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (!entries.length) {
    throw new SecretBoxError('invalid-key', 'No secret box key was given.')
  }
  const keys = entries.map((entry) => {
    const separator = entry.indexOf(':')
    return separator > 0
      ? createSecretBoxKey(entry.slice(separator + 1), entry.slice(0, separator))
      : createSecretBoxKey(entry)
  })
  const ids = new Set<string>()
  for (const key of keys) {
    if (ids.has(key.id)) {
      throw new SecretBoxError('invalid-key', 'Two secret box keys share one id.')
    }
    ids.add(key.id)
  }
  return { current: keys[0], keys }
}

function asKeyring(
  keys: SecretBoxKeyring | SecretBoxKey | readonly SecretBoxKey[],
): readonly SecretBoxKey[] {
  if (Array.isArray(keys)) return keys
  if ('current' in (keys as SecretBoxKeyring)) {
    return (keys as SecretBoxKeyring).keys
  }
  return [keys as SecretBoxKey]
}

/** Version and key id, then the caller's context, as authenticated data. */
function additionalData(keyId: string, context: string | undefined): Buffer {
  return Buffer.from(`${SECRET_BOX_VERSION}\u0000${keyId}\u0000${context ?? ''}`, 'utf8')
}

/**
 * Seals a string under a key.
 *
 * `context` is bound into the tag, and the same value must be passed to
 * {@link openSecret}. `iv` is a test seam for a deterministic IV; never pass
 * one in production, because a repeated IV under one key breaks GCM entirely.
 */
export function sealSecret(
  plaintext: string,
  key: SecretBoxKey,
  options: { context?: string; iv?: Uint8Array } = {},
): string {
  if (typeof plaintext !== 'string') {
    throw new SecretBoxError('malformed', 'Only a string can be sealed.')
  }
  if (!key || key.material?.length !== SECRET_BOX_KEY_BYTES || !KEY_ID.test(key.id)) {
    throw new SecretBoxError('invalid-key', 'The sealing key is not a usable secret box key.')
  }
  const iv = options.iv ? Buffer.from(options.iv) : randomBytes(IV_BYTES)
  if (iv.length !== IV_BYTES) {
    throw new SecretBoxError('malformed', `A secret box IV must be ${IV_BYTES} bytes.`)
  }
  const cipher = createCipheriv(ALGORITHM, Buffer.from(key.material), iv, {
    authTagLength: TAG_BYTES,
  })
  cipher.setAAD(additionalData(key.id, options.context))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    SECRET_BOX_VERSION,
    key.id,
    toBase64Url(iv),
    toBase64Url(ciphertext),
    toBase64Url(tag),
  ].join('.')
}

/**
 * Opens a sealed value with whichever key in the ring it names.
 *
 * Throws {@link SecretBoxError}: `malformed` for anything not shaped like a
 * sealed value, `unsupported-version`, `unknown-key` when the ring has no key
 * by that id, and `refused` when authentication fails.
 */
export function openSecret(
  sealed: string,
  keys: SecretBoxKeyring | SecretBoxKey | readonly SecretBoxKey[],
  options: { context?: string } = {},
): OpenedSecret {
  if (typeof sealed !== 'string' || !sealed) {
    throw new SecretBoxError('malformed', 'The sealed value is empty.')
  }
  const parts = sealed.split('.')
  if (parts.length !== 5) {
    throw new SecretBoxError('malformed', 'The sealed value does not have five parts.')
  }
  const [version, keyId, ivPart, ciphertextPart, tagPart] = parts
  if (version !== SECRET_BOX_VERSION) {
    throw new SecretBoxError(
      'unsupported-version',
      'The sealed value was made by a scheme this reader does not open.',
    )
  }
  if (!KEY_ID.test(keyId)) {
    throw new SecretBoxError('malformed', 'The sealed value names an unusable key id.')
  }
  const iv = decodeBase64Url(ivPart, IV_BYTES)
  // An empty ciphertext is a sealed empty string, and legitimate.
  const ciphertext = ciphertextPart ? decodeBase64Url(ciphertextPart) : Buffer.alloc(0)
  const tag = decodeBase64Url(tagPart, TAG_BYTES)

  const key = asKeyring(keys).find((candidate) => candidate.id === keyId)
  if (!key) {
    throw new SecretBoxError(
      'unknown-key',
      'The sealed value was sealed under a key this reader does not hold.',
    )
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, Buffer.from(key.material), iv, {
      authTagLength: TAG_BYTES,
    })
    decipher.setAAD(additionalData(keyId, options.context))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
    return { plaintext, keyId }
  } catch {
    throw new SecretBoxError(
      'refused',
      'The sealed value did not authenticate: it was altered, or the key or context is wrong.',
    )
  }
}

/** Whether a value opened under an earlier key and should be sealed again. */
export function needsReseal(opened: OpenedSecret, keyring: SecretBoxKeyring): boolean {
  return opened.keyId !== keyring.current.id
}

/** The id of the key a sealed value names, or `null` when it is not one. */
export function sealedSecretKeyId(sealed: unknown): string | null {
  if (typeof sealed !== 'string') return null
  const parts = sealed.split('.')
  return parts.length === 5 && parts[0] === SECRET_BOX_VERSION && KEY_ID.test(parts[1])
    ? parts[1]
    : null
}
