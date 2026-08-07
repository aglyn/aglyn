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

// The leaf module, NOT `api-plugins` — that one is reachable only through the
// `/server` entry, and importing it from this shared barrel formed a cycle
// that left the binding missing at runtime (AGL-1289).
import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/**
 * Tenant page-composition extension points (AGL-418): plugins hook the
 * site loader (`load-page-data`) from their `/server` entries instead of
 * the app importing plugin domain code. Three kinds, run in this order:
 *
 * 1. REDIRECT RESOLVERS — may answer a request with a redirect before any
 *    route resolution (plugins-redirects' rule engine, AGL-155).
 * 2. PAGE RESOLVERS — may fully resolve a path into page props
 *    (plugins-commerce's PDP/PLP template composition for /products/* and
 *    /collections/*, AGL-299). First non-undefined answer wins.
 * 3. ENRICHERS — contribute extra props onto an already-resolved screen
 *    page (plugins-marketing's overlays/experiments/client-automations).
 *    Outputs are shallow-merged into the page props in registration order.
 *
 * Handlers run server-side (node runtime) and may use firebase-admin.
 * Errors in enrichers are isolated (a broken plugin never 500s the site);
 * resolver errors propagate because their output IS the page.
 */

export interface SitePageContext {
  hostId: string
  /** The resolved host doc. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host: any
  /** The org billing doc (entitlement source); undefined pre-billing. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  org?: any
  /** Request path, '/a/b' form ('/' for the site root). */
  path: string
  slugSegments: string[]
  screenId?: string
  /** The resolved screen doc (enrichers only). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  screen?: any
  /**
   * The composed node tree for the page — layout applied, versions and
   * references denormalized (enrichers only, AGL-659).
   *
   * An enricher that wants to seed a block's data server-side has to know
   * which blocks are actually on the page and how each one is configured;
   * the screen doc alone does not say, because composition pulls in layout
   * and referenced nodes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes?: any
}

export interface SiteRedirectAnswer {
  destination: string
  statusCode: number
}
export type SiteRedirectResolver = (
  context: SitePageContext,
) => Promise<SiteRedirectAnswer | undefined> | SiteRedirectAnswer | undefined

/** A fully-composed page (the loader returns it verbatim as `props`). */
export type SitePageAnswer = Record<string, unknown>
export type SitePageResolver = (
  context: SitePageContext,
) => Promise<SitePageAnswer | undefined>

export type SitePageEnricher = (
  context: SitePageContext,
) => Promise<Record<string, unknown> | undefined>

const redirectResolvers: SiteRedirectResolver[] = []
const pageResolvers: SitePageResolver[] = []
const enrichers: SitePageEnricher[] = []
/**
 * Which plugin registered which enricher (AGL-1289). Recorded from the loader's
 * existing "currently registering" marker — the same mechanism that gives
 * `registerPluginApiRoute` its path→plugin ownership — so plugins need no new
 * API and nothing has to be kept in sync by hand.
 */
const enricherOwners = new WeakMap<SitePageEnricher, string>()

export function registerSiteRedirectResolver(fn: SiteRedirectResolver): void {
  redirectResolvers.push(fn)
}
export function registerSitePageResolver(fn: SitePageResolver): void {
  pageResolvers.push(fn)
}
export function registerSitePageEnricher(fn: SitePageEnricher): void {
  enrichers.push(fn)
  const owner = getRegisteringPluginId()
  if (owner) enricherOwners.set(fn, owner)
}

export async function resolveSiteRedirect(
  context: SitePageContext,
): Promise<SiteRedirectAnswer | undefined> {
  for (const resolver of redirectResolvers) {
    const answer = await resolver(context)
    if (answer) return answer
  }
  return undefined
}

export async function resolveSitePage(
  context: SitePageContext,
): Promise<SitePageAnswer | undefined> {
  for (const resolver of pageResolvers) {
    const answer = await resolver(context)
    if (answer) return answer
  }
  return undefined
}

/** Null/undefined, an empty array or an empty object — nothing to render. */
function isEmptyContribution(value: unknown): boolean {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

export interface SitePageEnrichment {
  /** The merged contributions, spread into the page props as before. */
  props: Record<string, unknown>
  /** Plugins that returned something non-empty for THIS page. */
  contributors: string[]
  /**
   * True when an enricher produced work but could not be attributed to a
   * plugin — registered outside a plugin's register fn, so the loader's
   * marker was unset. Callers narrowing on `contributors` must treat this as
   * "cannot narrow": an unattributed contribution belongs to somebody.
   */
  unattributed: boolean
}

export async function runSitePageEnrichers(
  context: SitePageContext,
): Promise<SitePageEnrichment> {
  const merged: Record<string, unknown> = {}
  const contributors = new Set<string>()
  let unattributed = false
  for (const enricher of enrichers) {
    try {
      const result = (await enricher(context)) ?? {}
      Object.assign(merged, result)
      // "Contributed" means produced something with content, not merely
      // returned a key. Every marketing enricher returns its full key set on
      // every page — `announcementBar: null`, `experiments: []` — so keying
      // off presence would mark it a contributor everywhere and the
      // attribution would be worth nothing.
      if (Object.values(result).some((value) => !isEmptyContribution(value))) {
        const owner = enricherOwners.get(enricher)
        if (owner) contributors.add(owner)
        else unattributed = true
      }
    } catch (error) {
      // A broken plugin must not take the site down — the page renders
      // without that plugin's contribution.
      console.error('site page enricher failed', error)
    }
  }
  return { props: merged, contributors: [...contributors], unattributed }
}
