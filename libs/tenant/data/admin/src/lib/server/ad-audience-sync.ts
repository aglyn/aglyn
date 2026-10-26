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

import { createHash } from 'node:crypto'

/**
 * THE ACCOUNT-HOLDER AD AUDIENCE (AGL-3780) — the pure half.
 *
 * Once a night the operator's own account holders are kept in step with a
 * customer-list audience on each of the operator's OWN ad accounts — Meta
 * Custom Audiences, Google Customer Match and LinkedIn DMP segments — so
 * signed-up people can be retargeted and left out of prospecting. This is
 * the platform's marketing, not a merchant feature: a merchant's own pixels
 * and conversion APIs are the ad-conversions plugin, which this shares
 * nothing with.
 *
 * Beside that one all-holders list, each provider may keep a STAGE list per
 * stage (AGL-4072): free and not published, free and published, paid, and
 * lapsed. Each is a subset of the same eligible audience, configured by its
 * own list id, and synced, recorded and guarded exactly like the main list.
 *
 * Everything here is pure — normalization, hashing, who is eligible, the
 * add/remove diff and each provider's request — so the spec walks every rule
 * without a network. `ad-audience-sync-run.ts` reads the accounts, sends and
 * records.
 *
 * No address ever leaves in the clear: each provider receives the SHA-256 hex
 * digest of the address normalized the way that provider documents, and
 * nothing here logs either one.
 */

export const AD_AUDIENCE_PROVIDERS = ['meta', 'google', 'linkedin'] as const
export type AdAudienceProvider = (typeof AD_AUDIENCE_PROVIDERS)[number]

export const AD_AUDIENCE_PROVIDER_LABELS: Record<AdAudienceProvider, string> = {
  meta: 'Meta',
  google: 'Google',
  linkedin: 'LinkedIn',
}

/*==========================================
 * NORMALIZATION AND HASHING
 *=========================================*/

const GOOGLE_CONSUMER_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

/**
 * The address the way one provider says to normalize it before hashing, or
 * null when it is not an address at all.
 *
 * - **Meta** (Custom Audiences, `EMAIL`): trim leading and trailing white
 *   space, lowercase.
 * - **LinkedIn** (DMP segment users, `SHA256_EMAIL`): lowercase, remove any
 *   white space.
 * - **Google** (Data Manager API, Customer Match): lowercase, remove leading,
 *   trailing and inner white space, and for `gmail.com` and `googlemail.com`
 *   only, remove the dots from the local part and drop a `+` and everything
 *   after it. Other domains keep both.
 *
 * Inner white space is never part of a deliverable address, so removing it
 * for Meta as well would change nothing real; it is left exactly as Meta
 * documents it.
 */
export function normalizeAudienceEmail(
  provider: AdAudienceProvider,
  raw: unknown,
): string | null {
  if (typeof raw !== 'string') return null
  let email =
    provider === 'meta' ? raw.trim().toLowerCase() : raw.replace(/\s+/g, '').toLowerCase()
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1 || email.indexOf('@') !== at) return null
  if (provider === 'google') {
    let local = email.slice(0, at)
    const domain = email.slice(at + 1)
    if (GOOGLE_CONSUMER_DOMAINS.has(domain)) {
      const plus = local.indexOf('+')
      if (plus >= 0) local = local.slice(0, plus)
      local = local.replace(/\./g, '')
      if (!local) return null
      email = `${local}@${domain}`
    }
  }
  return email
}

/** Lowercase SHA-256 hex of a UTF-8 string: what all three providers take. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** The hash one provider receives for an address, or null for no address. */
export function hashAudienceEmail(provider: AdAudienceProvider, raw: unknown): string | null {
  const normalized = normalizeAudienceEmail(provider, raw)
  return normalized ? sha256Hex(normalized) : null
}

/*==========================================
 * ELIGIBILITY
 *=========================================*/

/** What the sync knows about one account, read from Auth and Firestore. */
export interface AdAudienceAccount {
  uid: string
  email: string | null
  emailVerified: boolean
  disabled: boolean
  /** The `staff` custom claim. */
  staff: boolean
  /** `users/{uid}.adAudienceOptOut` is set. */
  optedOut: boolean
  /** An account lockdown is in force (`lockdowns/user--{uid}`). */
  locked: boolean
  /** The address is on the account-ban suppression list (an `abuse` ban). */
  banned: boolean
  /**
   * The billing-address countries (`orgs/{id}.contact.address.country`) of
   * the workspaces the account OWNS.
   */
  billingCountries: readonly string[]
  /** `users/{uid}.acquisition.geo.country`: where the sign-up request came from. */
  signupCountry: string | null
  /**
   * The facts the STAGE lists read (AGL-4072). Optional so an account read
   * without them is simply in no stage; eligibility never looks at them.
   */
  stageFacts?: AdAudienceStageFacts
}

/** What decides an eligible account's stage (AGL-4072). */
export interface AdAudienceStageFacts {
  /** When the Auth account was made (`metadata.creationTime`), or null. */
  createdAtMs: number | null
  /** The account OWNS a workspace whose effective plan is a paid one. */
  ownsPaidWorkspace: boolean
  /** The account owns a site with a page of its own that is published. */
  ownsPublishedSite: boolean
  /**
   * The newest real activity found inside the lapse window, or null when
   * none was found there. Only read for an account old enough to lapse; it is
   * never a sign-in time.
   */
  lastActivityAtMs: number | null
}

/** Why an account is left out. Counted in every report; never per person. */
export type AdAudienceExclusion =
  | 'no-email'
  | 'disabled'
  | 'staff'
  | 'internal'
  | 'locked'
  | 'banned'
  | 'opted-out'
  | 'unverified'
  | 'no-country'
  | 'not-us'

export const AD_AUDIENCE_EXCLUSIONS: readonly AdAudienceExclusion[] = [
  'no-email',
  'disabled',
  'staff',
  'internal',
  'locked',
  'banned',
  'opted-out',
  'unverified',
  'no-country',
  'not-us',
]

/** The one country the audience is built for. */
export const AD_AUDIENCE_COUNTRY = 'US'

export type AdAudienceCountrySource = 'billing' | 'signup'

const ALPHA2 = /^[A-Z]{2}$/

/**
 * The account's country, and which signal said so.
 *
 * 1. **The billing address** of a workspace the account owns. It is the
 *    address the account holder typed or gave Stripe, it is the address tax
 *    is computed on, and it is the strongest country fact the platform holds.
 *    When the account owns workspaces billed in different countries, the
 *    answer is US only when EVERY one of them is US: an account that bills
 *    from abroad is not counted as a US account holder on the strength of
 *    one US workspace.
 * 2. Otherwise **the sign-up geography**: the country the edge reported for
 *    the request that created the account (AGL-3289). It says where the
 *    person was when they signed up, which is a weaker fact, and it is the
 *    one most accounts have.
 * 3. Otherwise nothing, and an account with no country is left out. A phone
 *    number's `+1` is deliberately not a signal: it is shared with Canada and
 *    the Caribbean.
 */
export function resolveAccountCountry(account: {
  billingCountries: readonly string[]
  signupCountry: string | null
}): { country: string | null; source: AdAudienceCountrySource | null } {
  const billing = [
    ...new Set(
      account.billingCountries
        .map((country) => String(country ?? '').trim().toUpperCase())
        .filter((country) => ALPHA2.test(country)),
    ),
  ]
  if (billing.length) {
    const foreign = billing.find((country) => country !== AD_AUDIENCE_COUNTRY)
    return { country: foreign ?? AD_AUDIENCE_COUNTRY, source: 'billing' }
  }
  const signup = String(account.signupCountry ?? '').trim().toUpperCase()
  if (ALPHA2.test(signup)) return { country: signup, source: 'signup' }
  return { country: null, source: null }
}

/** The domain part of an operator address, lowercased, or null. */
export function emailDomain(address: string | null | undefined): string | null {
  const value = String(address ?? '').trim().toLowerCase()
  const at = value.lastIndexOf('@')
  return at > 0 && at < value.length - 1 ? value.slice(at + 1) : null
}

/**
 * Why this account is left out, or null when it belongs in the audience.
 *
 * Every condition must hold: an address, not disabled, not staff, not on the
 * operator's own domain, no account lock (an `abuse` lock is a permanent ban),
 * not on the ban list, not opted out, a verified address, and a United
 * States country. Account deletion needs no rule: an erased account has no
 * Auth record, so it is never read at all, and the diff removes it.
 *
 * The address must be VERIFIED because anyone can sign up with an address
 * that is not theirs, and uploading it would put a person who never signed up
 * into the audience. A Google or SSO sign-in arrives verified.
 */
export function adAudienceExclusion(
  account: AdAudienceAccount,
  options: { internalDomains?: readonly string[] } = {},
): AdAudienceExclusion | null {
  const domain = emailDomain(account.email)
  if (!domain) return 'no-email'
  if (account.disabled) return 'disabled'
  if (account.staff) return 'staff'
  if ((options.internalDomains ?? []).some((internal) => internal.toLowerCase() === domain)) {
    return 'internal'
  }
  if (account.locked) return 'locked'
  if (account.banned) return 'banned'
  if (account.optedOut) return 'opted-out'
  if (!account.emailVerified) return 'unverified'
  const { country } = resolveAccountCountry(account)
  if (!country) return 'no-country'
  if (country !== AD_AUDIENCE_COUNTRY) return 'not-us'
  return null
}

/*==========================================
 * STAGES (AGL-4072)
 *=========================================*/

/**
 * The stage lists kept beside the all-holders list, so the ads for people
 * who already have an account can say something that fits where they are.
 * Each one is a SUBSET of the eligible audience — every exclusion above
 * still applies first — and each is optional, sent only when its own list id
 * is set.
 *
 * - `free-unpublished` — owns no workspace on a paid plan, and no site with a
 *   page of its own published.
 * - `free-published` — owns no workspace on a paid plan, and at least one
 *   site with a page of its own published.
 * - `paid` — owns at least one workspace on a paid plan.
 * - `lapsed` — the account is more than 30 days old and nothing it did in the
 *   last 30 days was recorded. It overlaps the other three on purpose: a
 *   paying account that went quiet is both.
 */
export const AD_AUDIENCE_STAGES = ['free-unpublished', 'free-published', 'paid', 'lapsed'] as const
export type AdAudienceStage = (typeof AD_AUDIENCE_STAGES)[number]

export const AD_AUDIENCE_STAGE_LABELS: Record<AdAudienceStage, string> = {
  'free-unpublished': 'free, not published',
  'free-published': 'free, published',
  paid: 'paid',
  lapsed: 'lapsed',
}

/** How long an account must be quiet, and old, to be lapsed. */
export const AD_AUDIENCE_LAPSE_DAYS = 30
export const AD_AUDIENCE_LAPSE_MS = AD_AUDIENCE_LAPSE_DAYS * 86_400_000

/**
 * Change-log actions the platform writes under the person's id that are not
 * the person doing anything: the site made at sign-up, the starter it was
 * filled from, and an AI job's output landing (the job's START is what
 * counts, and it is read on its own). The same set the weekly activity
 * report leaves out.
 */
const NOT_A_PERSON_ACTING = new Set(['ai.job.output', 'Created the site', 'Started from the starter site'])

/** Whether one change-log entry's action is something the person did. */
export function isRealActivityAction(action: unknown): boolean {
  return typeof action === 'string' && Boolean(action) && !NOT_A_PERSON_ACTING.has(action)
}

/**
 * An instant in milliseconds off a stored value in whichever form it reached
 * this reader — a Firestore `Timestamp`, `{ seconds }` or `{ _seconds }`, a
 * `Date`, a number or an ISO string — or null.
 */
export function instantMs(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value !== 'object') return null
  const toMillis = (value as { toMillis?: unknown }).toMillis
  if (typeof toMillis === 'function') {
    const ms = Number(toMillis.call(value))
    return Number.isFinite(ms) ? ms : null
  }
  const record = value as { seconds?: unknown; _seconds?: unknown }
  const seconds = Number(record.seconds ?? record._seconds)
  return Number.isFinite(seconds) ? seconds * 1000 : null
}

/** A page document's fields the published test reads. */
export interface AdAudienceScreenFacts {
  publishedAt?: unknown
  deletedAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: unknown
}

/**
 * Whether one page counts as the account's own and published: live
 * (`publishedAt` set and not in the future, not deleted) and worked on by a
 * person — made by one (`createdBy`), or saved more than a minute after it
 * was made.
 *
 * The second half is why "has a published site" cannot be read off the site:
 * every new site is born a published starter website, so a site that is live
 * says nothing about whether its owner did anything. It is the weekly
 * activity report's test, less the page's version history, which is one more
 * read per page and moves with `updatedAt` anyway.
 */
export function isOwnPublishedScreen(screen: AdAudienceScreenFacts, now: number): boolean {
  if (screen.deletedAt) return false
  const published = instantMs(screen.publishedAt)
  if (published === null || published > now) return false
  if (typeof screen.createdBy === 'string' && screen.createdBy) return true
  const created = instantMs(screen.createdAt) ?? 0
  const updated = instantMs(screen.updatedAt) ?? 0
  return updated - created > 60_000
}

/**
 * Whether an account has lapsed: older than the window, and no real activity
 * found inside it. An account with no creation time is never lapsed — there
 * is no telling it from one made today.
 *
 * Only what the platform recorded the person DOING counts — their entries in
 * a site's or workspace's change log and the AI jobs they started. Firebase's
 * `lastSignInTime` and `lastRefreshTime` are deliberately not read: a browser
 * tab reloading in the background signs the person back in silently, which
 * moves both with nobody there.
 */
export function isLapsedAccount(facts: AdAudienceStageFacts, now: number): boolean {
  if (facts.createdAtMs === null) return false
  if (now - facts.createdAtMs <= AD_AUDIENCE_LAPSE_MS) return false
  return facts.lastActivityAtMs === null || now - facts.lastActivityAtMs > AD_AUDIENCE_LAPSE_MS
}

/**
 * Every stage an ELIGIBLE account is in. Eligibility is the caller's: this
 * classifies, it does not include. An account read without stage facts is
 * in none.
 */
export function adAudienceStages(account: AdAudienceAccount, now: number): AdAudienceStage[] {
  const facts = account.stageFacts
  if (!facts) return []
  const stages: AdAudienceStage[] = [
    facts.ownsPaidWorkspace ? 'paid' : facts.ownsPublishedSite ? 'free-published' : 'free-unpublished',
  ]
  if (isLapsedAccount(facts, now)) stages.push('lapsed')
  return stages
}

/*==========================================
 * THE DIFF
 *=========================================*/

/** What has to change for a provider to hold `next` when it holds `previous`. */
export function diffAudience(
  previous: Iterable<string>,
  next: Iterable<string>,
): { toAdd: string[]; toRemove: string[] } {
  const before = new Set(previous)
  const after = new Set(next)
  return {
    toAdd: [...after].filter((hash) => !before.has(hash)).sort(),
    toRemove: [...before].filter((hash) => !after.has(hash)).sort(),
  }
}

/**
 * Whether a night's set shrank so far it is more likely a failed read than
 * real churn. Below twenty there is no telling the two apart, so it is never
 * refused; above it, losing more than half the audience in one night is held
 * until a person passes `force`.
 */
export function isSuspiciousShrink(previousSize: number, nextSize: number): boolean {
  return previousSize >= 20 && nextSize < previousSize / 2
}

/** `items` in runs of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    runs.push(items.slice(index, index + size))
  }
  return runs
}

/*==========================================
 * CONFIGURATION
 *=========================================*/

export interface MetaAudienceConfig {
  accessToken: string
  audienceId: string
}

export interface GoogleAudienceConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  /** The Google Ads customer that owns the list, digits only. */
  customerId: string
  /** A manager account the credentials reach the customer through, digits only. */
  loginCustomerId: string | null
  /** The Customer Match user list id. */
  userListId: string
}

export interface LinkedInAudienceConfig {
  accessToken: string
  segmentId: string
}

/** One list on each provider: its settings, or null with the names it lacks. */
export interface AdAudienceListConfig {
  meta: MetaAudienceConfig | null
  google: GoogleAudienceConfig | null
  linkedin: LinkedInAudienceConfig | null
  /** For each provider left unconfigured, the variables it is missing. */
  missing: Record<AdAudienceProvider, string[]>
}

export interface AdAudienceConfig extends AdAudienceListConfig {
  /**
   * The stage lists (AGL-4072). Each reuses its provider's credentials and
   * names only its own list id, so a stage is configured when the provider's
   * credentials are set and that stage's id is too.
   */
  stages: Record<AdAudienceStage, AdAudienceListConfig>
}

/**
 * The variables, read here by their literal names so the self-host
 * environment reference can see every one of them.
 */
export function adAudienceEnv(): Record<string, string | undefined> {
  return {
    META_AUDIENCE_SYNC_ACCESS_TOKEN: process.env.META_AUDIENCE_SYNC_ACCESS_TOKEN,
    META_AUDIENCE_SYNC_AUDIENCE_ID: process.env.META_AUDIENCE_SYNC_AUDIENCE_ID,
    GOOGLE_AUDIENCE_SYNC_CLIENT_ID: process.env.GOOGLE_AUDIENCE_SYNC_CLIENT_ID,
    GOOGLE_AUDIENCE_SYNC_CLIENT_SECRET: process.env.GOOGLE_AUDIENCE_SYNC_CLIENT_SECRET,
    GOOGLE_AUDIENCE_SYNC_REFRESH_TOKEN: process.env.GOOGLE_AUDIENCE_SYNC_REFRESH_TOKEN,
    GOOGLE_AUDIENCE_SYNC_CUSTOMER_ID: process.env.GOOGLE_AUDIENCE_SYNC_CUSTOMER_ID,
    GOOGLE_AUDIENCE_SYNC_LOGIN_CUSTOMER_ID: process.env.GOOGLE_AUDIENCE_SYNC_LOGIN_CUSTOMER_ID,
    GOOGLE_AUDIENCE_SYNC_USER_LIST_ID: process.env.GOOGLE_AUDIENCE_SYNC_USER_LIST_ID,
    LINKEDIN_AUDIENCE_SYNC_ACCESS_TOKEN: process.env.LINKEDIN_AUDIENCE_SYNC_ACCESS_TOKEN,
    LINKEDIN_AUDIENCE_SYNC_SEGMENT_ID: process.env.LINKEDIN_AUDIENCE_SYNC_SEGMENT_ID,
    // The stage lists (AGL-4072): one list id per provider and stage.
    META_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_AUDIENCE_ID:
      process.env.META_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_AUDIENCE_ID,
    META_AUDIENCE_SYNC_STAGE_FREE_PUBLISHED_AUDIENCE_ID:
      process.env.META_AUDIENCE_SYNC_STAGE_FREE_PUBLISHED_AUDIENCE_ID,
    META_AUDIENCE_SYNC_STAGE_PAID_AUDIENCE_ID: process.env.META_AUDIENCE_SYNC_STAGE_PAID_AUDIENCE_ID,
    META_AUDIENCE_SYNC_STAGE_LAPSED_AUDIENCE_ID: process.env.META_AUDIENCE_SYNC_STAGE_LAPSED_AUDIENCE_ID,
    GOOGLE_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_USER_LIST_ID:
      process.env.GOOGLE_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_USER_LIST_ID,
    GOOGLE_AUDIENCE_SYNC_STAGE_FREE_PUBLISHED_USER_LIST_ID:
      process.env.GOOGLE_AUDIENCE_SYNC_STAGE_FREE_PUBLISHED_USER_LIST_ID,
    GOOGLE_AUDIENCE_SYNC_STAGE_PAID_USER_LIST_ID: process.env.GOOGLE_AUDIENCE_SYNC_STAGE_PAID_USER_LIST_ID,
    GOOGLE_AUDIENCE_SYNC_STAGE_LAPSED_USER_LIST_ID: process.env.GOOGLE_AUDIENCE_SYNC_STAGE_LAPSED_USER_LIST_ID,
    LINKEDIN_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_SEGMENT_ID:
      process.env.LINKEDIN_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_SEGMENT_ID,
    LINKEDIN_AUDIENCE_SYNC_STAGE_FREE_PUBLISHED_SEGMENT_ID:
      process.env.LINKEDIN_AUDIENCE_SYNC_STAGE_FREE_PUBLISHED_SEGMENT_ID,
    LINKEDIN_AUDIENCE_SYNC_STAGE_PAID_SEGMENT_ID: process.env.LINKEDIN_AUDIENCE_SYNC_STAGE_PAID_SEGMENT_ID,
    LINKEDIN_AUDIENCE_SYNC_STAGE_LAPSED_SEGMENT_ID: process.env.LINKEDIN_AUDIENCE_SYNC_STAGE_LAPSED_SEGMENT_ID,
  }
}

/** Each provider's credentials: what every one of its lists shares. */
const CREDENTIALS: Record<AdAudienceProvider, readonly string[]> = {
  meta: ['META_AUDIENCE_SYNC_ACCESS_TOKEN'],
  google: [
    'GOOGLE_AUDIENCE_SYNC_CLIENT_ID',
    'GOOGLE_AUDIENCE_SYNC_CLIENT_SECRET',
    'GOOGLE_AUDIENCE_SYNC_REFRESH_TOKEN',
    'GOOGLE_AUDIENCE_SYNC_CUSTOMER_ID',
  ],
  linkedin: ['LINKEDIN_AUDIENCE_SYNC_ACCESS_TOKEN'],
}

/** The all-holders list id on each provider. */
const LIST_ID: Record<AdAudienceProvider, string> = {
  meta: 'META_AUDIENCE_SYNC_AUDIENCE_ID',
  google: 'GOOGLE_AUDIENCE_SYNC_USER_LIST_ID',
  linkedin: 'LINKEDIN_AUDIENCE_SYNC_SEGMENT_ID',
}

const LIST_ID_SUFFIX: Record<AdAudienceProvider, string> = {
  meta: 'AUDIENCE_ID',
  google: 'USER_LIST_ID',
  linkedin: 'SEGMENT_ID',
}

const PROVIDER_PREFIX: Record<AdAudienceProvider, string> = {
  meta: 'META_AUDIENCE_SYNC',
  google: 'GOOGLE_AUDIENCE_SYNC',
  linkedin: 'LINKEDIN_AUDIENCE_SYNC',
}

/**
 * The variable that holds one stage's list id on one provider, e.g.
 * `META_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_AUDIENCE_ID`. Every name it
 * builds is read literally in `adAudienceEnv`.
 */
export function stageListVariable(provider: AdAudienceProvider, stage: AdAudienceStage): string {
  const name = stage.toUpperCase().replace(/-/g, '_')
  return `${PROVIDER_PREFIX[provider]}_STAGE_${name}_${LIST_ID_SUFFIX[provider]}`
}

const digits = (value: string) => value.replace(/\D/g, '')

/**
 * One list on every provider, given the variable that names its id on each.
 * Shared by the all-holders list and every stage, so the credentials are
 * read, and normalized, in exactly one way.
 */
function readListConfig(
  value: (name: string) => string,
  listVariable: Record<AdAudienceProvider, string>,
): AdAudienceListConfig {
  const missing = Object.fromEntries(
    AD_AUDIENCE_PROVIDERS.map((provider) => [
      provider,
      [...CREDENTIALS[provider], listVariable[provider]].filter((name) => !value(name)),
    ]),
  ) as Record<AdAudienceProvider, string[]>
  const loginCustomerId = digits(value('GOOGLE_AUDIENCE_SYNC_LOGIN_CUSTOMER_ID'))
  return {
    meta: missing.meta.length
      ? null
      : {
          accessToken: value('META_AUDIENCE_SYNC_ACCESS_TOKEN'),
          // `act_` belongs to the ad account, never to an audience id.
          audienceId: value(listVariable.meta),
        },
    google: missing.google.length
      ? null
      : {
          clientId: value('GOOGLE_AUDIENCE_SYNC_CLIENT_ID'),
          clientSecret: value('GOOGLE_AUDIENCE_SYNC_CLIENT_SECRET'),
          refreshToken: value('GOOGLE_AUDIENCE_SYNC_REFRESH_TOKEN'),
          // Google Ads shows `841-500-9958`; the API takes the digits.
          customerId: digits(value('GOOGLE_AUDIENCE_SYNC_CUSTOMER_ID')),
          loginCustomerId: loginCustomerId || null,
          userListId: digits(value(listVariable.google)),
        },
    linkedin: missing.linkedin.length
      ? null
      : {
          accessToken: value('LINKEDIN_AUDIENCE_SYNC_ACCESS_TOKEN'),
          // The segment URN's id, whichever form was pasted.
          segmentId: value(listVariable.linkedin).replace(/^urn:li:dmpSegment:/, ''),
        },
    missing,
  }
}

/**
 * Each provider's settings, or null with the names it lacks. A provider is
 * configured only when every required variable is set; a half-configured one
 * is skipped, never half-sent.
 *
 * The Meta audience is never created here. Creating one when the id is unset
 * would mint a fresh, empty audience on every run whose variable was lost, and
 * the ads targeting the real one would go on pointing at it, so the id is
 * required and the audience is made once, by hand. The same holds for every
 * stage list: an unset stage id is a stage that is not sent, never one made.
 *
 * A stage list never depends on the all-holders list's id: it needs only
 * its provider's credentials and its own id.
 */
export function readAdAudienceConfig(
  env: Record<string, string | undefined> = adAudienceEnv(),
): AdAudienceConfig {
  const value = (name: string) => String(env[name] ?? '').trim()
  const stages = Object.fromEntries(
    AD_AUDIENCE_STAGES.map((stage) => [
      stage,
      readListConfig(
        value,
        Object.fromEntries(
          AD_AUDIENCE_PROVIDERS.map((provider) => [provider, stageListVariable(provider, stage)]),
        ) as Record<AdAudienceProvider, string>,
      ),
    ]),
  ) as Record<AdAudienceStage, AdAudienceListConfig>
  return { ...readListConfig(value, LIST_ID), stages }
}

/*==========================================
 * PROVIDER REQUESTS
 *=========================================*/

/** One HTTP request, built without sending it. */
export interface AudienceRequest {
  method: 'POST'
  url: string
  headers: Record<string, string>
  /** A JSON body, or a form body when `headers` says so. */
  body: Record<string, unknown> | string
}

/**
 * META — the replace session.
 *
 * `POST /{audience}/usersreplace` swaps the audience's whole membership for
 * the batches of one session: `batch_seq` 1 opens it and `last_batch_flag`
 * closes it, so a removal needs no separate call and nothing has to be
 * remembered about who was there before. Each batch carries at most 10,000
 * hashes, and the session must finish inside 90 minutes. A replace does not
 * reset an ad set's learning phase, which an add and a delete would.
 */
export const META_GRAPH_VERSION = 'v25.0'
export const META_REPLACE_BATCH = 10_000

export function buildMetaReplaceRequests(
  config: MetaAudienceConfig,
  hashes: readonly string[],
  sessionId: number,
): AudienceRequest[] {
  const batches = chunk(hashes, META_REPLACE_BATCH)
  return batches.map((batch, index) => ({
    method: 'POST',
    url: `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(config.audienceId)}/usersreplace`,
    headers: { 'Content-Type': 'application/json' },
    body: {
      payload: { schema: 'EMAIL_SHA256', data: batch },
      session: {
        session_id: sessionId,
        batch_seq: index + 1,
        last_batch_flag: index === batches.length - 1,
        estimated_num_total: hashes.length,
      },
      access_token: config.accessToken,
    },
  }))
}

/**
 * GOOGLE — the Data Manager API, not the Google Ads API.
 *
 * Since 2026-04-01 the Google Ads API's `OfflineUserDataJobService` refuses
 * Customer Match uploads for a developer token with no Customer Match
 * activity in the six months before, and Google points every such project at
 * the Data Manager API instead. It needs an OAuth token with the
 * `datamanager` scope and no developer token.
 *
 * Adds go to `audienceMembers:ingest` and removals to `audienceMembers:remove`,
 * 10,000 members a request. The Data Manager API has no replace, so the
 * removals come from the set this sync last sent.
 *
 * No `consent` is sent. The audience is United States account holders only,
 * for whom Google requires no consent signal, and stating `CONSENT_GRANTED`
 * would assert a consent this platform does not collect.
 * `customerMatchTermsOfServiceStatus: ACCEPTED` is the operator's own
 * acceptance of the Customer Match terms, which Google requires on an
 * ingest; they are accepted in the Google Ads account before this is
 * configured.
 */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_DATA_MANAGER_BASE = 'https://datamanager.googleapis.com/v1'
export const GOOGLE_MEMBERS_BATCH = 10_000

export function buildGoogleTokenRequest(config: GoogleAudienceConfig): AudienceRequest {
  return {
    method: 'POST',
    url: GOOGLE_TOKEN_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }).toString(),
  }
}

export function buildGoogleMemberRequests(
  config: GoogleAudienceConfig,
  accessToken: string,
  action: 'ingest' | 'remove',
  hashes: readonly string[],
): AudienceRequest[] {
  const destination = {
    operatingAccount: { accountType: 'GOOGLE_ADS', accountId: config.customerId },
    ...(config.loginCustomerId
      ? { loginAccount: { accountType: 'GOOGLE_ADS', accountId: config.loginCustomerId } }
      : {}),
    productDestinationId: config.userListId,
  }
  return chunk(hashes, GOOGLE_MEMBERS_BATCH).map((batch) => ({
    method: 'POST',
    url: `${GOOGLE_DATA_MANAGER_BASE}/audienceMembers:${action}`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: {
      destinations: [destination],
      audienceMembers: batch.map((hash) => ({
        userData: { userIdentifiers: [{ emailAddress: hash }] },
      })),
      encoding: 'HEX',
      ...(action === 'ingest'
        ? { termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' } }
        : {}),
    },
  }))
}

/**
 * LINKEDIN — DMP segment users, streamed.
 *
 * `POST /rest/dmpSegments/{id}/users` with `X-RestLi-Method: BATCH_CREATE`
 * takes up to 5,000 `ADD` or `REMOVE` elements a request. There is no
 * replace, so the removals come from the set this sync last sent. Adding an
 * id twice or removing one already gone both answer 201, so a retry is safe.
 * The API is open only to developers LinkedIn has approved for Matched
 * Audiences, with the `rw_dmp_segments` permission.
 */
export const LINKEDIN_VERSION = '202609'
export const LINKEDIN_USERS_BATCH = 5_000

export function buildLinkedInUserRequests(
  config: LinkedInAudienceConfig,
  action: 'ADD' | 'REMOVE',
  hashes: readonly string[],
): AudienceRequest[] {
  return chunk(hashes, LINKEDIN_USERS_BATCH).map((batch) => ({
    method: 'POST',
    url: `https://api.linkedin.com/rest/dmpSegments/${encodeURIComponent(config.segmentId)}/users`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
      'LinkedIn-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'X-RestLi-Method': 'BATCH_CREATE',
    },
    body: {
      elements: batch.map((hash) => ({
        action,
        userIds: [{ idType: 'SHA256_EMAIL', idValue: hash }],
      })),
    },
  }))
}

/** How many elements of a LinkedIn batch response were refused. */
export function linkedInRefusedCount(answer: unknown): number {
  const elements = (answer as { elements?: unknown } | null)?.elements
  if (!Array.isArray(elements)) return 0
  return elements.filter((element) => {
    const status = Number((element as { status?: unknown } | null)?.status)
    return !(status >= 200 && status < 300)
  }).length
}
