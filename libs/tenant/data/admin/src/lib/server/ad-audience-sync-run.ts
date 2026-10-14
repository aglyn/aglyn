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

import { AD_AUDIENCE_OPT_OUT_FIELD, readAdAudienceOptOut } from '@aglyn/aglyn/app-utils/ad-audience'
import { ACCOUNT_ACQUISITION_FIELD } from '@aglyn/aglyn/app-utils/account-acquisition'
import {
  isAccountBanLockdownReason,
  LOCKDOWNS_COLLECTION,
} from '@aglyn/aglyn/app-utils/lockdown'
import { FieldPath } from 'firebase-admin/firestore'
import {
  AD_AUDIENCE_EXCLUSIONS,
  AD_AUDIENCE_PROVIDERS,
  adAudienceExclusion,
  buildGoogleMemberRequests,
  buildGoogleTokenRequest,
  buildLinkedInUserRequests,
  buildMetaReplaceRequests,
  diffAudience,
  hashAudienceEmail,
  isSuspiciousShrink,
  linkedInRefusedCount,
  resolveAccountCountry,
  type AdAudienceAccount,
  type AdAudienceConfig,
  type AdAudienceExclusion,
  type AdAudienceProvider,
  type AudienceRequest,
} from './ad-audience-sync'

/**
 * THE ACCOUNT-HOLDER AD AUDIENCE (AGL-3780) — reading, sending, recording.
 *
 * One run: every account from Auth (every pool), joined with the Firestore
 * facts eligibility needs, reduced to one hash set per provider, diffed
 * against what that provider was last sent, and — unless it is a dry run —
 * sent. Each provider is independent: an unconfigured one is skipped with a
 * line saying which variables it lacks, and a failing one fails alone.
 *
 * WHAT IS KEPT. `adAudienceSync/{provider}` holds the counts and times of the
 * last run, and `adAudienceSync/{provider}/members/{n}` the hashes it last
 * sent, in chunks. The hashes are kept because two of the three providers
 * have no replace: an account that is erased leaves no address behind, so
 * the only way to take it out of a Google list or a LinkedIn segment is the
 * hash this sync sent it under. Admin-SDK only; no client rule opens either.
 * No address is stored, and neither addresses nor hashes are ever logged.
 */

export const AD_AUDIENCE_SYNC_COLLECTION = 'adAudienceSync'
export const AD_AUDIENCE_MEMBERS_SUBCOLLECTION = 'members'
/** Hashes per member chunk: 5,000 × 64 bytes stays far under a document's 1 MiB. */
const MEMBER_CHUNK = 5_000
/** Auth pages walked per run (1,000 accounts each). */
const MAX_AUTH_PAGES = 500

/** The Auth page reader, as `listUsersAcrossPools` answers it. */
export type ListUsersPage = (
  pageSize: number,
  pageToken?: string,
) => Promise<{
  users: Array<{
    record: {
      uid: string
      email?: string
      emailVerified: boolean
      disabled: boolean
      customClaims?: Record<string, unknown>
    }
  }>
  nextPageToken: string | null | undefined
}>

export interface AdAudienceReadDeps {
  firestore: FirebaseFirestore.Firestore
  listUserPage: ListUsersPage
  /** The account-ban list's answer for these addresses, lowercased. */
  bannedEmails: (emails: readonly string[]) => Promise<Set<string>>
  now: number
}

/** A number for each reason; never a person. */
export type ExclusionCounts = Record<AdAudienceExclusion, number>

export interface AdAudienceSelection {
  scanned: number
  eligible: AdAudienceAccount[]
  excluded: ExclusionCounts
  /** How the eligible accounts' country was decided. */
  countrySource: { billing: number; signup: number }
}

/** Every account, with the facts eligibility reads. */
export async function readAdAudienceAccounts(
  deps: AdAudienceReadDeps,
): Promise<{ accounts: AdAudienceAccount[] }> {
  const db = deps.firestore

  // Profiles: the opt-out and the sign-up country, in one query.
  const profiles = await db
    .collection('users')
    .select(AD_AUDIENCE_OPT_OUT_FIELD, `${ACCOUNT_ACQUISITION_FIELD}.geo.country`)
    .get()
  const optedOut = new Set<string>()
  const signupCountry = new Map<string, string>()
  for (const doc of profiles.docs) {
    const data = (doc.data() ?? {}) as Record<string, unknown>
    if (readAdAudienceOptOut(data)) optedOut.add(doc.id)
    const geo = (data[ACCOUNT_ACQUISITION_FIELD] as { geo?: { country?: unknown } } | undefined)?.geo
    if (typeof geo?.country === 'string') signupCountry.set(doc.id, geo.country)
  }

  // Billing countries of the workspaces each account owns.
  const orgs = await db.collection('orgs').select('ownerUid', 'contact.address.country').get()
  const billing = new Map<string, string[]>()
  for (const doc of orgs.docs) {
    const owner = doc.get('ownerUid')
    const country = doc.get('contact.address.country')
    if (typeof owner !== 'string' || !owner || typeof country !== 'string' || !country) continue
    billing.set(owner, [...(billing.get(owner) ?? []), country])
  }

  // Account locks: `lockdowns/user--{uid}`, by document id range.
  const locks = await db
    .collection(LOCKDOWNS_COLLECTION)
    .where(FieldPath.documentId(), '>=', 'user--')
    .where(FieldPath.documentId(), '<', 'user-.')
    .get()
  const locked = new Set<string>()
  for (const doc of locks.docs) {
    const uid = doc.id.slice('user--'.length)
    const untilMs = doc.get('untilMs')
    // An `abuse` lock is a permanent ban whatever its expiry says.
    const live =
      isAccountBanLockdownReason(doc.get('reason')) ||
      !(typeof untilMs === 'number' && untilMs <= deps.now)
    if (uid && live) locked.add(uid)
  }

  const accounts: AdAudienceAccount[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_AUTH_PAGES; page += 1) {
    const listed = await deps.listUserPage(1000, pageToken)
    for (const { record } of listed.users) {
      accounts.push({
        uid: record.uid,
        email: record.email ?? null,
        emailVerified: Boolean(record.emailVerified),
        disabled: Boolean(record.disabled),
        staff: Boolean(record.customClaims?.['staff']),
        optedOut: optedOut.has(record.uid),
        locked: locked.has(record.uid),
        banned: false,
        billingCountries: billing.get(record.uid) ?? [],
        signupCountry: signupCountry.get(record.uid) ?? null,
      })
    }
    pageToken = listed.nextPageToken ?? undefined
    if (!pageToken) break
  }
  if (pageToken) {
    // A partial read would look like mass churn and remove real members.
    throw new Error(`more than ${MAX_AUTH_PAGES * 1000} accounts; raise MAX_AUTH_PAGES`)
  }

  const banned = await deps.bannedEmails(
    accounts.map((account) => account.email).filter((email): email is string => Boolean(email)),
  )
  for (const account of accounts) {
    if (account.email && banned.has(account.email.trim().toLowerCase())) account.banned = true
  }
  return { accounts }
}

/** The eligible accounts and the counts of everyone left out. */
export function selectAdAudience(
  accounts: readonly AdAudienceAccount[],
  internalDomains: readonly string[],
): AdAudienceSelection {
  const excluded = Object.fromEntries(
    AD_AUDIENCE_EXCLUSIONS.map((reason) => [reason, 0]),
  ) as ExclusionCounts
  const eligible: AdAudienceAccount[] = []
  const countrySource = { billing: 0, signup: 0 }
  for (const account of accounts) {
    const reason = adAudienceExclusion(account, { internalDomains })
    if (reason) {
      excluded[reason] += 1
      continue
    }
    eligible.push(account)
    const { source } = resolveAccountCountry(account)
    if (source) countrySource[source] += 1
  }
  return { scanned: accounts.length, eligible, excluded, countrySource }
}

/** The set one provider should hold. Two addresses may share a hash. */
export function providerHashes(
  provider: AdAudienceProvider,
  eligible: readonly AdAudienceAccount[],
): string[] {
  const hashes = new Set<string>()
  for (const account of eligible) {
    const hash = hashAudienceEmail(provider, account.email)
    if (hash) hashes.add(hash)
  }
  return [...hashes].sort()
}

/*==========================================
 * STATE
 *=========================================*/

/** What one provider was last sent. */
export async function readSentHashes(
  firestore: FirebaseFirestore.Firestore,
  provider: AdAudienceProvider,
): Promise<string[]> {
  const chunks = await firestore
    .collection(AD_AUDIENCE_SYNC_COLLECTION)
    .doc(provider)
    .collection(AD_AUDIENCE_MEMBERS_SUBCOLLECTION)
    .get()
  const hashes: string[] = []
  for (const doc of chunks.docs) {
    const held = doc.get('hashes')
    if (Array.isArray(held)) hashes.push(...held.filter((hash): hash is string => typeof hash === 'string'))
  }
  return hashes
}

/** Replace what one provider was last sent, and its counts. */
async function writeSentState(
  firestore: FirebaseFirestore.Firestore,
  provider: AdAudienceProvider,
  hashes: readonly string[],
  state: Record<string, unknown>,
): Promise<void> {
  const ref = firestore.collection(AD_AUDIENCE_SYNC_COLLECTION).doc(provider)
  const members = ref.collection(AD_AUDIENCE_MEMBERS_SUBCOLLECTION)
  const existing = await members.get()
  const runs: string[][] = []
  for (let index = 0; index < hashes.length; index += MEMBER_CHUNK) {
    runs.push(hashes.slice(index, index + MEMBER_CHUNK))
  }
  for (const [index, run] of runs.entries()) {
    await members.doc(String(index).padStart(4, '0')).set({ hashes: run })
  }
  const keep = new Set(runs.map((_, index) => String(index).padStart(4, '0')))
  for (const doc of existing.docs) {
    if (!keep.has(doc.id)) await doc.ref.delete()
  }
  await ref.set({ provider, ...state, members: hashes.length, chunks: runs.length }, { merge: true })
}

/** The counts of a run on the provider's state document, members untouched. */
async function writeRunState(
  firestore: FirebaseFirestore.Firestore,
  provider: AdAudienceProvider,
  state: Record<string, unknown>,
): Promise<void> {
  await firestore
    .collection(AD_AUDIENCE_SYNC_COLLECTION)
    .doc(provider)
    .set({ provider, ...state }, { merge: true })
}

/*==========================================
 * SENDING
 *=========================================*/

export type AudienceFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** Thrown with the provider's status only; a response body may echo a token. */
export class AudienceSendError extends Error {
  constructor(
    readonly provider: AdAudienceProvider,
    readonly status: number,
    detail: string,
  ) {
    super(`${provider} answered ${status}: ${detail}`)
  }
}

/** The provider's error message, when it gave one, clipped. Never the request. */
function errorDetail(answer: unknown): string {
  const error = (answer as { error?: unknown; message?: unknown } | null) ?? null
  const message =
    (typeof error?.error === 'object' && error?.error
      ? (error.error as { message?: unknown }).message
      : error?.error) ?? error?.message
  return typeof message === 'string' ? message.slice(0, 300) : 'no detail'
}

async function send(
  fetcher: AudienceFetch,
  provider: AdAudienceProvider,
  request: AudienceRequest,
): Promise<unknown> {
  const response = await fetcher(request.url, {
    method: request.method,
    headers: request.headers,
    body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body),
  })
  const answer = await response.json().catch(() => null)
  if (!response.ok) throw new AudienceSendError(provider, response.status, errorDetail(answer))
  return answer
}

async function sendMeta(
  fetcher: AudienceFetch,
  config: NonNullable<AdAudienceConfig['meta']>,
  hashes: readonly string[],
  now: number,
): Promise<void> {
  // A session id unique within the ad account: the run's clock is.
  for (const request of buildMetaReplaceRequests(config, hashes, now)) {
    await send(fetcher, 'meta', request)
  }
}

async function sendGoogle(
  fetcher: AudienceFetch,
  config: NonNullable<AdAudienceConfig['google']>,
  diff: { toAdd: string[]; toRemove: string[] },
): Promise<void> {
  const token = (await send(fetcher, 'google', buildGoogleTokenRequest(config))) as {
    access_token?: unknown
  } | null
  if (typeof token?.access_token !== 'string') {
    throw new AudienceSendError('google', 200, 'the token endpoint returned no access token')
  }
  for (const request of buildGoogleMemberRequests(config, token.access_token, 'remove', diff.toRemove)) {
    await send(fetcher, 'google', request)
  }
  for (const request of buildGoogleMemberRequests(config, token.access_token, 'ingest', diff.toAdd)) {
    await send(fetcher, 'google', request)
  }
}

async function sendLinkedIn(
  fetcher: AudienceFetch,
  config: NonNullable<AdAudienceConfig['linkedin']>,
  diff: { toAdd: string[]; toRemove: string[] },
): Promise<void> {
  const requests = [
    ...buildLinkedInUserRequests(config, 'REMOVE', diff.toRemove),
    ...buildLinkedInUserRequests(config, 'ADD', diff.toAdd),
  ]
  for (const request of requests) {
    const refused = linkedInRefusedCount(await send(fetcher, 'linkedin', request))
    if (refused) {
      throw new AudienceSendError('linkedin', 400, `${refused} of the batch were refused`)
    }
  }
}

/*==========================================
 * ONE RUN
 *=========================================*/

export type ProviderOutcome =
  | 'unconfigured'
  | 'dry-run'
  | 'flag-off'
  | 'unchanged'
  | 'empty'
  | 'held-shrink'
  | 'sent'
  | 'failed'

export interface ProviderReport {
  outcome: ProviderOutcome
  eligible: number
  previous: number
  toAdd: number
  toRemove: number
  /** For `unconfigured`: the variables it lacks. */
  missing?: string[]
  /** For `failed`: the provider's status and message, never a payload. */
  error?: string
}

export interface AdAudienceSyncReport {
  dryRun: boolean
  flagOn: boolean
  scanned: number
  eligible: number
  excluded: ExclusionCounts
  countrySource: { billing: number; signup: number }
  providers: Record<AdAudienceProvider, ProviderReport>
}

export interface AdAudienceRunOptions {
  /** Report what would change and send nothing. */
  dryRun: boolean
  /** `release_ad_audience_sync`. Off, a run that is not a dry run sends nothing. */
  flagOn: boolean
  /** Send a set that shrank by more than half anyway. */
  force?: boolean
  config: AdAudienceConfig
  internalDomains: readonly string[]
  accounts: readonly AdAudienceAccount[]
  firestore: FirebaseFirestore.Firestore
  fetch: AudienceFetch
  now: number
  /** One line per provider, for the function log. Counts only. */
  log?: (line: string) => void
}

export async function runAdAudienceSync(options: AdAudienceRunOptions): Promise<AdAudienceSyncReport> {
  const log = options.log ?? ((line: string) => console.info(line))
  const selection = selectAdAudience(options.accounts, options.internalDomains)
  const providers = {} as Record<AdAudienceProvider, ProviderReport>

  for (const provider of AD_AUDIENCE_PROVIDERS) {
    const hashes = providerHashes(provider, selection.eligible)
    const config = options.config[provider]
    const base = { eligible: hashes.length, previous: 0, toAdd: 0, toRemove: 0 }
    if (!config) {
      providers[provider] = { ...base, outcome: 'unconfigured', missing: options.config.missing[provider] }
      log(`[ad-audience-sync] ${provider} skipped — set ${options.config.missing[provider].join(', ')}`)
      continue
    }
    const previous = await readSentHashes(options.firestore, provider)
    const diff = diffAudience(previous, hashes)
    const counts = {
      ...base,
      previous: previous.length,
      toAdd: diff.toAdd.length,
      toRemove: diff.toRemove.length,
    }
    const outcome = (value: ProviderOutcome, extra: Partial<ProviderReport> = {}) => {
      providers[provider] = { ...counts, outcome: value, ...extra }
      log(
        `[ad-audience-sync] ${provider} ${value}: eligible ${counts.eligible}, ` +
          `previous ${counts.previous}, add ${counts.toAdd}, remove ${counts.toRemove}` +
          (extra.error ? ` — ${extra.error}` : ''),
      )
    }
    if (options.dryRun) {
      outcome('dry-run')
      continue
    }
    if (!options.flagOn) {
      outcome('flag-off')
      continue
    }
    const stamp = { lastRunAtMs: options.now, eligible: counts.eligible }
    if (!diff.toAdd.length && !diff.toRemove.length) {
      await writeRunState(options.firestore, provider, { ...stamp, lastOutcome: 'unchanged' })
      outcome('unchanged')
      continue
    }
    // Meta replaces with what it is sent, and an empty replace is no replace.
    if (!hashes.length) {
      await writeRunState(options.firestore, provider, { ...stamp, lastOutcome: 'empty' })
      outcome('empty', { error: 'no eligible account; the audience was left as it is' })
      continue
    }
    if (!options.force && isSuspiciousShrink(previous.length, hashes.length)) {
      await writeRunState(options.firestore, provider, { ...stamp, lastOutcome: 'held-shrink' })
      outcome('held-shrink', {
        error: `the audience would shrink from ${previous.length} to ${hashes.length}; held until a run with force`,
      })
      continue
    }
    try {
      if (provider === 'meta') {
        await sendMeta(options.fetch, config as NonNullable<AdAudienceConfig['meta']>, hashes, options.now)
      } else if (provider === 'google') {
        await sendGoogle(options.fetch, config as NonNullable<AdAudienceConfig['google']>, diff)
      } else {
        await sendLinkedIn(options.fetch, config as NonNullable<AdAudienceConfig['linkedin']>, diff)
      }
    } catch (error) {
      // The stored set stays as it was: the next run retries the whole diff,
      // and every provider takes a repeated add or remove without harm.
      const message = error instanceof AudienceSendError ? error.message : `${provider} send failed`
      if (!(error instanceof AudienceSendError)) console.error(`[ad-audience-sync] ${provider}`, error)
      await writeRunState(options.firestore, provider, {
        ...stamp,
        lastOutcome: 'failed',
        lastError: message,
      })
      outcome('failed', { error: message })
      continue
    }
    await writeSentState(options.firestore, provider, hashes, {
      ...stamp,
      lastOutcome: 'sent',
      lastSentAtMs: options.now,
      lastAdded: counts.toAdd,
      lastRemoved: counts.toRemove,
      lastError: null,
    })
    outcome('sent')
  }

  return {
    dryRun: options.dryRun,
    flagOn: options.flagOn,
    scanned: selection.scanned,
    eligible: selection.eligible.length,
    excluded: selection.excluded,
    countrySource: selection.countrySource,
    providers,
  }
}
