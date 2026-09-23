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
  builtInFirstPartyHosts,
  FIRST_PARTY_HOSTS_SETTINGS_DOC,
  mergeFirstPartyHosts,
  platformHostInputs,
} from '@aglyn/aglyn/app-utils/first-party-hosts'
import { isFirstPartyHost } from '@aglyn/shared-util-first-touch'
import firebaseAdmin from './firebase-admin'

/**
 * The first-party host registry as a server reads it (AGL-3289): the list
 * built from this deployment's configuration, plus the list staff keep on the
 * Platform settings page. Both apps serve the capture and read it here.
 */

/** Where platform-wide settings live; the rules deny every client. */
export const FIRST_PARTY_HOSTS_COLLECTION = 'platformSettings'

/** How long a process serves the list it read before reading again. */
export const FIRST_PARTY_HOSTS_CACHE_TTL_MS = 5 * 60 * 1000

/** The list staff configured, and who last changed it. */
export interface ConfiguredFirstPartyHosts {
  hosts: string[]
  updatedAtMs: number | null
  updatedBy: string | null
}

function settingsDoc() {
  return firebaseAdmin
    .app()
    .firestore()
    .collection(FIRST_PARTY_HOSTS_COLLECTION)
    .doc(FIRST_PARTY_HOSTS_SETTINGS_DOC)
}

/** What staff configured, as stored. */
export async function readConfiguredFirstPartyHosts(): Promise<ConfiguredFirstPartyHosts> {
  const snapshot = await settingsDoc().get()
  const hosts = snapshot.get('hosts')
  return {
    hosts: Array.isArray(hosts) ? hosts.filter((entry): entry is string => typeof entry === 'string') : [],
    updatedAtMs: typeof snapshot.get('updatedAtMs') === 'number' ? snapshot.get('updatedAtMs') : null,
    updatedBy: typeof snapshot.get('updatedBy') === 'string' ? snapshot.get('updatedBy') : null,
  }
}

/** Replace what staff configured. The caller audits and invalidates. */
export async function writeConfiguredFirstPartyHosts(
  hosts: readonly string[],
  updatedBy: string | null,
  nowMs: number = Date.now(),
): Promise<void> {
  await settingsDoc().set({ hosts: [...hosts], updatedAtMs: nowMs, updatedBy })
}

let cached: { hosts: string[]; configured: string[]; at: number } | null = null
let reading: Promise<string[]> | null = null

/** Forget the cached list, so the process that changed it serves the change. */
export function invalidateFirstPartyHostsCache(): void {
  cached = null
}

/** This deployment's built-in list, with nothing configured. */
export function builtInHosts(): string[] {
  return builtInFirstPartyHosts(platformHostInputs())
}

/**
 * The whole registry, cached per process.
 *
 * A failed read serves the built-in list with whatever this process last read
 * configured, rather than failing: the capture keeps working on every host the
 * configuration already names, and a registry that could not load must never
 * switch the capture off everywhere at once.
 */
export async function resolveFirstPartyHosts(nowMs: number = Date.now()): Promise<string[]> {
  if (cached && nowMs - cached.at < FIRST_PARTY_HOSTS_CACHE_TTL_MS) return cached.hosts
  if (!reading) {
    reading = (async () => {
      let configured = cached?.configured ?? []
      try {
        configured = (await readConfiguredFirstPartyHosts()).hosts
      } catch (error) {
        console.error('[first-party-hosts] read failed; serving the built-in list', error)
      }
      const hosts = mergeFirstPartyHosts(builtInHosts(), configured)
      cached = { hosts, configured, at: Date.now() }
      return hosts
    })().finally(() => {
      reading = null
    })
  }
  return reading
}

/**
 * Whether a published site is one of the platform's OWN surfaces: its custom
 * domain is a registered host. A site on the tenant domain is always a
 * customer's, and so is any custom domain the registry does not name.
 */
export async function isFirstPartySite(site: { cname?: unknown } | null | undefined): Promise<boolean> {
  const cname = typeof site?.cname === 'string' ? site.cname.trim() : ''
  if (!cname) return false
  return isFirstPartyHost(cname, await resolveFirstPartyHosts())
}

/**
 * The origin to echo in `Access-Control-Allow-Origin`, or null to echo none:
 * an https origin on a registered host, or http on localhost.
 */
export function firstPartyOrigin(
  origin: string | null | undefined,
  hosts: readonly string[],
): string | null {
  if (!origin) return null
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
  if (!secure || url.origin !== origin) return null
  return isFirstPartyHost(url.hostname, hosts) ? url.origin : null
}
