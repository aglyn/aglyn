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
 * A plugin's answer to "did this workspace already know this person?"
 * (AGL-3289).
 *
 * The platform asks when a staff member reads where an account came from: a
 * sign-up whose address a sales workspace was already working, or whose name
 * matches somebody on a list, is the answer to "is this the person we have
 * been writing to — on a personal address?". The platform keeps no people of
 * its own, so it cannot answer; any plugin that keeps records about people
 * can, and registers a matcher here. The platform runs every matcher and
 * shows what comes back.
 *
 * Two kinds of answer, and the distinction is the point of the seam:
 *
 * - **`email`** — the record carries the account's address. Certain.
 * - **`name`** — the record's name resembles the account's. A GUESS, which the
 *   staff card labels "possible" and never presents as a fact.
 *
 * A matcher leaves out the record the account's own sign-up created: a
 * platform that files every new account into its sales workspace would
 * otherwise answer "yes, we know them" for everybody, which says nothing.
 * What is worth showing is a record that existed BEFORE the account did.
 *
 * Matchers run in registration order and are ISOLATED: a throw is logged
 * against its plugin and reported as that plugin having failed, so a card can
 * say "could not check" rather than showing an absence it did not measure.
 * Nothing here writes; every matcher is a read.
 *
 * Registered from a plugin's server declarations, so the matcher is in place
 * in a process that never loaded the plugin's API surface.
 */

import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** Who to look for, and where. */
export interface PluginPersonMatchRequest {
  /** The workspace whose records are searched. */
  orgId: string
  /** Its slug, so a matcher can link to what it found. */
  orgSlug: string | null
  /** The account's address, normalized; null when it has none. */
  email: string | null
  /** The account's name, for the name half; null when it has none. */
  name: string | null
  /**
   * When the account was created. A record the account's own sign-up made at
   * or after this moment is the account, not somebody already known.
   */
  accountCreatedAtMs: number | null
}

/** One record a matcher found. */
export interface PluginPersonMatch {
  /** The record's kind, in the plugin's own words. */
  kind: string
  id: string
  /** What a reader recognizes the record by — a name, else its address. */
  label: string
  email: string | null
  /** `email` is certain; `name` is a resemblance, shown as "possible". */
  basis: 'email' | 'name'
  /** When the workspace first knew this record, when it can say. */
  firstSeenAtMs: number | null
  /** How the workspace came to know them, in the plugin's words. */
  sources: string[]
  /** A console path to the record, when the plugin publishes one. */
  href: string | null
}

export type PluginPersonMatcher = (
  request: PluginPersonMatchRequest,
) => Promise<PluginPersonMatch[]>

interface Registration {
  pluginId: string
  matcher: PluginPersonMatcher
}

const registrations: Registration[] = []

/**
 * Registers a plugin's matcher. Owner = the loader's marker inside a register
 * fn, else `options.pluginId`; a matcher with neither throws. One matcher per
 * plugin: registering again replaces the earlier one in place.
 */
export function registerPluginPersonMatcher(
  matcher: PluginPersonMatcher,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a plugin person matcher was registered with no owner: pass { pluginId } ' +
        'when registering outside a plugin register fn',
    )
  }
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, matcher }
  else registrations.push({ pluginId, matcher })
}

/** The plugins with a matcher registered, in registration order. */
export function listPluginPersonMatchers(): string[] {
  return registrations.map((entry) => entry.pluginId)
}

/** Test seam — forget every matcher. */
export function resetPluginPersonMatchers(): void {
  registrations.length = 0
}

/** What every matcher answered, together. */
export interface PluginPersonMatchReport {
  /** Every match, tagged with the plugin that found it; certain ones first. */
  matches: Array<PluginPersonMatch & { pluginId: string }>
  /** Plugins whose matcher threw — their absence from `matches` measures nothing. */
  failed: string[]
  /** Plugins that were asked. None means nothing on this install can answer. */
  asked: string[]
}

/** Runs every matcher. Never throws. */
export async function runPluginPersonMatchers(
  request: PluginPersonMatchRequest,
): Promise<PluginPersonMatchReport> {
  const report: PluginPersonMatchReport = { matches: [], failed: [], asked: [] }
  for (const { pluginId, matcher } of [...registrations]) {
    report.asked.push(pluginId)
    try {
      const found = await matcher({ ...request })
      for (const match of Array.isArray(found) ? found : []) {
        report.matches.push({ ...match, pluginId })
      }
    } catch (error) {
      report.failed.push(pluginId)
      // The org, never the person: this line is read by people who were not
      // asked to look the person up.
      console.error(`[plugins] ${pluginId} failed to match a person in org ${request.orgId}`, error)
    }
  }
  report.matches.sort((a, b) =>
    a.basis === b.basis ? 0 : a.basis === 'email' ? -1 : 1,
  )
  return report
}
