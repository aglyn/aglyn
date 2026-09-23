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

import { normalizeFirstTouchHost } from '@aglyn/shared-util-first-touch'
import { DOCS_BASE_URL } from './docs-help'
import { PLATFORM_HOME_URL } from './platform-brand'

/**
 * The hosts this install serves ITSELF — the first-party host registry the
 * first-touch capture reads (AGL-3289).
 *
 * A referrer on one of these is internal and never a first touch, and the
 * capture only runs on a page served from one. Two layers:
 *
 * 1. **Built in**, derived from configuration every install already has: the
 *    workspace domain and every subdomain of it (the console, its auth host,
 *    each workspace, the docs host under it), plus the configured console,
 *    docs and home origins wherever they live. A self-hosted install gets its
 *    own list from its own configuration, with nothing new to set.
 * 2. **Configured**, a list staff edit on the Platform settings page and the
 *    platform keeps in `platformSettings/firstPartyHosts` — for a surface the
 *    configuration cannot name: a forum, a status page, another apex.
 *
 * Adding a surface is therefore: register its host (unless the workspace
 * domain already covers it), and include the capture. Nothing else.
 *
 * ## What is deliberately NOT first-party
 *
 * Published customer sites. A visitor who follows a customer's "made with"
 * badge to the platform arrived from somebody else's site, which is exactly
 * the kind of referral the record is for. The tenant domain lives outside the
 * workspace domain on the platform's own deployment; where an install nests it
 * inside, the registry EXCLUDES it explicitly rather than trusting the
 * wildcard.
 */

/** The `platformSettings` document the configured list lives in. */
export const FIRST_PARTY_HOSTS_SETTINGS_DOC = 'firstPartyHosts'

/** How many entries staff may configure; the built-in list is not counted. */
export const FIRST_PARTY_HOSTS_MAX = 50

/** The configuration the built-in list is derived from. */
export interface PlatformHostInputs {
  /** The domain workspaces are served under; its subdomains are all ours. */
  workspaceDomain: string | null
  consoleUrl: string | null
  docsUrl: string | null
  homeUrl: string | null
  /** The domain customer sites are served under. */
  tenantDomain: string | null
  /** Local development, where the console and the sites run on localhost. */
  development: boolean
}

function hostOf(value: string | null | undefined): string {
  if (!value) return ''
  try {
    return normalizeFirstTouchHost(new URL(value).hostname)
  } catch {
    return normalizeFirstTouchHost(value)
  }
}

/**
 * A registry entry as staff typed it, or '' when it is not one: a host, a
 * `*.` wildcard, either with a leading `!` to exclude, or a URL whose host is
 * taken. Every host but `localhost` needs a dot, so nobody can make a whole
 * top-level domain internal by typing `*.com`.
 */
export function normalizeFirstPartyHostEntry(value: unknown): string {
  if (typeof value !== 'string') return ''
  let raw = value.trim().toLowerCase()
  const negated = raw.startsWith('!')
  if (negated) raw = raw.slice(1).trim()
  const wildcard = raw.startsWith('*.')
  if (wildcard) raw = raw.slice(2)
  const host = raw.includes('/') ? hostOf(raw.includes('://') ? raw : `https://${raw}`) : hostOf(raw)
  if (!host) return ''
  if (host !== 'localhost' && !host.includes('.')) return ''
  return `${negated ? '!' : ''}${wildcard ? '*.' : ''}${host}`
}

/** The built-in list for a set of configuration values. */
export function builtInFirstPartyHosts(inputs: PlatformHostInputs): string[] {
  const hosts: string[] = []
  const add = (entry: string) => {
    const normalized = normalizeFirstPartyHostEntry(entry)
    if (normalized && !hosts.includes(normalized)) hosts.push(normalized)
  }
  const workspace = hostOf(inputs.workspaceDomain)
  if (workspace) {
    add(workspace)
    add(`*.${workspace}`)
  }
  for (const url of [inputs.consoleUrl, inputs.docsUrl]) {
    const host = hostOf(url)
    if (host) add(host)
  }
  const home = hostOf(inputs.homeUrl)
  if (home) {
    add(home)
    if (!home.startsWith('www.')) add(`www.${home}`)
  }
  const tenant = hostOf(inputs.tenantDomain)
  if (tenant && workspace && tenant.endsWith(`.${workspace}`)) {
    add(`!${tenant}`)
    add(`!*.${tenant}`)
  }
  if (inputs.development) {
    add('localhost')
    add('*.localhost')
  }
  return hosts
}

/**
 * This deployment's configuration, read the way the rest of the platform
 * reads it.
 *
 * The workspace domain falls back to the home URL's host when its variable is
 * unset — which it is on the platform's own production console, where the
 * code-level default and the home URL name the same apex. Dot notation
 * throughout, so a browser bundle gets the build-time values.
 */
export function platformHostInputs(): PlatformHostInputs {
  const home = hostOf(PLATFORM_HOME_URL)
  return {
    workspaceDomain:
      process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ||
      (home.startsWith('www.') ? home.slice(4) : home) ||
      null,
    consoleUrl: process.env.NEXT_PUBLIC_CONSOLE_URL || null,
    docsUrl: DOCS_BASE_URL || null,
    homeUrl: PLATFORM_HOME_URL,
    tenantDomain: process.env.NEXT_PUBLIC_TENANT_DOMAIN || null,
    development: process.env.NODE_ENV !== 'production',
  }
}

/**
 * The whole registry: the built-in list, then whatever staff configured,
 * cleaned and de-duplicated. An unusable configured entry is dropped rather
 * than failing the list, because a registry that refused to load would switch
 * the capture off everywhere at once.
 */
export function mergeFirstPartyHosts(builtIn: readonly string[], configured: unknown): string[] {
  const hosts = [...builtIn]
  const entries = Array.isArray(configured) ? configured.slice(0, FIRST_PARTY_HOSTS_MAX) : []
  for (const entry of entries) {
    const normalized = normalizeFirstPartyHostEntry(entry)
    if (normalized && !hosts.includes(normalized)) hosts.push(normalized)
  }
  return hosts
}
