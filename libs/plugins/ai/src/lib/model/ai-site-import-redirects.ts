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

import type { AiJobItemLedger } from './ai-jobs.types'
import {
  aiSiteImportOtherAddresses,
  type AiSiteImportPage,
  type AiSiteImportRedirect,
  type AiSiteImportRedirectReason,
  type AiSiteImportState,
} from './ai-site-import'

/*==========================================
 * THE OLD ADDRESSES, REDIRECTED (AGL-4245).
 *
 * A business moving its site here keeps its search ranking and its
 * bookmarked links only if each old page address sends visitors to the new
 * page. The import knows both addresses of every page it brings in, so when
 * a wave closes each one gets a permanent (301) redirect, written by the
 * redirects plugin's own writer (the core's resource-drafts seam, resource
 * `redirect`), which holds it to every rule the Redirects page holds a save
 * to: the publishing role, the plan's redirects and its allowance, the
 * page's normalization, duplicates, loops, and a published page's address.
 *
 * This file decides, without reading or writing, which old addresses to ask
 * for and which are settled already:
 *
 *  - a page that came in and is live on the new site at an address other
 *    than its old one is asked for, to that live address;
 *  - a page at the same address needs nothing (`same`);
 *  - a page that came in but is not published (its site is not in preview,
 *    or another page took its address) is left out as `unpublished`, and is
 *    asked for again when a later wave closes;
 *  - an old address a page of the new site is at, or one this import will
 *    put a page at, is never redirected (`page-there`): the redirect would
 *    hide the page;
 *  - two old addresses that are one once their query is dropped (a redirect
 *    matches the path only) get one redirect, the first's (`shared-address`);
 *  - an old address the import already recorded as another address of a
 *    page it brought in (a `duplicate` left out with its `sameAs`) is asked
 *    for, to that page's live address. No other skipped page is: the import
 *    records no new home for it, and none is invented;
 *  - an address already `created`, `kept` or `same` is carried as it is, so
 *    a later wave never asks twice.
 *
 * Addresses are compared as the redirects plugin stores them, through its
 * writer's `check` (`storedSource`), never by a rule restated here.
 *=========================================*/

/** One redirect to ask the writer for. */
export interface AiSiteImportRedirectAsk {
  /** The old address, as the redirects plugin stores it. */
  from: string
  /** The new page's live address. */
  to: string
  slot: string | null
}

export interface AiSiteImportRedirectPlanInput {
  state: AiSiteImportState
  items: readonly AiJobItemLedger[]
  /** The site's routing map (`host.screens`): page id → path without its leading slash, `/` for home. */
  screens: Readonly<Record<string, unknown>> | null | undefined
  /** An old address as the redirects plugin stores a rule's from-path; `null` where it cannot be one. */
  storedSource: (path: string) => string | null
}

export interface AiSiteImportRedirectPlan {
  /** Every old address considered, in the site's order: settled ones as they stand, asked ones as `left-out` placeholders until written. */
  entries: AiSiteImportRedirect[]
  /** The redirects to ask the writer for, each with its place in `entries`. */
  asks: Array<AiSiteImportRedirectAsk & { at: number }>
}

const delivered = (row: AiJobItemLedger | undefined) => row?.status === 'succeeded' || row?.status === 'degraded'

/** A routing map's path as an address: `/` for home, `/about` for `about`. */
function addressOf(path: unknown): string | null {
  if (typeof path !== 'string' || !path) return null
  return path === '/' ? '/' : `/${path.replace(/^\/+/, '')}`
}

/** The key an entry is carried across waves by: its page, or its old address. */
const keyOf = (entry: Pick<AiSiteImportRedirect, 'slot' | 'from'>) => (entry.slot ? `s:${entry.slot}` : `a:${entry.from}`)

/** The outcomes a later wave never asks again. */
const SETTLED: ReadonlySet<AiSiteImportRedirect['outcome']> = new Set(['created', 'kept', 'same'])

/**
 * Which old addresses to ask a redirect for, and which are settled (see the
 * block above). Pure.
 */
export function aiSiteImportRedirectPlan(input: AiSiteImportRedirectPlanInput): AiSiteImportRedirectPlan {
  const { state } = input
  const rows = new Map(input.items.map((row) => [row.slot, row]))
  const screens = (input.screens ?? {}) as Record<string, unknown>
  const liveAt = new Map<string, string>()
  const livePaths = new Set<string>()
  for (const [id, path] of Object.entries(screens)) {
    const address = addressOf(path)
    if (!address) continue
    liveAt.set(id, address)
    livePaths.add(address.toLowerCase())
  }
  // Where this import puts its pages, those still to come included.
  const planned = new Map(
    state.pages.filter((page) => !page.refused).map((page) => [(page.slug === '/' ? '/' : `/${page.slug}`).toLowerCase(), page.slot]),
  )
  const prior = new Map((state.redirects ?? []).map((entry) => [keyOf(entry), entry]))
  const entries: AiSiteImportRedirect[] = []
  const asks: AiSiteImportRedirectPlan['asks'] = []
  const taken = new Map<string, string | null>()

  const consider = (page: AiSiteImportPage, oldPath: string, slot: string | null) => {
    const from = input.storedSource(oldPath)
    const leave = (reason: AiSiteImportRedirectReason, to: string | null = null) =>
      entries.push({ from: from ?? oldPath, to, outcome: 'left-out', reason, slot })
    if (!from) return leave('unusable')
    const before = prior.get(keyOf({ slot, from }))
    if (before && SETTLED.has(before.outcome) && before.from === from) {
      entries.push(before)
      taken.set(from, before.to)
      return
    }
    const live = liveAt.get(page.draftId) ?? null
    if (!live) return leave('unpublished')
    if (from === live.toLowerCase()) {
      entries.push({ from, to: live, outcome: 'same', slot })
      return
    }
    if (taken.has(from)) return taken.get(from) === live ? undefined : leave('shared-address', live)
    const plannedFor = planned.get(from)
    if (livePaths.has(from) || (plannedFor && plannedFor !== page.slot)) return leave('page-there', live)
    taken.set(from, live)
    asks.push({ from, to: live, slot, at: entries.length })
    entries.push({ from, to: live, outcome: 'left-out', reason: 'refused', slot })
  }

  const cameIn = state.pages.filter((page) => !page.refused && page.origin !== 'proposed' && delivered(rows.get(page.slot)))
  for (const page of cameIn) consider(page, page.path, page.slot)
  // Other addresses of a page that came in, as the read recorded them.
  const byOldPath = new Map<string, AiSiteImportPage>()
  for (const page of cameIn) {
    const key = input.storedSource(page.path)
    if (key && !byOldPath.has(key)) byOldPath.set(key, page)
  }
  for (const other of aiSiteImportOtherAddresses(state)) {
    const key = input.storedSource(other.sameAs)
    const page = key ? byOldPath.get(key) : undefined
    if (page) consider(page, other.path, null)
  }
  return { entries, asks }
}

/*------------------------------------------
 * What the import's page says
 *-----------------------------------------*/

/** Why an old address got no redirect, after "No redirect: ". */
const REASON_COPY: Readonly<Record<AiSiteImportRedirectReason, string>> = {
  unpublished: 'the new page is not published yet. Add one in Redirects once it is.',
  'page-there': 'a page on your new site uses this address, and a redirect would hide it.',
  'shared-address': 'redirects ignore anything after a ? in an address, and another old page already uses this one.',
  unusable: 'this old address cannot be used for a redirect.',
  'plan-limit': 'your plan has no room for more redirects.',
  off: 'redirects are not available on this site.',
  refused: 'it could not be added.',
}

/** What a page's row says of its old address's redirect, or `null` when there is nothing to say yet. */
export function aiSiteImportRedirectText(entry: AiSiteImportRedirect | null | undefined): string | null {
  if (!entry) return null
  switch (entry.outcome) {
    case 'created':
      return entry.to ? `Redirect added: visitors to the old address go to ${entry.to}` : 'Redirect added from the old address'
    case 'kept':
      return 'You already had a redirect from the old address, so it was kept'
    case 'same':
      return null
    default:
      return `No redirect: ${entry.note && (entry.reason === 'plan-limit' || entry.reason === 'off' || entry.reason === 'refused') ? entry.note : REASON_COPY[entry.reason ?? 'refused']}`
  }
}

/** The redirect entry of a page's row, by its slot. */
export function aiSiteImportRedirectOf(state: Pick<AiSiteImportState, 'redirects'> | null | undefined, slot: string): AiSiteImportRedirect | null {
  return (state?.redirects ?? []).find((entry) => entry.slot === slot) ?? null
}

/** The reasons an address is left out that can clear later: a page published, room in the plan, redirects turned on. */
export const AI_SITE_IMPORT_REDIRECT_RETRYABLE: ReadonlySet<AiSiteImportRedirectReason> = new Set(['unpublished', 'plan-limit', 'off'])

/** Whether "Add redirects for published pages" has anything to try: an address left out for a reason that can clear. */
export function aiSiteImportRedirectsRetryable(state: Pick<AiSiteImportState, 'redirects'> | null | undefined): boolean {
  return (state?.redirects ?? []).some((entry) => entry.outcome === 'left-out' && AI_SITE_IMPORT_REDIRECT_RETRYABLE.has(entry.reason ?? 'refused'))
}

/** The button that runs the pass again, and what it says beside it. */
export const AI_SITE_IMPORT_REDIRECTS_RETRY_COPY = {
  action: 'Add redirects for published pages',
  busy: 'Adding redirects…',
  help: 'Published more of your pages, or made room in your plan? Add the redirects their old addresses are missing.',
} as const

/** The import's redirects, counted, for the card that lists them. */
export function aiSiteImportRedirectCounts(state: Pick<AiSiteImportState, 'redirects'> | null | undefined): {
  created: number
  kept: number
  leftOut: number
} {
  const counts = { created: 0, kept: 0, leftOut: 0 }
  for (const entry of state?.redirects ?? []) {
    if (entry.outcome === 'created') counts.created += 1
    else if (entry.outcome === 'kept') counts.kept += 1
    else if (entry.outcome === 'left-out') counts.leftOut += 1
  }
  return counts
}

/** The card's lead: "12 redirects added, 1 kept, 2 left out." `null` when there are none to speak of. */
export function aiSiteImportRedirectsSummary(state: Pick<AiSiteImportState, 'redirects'> | null | undefined): string | null {
  const counts = aiSiteImportRedirectCounts(state)
  if (!counts.created && !counts.kept && !counts.leftOut) return null
  const parts = [
    `${counts.created} ${counts.created === 1 ? 'redirect' : 'redirects'} added from your old addresses`,
    ...(counts.kept ? [`${counts.kept} of yours kept`] : []),
    ...(counts.leftOut ? [`${counts.leftOut} left out`] : []),
  ]
  return `${parts.join(', ')}.`
}

/** The record kind the redirects plugin publishes its rules' addresses under (`plugin-record-routes`). */
export const AI_SITE_IMPORT_REDIRECT_RECORD = 'redirect'

/** When the redirects take effect, said beside them. */
export const AI_SITE_IMPORT_REDIRECTS_WHEN =
  'They send visitors and search engines from your old page addresses to the new pages once your own domain points at your new site. You can change or remove any of them in Redirects.'
