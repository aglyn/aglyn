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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * Searching for a domain name to register, as core asks for it (AGL-3958).
 *
 * The one-screen build for a client has a Domain step: staff type what the
 * owner wants, see what is free with its first-year and renewal price side by
 * side, and record the pick on the bundle link, so the owner buys it on their
 * own phone after subscribing. Which registrar answers, and what it charges,
 * is the domains plugin's; core asks through this slot and never imports it.
 *
 * One implementation, registered from the provider plugin's
 * `consoleServerDeclarations`: the only caller is a staff console route. A
 * deployment with no provider, or one whose provider has no registrar
 * configured, offers no search at all, and the step shows only "use the
 * free address" and "I have a domain".
 *
 * Search only. Nothing here buys, holds or reserves a name.
 */

/** One name a search found. */
export interface PluginDomainSearchResult {
  /** The full name, lower case: `example.com`. */
  name: string
  /** Whether the name can be registered now. */
  available: boolean
  /** What the first year costs, in US dollars, as the owner will be charged. */
  firstYearUsd: number
  /** What each year after costs, in US dollars. Shown beside the first year, always. */
  renewalUsd: number
  /** A registry premium name, priced above the TLD's list price. */
  premium?: boolean
}

export interface PluginDomainSearch {
  /**
   * Names for a query: the exact name when the query is one, and close
   * alternatives. `null` when the provider has no registrar configured in
   * this deployment, so there is nothing to search with. May throw; the
   * caller reports a failed search, never a partial one.
   */
  search(query: string): Promise<PluginDomainSearchResult[] | null>
}

export const PLUGIN_DOMAIN_SEARCH = definePluginServiceContract<PluginDomainSearch>(
  'core.domain-search',
  { multiple: false },
)

/**
 * Fills the slot. The owner is the loader's marker when a register fn is
 * running, else `options.pluginId`; a second plugin's implementation is
 * refused naming both.
 */
export function registerPluginDomainSearch(
  impl: PluginDomainSearch,
  options?: { pluginId?: string },
): void {
  registerPluginService(PLUGIN_DOMAIN_SEARCH, impl, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** Whether a plugin offers domain search in this process: the step's "show the search?" */
export function domainSearchRegistered(): boolean {
  return resolvePluginServices(PLUGIN_DOMAIN_SEARCH).length > 0
}

/** What a caller learns from a search. */
export type DomainSearchOutcome =
  | { status: 'ok'; results: PluginDomainSearchResult[] }
  /** No plugin offers search, or its registrar is not configured here. */
  | { status: 'unavailable' }
  /** The provider threw. Logged. */
  | { status: 'failed' }

/** Keeps a provider's answer to names and prices that can be shown as they are. */
function usable(result: PluginDomainSearchResult): boolean {
  const price = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  return (
    typeof result?.name === 'string' &&
    result.name.length > 0 &&
    typeof result.available === 'boolean' &&
    price(result.firstYearUsd) &&
    price(result.renewalUsd)
  )
}

/** Searches through whichever plugin offers it. Never throws. */
export async function searchDomains(query: string): Promise<DomainSearchOutcome> {
  const impl = resolvePluginServices(PLUGIN_DOMAIN_SEARCH)[0]?.impl
  if (!impl) return { status: 'unavailable' }
  try {
    const results = await impl.search(query)
    if (results === null) return { status: 'unavailable' }
    return {
      status: 'ok',
      results: (Array.isArray(results) ? results : [])
        .filter(usable)
        .map((result) => ({ ...result, name: result.name.toLowerCase() })),
    }
  } catch (error) {
    // The query is a business name a prospect said aloud: not logged.
    console.error('[domain-search] the provider failed a search', error)
    return { status: 'failed' }
  }
}
