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

/**
 * Personal-data export — access and portability, in a machine-readable form
 * (AGL-1974).
 *
 * Privacy Policy §7 grants portability (GDPR Art. 20) and nothing in the
 * product exported a person's or a workspace's personal data. Six surfaces
 * told customers to "export first" before deleting — the org settings Delete
 * tab, the Close account card, `erase-org-cli.mjs`, the staff org actions,
 * live DPA §11 and Terms §13.3 — all pointing at something that did not
 * exist. An access request was assembled by a staff member reading the console
 * by hand.
 *
 * ## THE PROPERTY THIS FILE EXISTS FOR
 *
 * **An export whose coverage differs from erasure's is a bug in one of them.**
 * Both answer the same question — *what do we hold about this subject* — and
 * the honest failure modes are symmetric: an export that misses a collection
 * under-discloses on an access request, and an erasure that misses the same
 * one leaves data behind after we said it was gone. Historically the second
 * kept happening (AGL-1444, AGL-1448, AGL-1970, AGL-1971 each found a
 * collection outside the cascade), which is exactly the evidence that a list
 * kept in one place and mirrored by hand in another will drift.
 *
 * The ideal is one enumeration both derive from. That is not available here:
 * `erase.ts` is under concurrent change and its sweep list is expressed as
 * code, not data. So the coverage is enumerated ONCE below, as data, and
 * `personal-data-export-coverage.spec.ts` DISCOVERS every collection
 * `erase.ts` touches out of its source and fails when the two disagree. A new
 * sweep added to the erasure turns this file red until somebody decides
 * whether the export discloses it — which is the decision that was being
 * skipped.
 *
 * That guard is worth more than the feature.
 *
 * ## What must NOT come out wholesale
 *
 * Three categories, and each is a way an access request becomes a breach:
 *
 *  1. **Another person's data.** A workspace is shared. A member asking what
 *     we hold about THEM gets their own roster row, not the roster; their own
 *     support messages, not the thread's other authors. Handled by exporting
 *     the person and the workspace as different subjects with different
 *     scopes, never by filtering a single blob after the fact.
 *  2. **Secrets.** An `apiKeys` row confirms that a credential exists — its
 *     label, scopes, creator and dates, which are all facts about the subject
 *     — and never re-discloses the credential. Note the document ID *is* the
 *     SHA-256 of the token, so the id itself is withheld too; a hash handed
 *     back is a verifier handed back.
 *  3. **Staff-only fields.** Internal notes, override reasons and moderation
 *     state are about our handling, not about the person, and several name a
 *     staff member.
 *
 * ## What it is NOT
 *
 * Not `GET /api/hosts/export` — that is a Pro+ site-design backup whose own
 * header says it never includes bookings, leads, submissions or secrets, and
 * offering it as a portability answer would be misdescribing it. Not the
 * `firestore-export` cron, which is an unscoped DR snapshot. Not the audit CSV.
 */

import { firebaseAdmin } from './firebase-admin'
import { CONSOLE_DOMAINS_COLLECTION } from './console-domains'

const firestoreApp = () => firebaseAdmin.app().firestore()

/** Which subject an export source belongs to. */
export type ExportSubject = 'user' | 'org'

/** How a source is located — the axis a path cascade is blind to. */
export type ExportKeying =
  /** Top-level collection carrying the subject id in a FIELD. */
  | 'field'
  /** Top-level collection whose DOCUMENT ID is the subject id. */
  | 'doc-id'
  /** Under the subject's own document path. */
  | 'path'
  /** Reached through another collection's rows (a collection group). */
  | 'collection-group'
  /** Outside Firestore entirely. */
  | 'external'

export interface ExportSourceSpec {
  /** Firestore collection name, or an `external:` pseudo-name. */
  collection: string
  keyedBy: ExportKeying
  subjects: readonly ExportSubject[]
  /**
   * `true` when the export discloses it. `false` requires `reason` — and the
   * reason is the whole value of the field: it is a decision recorded at the
   * moment it was made, not an omission discovered later.
   */
  exported: boolean
  /** Why it is withheld, or how it is disclosed. Always present. */
  note: string
}

/**
 * Every collection `erase.ts` touches, and what the export does with it.
 *
 * Kept in the SAME order as the erasure's steps so a reader comparing the two
 * files reads them in step. `personal-data-export-coverage.spec.ts` proves the
 * set matches; this list carries the decision for each one.
 */
export const PERSONAL_DATA_SOURCES: readonly ExportSourceSpec[] = [
  // ── The person ────────────────────────────────────────────────────────
  {
    collection: 'users',
    keyedBy: 'doc-id',
    subjects: ['user'],
    exported: true,
    note: 'Profile: name, phone, postal address, legalAcceptances, and every subcollection (orgs, hostMemberships, notifications, passkeys).',
  },
  {
    collection: 'profiles',
    keyedBy: 'doc-id',
    subjects: ['user'],
    exported: true,
    note: 'The world-readable handle, display name and Stripe Connect account. Not reachable from the user tree (AGL-1970) — the same blind spot on both sides.',
  },
  // ── The workspace ─────────────────────────────────────────────────────
  {
    collection: 'orgs',
    keyedBy: 'doc-id',
    subjects: ['org'],
    exported: true,
    note: 'The org document and every subcollection: members, invites, roles, usage, apiUsage, analytics, datasets/records, contacts, lists, media, installs, activity, assistExchanges, retention.',
  },
  {
    collection: 'hosts',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'Each site tree the org owns — screens, layouts, orders, form submissions. Secrets within are redacted, not omitted, so the export still says a webhook exists.',
  },
  {
    collection: 'hostIndex',
    keyedBy: 'doc-id',
    subjects: ['org'],
    exported: true,
    note: 'Subdomain/CNAME routing for each of the org’s sites. Configuration the customer set, so it is theirs to take.',
  },
  {
    collection: 'supplierDeliveries',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'The dropship outbox for each of the org’s sites, keyed by hostId (AGL-1448). Disclosed to the ORG and to no one else, and the reason is the unusual one: the personal data in the row is a SHOPPER’s — name, email and shipping address in the body we sign and POST to the supplier. That is the merchant’s own order record, which they already read in their console and for which they are the controller and we the processor, so an org access request is entitled to it. It is NOT a `user`-subject source: a console member asking what we hold about THEM is not the shopper, and returning these rows would answer their request with a third party’s address. Withholding it was not an option worth taking — `eraseHost` destroys these rows, so an export that omitted them would delete what it never disclosed.',
  },
  // ── Top-level, field-keyed: what a path cascade cannot see ────────────
  {
    collection: 'apiKeys',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'EXISTENCE ONLY — label, scopes, creating uid, dates. Never the credential, and never the document id, which is the SHA-256 of the token.',
  },
  {
    collection: 'ssoDomains',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'The public SSO routing document: domain, GCIP tenant and provider ids, IdP display name. `token` is redacted.',
  },
  {
    collection: CONSOLE_DOMAINS_COLLECTION,
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'Custom console domain claims the org holds.',
  },
  {
    collection: 'apiIdempotency',
    keyedBy: 'field',
    subjects: ['org'],
    exported: false,
    note: 'Replay keys. The document id is a SHA-256 of the org id and the caller’s Idempotency-Key, and the row names a record id and nothing about a person. Disclosed as a COUNT so the export does not silently omit a collection the erasure destroys.',
  },
  {
    collection: 'stripeCustomers',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'The local reverse index: which Stripe customer id belongs to this workspace. An identifier the customer already holds on their own invoices.',
  },
  {
    collection: 'orgSlugs',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'Every workspace name the org has ever held, rename tombstones included — naming history is a fact about them.',
  },
  {
    collection: 'publisherHandles',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'Marketplace handle reservations and rename tombstones (AGL-1970).',
  },
  {
    collection: 'publisherProfiles',
    keyedBy: 'doc-id',
    subjects: ['org'],
    exported: true,
    note: 'The public publisher identity — handle, display name, bio, website, avatar, publisher agreement. `stripeAccountId` is the org’s own payout destination and is disclosed; nothing here is a credential.',
  },
  {
    collection: 'marketplaceListings',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'Listings the org published. These deliberately OUTLIVE an erasure (AGL-1448 Tier 3) — which makes disclosing them on an access request more important, not less: they are the part that does not go away.',
  },
  {
    collection: 'supportTickets',
    keyedBy: 'field',
    subjects: ['org', 'user'],
    exported: true,
    note: 'For an ORG: every thread and its messages. For a PERSON: only the messages they themselves authored — a thread has other authors, and handing a member the whole conversation would disclose colleagues’ words to them.',
  },
  // ── Retained past erasure on statutory grounds ────────────────────────
  {
    collection: 'platformRevenue',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'Per-transaction tax filing records. GDPR Art. 17(3)(b) exempts them from ERASURE (AGL-1811); it does not exempt them from ACCESS. If a transaction of theirs is in there it is disclosable — and the export is the only place a customer can see what survived their erasure.',
  },
  {
    collection: 'storefrontTaxCollected',
    keyedBy: 'field',
    subjects: ['org'],
    exported: true,
    note: 'Sales tax charged to shoppers on the org’s storefront (AGL-1904). Same statutory retention, same access obligation.',
  },
  // ── Records of our own handling ───────────────────────────────────────
  {
    collection: 'adminAudit',
    keyedBy: 'field',
    subjects: ['org', 'user'],
    exported: false,
    note: 'STAFF-ONLY. Rows name the staff actor, carry override reasons and internal notes, and are the record of our handling rather than data about the subject. `/admin/audit` → Export CSV serves a request that specifically asks for them, after a staff read.',
  },
]

/** Sources this export deliberately withholds, with the reason. */
export const EXPORT_WITHHELD = PERSONAL_DATA_SOURCES.filter((s) => !s.exported)

/** Collection names the export claims to cover, for the coverage guard. */
export const EXPORT_COVERED_COLLECTIONS: readonly string[] =
  PERSONAL_DATA_SOURCES.map((source) => source.collection)

/**
 * ## WHY THIS IS SHAPE-DRIVEN AND NOT A LIST OF NAMES
 *
 * It used to be a list of names, anchored on separators:
 *
 *     /(^|[._-])(secret|token|password|apikey|…)($|[._-])/i
 *
 * That pattern requires a `.`, `_`, `-`, or a string boundary on both sides
 * of the word, so it reads `password_hash` and `webhooks.secret` and misses
 * `supplierToken` and `passwordScrypt` — the exact two fields the AGL-1881
 * review found leaving the platform in a customer's own export file. One is
 * a live bearer credential a supplier authenticates with; the other is a
 * shopper's scrypt password hash. **A denylist of names is always one naming
 * convention behind, and camelCase is the proof.**
 *
 * So the name half is now tokenized rather than separator-anchored, and it is
 * no longer the only gate. Three run, in order, and any of them redacts:
 *
 *  * **(A) The name, tokenized.** `supplierToken` splits to
 *    `['supplier','token']` the same way `supplier_token` and
 *    `SUPPLIER-TOKEN` do, so the convention stops mattering. A name matches
 *    on a single secret word or on an adjacent pair (`client secret`).
 *  * **(B) The VALUE's shape, whatever the key is called.** This is the half
 *    that does not need to know the schema: a PEM block, a JWT, a vendor
 *    prefix (`sk_live_`, `whsec_`, `ghp_`, `AKIA`…), a `$2b$`/`$argon2` hash,
 *    this repo's own `salt:hash` scrypt form, or an opaque high-entropy
 *    string is a credential whether the field is called `supplierToken`,
 *    `t`, or `notes`. **Gate B is the "redact unless known safe" default**:
 *    a credential-shaped string is withheld unless its key names it as a
 *    content identifier (see {@link SAFE_VALUE_WORDS}).
 *  * **(C) Credentials carried inside a URL.** `?token=`, `?sig=`,
 *    `?key=`, and `https://user:pass@host` are stripped from the URL rather
 *    than the URL being blanked, because a media object's `url` field really
 *    does carry a live Firebase download token in a query parameter, and the
 *    location of the customer's own file is exactly what an access request
 *    asks for. Precision beats blanking here.
 *
 * ### Why the KEY half is still deny-based, when the value half is not
 *
 * A true allowlist of field names is not available on this data. The export
 * walks documents whose field names our customers author — canvas nodes,
 * dataset records, custom metadata, form submissions — so an allowlist of
 * names would blank most of the file and turn an access request into a
 * non-answer, which is the under-disclosure this feature exists to stop. The
 * allowlist therefore lives where the vocabulary IS ours: value shapes. An
 * unrecognized VALUE shape is passed through (it is prose, a number, a date,
 * a customer's own content); an unrecognized value shape that looks like a
 * credential is withheld. That is the inversion the review asked for, put
 * where it can hold.
 *
 * ### The one deliberate carve-out
 *
 * `token`/`tokens` is also a metering word — `tokensUsed: 14203` on an
 * assist exchange is a usage count, and blanking it would blank a real
 * disclosure. A credential is a STRING; a count is a number. So a numeric or
 * boolean value under a name that matched only on a metering word passes
 * through. Nothing else in the vocabulary gets that treatment.
 *
 * A false positive costs a redacted field in an export. A false negative
 * costs a credential. Everything below is tuned in that direction.
 */

/**
 * Split a field name into lowercase word tokens, convention-independently.
 *
 * `supplierToken`, `supplier_token`, `SUPPLIER-TOKEN` and `Supplier.Token`
 * all become `['supplier','token']`. Acronym runs split at the last capital
 * (`SSOTokenId` → `['sso','token','id']`) and digits break a word
 * (`apiKey2` → `['api','key','2']`), so a numbered field cannot hide.
 */
export function fieldNameTokens(key: unknown): string[] {
  return String(key ?? '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
}

/**
 * Words that make a field a credential on their own.
 *
 * Deliberately short. Every entry here is a word that has no innocent
 * meaning on a stored VALUE — `hmac`, `scrypt` and `bcrypt` name the
 * algorithm that produced a verifier, `passphrase` and `credential` name the
 * thing itself. `key` is NOT here and must never be: `publicKey` on a
 * passkey and `sortKey` on a dataset are not secrets, which is what
 * {@link SECRET_WORD_PAIRS} is for.
 */
const SECRET_WORDS = new Set([
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwd',
  'pwd',
  'passphrase',
  'token',
  'tokens',
  'credential',
  'credentials',
  'apikey',
  'privatekey',
  'scrypt',
  'bcrypt',
  'argon',
  'argon2',
  'pbkdf2',
  'hmac',
  'otp',
  'totp',
  'authorization',
])

/**
 * Words that are a credential only next to another word.
 *
 * `key` is meaningless alone and decisive after `api`, `private`, `signing`,
 * `secret`, `session` or `encryption`; `token` after `access`/`refresh` is
 * already caught by {@link SECRET_WORDS} and listed here anyway so the pair
 * table reads as the complete statement of the rule.
 */
const SECRET_WORD_PAIRS = new Set([
  'api key',
  'private key',
  'signing key',
  'secret key',
  'session key',
  'encryption key',
  'client secret',
  'access token',
  'refresh token',
  'webhook secret',
  'shared secret',
  // A Stripe payment link is a live bearer URL: whoever holds it can pay.
  // Named in the AGL-1443 inventory of what the old dump actually carried.
  'payment link',
  'auth code',
  'recovery code',
  'backup code',
])

/**
 * The metering carve-out — see the header. A name that matched ONLY on one
 * of these, over a number or a boolean, is a count and is disclosed.
 */
const METERING_WORDS = new Set(['token', 'tokens'])

/**
 * Key words that mark a high-entropy value as a content identifier rather
 * than a credential, defusing gate (B) only.
 *
 * A SHA-256 has exactly the shape of a 64-character secret and is not one.
 * Gate (A) is never defused by this list: `apiKeyId` is redacted, because
 * the name says credential and an id of a credential is not worth the
 * argument.
 */
const SAFE_VALUE_WORDS = new Set([
  // A passkey's `publicKey` is public by definition and has exactly the shape
  // of a secret. Safe to list because gate (A) is never defused here — a
  // `publicToken` is still redacted, on the strength of `token`.
  'public',
  'id',
  'ids',
  'uid',
  'uuid',
  'guid',
  'hash',
  'hashes',
  'sha',
  'sha1',
  'sha256',
  'sha512',
  'md5',
  'crc',
  'crc32c',
  'etag',
  'checksum',
  'digest',
  'fingerprint',
  'generation',
  'version',
  'revision',
  'slug',
  'path',
  'url',
  'uri',
  'href',
  'src',
  'color',
  'colour',
  'hex',
])

/** Vendor credential prefixes — unambiguous, and worth naming explicitly. */
const CREDENTIAL_PREFIXES = [
  'sk_live_',
  'sk_test_',
  'rk_live_',
  'rk_test_',
  'whsec_',
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'github_pat_',
  'xoxb-',
  'xoxp-',
  'xapp-',
  'xoxa-',
  'AKIA',
  'ASIA',
  'AIza',
  'ya29.',
  'SG.',
  're_',
  'shpat_',
  'shpss_',
  'npm_',
  'glpat-',
  'sq0csp-',
  'sq0atp-',
]

/** A PEM block that carries a private key or a certificate request. */
const PEM_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/

/** Modular crypt format: bcrypt, argon2, scrypt, PBKDF2, sha512-crypt. */
const CRYPT_HASH_PATTERN = /^\$(2[abxy]?|argon2[a-z]*|scrypt|pbkdf2[^$]*|[56])\$/

/** This repo's own scrypt storage form: `{16+ hex salt}:{32+ hex hash}`. */
const SALTED_HASH_PATTERN = /^[0-9a-f]{16,}:[0-9a-f]{32,}$/i

/** A JSON Web Token — three base64url segments. */
const JWT_PATTERN = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/

/** A UUID, which is an identifier far more often than it is a credential. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Charset of an opaque credential: base64, base64url or hex, nothing else. */
const OPAQUE_CHARSET = /^[A-Za-z0-9_+/=-]+$/

/**
 * The window an opaque secret lives in.
 *
 * Below 32 characters the false-positive rate against ordinary identifiers is
 * not worth it and the value is too short to be a modern credential anyway.
 * Above 512 it is customer CONTENT — a base64 image, a compressed canvas
 * blob, an encoded document — and blanking those is the "gutting the export"
 * failure this file is explicitly trying not to commit.
 */
const OPAQUE_MIN_LENGTH = 32
const OPAQUE_MAX_LENGTH = 512

/** Shannon entropy per character. Prose and slugs sit well below this. */
const OPAQUE_MIN_ENTROPY = 3.2

function shannonEntropyPerChar(text: string): number {
  const counts = new Map<string, number>()
  for (const character of text) {
    counts.set(character, (counts.get(character) ?? 0) + 1)
  }
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / text.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/**
 * Does this STRING look like a credential, ignoring what it is called?
 *
 * Exported because the guard spec asserts each limb independently — a shape
 * detector tested only through the redactor is a detector whose gaps are
 * invisible.
 */
export function looksLikeCredential(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (PEM_PATTERN.test(text)) return true
  if (CRYPT_HASH_PATTERN.test(text)) return true
  if (SALTED_HASH_PATTERN.test(text)) return true
  if (CREDENTIAL_PREFIXES.some((prefix) => text.startsWith(prefix))) return true
  if (JWT_PATTERN.test(text)) return true
  // Anything with whitespace is prose, and `data:` is an inline asset. Both
  // are customer content, and neither is a bearer credential.
  if (/\s/.test(text)) return false
  if (/^data:/i.test(text)) return false
  if (UUID_PATTERN.test(text)) return false
  if (text.length < OPAQUE_MIN_LENGTH || text.length > OPAQUE_MAX_LENGTH) {
    return false
  }
  if (!OPAQUE_CHARSET.test(text)) return false
  return shannonEntropyPerChar(text) >= OPAQUE_MIN_ENTROPY
}

/** What a stripped URL parameter reads as, so the removal is visible. */
export const REDACTED_URL_PARAM = 'REDACTED'

/** Query parameters that carry a bearer credential inside a URL. */
const URL_CREDENTIAL_PARAMS = new Set([
  'token',
  'access_token',
  'accesstoken',
  'id_token',
  'refresh_token',
  'auth',
  'authorization',
  'apikey',
  'api_key',
  'key',
  'sig',
  'signature',
  'secret',
  'password',
  'downloadtoken',
])

/**
 * Strip the credential out of a URL, keeping the URL.
 *
 * A media object's `url` is `…/o/{path}?alt=media&token={uuid}` — a live,
 * unauthenticated download credential, in a field an access request has a
 * real interest in. Blanking the whole value would tell the customer nothing
 * about where their own file is; keeping it whole hands out the credential.
 * So the parameter is replaced and the rest survives. `user:pass@` userinfo
 * goes the same way.
 *
 * Returns the input unchanged when it is not a URL — every non-URL string
 * has already been decided by the shape gate.
 */
export function scrubUrlCredentials(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  let changed = false
  if (url.username || url.password) {
    url.username = ''
    url.password = ''
    changed = true
  }
  for (const name of Array.from(url.searchParams.keys())) {
    if (!URL_CREDENTIAL_PARAMS.has(name.toLowerCase())) continue
    if (!url.searchParams.get(name)) continue
    url.searchParams.set(name, REDACTED_URL_PARAM)
    changed = true
  }
  return changed ? url.toString() : value
}

/**
 * Gate (A): does the NAME say credential?
 *
 * `value` is consulted only for the metering carve-out described in the
 * header — a `tokensUsed: 14203` is a count, not a credential.
 */
export function secretByName(key: unknown, value?: unknown): boolean {
  const tokens = fieldNameTokens(key)
  if (!tokens.length) return false
  const hits = tokens.filter((token) => SECRET_WORDS.has(token))
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (SECRET_WORD_PAIRS.has(`${tokens[index]} ${tokens[index + 1]}`)) {
      return true
    }
  }
  if (!hits.length) return false
  // Matched only on a metering word, over a number or a boolean: a count.
  const metering = hits.every((token) => METERING_WORDS.has(token))
  if (metering && (typeof value === 'number' || typeof value === 'boolean')) {
    return false
  }
  return true
}

/** Gate (B)'s defuser: does the NAME say this high-entropy value is an id? */
function nameMarksContentIdentifier(key: unknown): boolean {
  return fieldNameTokens(key).some((token) => SAFE_VALUE_WORDS.has(token))
}

/** What a redacted value is replaced with — presence, never content. */
export interface RedactedValue {
  redacted: true
  /** Whether a value was actually there, so absence is distinguishable. */
  present: boolean
  reason: 'secret'
}

const redactedMarker = (present: boolean): RedactedValue => ({
  redacted: true,
  present,
  reason: 'secret',
})

/**
 * Deep-copy a document, replacing every credential-shaped value with a
 * presence marker.
 *
 * Presence rather than deletion, because "we hold a webhook secret for you"
 * is itself a true and disclosable fact, and a silently-absent key would make
 * the export look like it holds less than it does — the under-disclosure this
 * feature exists to stop, reintroduced by the safety measure.
 *
 * Firestore values that are not plain JSON (Timestamp, GeoPoint, DocumentRef,
 * Buffer) are stringified rather than walked: they carry no nested keys to
 * redact, and `JSON.stringify` on a Timestamp yields `{_seconds,_nanoseconds}`,
 * which is not a date to a human reading the file.
 *
 * Three gates, any of which redacts — the name (A), the value's shape (B),
 * and a credential embedded in a URL (C). See the header above
 * {@link fieldNameTokens} for why the value half is the one that carries the
 * "withhold unless known safe" default.
 */
export function redactSecrets(value: unknown, key = ''): unknown {
  // (A) The name, tokenized — convention-independent.
  if (key && secretByName(key, value)) {
    return redactedMarker(value !== undefined && value !== null && value !== '')
  }
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') {
    // (C) A URL that carries its credential in a parameter keeps the URL and
    // loses the credential — see {@link scrubUrlCredentials}.
    const scrubbed = scrubUrlCredentials(value)
    if (scrubbed !== value) return scrubbed
    // (B) The shape, whatever the field is called. Withheld unless the name
    // marks it as a content identifier.
    if (looksLikeCredential(value) && !nameMarksContentIdentifier(key)) {
      return redactedMarker(true)
    }
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, key))
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    // Firestore Timestamp — the only non-plain value common enough to be
    // worth rendering rather than dumping.
    if (typeof (source as any).toDate === 'function') {
      try {
        return (source as any).toDate().toISOString()
      } catch {
        return String(value)
      }
    }
    if (typeof (source as any).toBase64 === 'function') return '[binary]'
    const out: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(source)) {
      out[childKey] = redactSecrets(childValue, childKey)
    }
    return out
  }
  return value
}

export interface ExportedDocument {
  /** Document id — omitted where the id is itself a secret (see `apiKeys`). */
  id?: string
  path?: string
  data: unknown
}

export interface PersonalDataExport {
  subject: { type: ExportSubject; id: string }
  generatedAt: string
  /**
   * The disclosure decision for every source, copied into the file the
   * customer receives. An export that silently omits a collection is
   * indistinguishable from one that has nothing to report; this makes the two
   * different, and it is what a supervisory authority would ask to see.
   */
  coverage: readonly ExportSourceSpec[]
  /** Collection name → the documents disclosed for it. */
  data: Record<string, ExportedDocument[]>
  /** Collection name → row count, for sources disclosed as a count only. */
  counts: Record<string, number>
  /** Places we hold data that is not in Firestore. */
  elsewhere: readonly string[]
}

/** Data we hold outside Firestore — named, because a file that omits them reads as complete. */
const ELSEWHERE = [
  'Stripe — customer object, payment methods, invoices. Request from Stripe or ask us.',
  'Resend — transactional email delivery logs.',
  'Google Analytics — 14-month retention, not keyed to an account.',
  'Cloud Storage — uploaded media and avatars, under users/{uid}/, orgs/{orgId}/ and hosts/{hostId}/. Listed by path in this file; the bytes are served by their own URLs.',
]

function sourcesFor(subject: ExportSubject): ExportSourceSpec[] {
  return PERSONAL_DATA_SOURCES.filter((source) => source.subjects.includes(subject))
}

/** Read a top-level collection bounded by a field equal to the subject id. */
async function readByField(
  db: any,
  collection: string,
  field: string,
  id: string,
  options: { includeIds?: boolean } = {},
): Promise<ExportedDocument[]> {
  const rows = await db.collection(collection).where(field, '==', id).get()
  return rows.docs.map((doc: any) => ({
    // `apiKeys` document ids are the SHA-256 of the token: an id handed back
    // is a verifier handed back, so the caller opts in rather than out.
    ...(options.includeIds === false ? {} : { id: doc.id }),
    data: redactSecrets(doc.data()),
  }))
}

/** Read one document by id, or nothing when it does not exist. */
async function readDoc(
  db: any,
  collection: string,
  id: string,
): Promise<ExportedDocument[]> {
  const snapshot = await db.collection(collection).doc(id).get()
  if (!snapshot.exists) return []
  return [{ id, data: redactSecrets(snapshot.data()) }]
}

/**
 * Walk a document and everything beneath it.
 *
 * `listCollections()` rather than a hard-coded subcollection list, for the
 * same reason the erasure uses `recursiveDelete`: a subcollection added next
 * quarter is reached without anybody remembering this file exists. Bounded by
 * `maxDepth` because the tree is customer-shaped and an unbounded recursion
 * inside a request is how AGL-1455 lost erasures to a 60-second timeout.
 */
async function readSubtree(
  db: any,
  ref: any,
  depth = 0,
  maxDepth = 4,
): Promise<ExportedDocument[]> {
  const snapshot = await ref.get()
  const found: ExportedDocument[] = []
  if (snapshot.exists) {
    found.push({ path: ref.path, data: redactSecrets(snapshot.data()) })
  }
  if (depth >= maxDepth) return found
  const children = (await ref.listCollections?.()) ?? []
  for (const child of children) {
    const rows = await child.get()
    for (const doc of rows.docs) {
      found.push(...(await readSubtree(db, doc.ref, depth + 1, maxDepth)))
    }
  }
  return found
}

export interface ExportOptions {
  /** Injectable for tests; defaults to the admin app's Firestore. */
  firestore?: any
  /** Stops a pathological workspace from building an unbounded file. */
  maxDepth?: number
}

/**
 * Everything we hold about a PERSON, as the person themselves may ask for it
 * (GDPR Art. 15 and Art. 20).
 *
 * Scoped to them, never to the workspaces they belong to. Their membership row
 * in each org is theirs; the roster around it is their colleagues'. An org
 * export is a separate call with a separate authorization, which is the whole
 * reason the two are different functions rather than one with a flag.
 */
export async function exportUserData(
  uid: string,
  options: ExportOptions = {},
): Promise<PersonalDataExport> {
  const db = options.firestore ?? firestoreApp()
  const data: Record<string, ExportedDocument[]> = {}
  const counts: Record<string, number> = {}

  // The profile tree — `users/{uid}` and every subcollection under it.
  data['users'] = await readSubtree(
    db,
    db.collection('users').doc(uid),
    0,
    options.maxDepth ?? 4,
  )

  // The public identity, which the user tree does not reach (AGL-1970).
  data['profiles'] = await readDoc(db, 'profiles', uid)

  // ONLY the messages this person wrote. The threads belong to a workspace
  // and carry other people's words; handing a member the whole conversation
  // to answer their own access request is a disclosure nobody consented to.
  const messages = await db
    .collectionGroup('messages')
    .where('authorId', '==', uid)
    .get()
    .catch(() => ({ docs: [] as any[] }))
  data['supportTickets'] = messages.docs.map((doc: any) => ({
    path: doc.ref.path,
    data: redactSecrets(doc.data()),
  }))

  return {
    subject: { type: 'user', id: uid },
    generatedAt: new Date().toISOString(),
    coverage: sourcesFor('user'),
    data,
    counts,
    elsewhere: ELSEWHERE,
  }
}

/**
 * Everything we hold about a WORKSPACE, for its owner (Art. 15 for the
 * personal data in it, and the "export before you delete" the Delete tab,
 * DPA §11 and Terms §13.3 have been promising).
 *
 * Every top-level collection the erasure sweeps by `orgId` is read here by the
 * same bound, so the two see the same rows. Where a source is withheld, its
 * COUNT is still reported: a collection that appears in neither the data nor
 * the counts is indistinguishable from one that does not exist, and that
 * ambiguity is what makes an incomplete export undetectable.
 */
export async function exportOrgData(
  orgId: string,
  options: ExportOptions = {},
): Promise<PersonalDataExport> {
  const db = options.firestore ?? firestoreApp()
  const data: Record<string, ExportedDocument[]> = {}
  const counts: Record<string, number> = {}

  data['orgs'] = await readSubtree(
    db,
    db.collection('orgs').doc(orgId),
    0,
    options.maxDepth ?? 4,
  )

  // Sites: the routing entry and the whole tree for each.
  const hosts = await db.collection('hosts').where('orgId', '==', orgId).get()
  const hostDocs: ExportedDocument[] = []
  const routing: ExportedDocument[] = []
  const outbox: ExportedDocument[] = []
  for (const host of hosts.docs) {
    hostDocs.push(...(await readSubtree(db, host.ref, 0, options.maxDepth ?? 4)))
    routing.push(...(await readDoc(db, 'hostIndex', host.id)))
    // Keyed by `hostId`, not `orgId`, so it is read here rather than in the
    // field-keyed loop below — the same bound `eraseHostSupplierDeliveries`
    // sweeps by, so the export and the erasure see the same rows.
    outbox.push(...(await readByField(db, 'supplierDeliveries', 'hostId', host.id)))
  }
  data['hosts'] = hostDocs
  data['hostIndex'] = routing
  data['supplierDeliveries'] = outbox

  // The field-keyed collections a path cascade is blind to — the ones the
  // erasure had to grow a sweep for, one issue at a time.
  for (const collection of [
    'ssoDomains',
    CONSOLE_DOMAINS_COLLECTION,
    'stripeCustomers',
    'orgSlugs',
    'publisherHandles',
    'platformRevenue',
    'storefrontTaxCollected',
  ]) {
    data[collection] = await readByField(db, collection, 'orgId', orgId)
  }

  // Existence, never the credential — and not the id either, which is the
  // token's SHA-256.
  data['apiKeys'] = await readByField(db, 'apiKeys', 'orgId', orgId, {
    includeIds: false,
  })

  data['publisherProfiles'] = await readDoc(db, 'publisherProfiles', orgId)
  data['marketplaceListings'] = await readByField(
    db,
    'marketplaceListings',
    'profileId',
    orgId,
  )

  // Support threads WITH their messages — for an org the whole thread is the
  // org's own record, unlike the person-scoped export above.
  const tickets = await db
    .collection('supportTickets')
    .where('orgId', '==', orgId)
    .get()
  const ticketDocs: ExportedDocument[] = []
  for (const ticket of tickets.docs) {
    ticketDocs.push(...(await readSubtree(db, ticket.ref, 0, 2)))
  }
  data['supportTickets'] = ticketDocs

  // Withheld, but counted — see the note on this function.
  const replayKeys = await db
    .collection('apiIdempotency')
    .where('orgId', '==', orgId)
    .get()
  counts['apiIdempotency'] = replayKeys.docs.length

  return {
    subject: { type: 'org', id: orgId },
    generatedAt: new Date().toISOString(),
    coverage: sourcesFor('org'),
    data,
    counts,
    elsewhere: ELSEWHERE,
  }
}

/** A filename a human can file: subject, id and the date it was produced. */
export function exportFilename(exported: PersonalDataExport): string {
  const day = exported.generatedAt.slice(0, 10)
  return `aglyn-${exported.subject.type}-data-${exported.subject.id}-${day}.json`
}

export default exportUserData
