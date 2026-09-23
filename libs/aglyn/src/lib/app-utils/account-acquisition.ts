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
  classifyChannel,
  displayHost,
  sanitizeFirstTouch,
  sourceAndMedium,
  type AcquisitionChannel,
  type FirstTouchClickId,
  type FirstTouchUtm,
} from '@aglyn/shared-util-first-touch'

/**
 * Where an account came from, written ONCE on the account when it is created
 * (AGL-3289) — `users/{uid}.acquisition`, and on the organization created in
 * the same flow as `orgs/{orgId}.acquisition`.
 *
 * ## Why this exists
 *
 * Answering "where did this person come from?" for one new workspace took a
 * sales session twenty-five minutes across five tools: the staff user page
 * had no source, Firestore held nothing beyond names, and the answer — a
 * review site's referral — was finally found in an analytics property and in
 * the marketing host's daily referrer counts. The platform never stored the
 * fact on the account it was about. This record is that fact, read from one
 * card on the staff user and organization pages.
 *
 * ## What writes it, and what never may
 *
 * The capture library keeps the first touch on the visitor's device; the
 * platform turns it into this record at account creation, server-side, and
 * the rules refuse the field to every client — owner and staff alike. A
 * record the account holder could restate would be a record nobody could
 * trust. It is never overwritten: a later touch, if one is ever kept, goes
 * BESIDE it as its own field.
 *
 * Every field here is built from the untrusted touch by re-scrubbing it, the
 * same way the capture scrubbed it on the device, and nothing the record says
 * grants anything: it is a label for a staff reader.
 */

/** The field on `users/{uid}` and `orgs/{orgId}`. */
export const ACCOUNT_ACQUISITION_FIELD = 'acquisition'

/**
 * How an account was created: the signup form with a password, the signup
 * form through Google, accepting an invitation, or single sign-on.
 */
export const ACQUISITION_DOORS = [
  'signup-password',
  'signup-google',
  'invite',
  'sso',
] as const
export type AcquisitionDoor = (typeof ACQUISITION_DOORS)[number] | 'unknown'

/** What wrote a record: a door at creation, an organization copying its creator's, or the backfill. */
export type AcquisitionRecordedBy = 'signup' | 'sso' | 'org-creation' | 'backfill'

/** Where the account-creating request came from, as the edge reported it. */
export interface AcquisitionGeo {
  country: string | null
  region: string | null
  city: string | null
}

/** The stored record. */
export interface AccountAcquisition {
  v: 1
  /**
   * Where the visit came from, spelled the way reports spell it — a
   * `utm_source`, a referring host, `(direct)` — or `unknown` when nothing was
   * captured.
   */
  source: string
  /** `utm_medium`, or what the channel implies; null when unknown. */
  medium: string | null
  /** `utm_campaign`, when the landing URL named one. */
  campaign: string | null
  /** The channel, from the platform's own rule table. */
  channel: AcquisitionChannel
  /** When the first visit landed; null when it was never captured. */
  capturedAt: number | null
  /** The first page the visitor landed on. */
  landing: { host: string; path: string } | null
  /** The external host that sent them. */
  referrerHost: string | null
  /** One of the platform's own hosts they came from before anything captured them. */
  viaHost: string | null
  /** Every `utm_*` the landing URL carried. */
  utm: FirstTouchUtm | null
  /** Which ad click ids the landing URL carried — presence only. */
  clickIds: FirstTouchClickId[]
  /** How the account was created. */
  door: AcquisitionDoor
  /** The sign-in provider it was created with: `password`, `google.com`, `saml.…`. */
  provider: string | null
  /** The organization whose invitation the person signed up to accept. */
  invitedToOrgId: string | null
  /** Where the account-creating request came from. */
  geo: AcquisitionGeo | null
  /** When the auth record says the account was created. */
  accountCreatedAt: number | null
  /** When this record was written. */
  recordedAt: number
  recordedBy: AcquisitionRecordedBy
  /** On an organization's copy: the account it was copied from. */
  copiedFromUid?: string
}

const MAX_LABEL = 100
const PROVIDER_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const RECORDED_BY: readonly AcquisitionRecordedBy[] = [
  'signup',
  'sso',
  'org-creation',
  'backfill',
]

function label(value: unknown, max = MAX_LABEL): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim() // eslint-disable-line no-control-regex
  return clean ? clean.slice(0, max) : null
}

function doorOf(value: unknown): AcquisitionDoor {
  return (ACQUISITION_DOORS as readonly string[]).includes(value as string)
    ? (value as AcquisitionDoor)
    : 'unknown'
}

function providerOf(value: unknown): string | null {
  return typeof value === 'string' && PROVIDER_SHAPE.test(value.trim())
    ? value.trim().toLowerCase()
    : null
}

function geoOf(value: unknown): AcquisitionGeo | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const geo: AcquisitionGeo = {
    country: label(raw['country'], 8)?.toUpperCase() ?? null,
    region: label(raw['region'], 64),
    city: label(raw['city'], 64),
  }
  return geo.country || geo.region || geo.city ? geo : null
}

function millisOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function uidOf(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
}

/** What a door knows when it records an account. */
export interface AccountAcquisitionInput {
  /** The first touch the capture kept — untrusted, from the device. */
  touch: unknown
  door: unknown
  provider?: unknown
  geo?: unknown
  invitedToOrgId?: unknown
  /** When the auth record says the account was created. */
  accountCreatedAtMs?: number | null
  recordedBy: AcquisitionRecordedBy
  nowMs: number
}

/**
 * The record for an account being created now.
 *
 * A missing or unusable touch still produces a record — `source: 'unknown'`
 * with whatever the door knows — because "we asked and nothing came back" is
 * a fact about the account too, and a card that renders blank would read as
 * "never asked".
 */
export function buildAccountAcquisition(input: AccountAcquisitionInput): AccountAcquisition {
  const touch = sanitizeFirstTouch(input.touch, input.nowMs)
  const base = {
    door: doorOf(input.door),
    provider: providerOf(input.provider),
    invitedToOrgId: uidOf(input.invitedToOrgId),
    geo: geoOf(input.geo),
    accountCreatedAt: millisOf(input.accountCreatedAtMs),
    recordedAt: input.nowMs,
    recordedBy: input.recordedBy,
  }
  if (!touch) return unknownAccountAcquisition(base)
  const { source, medium } = sourceAndMedium(touch)
  return {
    v: 1,
    source,
    medium,
    campaign: touch.utm?.campaign ?? null,
    channel: classifyChannel(touch),
    capturedAt: touch.at,
    landing: { host: touch.host, path: touch.path },
    referrerHost: touch.ref,
    viaHost: touch.via ?? null,
    utm: touch.utm ?? null,
    clickIds: touch.click ?? [],
    ...base,
  }
}

/** A record for an account nothing was captured for. */
export function unknownAccountAcquisition(input: {
  recordedAt: number
  recordedBy: AcquisitionRecordedBy
  door?: AcquisitionDoor
  provider?: string | null
  invitedToOrgId?: string | null
  geo?: AcquisitionGeo | null
  accountCreatedAt?: number | null
}): AccountAcquisition {
  return {
    v: 1,
    source: 'unknown',
    medium: null,
    campaign: null,
    channel: 'unknown',
    capturedAt: null,
    landing: null,
    referrerHost: null,
    viaHost: null,
    utm: null,
    clickIds: [],
    door: input.door ?? 'unknown',
    provider: input.provider ?? null,
    invitedToOrgId: input.invitedToOrgId ?? null,
    geo: input.geo ?? null,
    accountCreatedAt: input.accountCreatedAt ?? null,
    recordedAt: input.recordedAt,
    recordedBy: input.recordedBy,
  }
}

/**
 * The organization's copy of its creator's record, or an `unknown` one naming
 * the creator when the account has none — so an organization's card is never
 * blank either, and always says whose record it is.
 */
export function organizationAcquisition(
  creatorRecord: unknown,
  creatorUid: string,
  nowMs: number,
): AccountAcquisition {
  const record = readAccountAcquisition(creatorRecord)
  const copied = record
    ? { ...record }
    : unknownAccountAcquisition({ recordedAt: nowMs, recordedBy: 'org-creation' })
  delete copied.copiedFromUid
  return { ...copied, copiedFromUid: creatorUid }
}

/**
 * A stored record as a reader should trust it: re-validated field by field,
 * so a document written by an older version, a backfill or a hand edit still
 * renders, and renders nothing it should not. Null when the value is not a
 * record at all.
 */
export function readAccountAcquisition(value: unknown): AccountAcquisition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const source = label(raw['source'])
  if (!source) return null
  const channel = raw['channel']
  const landing = raw['landing'] as Record<string, unknown> | null
  const utmRaw = raw['utm'] as Record<string, unknown> | null
  const utm: FirstTouchUtm = {}
  for (const key of ['source', 'medium', 'campaign', 'content', 'term'] as const) {
    const cleaned = label(utmRaw?.[key])
    if (cleaned) utm[key] = cleaned
  }
  const clickIds = Array.isArray(raw['clickIds'])
    ? (['gclid', 'fbclid', 'msclkid'] as const).filter((id) =>
        (raw['clickIds'] as unknown[]).includes(id),
      )
    : []
  const recordedBy = RECORDED_BY.includes(raw['recordedBy'] as AcquisitionRecordedBy)
    ? (raw['recordedBy'] as AcquisitionRecordedBy)
    : 'backfill'
  const record: AccountAcquisition = {
    v: 1,
    source,
    medium: label(raw['medium']),
    campaign: label(raw['campaign']),
    channel:
      typeof channel === 'string' &&
      [
        'organic-search',
        'paid-search',
        'social',
        'referral',
        'email',
        'direct',
        'unknown',
      ].includes(channel)
        ? (channel as AcquisitionChannel)
        : 'unknown',
    capturedAt:
      typeof raw['capturedAt'] === 'number' && raw['capturedAt'] > 0
        ? (raw['capturedAt'] as number)
        : null,
    landing:
      landing && label(landing['host'], 253)
        ? { host: label(landing['host'], 253) as string, path: label(landing['path'], 200) ?? '/' }
        : null,
    referrerHost: label(raw['referrerHost'], 253),
    viaHost: label(raw['viaHost'], 253),
    utm: Object.keys(utm).length ? utm : null,
    clickIds,
    door: doorOf(raw['door']),
    provider: providerOf(raw['provider']),
    invitedToOrgId: uidOf(raw['invitedToOrgId']),
    geo: geoOf(raw['geo']),
    accountCreatedAt: millisOf(raw['accountCreatedAt']),
    recordedAt:
      typeof raw['recordedAt'] === 'number' ? (raw['recordedAt'] as number) : 0,
    recordedBy,
  }
  const copiedFrom = uidOf(raw['copiedFromUid'])
  if (copiedFrom) record.copiedFromUid = copiedFrom
  return record
}

/** A sign-in provider id as a person reads it. */
export function providerLabel(provider: string | null | undefined): string | null {
  if (!provider) return null
  if (provider === 'password') return 'password'
  if (provider === 'google.com') return 'Google'
  if (provider === 'apple.com') return 'Apple'
  if (provider === 'microsoft.com') return 'Microsoft'
  if (provider === 'github.com') return 'GitHub'
  if (provider.startsWith('saml.') || provider.startsWith('oidc.')) return 'single sign-on'
  return provider
}

function channelPhrase(record: AccountAcquisition): string {
  const from = displayHost(record.referrerHost) || record.source
  const campaign = record.campaign ? `, ${record.campaign}` : ''
  switch (record.channel) {
    case 'referral':
      return `Referral from ${from}${campaign}`
    case 'organic-search':
      return `Organic search from ${from}`
    case 'paid-search':
      return `Paid search (${record.source}${campaign})`
    case 'social':
      return `Social from ${from}${campaign}`
    case 'email':
      return `Email (${record.source}${campaign})`
    case 'direct':
      return record.viaHost
        ? `Direct, first seen arriving from ${record.viaHost}`
        : 'Direct'
    default:
      return record.recordedBy === 'backfill'
        ? 'Source unknown — the account predates capture'
        : 'Source unknown — nothing was captured'
  }
}

function doorPhrase(record: AccountAcquisition): string {
  const provider = providerLabel(record.provider)
  switch (record.door) {
    case 'signup-password':
      return 'signed up with password'
    case 'signup-google':
      return 'signed up with Google'
    case 'invite':
      return provider
        ? `signed up from an invitation, with ${provider}`
        : 'signed up from an invitation'
    case 'sso':
      return 'signed in with single sign-on'
    default:
      return provider ? `created with ${provider}` : 'created'
  }
}

/**
 * The record as one sentence a staff member reads at a glance:
 * "Referral from g2.com → /pricing → signed up with password".
 *
 * The landing is a bare path when it was on `primaryHost` — the platform's own
 * home — and host-and-path anywhere else, so a docs landing says so.
 */
export function describeAccountAcquisition(
  record: AccountAcquisition | null | undefined,
  options: { primaryHost?: string | null } = {},
): string {
  if (!record) return 'No acquisition record'
  const parts = [channelPhrase(record)]
  if (record.landing) {
    const onPrimary =
      options.primaryHost &&
      displayHost(record.landing.host) === displayHost(options.primaryHost)
    parts.push(
      onPrimary ? record.landing.path : `${displayHost(record.landing.host)}${record.landing.path}`,
    )
  }
  parts.push(doorPhrase(record))
  return parts.join(' → ')
}
