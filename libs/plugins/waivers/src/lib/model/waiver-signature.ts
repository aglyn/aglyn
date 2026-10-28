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
  WAIVER_DEFAULT_ADULT_AGE,
  WAIVER_LIMITS,
  addDays,
  formatDayKey,
  isDayKey,
  validityLabel,
  waiverAdultAge,
  waiverBodyText,
  type WaiverDraft,
  type WaiverValidity,
} from './waiver'

/*==========================================
 * ONE SIGNING (AGL-4042): who signed, for which minors, what they ticked,
 * how they signed, and the trail a merchant shows when asked. Pure: the
 * signing form checks with the same rules the server enforces.
 *=========================================*/

/** `online`: before arriving; `at_window`: a tablet staff handed over; `paper`: recorded from a clipboard. */
export type WaiverSignMethod = 'online' | 'at_window' | 'paper'

export const WAIVER_METHOD_LABELS: Record<WaiverSignMethod, string> = {
  online: 'Online',
  at_window: 'At the window',
  paper: 'On paper',
}

/**
 * The age below which somebody is a minor on a waiver that sets none, so a
 * parent or guardian signs for them. Each waiver sets its own adult age
 * (`waiverAdultAge`); this is the one a waiver saved before that setting
 * reads as.
 */
export const WAIVER_ADULT_AGE = WAIVER_DEFAULT_ADULT_AGE

/**
 * The sentence a signer agrees to before an electronic signature counts as
 * theirs (the consent the US ESIGN Act and UETA ask for). Stored on every
 * signature exactly as shown, with its version, so a later wording change
 * never rewrites what somebody agreed to. It says what signing electronically
 * means for the signer; it makes no claim about how a court reads a waiver.
 */
export const WAIVER_ESIGN_CONSENT = {
  version: 1,
  text:
    'I agree to sign this waiver electronically and to receive it and my signed copy by email. ' +
    'I intend my electronic signature to be my signature on this waiver. ' +
    'I can ask the business for a paper copy instead.',
} as const

export interface WaiverMinor {
  name: string
  dateOfBirth: string
}

export interface WaiverSigner {
  name: string
  email: string
  phone: string
  dateOfBirth: string
}

/** A drawn signature's strokes: each a list of `[x, y]` points, 0–1000 across the pad. */
export type WaiverStrokes = Array<Array<[number, number]>>

export type WaiverSignatureMark =
  | { kind: 'drawn'; strokes: WaiverStrokes }
  | { kind: 'typed'; text: string }

/** What a signing form sends. */
export interface WaiverSignInput {
  waiverId: string
  /** The version the signer read; a newer one is refused so they read it first. */
  version: number
  signer: WaiverSigner
  minors: WaiverMinor[]
  guardianRelationship: string
  /** The ids of the checkboxes ticked: every one, or the signing is refused. */
  checked: string[]
  signature: WaiverSignatureMark
  consent: boolean
}

/** A signature as stored, under `orgs/{orgId}/waiverSignatures/{id}`. */
export interface StoredWaiverSignature {
  id: string
  orgId: string
  hostId: string
  waiverId: string
  waiverTitle: string
  version: number
  /** The exact text agreed to, kept as a snapshot, and its sha256 (hex). */
  signedText: string
  signedTextSha256: string
  /**
   * The adult age the signing was checked against: the waiver's own, as it
   * stood at the version signed. Absent on a signature taken before each
   * waiver set its own, which was checked against the default.
   */
  adultAge?: number
  signer: WaiverSigner
  minors: WaiverMinor[]
  guardianRelationship: string | null
  checked: string[]
  signature:
    | { kind: 'drawn'; strokes: WaiverStrokes; imagePath: string | null }
    | { kind: 'typed'; text: string }
    | { kind: 'paper' }
  consent: { agreed: boolean; text: string; version: number } | null
  method: WaiverSignMethod
  signedAtMs: number
  /** The signing day in the site's time zone, and the days the signature covers. */
  dayKey: string
  validThroughDayKey: string
  timeZone: string
  audit: {
    ip: string | null
    userAgent: string | null
    /** The address the page was signed on. */
    signedOnHost: string | null
    staffUid: string | null
    staffName: string | null
  }
  paper: {
    photoPath: string | null
    recordedByUid: string
    recordedByName: string | null
    recordedAtMs: number
  } | null
  contactId: string | null
  /** Search keys: lowercased address, the signer's name, and each word of every name on it. */
  emailLower: string
  nameLower: string
  nameTokens: string[]
  /**
   * One match key per person the signature covers, the signer and each
   * minor: `name|YYYY-MM-DD`, the name lower case with its spacing settled
   * (`waiverNameDobKeys`, AGL-4042). What check-in matches a rider by when
   * their email matches nothing. Absent on a signature taken before the
   * field, until `backfill-waiver-name-dob-keys.mts` stamps it.
   */
  nameDobKeys?: string[]
  voidedAt: number | null
  voidedBy: string | null
  voidReason: string | null
  /**
   * The signer asked to be erased (AGL-4042). The signature is the store's
   * record of what they agreed to, so it is kept rather than deleted, until
   * {@link retainUntilMs}; the link to their people record is cleared, since
   * that record is erased. Absent or `null` for a signer who never asked.
   */
  erasure?: { requestedAtMs: number } | null
  /**
   * When the signature is deleted, epoch ms: the end of the store's waiver
   * retention period (`waiverRetainUntilMs`). The waivers retention job
   * deletes it, with its drawn signature and paper photo, on the first run
   * after. Stamped on every signature when it is signed, and again when the
   * store changes the period; absent only on one signed before every
   * signature was stamped, until the backfill or the job reaches it.
   */
  retainUntilMs?: number | null
  /** The retention period, in whole years, {@link retainUntilMs} was counted with. */
  retentionYears?: number | null
}

/** What the console list shows of one signature (no strokes, no snapshot). */
export interface WaiverSignatureRow {
  id: string
  waiverId: string
  waiverTitle: string
  version: number
  signerName: string
  email: string
  phone: string
  minors: WaiverMinor[]
  method: WaiverSignMethod
  signedAtMs: number
  dayKey: string
  validThroughDayKey: string
  voided: boolean
  /** Kept after its signer asked to be erased, until this time (epoch ms); `null` otherwise. */
  retainedUntilMs: number | null
}

export function signatureRow(signature: StoredWaiverSignature): WaiverSignatureRow {
  return {
    id: signature.id,
    waiverId: signature.waiverId,
    waiverTitle: signature.waiverTitle,
    version: signature.version,
    signerName: signature.signer?.name ?? '',
    email: signature.signer?.email ?? '',
    phone: signature.signer?.phone ?? '',
    minors: signature.minors ?? [],
    method: signature.method,
    signedAtMs: signature.signedAtMs,
    dayKey: signature.dayKey,
    validThroughDayKey: signature.validThroughDayKey,
    voided: Boolean(signature.voidedAt),
    retainedUntilMs: signature.erasure ? (signature.retainUntilMs ?? null) : null,
  }
}

const cleanLine = (value: unknown, max: number): string =>
  String(value ?? '')
    // Control characters out of a single line of what somebody typed.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Whole years between a date of birth and a day. */
export function ageOn(dateOfBirth: string, dayKey: string): number {
  if (!isDayKey(dateOfBirth) || !isDayKey(dayKey)) return Number.NaN
  const [by, bm, bd] = dateOfBirth.split('-').map(Number)
  const [y, m, d] = dayKey.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

/** The search keys of a signature's names. */
export function nameSearchTokens(names: readonly string[]): string[] {
  const tokens = new Set<string>()
  for (const name of names) {
    const lower = cleanLine(name, WAIVER_LIMITS.name).toLowerCase()
    if (!lower) continue
    tokens.add(lower)
    for (const word of lower.split(/[\s,.'’-]+/)) if (word.length >= 2) tokens.add(word)
  }
  return [...tokens].slice(0, 60)
}

/** One search box's words as the query it runs. */
export type WaiverSignatureSearch =
  | { kind: 'all' }
  | { kind: 'email'; value: string }
  | { kind: 'day'; value: string }
  | { kind: 'name'; value: string }

export function parseSignatureSearch(raw: unknown): WaiverSignatureSearch {
  const value = cleanLine(raw, WAIVER_LIMITS.name).toLowerCase()
  if (!value) return { kind: 'all' }
  if (isDayKey(`${value}`)) return { kind: 'day', value }
  if (value.includes('@')) return { kind: 'email', value }
  return { kind: 'name', value }
}

function normalizeStrokes(raw: unknown): WaiverStrokes | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 60) return null
  const strokes: WaiverStrokes = []
  let points = 0
  for (const stroke of raw) {
    if (!Array.isArray(stroke) || !stroke.length) continue
    const line: Array<[number, number]> = []
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2) return null
      const [x, y] = point.map((n) => Math.round(Number(n)))
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) return null
      line.push([x, y])
    }
    points += line.length
    strokes.push(line)
  }
  if (!strokes.length || points < 4 || points > 4000) return null
  return strokes
}

/**
 * A signing from whatever a client sent, checked against the waiver it
 * names on the day it is signed, or the sentence that says what to fix.
 */
export function normalizeSignInput(
  raw: unknown,
  waiver: WaiverDraft & { version: number },
  dayKey: string,
  options: { method: Exclude<WaiverSignMethod, 'paper'> },
): { ok: true; input: WaiverSignInput } | { ok: false; error: string; code?: 'version' } {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (Number(body['version']) !== waiver.version) {
    return {
      ok: false,
      code: 'version',
      error: 'This waiver was updated while you were reading it. Read the new version and sign again.',
    }
  }
  const signerRaw = (body['signer'] && typeof body['signer'] === 'object' ? body['signer'] : {}) as Record<string, unknown>
  const signer: WaiverSigner = {
    name: cleanLine(signerRaw['name'], WAIVER_LIMITS.name),
    email: cleanLine(signerRaw['email'], WAIVER_LIMITS.email).toLowerCase(),
    phone: cleanLine(signerRaw['phone'], WAIVER_LIMITS.phone),
    dateOfBirth: cleanLine(signerRaw['dateOfBirth'], 10),
  }
  if (!signer.name) return { ok: false, error: 'Enter your full name.' }
  if (options.method === 'online' && !signer.email) {
    return { ok: false, error: 'Enter your email address, so we can send you a signed copy.' }
  }
  if (signer.email && !EMAIL.test(signer.email)) return { ok: false, error: 'Check your email address.' }
  if (!isDayKey(signer.dateOfBirth) || signer.dateOfBirth > dayKey) {
    return { ok: false, error: 'Enter your date of birth.' }
  }
  const adultAge = waiverAdultAge(waiver)
  if (ageOn(signer.dateOfBirth, dayKey) < adultAge) {
    return {
      ok: false,
      error: `Anyone under ${adultAge} needs a parent or guardian to sign for them.`,
    }
  }
  const minorsRaw = Array.isArray(body['minors']) ? body['minors'] : []
  if (minorsRaw.length && !waiver.allowMinors) {
    return { ok: false, error: 'This waiver can’t be signed for minors. Each rider signs their own.' }
  }
  if (minorsRaw.length > WAIVER_LIMITS.minors) {
    return { ok: false, error: `Sign for up to ${WAIVER_LIMITS.minors} minors at a time.` }
  }
  const minors: WaiverMinor[] = []
  for (const [index, entry] of minorsRaw.entries()) {
    const minor = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const name = cleanLine(minor['name'], WAIVER_LIMITS.name)
    const dateOfBirth = cleanLine(minor['dateOfBirth'], 10)
    if (!name) return { ok: false, error: `Enter minor ${index + 1}’s full name.` }
    if (!isDayKey(dateOfBirth) || dateOfBirth > dayKey) {
      return { ok: false, error: `Enter ${name}’s date of birth.` }
    }
    if (ageOn(dateOfBirth, dayKey) >= adultAge) {
      return { ok: false, error: `${name} is ${adultAge} or older, so they sign their own waiver.` }
    }
    minors.push({ name, dateOfBirth })
  }
  const guardianRelationship = minors.length ? cleanLine(body['guardianRelationship'], WAIVER_LIMITS.relationship) : ''
  if (minors.length && !guardianRelationship) {
    return { ok: false, error: 'Say how you are related to the minors you are signing for, like Parent or Guardian.' }
  }
  const checkedRaw = new Set((Array.isArray(body['checked']) ? body['checked'] : []).map(String))
  const missing = waiver.checkboxes.find((box) => !checkedRaw.has(box.id))
  if (missing) return { ok: false, error: `Tick “${missing.label}” to sign.` }
  if (body['consent'] !== true) {
    return { ok: false, error: 'Agree to sign electronically, or ask for a paper waiver.' }
  }
  const markRaw = (body['signature'] && typeof body['signature'] === 'object' ? body['signature'] : {}) as Record<
    string,
    unknown
  >
  let signature: WaiverSignatureMark
  if (markRaw['kind'] === 'typed') {
    const text = cleanLine(markRaw['text'], WAIVER_LIMITS.name)
    if (!text) return { ok: false, error: 'Type your name to sign.' }
    signature = { kind: 'typed', text }
  } else {
    const strokes = normalizeStrokes(markRaw['strokes'])
    if (!strokes) return { ok: false, error: 'Sign in the box, or type your name instead.' }
    signature = { kind: 'drawn', strokes }
  }
  return {
    ok: true,
    input: {
      waiverId: String(body['waiverId'] ?? ''),
      version: waiver.version,
      signer,
      minors,
      guardianRelationship,
      checked: waiver.checkboxes.map((box) => box.id),
      signature,
      consent: true,
    },
  }
}

/**
 * The exact text a signer agreed to: the waiver's title, version, words,
 * every checkbox and how long it lasts, then the e-signature consent. The
 * signer's own details are not in it, so every signer of one version agrees
 * to the same text and the same hash. Paper signings carry no consent line.
 */
export function waiverSignedText(
  waiver: WaiverDraft & { version: number },
  options: { consent: boolean },
): string {
  const parts = [
    waiver.title,
    `Version ${waiver.version}`,
    waiverBodyText(waiver.body),
    ...waiver.checkboxes.map((box) => `[x] ${box.label}`),
    validityLabel(waiver.validity),
  ]
  if (options.consent) parts.push(`Electronic signature consent: ${WAIVER_ESIGN_CONSENT.text}`)
  return parts.filter(Boolean).join('\n\n')
}

/** What one person's signatures say about a day. */
export interface WaiverDayStatus {
  /** Whether some live signature covers the day. */
  signed: boolean
  /** The names a live signature covers that day: the signer, then minors. */
  coveredNames: string[]
  /** The newest covering signature, when there is one. */
  signatureId: string | null
}

/** A signature covers a day when it is not voided and the day is inside its window. */
export function signatureCovers(signature: Pick<StoredWaiverSignature, 'voidedAt' | 'dayKey' | 'validThroughDayKey'>, dayKey: string): boolean {
  return !signature.voidedAt && signature.dayKey <= dayKey && dayKey <= signature.validThroughDayKey
}

export function waiverDayStatus(
  signatures: readonly Pick<
    StoredWaiverSignature,
    'id' | 'voidedAt' | 'dayKey' | 'validThroughDayKey' | 'signer' | 'minors' | 'signedAtMs'
  >[],
  dayKey: string,
): WaiverDayStatus {
  const covering = signatures
    .filter((signature) => signatureCovers(signature, dayKey))
    .sort((a, b) => b.signedAtMs - a.signedAtMs)
  const names = new Map<string, string>()
  for (const signature of covering) {
    for (const name of [signature.signer?.name, ...(signature.minors ?? []).map((minor) => minor.name)]) {
      const key = String(name ?? '').trim().toLowerCase()
      if (key && !names.has(key)) names.set(key, String(name).trim())
    }
  }
  return { signed: covering.length > 0, coveredNames: [...names.values()], signatureId: covering[0]?.id ?? null }
}

/** The console's words for one person's status: "Waiver signed", "Signed for 2 of 3 riders", "Waiver needed". */
export function waiverStatusLabel(status: WaiverDayStatus, expectedPeople?: number): string {
  if (!status.signed) return 'Waiver needed'
  const covered = status.coveredNames.length
  if (expectedPeople && expectedPeople > 1 && covered < expectedPeople) {
    return `Signed for ${covered} of ${expectedPeople} riders`
  }
  return 'Waiver signed'
}

export const WAIVER_SIGNATURE_CSV_HEADER = [
  'Signed at',
  'Day',
  'Good through',
  'Waiver',
  'Version',
  'Signer',
  'Email',
  'Phone',
  'Date of birth',
  'Minors',
  'Relationship',
  'Method',
  'Voided',
  'Signature ID',
] as const

/** One signature as a spreadsheet row, in {@link WAIVER_SIGNATURE_CSV_HEADER}'s order. */
export function signatureCsvRow(signature: StoredWaiverSignature, timeZone: string): string[] {
  const at = new Date(signature.signedAtMs)
  let signedAt: string
  try {
    signedAt = at.toLocaleString('en-US', { timeZone })
  } catch {
    signedAt = at.toISOString()
  }
  return [
    signedAt,
    signature.dayKey,
    signature.validThroughDayKey,
    signature.waiverTitle,
    String(signature.version),
    signature.signer?.name ?? '',
    signature.signer?.email ?? '',
    signature.signer?.phone ?? '',
    signature.signer?.dateOfBirth ?? '',
    (signature.minors ?? []).map((minor) => `${minor.name} (${minor.dateOfBirth})`).join('; '),
    signature.guardianRelationship ?? '',
    WAIVER_METHOD_LABELS[signature.method] ?? signature.method,
    signature.voidedAt ? 'Yes' : '',
    signature.id,
  ]
}

/** "Good through Oct 24, 2026" for one stored signature. */
export function signatureWindowLabel(signature: Pick<StoredWaiverSignature, 'dayKey' | 'validThroughDayKey'>): string {
  return signature.dayKey === signature.validThroughDayKey
    ? `Good for ${formatDayKey(signature.dayKey)}`
    : `Good ${formatDayKey(signature.dayKey)} through ${formatDayKey(signature.validThroughDayKey)}`
}

/** Today's key plus a day, for a range query's upper bound. */
export const nextDayKey = (dayKey: string): string => addDays(dayKey, 1)

export type { WaiverValidity }
