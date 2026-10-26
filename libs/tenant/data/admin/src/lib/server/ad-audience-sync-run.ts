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
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import {
  AD_AUDIENCE_EXCLUSIONS,
  AD_AUDIENCE_LAPSE_MS,
  AD_AUDIENCE_PROVIDERS,
  AD_AUDIENCE_STAGES,
  adAudienceExclusion,
  adAudienceStages,
  buildGoogleMemberRequests,
  buildGoogleTokenRequest,
  buildLinkedInUserRequests,
  buildMetaReplaceRequests,
  diffAudience,
  hashAudienceEmail,
  instantMs,
  isOwnPublishedScreen,
  isRealActivityAction,
  isSuspiciousShrink,
  linkedInRefusedCount,
  resolveAccountCountry,
  type AdAudienceAccount,
  type AdAudienceConfig,
  type AdAudienceExclusion,
  type AdAudienceListConfig,
  type AdAudienceProvider,
  type AdAudienceStage,
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
 *
 * A STAGE list (AGL-4072) keeps the same two things under its own document,
 * `adAudienceSync/{provider}--{stage}`, so each stage has its own ledger, its
 * own diff and its own shrink guard, and nothing one list does can touch what
 * another was sent.
 */

export const AD_AUDIENCE_SYNC_COLLECTION = 'adAudienceSync'
export const AD_AUDIENCE_MEMBERS_SUBCOLLECTION = 'members'
/** Hashes per member chunk: 5,000 × 64 bytes stays far under a document's 1 MiB. */
const MEMBER_CHUNK = 5_000
/** Auth pages walked per run (1,000 accounts each). */
const MAX_AUTH_PAGES = 500
/** Page documents read per page of the published-page scan. */
const SCREEN_PAGE = 5_000
/** Change-log entries read per page while looking for one the person made. */
const ACTIVITY_PAGE = 25
/** Pages of change log read per account before it is called quiet. */
const ACTIVITY_PAGES = 4
/** Accounts whose recent activity is read at once. */
const ACTIVITY_CONCURRENCY = 20

/** The ledger document of one list: the provider's own, or `{provider}--{stage}`. */
export function adAudienceLedgerId(provider: AdAudienceProvider, stage?: AdAudienceStage | null): string {
  return stage ? `${provider}--${stage}` : provider
}

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
      /**
       * Only `creationTime` is read. `lastSignInTime` and `lastRefreshTime`
       * are never activity: a silent re-sign-in moves both with nobody there.
       */
      metadata?: { creationTime?: string }
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
  /**
   * The operator's own domains. Only narrows whose recent activity is read:
   * an internal account is in no list, so its change log is not looked at.
   */
  internalDomains?: readonly string[]
  /**
   * The newest real activity of one account since `sinceMs`, or null. The
   * Firestore reader `readRecentActivityAtMs` unless a spec passes its own.
   */
  recentActivity?: (uid: string, sinceMs: number) => Promise<number | null>
}

/** A number for each reason; never a person. */
export type ExclusionCounts = Record<AdAudienceExclusion, number>

export interface AdAudienceSelection {
  scanned: number
  eligible: AdAudienceAccount[]
  excluded: ExclusionCounts
  /** How the eligible accounts' country was decided. */
  countrySource: { billing: number; signup: number }
  /** The eligible accounts in each stage (AGL-4072). */
  stages: Record<AdAudienceStage, AdAudienceAccount[]>
}

/** Every account, with the facts eligibility and the stage lists read. */
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

  // The workspaces each account owns, in one query: their billing countries,
  // whether any is on a paid plan, and the sites they hold. The plan is
  // `resolveEffectivePlan`'s, the one every entitlement reads — a canceled
  // subscription is Free, a staff comp is the plan it grants — and it needs
  // only the org document's own fields (the derived `billingStatus` included).
  const orgs = await db
    .collection('orgs')
    .select(
      'ownerUid',
      'contact.address.country',
      'plan',
      'billingStatus',
      'subscription.status',
      'entitlements.planComp',
      'hosts',
    )
    .get()
  const billing = new Map<string, string[]>()
  const paidOwners = new Set<string>()
  const hostOwner = new Map<string, string>()
  for (const doc of orgs.docs) {
    const owner = doc.get('ownerUid')
    if (typeof owner !== 'string' || !owner) continue
    const country = doc.get('contact.address.country')
    if (typeof country === 'string' && country) {
      billing.set(owner, [...(billing.get(owner) ?? []), country])
    }
    const data = (doc.data() ?? {}) as Record<string, unknown>
    if (resolveEffectivePlan(data as never) !== 'free') paidOwners.add(owner)
    const hosts = data['hosts']
    if (hosts && typeof hosts === 'object') {
      for (const hostId of Object.keys(hosts as Record<string, unknown>)) hostOwner.set(hostId, owner)
    }
  }

  // The stage facts never hold up the all-holders list: a read that fails
  // leaves the accounts in no stage tonight, which every stage list's shrink
  // hold (or its refusal to send an empty replace) keeps from reaching a
  // provider, and the main list is synced as ever.
  const publishedOwners = await readOwnPublishedOwners(db, hostOwner, deps.now).catch(
    (error: unknown): null => {
      console.error('[ad-audience-sync] the published-page read failed; no stage tonight', error)
      return null
    },
  )

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
        ...(publishedOwners
          ? {
              stageFacts: {
                createdAtMs: instantMs(record.metadata?.creationTime),
                ownsPaidWorkspace: paidOwners.has(record.uid),
                ownsPublishedSite: publishedOwners.has(record.uid),
                lastActivityAtMs: null,
              },
            }
          : {}),
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

  // Recent activity, for the only accounts it can change anything for: those
  // in the audience and old enough to lapse. Everyone else's change log is
  // never read, which keeps the nightly cost to the accounts that matter.
  const since = deps.now - AD_AUDIENCE_LAPSE_MS
  const recentActivity =
    deps.recentActivity ?? ((uid: string, sinceMs: number) => readRecentActivityAtMs(db, uid, sinceMs))
  const internalDomains = deps.internalDomains ?? []
  const candidates = accounts.filter((account) => {
    const created = account.stageFacts?.createdAtMs
    return (
      typeof created === 'number' &&
      created < since &&
      !adAudienceExclusion(account, { internalDomains })
    )
  })
  let activityFailures = 0
  for (let index = 0; index < candidates.length; index += ACTIVITY_CONCURRENCY) {
    await Promise.all(
      candidates.slice(index, index + ACTIVITY_CONCURRENCY).map(async (account) => {
        try {
          const at = await recentActivity(account.uid, since)
          if (account.stageFacts) account.stageFacts.lastActivityAtMs = at
        } catch {
          // Unknown is not quiet: out of every stage tonight, never lapsed by mistake.
          delete account.stageFacts
          activityFailures += 1
        }
      }),
    )
  }
  if (activityFailures) {
    console.error(`[ad-audience-sync] recent activity unread for ${activityFailures} accounts; in no stage tonight`)
  }
  return { accounts }
}

/**
 * The owners of a site with a page of their own published, from one scan of
 * every page document (`hosts/{hostId}/screens/{id}`), paged by path and
 * reading only the fields the test needs. One query instead of one per site;
 * a page whose site no workspace holds counts for nobody.
 */
async function readOwnPublishedOwners(
  db: FirebaseFirestore.Firestore,
  hostOwner: ReadonlyMap<string, string>,
  now: number,
): Promise<Set<string>> {
  const owners = new Set<string>()
  if (!hostOwner.size) return owners
  const base = db
    .collectionGroup('screens')
    .orderBy(FieldPath.documentId())
    .select('publishedAt', 'deletedAt', 'createdAt', 'updatedAt', 'createdBy')
    .limit(SCREEN_PAGE)
  let after: FirebaseFirestore.QueryDocumentSnapshot | undefined
  for (;;) {
    const page = await (after ? base.startAfter(after) : base).get()
    for (const doc of page.docs) {
      // `hosts/{hostId}/screens/{screenId}`; any other `screens` is not a site's.
      const [root, hostId] = doc.ref.path.split('/')
      const owner = root === 'hosts' ? hostOwner.get(hostId) : undefined
      if (!owner || owners.has(owner)) continue
      if (isOwnPublishedScreen((doc.data() ?? {}) as Record<string, unknown>, now)) owners.add(owner)
    }
    if (page.docs.length < SCREEN_PAGE) break
    after = page.docs[page.docs.length - 1]
  }
  return owners
}

/**
 * The newest thing one account DID since `sinceMs`, or null when nothing was
 * recorded. Two signals, both read through collection-group indexes that
 * already exist for the staff activity feed and the AI job list:
 *
 * - **Change-log entries** under the account's id, on any site's or
 *   workspace's log (`hosts/{id}/activity`, `orgs/{id}/activity`): page
 *   edits, publishes, form and CRM actions, settings. Entries the platform
 *   writes under the person's id without them acting
 *   (`isRealActivityAction`) are skipped.
 * - **AI jobs the account started** (`orgs/{id}/aiJobs` by `createdBy`). The
 *   start only: a job's later updates are the platform's.
 *
 * Firebase's sign-in and token-refresh times, and the device "last seen"
 * stamps, are never read: a silent re-sign-in moves them with nobody there.
 */
export async function readRecentActivityAtMs(
  db: FirebaseFirestore.Firestore,
  uid: string,
  sinceMs: number,
): Promise<number | null> {
  const since = Timestamp.fromMillis(sinceMs)
  const jobs = db
    .collectionGroup('aiJobs')
    .where('createdBy', '==', uid)
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .select('createdAt')
    .limit(1)
    .get()
  const log = db
    .collectionGroup('activity')
    .where('actorId', '==', uid)
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .select('action', 'createdAt')
    .limit(ACTIVITY_PAGE)
  let newest: number | null = null
  let after: FirebaseFirestore.QueryDocumentSnapshot | undefined
  // Newest first, so the first real entry is the newest; a page of nothing
  // but platform entries reads the next one, a few pages at most.
  for (let page = 0; page < ACTIVITY_PAGES && newest === null; page += 1) {
    const entries = await (after ? log.startAfter(after) : log).get()
    const real = entries.docs.find((doc) => isRealActivityAction(doc.get('action')))
    if (real) newest = instantMs(real.get('createdAt')) ?? sinceMs
    if (entries.docs.length < ACTIVITY_PAGE) break
    after = entries.docs[entries.docs.length - 1]
  }
  const job = (await jobs).docs[0]
  const started = job ? (instantMs(job.get('createdAt')) ?? sinceMs) : null
  return newest === null ? started : started === null ? newest : Math.max(newest, started)
}

/** The eligible accounts, the counts of everyone left out, and each stage. */
export function selectAdAudience(
  accounts: readonly AdAudienceAccount[],
  internalDomains: readonly string[],
  now: number = Date.now(),
): AdAudienceSelection {
  const excluded = Object.fromEntries(
    AD_AUDIENCE_EXCLUSIONS.map((reason) => [reason, 0]),
  ) as ExclusionCounts
  const eligible: AdAudienceAccount[] = []
  const countrySource = { billing: 0, signup: 0 }
  const stages = Object.fromEntries(AD_AUDIENCE_STAGES.map((stage) => [stage, []])) as unknown as Record<
    AdAudienceStage,
    AdAudienceAccount[]
  >
  for (const account of accounts) {
    const reason = adAudienceExclusion(account, { internalDomains })
    if (reason) {
      excluded[reason] += 1
      continue
    }
    eligible.push(account)
    const { source } = resolveAccountCountry(account)
    if (source) countrySource[source] += 1
    for (const stage of adAudienceStages(account, now)) stages[stage].push(account)
  }
  return { scanned: accounts.length, eligible, excluded, countrySource, stages }
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

/**
 * What one list was last sent: the provider's all-holders list, or with
 * `stage` that stage's list, each from its own ledger.
 */
export async function readSentHashes(
  firestore: FirebaseFirestore.Firestore,
  provider: AdAudienceProvider,
  stage?: AdAudienceStage | null,
): Promise<string[]> {
  const chunks = await firestore
    .collection(AD_AUDIENCE_SYNC_COLLECTION)
    .doc(adAudienceLedgerId(provider, stage))
    .collection(AD_AUDIENCE_MEMBERS_SUBCOLLECTION)
    .get()
  const hashes: string[] = []
  for (const doc of chunks.docs) {
    const held = doc.get('hashes')
    if (Array.isArray(held)) hashes.push(...held.filter((hash): hash is string => typeof hash === 'string'))
  }
  return hashes
}

/** The list a ledger write is for. */
interface LedgerList {
  provider: AdAudienceProvider
  stage: AdAudienceStage | null
}

/** The fields that say which list a state document belongs to. */
const ledgerFields = (list: LedgerList) => ({
  provider: list.provider,
  ...(list.stage ? { stage: list.stage } : {}),
})

/** Replace what one list was last sent, and its counts. */
async function writeSentState(
  firestore: FirebaseFirestore.Firestore,
  list: LedgerList,
  hashes: readonly string[],
  state: Record<string, unknown>,
): Promise<void> {
  const ref = firestore.collection(AD_AUDIENCE_SYNC_COLLECTION).doc(adAudienceLedgerId(list.provider, list.stage))
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
  await ref.set({ ...ledgerFields(list), ...state, members: hashes.length, chunks: runs.length }, { merge: true })
}

/** The counts of a run on the list's state document, members untouched. */
async function writeRunState(
  firestore: FirebaseFirestore.Firestore,
  list: LedgerList,
  state: Record<string, unknown>,
): Promise<void> {
  await firestore
    .collection(AD_AUDIENCE_SYNC_COLLECTION)
    .doc(adAudienceLedgerId(list.provider, list.stage))
    .set({ ...ledgerFields(list), ...state }, { merge: true })
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

/** One stage's list on every provider (AGL-4072). */
export interface StageReport {
  /**
   * The eligible accounts in the stage. Counted for every stage on every
   * run, whether or not any of its lists is configured, so the report says
   * when a stage is big enough to be worth a list.
   */
  eligible: number
  providers: Record<AdAudienceProvider, ProviderReport>
}

export interface AdAudienceSyncReport {
  dryRun: boolean
  flagOn: boolean
  scanned: number
  eligible: number
  excluded: ExclusionCounts
  countrySource: { billing: number; signup: number }
  providers: Record<AdAudienceProvider, ProviderReport>
  stages: Record<AdAudienceStage, StageReport>
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

/**
 * One list on one provider: read what it was last sent, diff, and — unless
 * this run may not send — send and record. The all-holders list and every
 * stage list go through exactly this, each against its own ledger.
 */
async function syncList(
  options: AdAudienceRunOptions,
  log: (line: string) => void,
  list: LedgerList,
  listConfig: AdAudienceListConfig,
  hashes: string[],
  /** Added to the clock for Meta's session id, which must be unique per run and audience. */
  sessionOffset: number,
): Promise<ProviderReport> {
  const { provider, stage } = list
  const name = stage ? `${provider} ${stage}` : provider
  const config = listConfig[provider]
  const base = { eligible: hashes.length, previous: 0, toAdd: 0, toRemove: 0 }
  if (!config) {
    // A stage list nobody set up is the normal case; its line is the stage's.
    if (!stage) log(`[ad-audience-sync] ${provider} skipped — set ${listConfig.missing[provider].join(', ')}`)
    return { ...base, outcome: 'unconfigured', missing: listConfig.missing[provider] }
  }
  const previous = await readSentHashes(options.firestore, provider, stage)
  const diff = diffAudience(previous, hashes)
  const counts = {
    ...base,
    previous: previous.length,
    toAdd: diff.toAdd.length,
    toRemove: diff.toRemove.length,
  }
  const outcome = (value: ProviderOutcome, extra: Partial<ProviderReport> = {}): ProviderReport => {
    log(
      `[ad-audience-sync] ${name} ${value}: eligible ${counts.eligible}, ` +
        `previous ${counts.previous}, add ${counts.toAdd}, remove ${counts.toRemove}` +
        (extra.error ? ` — ${extra.error}` : ''),
    )
    return { ...counts, outcome: value, ...extra }
  }
  if (options.dryRun) return outcome('dry-run')
  if (!options.flagOn) return outcome('flag-off')
  const stamp = { lastRunAtMs: options.now, eligible: counts.eligible }
  if (!diff.toAdd.length && !diff.toRemove.length) {
    await writeRunState(options.firestore, list, { ...stamp, lastOutcome: 'unchanged' })
    return outcome('unchanged')
  }
  // Meta replaces with what it is sent, and an empty replace is no replace.
  if (!hashes.length) {
    await writeRunState(options.firestore, list, { ...stamp, lastOutcome: 'empty' })
    return outcome('empty', { error: 'no eligible account; the audience was left as it is' })
  }
  if (!options.force && isSuspiciousShrink(previous.length, hashes.length)) {
    await writeRunState(options.firestore, list, { ...stamp, lastOutcome: 'held-shrink' })
    return outcome('held-shrink', {
      error: `the audience would shrink from ${previous.length} to ${hashes.length}; held until a run with force`,
    })
  }
  try {
    if (provider === 'meta') {
      await sendMeta(
        options.fetch,
        config as NonNullable<AdAudienceConfig['meta']>,
        hashes,
        options.now + sessionOffset,
      )
    } else if (provider === 'google') {
      await sendGoogle(options.fetch, config as NonNullable<AdAudienceConfig['google']>, diff)
    } else {
      await sendLinkedIn(options.fetch, config as NonNullable<AdAudienceConfig['linkedin']>, diff)
    }
  } catch (error) {
    // The stored set stays as it was: the next run retries the whole diff,
    // and every provider takes a repeated add or remove without harm.
    const message = error instanceof AudienceSendError ? error.message : `${provider} send failed`
    if (!(error instanceof AudienceSendError)) console.error(`[ad-audience-sync] ${name}`, error)
    await writeRunState(options.firestore, list, {
      ...stamp,
      lastOutcome: 'failed',
      lastError: message,
    })
    return outcome('failed', { error: message })
  }
  await writeSentState(options.firestore, list, hashes, {
    ...stamp,
    lastOutcome: 'sent',
    lastSentAtMs: options.now,
    lastAdded: counts.toAdd,
    lastRemoved: counts.toRemove,
    lastError: null,
  })
  return outcome('sent')
}

export async function runAdAudienceSync(options: AdAudienceRunOptions): Promise<AdAudienceSyncReport> {
  const log = options.log ?? ((line: string) => console.info(line))
  const selection = selectAdAudience(options.accounts, options.internalDomains, options.now)

  const providers = {} as Record<AdAudienceProvider, ProviderReport>
  for (const provider of AD_AUDIENCE_PROVIDERS) {
    providers[provider] = await syncList(
      options,
      log,
      { provider, stage: null },
      options.config,
      providerHashes(provider, selection.eligible),
      0,
    )
  }

  // The stage lists: each a subset of the same eligible audience, each with
  // its own ledger, diff and shrink guard. Each failing alone, like a provider.
  const stages = {} as Record<AdAudienceStage, StageReport>
  for (const [index, stage] of AD_AUDIENCE_STAGES.entries()) {
    const members = selection.stages[stage]
    const stageProviders = {} as Record<AdAudienceProvider, ProviderReport>
    for (const provider of AD_AUDIENCE_PROVIDERS) {
      stageProviders[provider] = await syncList(
        options,
        log,
        { provider, stage },
        options.config.stages[stage],
        providerHashes(provider, members),
        index + 1,
      )
    }
    const unset = AD_AUDIENCE_PROVIDERS.filter((provider) => stageProviders[provider].outcome === 'unconfigured')
    log(
      `[ad-audience-sync] stage ${stage}: eligible ${members.length}` +
        (unset.length ? `; no list set on ${unset.join(', ')}` : ''),
    )
    stages[stage] = { eligible: members.length, providers: stageProviders }
  }

  return {
    dryRun: options.dryRun,
    flagOn: options.flagOn,
    scanned: selection.scanned,
    eligible: selection.eligible.length,
    excluded: selection.excluded,
    countrySource: selection.countrySource,
    providers,
    stages,
  }
}
