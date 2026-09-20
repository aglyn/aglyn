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
 * A dataset record write refreshes the live pages that show it (AGL-3113).
 *
 * ## What was missing
 *
 * Every other change a visitor can see announces itself the moment it lands: a
 * publish, a layout, a component, a content entry, a redirect rule, the
 * maintenance toggle. A dataset RECORD did not. It was written — by a form, by
 * an automation, over `/v1`, from the console — and the pages repeating over
 * it went on serving the rows they were built from until the hour-long window
 * lapsed. `PUBLISHED_SITE_DATA_TTL_SECONDS` was the propagation mechanism,
 * which is the same mistake AGL-1302 and AGL-1150 each had to undo elsewhere:
 * a backstop doing a job nothing else was doing.
 *
 * ## Scope, not the site
 *
 * A record changed one dataset, so this drops the pages that repeat over that
 * dataset and nothing else. The set is derived from the SAME binding the
 * published page expands — `repeatDatasetKeys`, the generic
 * `props.repeatDataset` any node can now carry (AGL-3111) — rather than from a
 * list of components that may repeat. A component allowlist was already wrong
 * the day repeat stopped being the Stack's: a heading bound to a dataset
 * renders rows exactly as a Stack does, and would have been missed.
 *
 * Three corpora, because the composer reads repeat keys after the layout chain
 * and the reusable-component graft: a repeat in a layout's chrome or inside a
 * component reaches every screen that renders it.
 *
 * ## Which sites
 *
 * Datasets are ORG-scoped and shared with sites through `visibleTo` — every
 * site in the org, or up to `MAX_SCOPE_HOSTS` named ones. Each site caches its
 * own copy of the rows under its own `tenant-data:{hostId}` tag and its own
 * page keys, so one record write is a fan-out. A missing `visibleTo` is
 * visible to NOBODY and announces nothing; defaulting it to org-wide here
 * would re-make AGL-1466 in the cache layer.
 *
 * ## Best effort, always
 *
 * The record is already written by the time any of this runs. A refused or
 * failed drop is reported to the caller and logged, never thrown: a record
 * must not be lost because a cache refused, and the TTL is still underneath as
 * the backstop it was always meant to be.
 */

import {
  ORG_SCOPE_TOKEN,
  hostIdsFromScope,
  repeatDatasetKeys,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/server'
import type { Firestore } from 'firebase-admin/firestore'
import {
  readUsageSources,
  screenIdsUsingComponentDeep,
  screenIdsUsingLayoutDeep,
  isLiveUsageCandidate,
  type UsageCandidate,
  type UsageSources,
} from './live-page-usage'

/**
 * How many documents per collection the per-site scan reads.
 *
 * The console's publish scan uses the same number for the same reason
 * (AGL-1161): this decides which caches get dropped, so a prefix scan would
 * report a refreshed site and leave real pages serving the old rows. Bounded
 * all the same, and when the bound bites it is SAID rather than absorbed.
 */
export const DATASET_SCAN_LIMIT = 2000

/**
 * How many sites one record write fans out to.
 *
 * `MAX_SCOPE_HOSTS` is the ceiling on a NAMED selection, so only an org-wide
 * dataset can reach this — an org with more sites than this pays a scan per
 * site on every write otherwise, which is a cost the person writing one row
 * did not ask for. Sites past the cap keep the TTL they had before this
 * existed, and the shortfall is returned and logged rather than swallowed.
 */
export const MAX_DATASET_FANOUT_HOSTS = 30

/**
 * How long one site-and-dataset pair waits before announcing again.
 *
 * A 1,000-row import is one announce because the importer announces after its
 * loop, not per row. This covers the other burst — many small writes arriving
 * separately, a form under load or an automation fanning out — where each one
 * would otherwise pay a full scan per site and hand the tenant the same path
 * list again.
 *
 * Leading edge, so the FIRST write of a burst refreshes immediately; what is
 * skipped is a repeat inside the window, and the next write after it announces
 * again. The cost of the skip is bounded by the window: a row written during
 * one is visible no later than the next announce.
 */
export const DATASET_ANNOUNCE_WINDOW_MS = 2000

/** Last announce per `orgId/datasetId/hostId`, for the window above. */
const lastAnnouncedAt = new Map<string, number>()

/**
 * Bounded so a long-lived server cannot grow this map without limit. Far above
 * the number of datasets any one instance writes in a window; when it bites,
 * the oldest entries simply lose their throttle and announce again.
 */
const MAX_THROTTLE_ENTRIES = 5000

function throttleAllows(key: string, now: number): boolean {
  const previous = lastAnnouncedAt.get(key)
  if (previous !== undefined && now - previous < DATASET_ANNOUNCE_WINDOW_MS) {
    return false
  }
  if (lastAnnouncedAt.size >= MAX_THROTTLE_ENTRIES) lastAnnouncedAt.clear()
  lastAnnouncedAt.set(key, now)
  return true
}

/** Test seam: the window is process-wide state, so a spec has to reset it. */
export function resetDatasetAnnounceThrottle(): void {
  lastAnnouncedAt.clear()
}

/** One site's share of a dataset change. */
export interface DatasetLivePageTarget {
  hostId: string
  /** The tenant keys its cache on this, never on `hostId`. */
  subdomain: string
  /** The attached custom domain, whose pages live under a second cache key. */
  cname?: string
  /** Site-absolute addresses (`/`, `/team`) that repeat over the dataset. */
  paths: string[]
  /** The site held more documents than the scan read, so `paths` is partial. */
  truncated: boolean
}

export interface DatasetLivePageScope {
  targets: DatasetLivePageTarget[]
  /**
   * Sites the fan-out cap left out. Zero in the ordinary case, and reported
   * rather than logged because a caller that says "refreshed" while some sites
   * were skipped is the failure this whole arc exists to remove.
   */
  hostsDropped: number
  /**
   * Why there is nothing to announce, or `'ok'`.
   *
   * `'not-rendered'` is a success: a dataset no page repeats over has no live
   * page to refresh. It is kept apart from `'error'` for the same reason the
   * revalidate route keeps `not-routed` apart from a refusal — one means there
   * was nothing to do, the other means something was left stale.
   */
  reason: 'ok' | 'no-dataset' | 'no-sites' | 'not-rendered' | 'error'
}

/**
 * Whether a node tree repeats over any of `keys`.
 *
 * Asks `repeatDatasetKeys` — literally the function the tenant composer calls
 * to decide which datasets to load for a page — so this cannot come to
 * disagree with what actually renders. A predicate even slightly narrower than
 * the expansion's is a page that renders rows and never refreshes them.
 */
function nodesRepeatDataset(
  nodes: UsageCandidate['nodes'],
  keys: ReadonlySet<string>,
): boolean {
  return repeatDatasetKeys(nodes).some((key) => keys.has(key))
}

/**
 * Every live screen whose rendered output repeats over the dataset, however
 * indirectly.
 *
 * The same three-bucket closure a placed form's pages are found by, for the
 * same reason: a binding is found by SEARCHING node trees rather than by
 * matching a pointer, so it can sit on the screen, in the chrome of the layout
 * the screen renders inside, or inside a reusable component a third component
 * nests. After the first level the fan-out is identical, so it is delegated
 * rather than restated.
 *
 * Pure, and separate from the Firestore read, so the closure is testable
 * without a database.
 */
export function screenIdsRepeatingDataset(
  keys: ReadonlySet<string>,
  sources: UsageSources,
): string[] {
  if (!keys.size) return []
  const screenIds = new Set<string>()

  for (const candidate of sources.screens) {
    if (!isLiveUsageCandidate(candidate)) continue
    if (nodesRepeatDataset(candidate.nodes, keys)) screenIds.add(candidate.id)
  }
  for (const candidate of sources.layouts) {
    if (!isLiveUsageCandidate(candidate)) continue
    if (!nodesRepeatDataset(candidate.nodes, keys)) continue
    // The layout itself renders no URL; the screens beneath it do.
    for (const screenId of screenIdsUsingLayoutDeep(
      candidate.id,
      sources.screens,
      sources.layouts,
    )) {
      screenIds.add(screenId)
    }
  }
  for (const candidate of sources.components) {
    if (!isLiveUsageCandidate(candidate)) continue
    if (!nodesRepeatDataset(candidate.nodes, keys)) continue
    // And a component renders wherever it is placed, however deeply nested.
    for (const screenId of screenIdsUsingComponentDeep(candidate.id, sources)) {
      screenIds.add(screenId)
    }
  }

  return [...screenIds]
}

/**
 * The keys a page can be bound to this dataset by: its id, and the display
 * name editors type into the Repeat attribute.
 *
 * Both, because the expansion looks a key up either way (`getDatasets`
 * resolves an id first and then a display name). Matching only the id would
 * miss every binding written by name, which is the older and still-supported
 * half of them.
 */
function datasetKeysOf(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): Set<string> {
  const keys = new Set<string>([snapshot.id])
  const displayName = String(snapshot.get('displayName') ?? '').trim()
  if (displayName) keys.add(displayName)
  return keys
}

/**
 * The sites a dataset is shared with, as host ids.
 *
 * Fails CLOSED on a missing or empty `visibleTo`, matching `visibleToHost` and
 * both enforcement layers underneath it: a document nobody scoped is shared
 * with nobody, and reading it as org-wide here would announce one org's
 * dataset change to sites that cannot see the dataset at all.
 */
async function hostIdsSharingDataset(
  firestore: Firestore,
  orgId: string,
  visibleTo: readonly string[] | undefined,
): Promise<{ hostIds: string[]; hostsDropped: number }> {
  if (!Array.isArray(visibleTo) || !visibleTo.length) {
    return { hostIds: [], hostsDropped: 0 }
  }
  if (!visibleTo.includes(ORG_SCOPE_TOKEN)) {
    const named = hostIdsFromScope(visibleTo)
    return { hostIds: named, hostsDropped: 0 }
  }
  // One over the cap, so a shortfall is detected rather than assumed away.
  const hosts = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .limit(MAX_DATASET_FANOUT_HOSTS + 1)
    .get()
  const all = hosts.docs.map((doc) => doc.id)
  return {
    hostIds: all.slice(0, MAX_DATASET_FANOUT_HOSTS),
    hostsDropped: Math.max(0, all.length - MAX_DATASET_FANOUT_HOSTS),
  }
}

/** One site's paths, or `null` when the site has nothing to refresh. */
async function targetForHost(
  firestore: Firestore,
  hostId: string,
  keys: ReadonlySet<string>,
): Promise<DatasetLivePageTarget | null> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) return null
  const subdomain = String(hostSnapshot.get('subdomain') ?? '')
  // Without a subdomain there is no tenant deployment holding cached pages for
  // this site — the ordinary state of one not yet given a name, not a failure.
  if (!subdomain) return null

  const sources = await readUsageSources(hostRef, DATASET_SCAN_LIMIT)
  const screens = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
  const paths = screenIdsRepeatingDataset(keys, sources.candidates)
    .map((screenId) => screens[screenId])
    .filter((path): path is string => Boolean(path))
    .map((path) => screenRoutePathToUrl(path))
    .filter((path, index, all) => all.indexOf(path) === index)
  if (!paths.length) return null

  const cname = String(hostSnapshot.get('cname') ?? '')
  return {
    hostId,
    subdomain,
    ...(cname ? { cname } : {}),
    paths,
    truncated: sources.truncated,
  }
}

/**
 * Every live page a change to this dataset's records makes stale, per site.
 *
 * Reads only; announcing is the caller's, because the two runtimes announce
 * differently — the console posts to the tenant over the shared secret, and
 * the tenant drops its own caches in process. Splitting it here is what lets
 * both use one answer to the question of WHICH pages.
 *
 * Never throws. A scope that could not be computed is a scope of nothing, and
 * the TTL underneath is unaffected.
 */
export async function datasetLivePageScope(options: {
  firestore: Firestore
  orgId: string
  datasetId: string
}): Promise<DatasetLivePageScope> {
  const { firestore, orgId, datasetId } = options
  if (!orgId || !datasetId) {
    return { targets: [], hostsDropped: 0, reason: 'no-dataset' }
  }
  try {
    const snapshot = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('datasets')
      .doc(datasetId)
      .get()
    if (!snapshot.exists) {
      return { targets: [], hostsDropped: 0, reason: 'no-dataset' }
    }
    const { hostIds, hostsDropped } = await hostIdsSharingDataset(
      firestore,
      orgId,
      snapshot.get('visibleTo') as readonly string[] | undefined,
    )
    if (!hostIds.length) {
      return { targets: [], hostsDropped, reason: 'no-sites' }
    }
    const keys = datasetKeysOf(snapshot)
    const resolved = await Promise.all(
      hostIds.map(async (hostId) => {
        try {
          return await targetForHost(firestore, hostId, keys)
        } catch (error) {
          // One unreadable site must not cost the others their refresh.
          console.error('[dataset-live-pages] site scan failed', hostId, error)
          return null
        }
      }),
    )
    const targets = resolved.filter(
      (target): target is DatasetLivePageTarget => target !== null,
    )
    return {
      targets,
      hostsDropped,
      reason: targets.length ? 'ok' : 'not-rendered',
    }
  } catch (error) {
    console.error('[dataset-live-pages] scope failed', datasetId, error)
    return { targets: [], hostsDropped: 0, reason: 'error' }
  }
}

/**
 * How one runtime drops a site's cached pages.
 *
 * The generic seam, registered by the deployment that owns the caches. The
 * tenant registers an in-process drop at boot; the console announces over the
 * shared secret and passes its own dropper at the call site. Core names
 * neither, exactly as it names no repeat source.
 *
 * Returns whether the drop landed. It must never throw: everything above it
 * has already been written.
 */
export type LivePageDropper = (
  target: DatasetLivePageTarget,
) => Promise<boolean>

let registeredDropper: LivePageDropper | undefined

/**
 * Registers the dropper for this process, replacing any previous one. Returns
 * the unregister, which removes it only if it is still the one registered.
 *
 * Called from a function the platform calls BY NAME at boot, never from a
 * module's top level: a bundler deletes a module imported only for its side
 * effect when its package says it has none (AGL-3025).
 */
export function registerLivePageDropper(drop: LivePageDropper): () => void {
  registeredDropper = drop
  return () => {
    if (registeredDropper === drop) registeredDropper = undefined
  }
}

export interface DatasetAnnounceResult {
  /** Sites whose cached pages were dropped. */
  sitesRefreshed: number
  /** Pages named across those sites. */
  pathsRefreshed: number
  /** Sites the drop was attempted on and refused. */
  sitesRefused: number
  /** Sites past the fan-out cap, and sites whose scan was truncated. */
  hostsDropped: number
  scanTruncated: boolean
  /** `'throttled'` when a drop for this pair already went out just now. */
  reason: DatasetLivePageScope['reason'] | 'throttled' | 'no-dropper'
}

const EMPTY_RESULT: Omit<DatasetAnnounceResult, 'reason'> = {
  sitesRefreshed: 0,
  pathsRefreshed: 0,
  sitesRefused: 0,
  hostsDropped: 0,
  scanTruncated: false,
}

/**
 * Refresh every live page that shows this dataset's records.
 *
 * The one call a write path makes. BEST EFFORT, ALWAYS: it never throws and
 * never rejects, so a caller can `await` it inside the try that already guards
 * the write without any chance of turning a stored record into a failed one.
 *
 * `drop` overrides the registered dropper for callers that hold their own —
 * the console, whose announce is an authenticated request rather than a local
 * cache call.
 */
export async function announceDatasetRecordChange(options: {
  firestore: Firestore
  orgId: string
  datasetId: string
  drop?: LivePageDropper
}): Promise<DatasetAnnounceResult> {
  const { firestore, orgId, datasetId } = options
  const drop = options.drop ?? registeredDropper
  if (!drop) {
    // Said out loud: a process that writes records and registered no dropper
    // is one where this feature is silently absent, which reads exactly like
    // a working one until somebody watches a page fail to change.
    console.warn(
      JSON.stringify({
        tag: 'AGL-3113:no-live-page-dropper',
        orgId,
        datasetId,
      }),
    )
    return { ...EMPTY_RESULT, reason: 'no-dropper' }
  }
  const throttleKey = `${orgId}/${datasetId}`
  if (!throttleAllows(throttleKey, Date.now())) {
    return { ...EMPTY_RESULT, reason: 'throttled' }
  }
  const scope = await datasetLivePageScope({ firestore, orgId, datasetId })
  if (!scope.targets.length) {
    return {
      ...EMPTY_RESULT,
      hostsDropped: scope.hostsDropped,
      reason: scope.reason,
    }
  }

  let sitesRefreshed = 0
  let sitesRefused = 0
  let pathsRefreshed = 0
  for (const target of scope.targets) {
    let landed = false
    try {
      landed = await drop(target)
    } catch (error) {
      // A dropper that throws is a dropper that failed; it is not a write
      // that failed.
      console.error('[dataset-live-pages] drop failed', target.hostId, error)
    }
    if (landed) {
      sitesRefreshed += 1
      pathsRefreshed += target.paths.length
    } else {
      sitesRefused += 1
    }
  }

  const scanTruncated = scope.targets.some((target) => target.truncated)
  const result: DatasetAnnounceResult = {
    sitesRefreshed,
    pathsRefreshed,
    sitesRefused,
    hostsDropped: scope.hostsDropped,
    scanTruncated,
    reason: scope.reason,
  }
  // ONE line per announce, on success as well as failure, for the reason
  // `postTenantRevalidate` gives: a record that only logs its failures cannot
  // tell "every write refreshed" apart from "the call never happened", and
  // that ambiguity is how an eleven-day propagation outage went unnoticed.
  console.log(
    JSON.stringify({
      tag: 'AGL-3113:dataset-announce',
      orgId,
      datasetId,
      ...result,
    }),
  )
  return result
}

/**
 * One sentence for a refresh that did not cover every page, or `null` when it
 * did.
 *
 * Beside the call rather than at each surface, so the console cannot word this
 * differently in two places — the same reason `describeRevalidateShortfall`
 * lives beside `revalidateLivePages`. `lead` names the act that succeeded,
 * because only that word differs between surfaces: a record is SAVED, and
 * telling someone who fixed a typo that they published it is a worse error
 * than the staleness the sentence is about.
 */
export function describeDatasetAnnounceShortfall(
  result: DatasetAnnounceResult | null,
  lead = 'Saved.',
): string | null {
  if (!result) return null
  // `not-rendered`, `no-sites` and `throttled` are deliberately silent: a
  // dataset no page shows has no stale page, and a throttled drop means one
  // already went out a moment ago. Saying anything would be alarming and wrong.
  if (result.reason === 'error' || result.sitesRefused) {
    return (
      `${lead} The live pages could not be refreshed just now, so they ` +
      'may show the previous records for up to an hour.'
    )
  }
  if (result.hostsDropped || result.scanTruncated) {
    return (
      `${lead} Some pages that use this dataset are too many to refresh at ` +
      'once — they update on their own within an hour.'
    )
  }
  return null
}

export default announceDatasetRecordChange
