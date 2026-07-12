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

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pluginArtifactPath } from '../app-utils/plugin-manifest'
import {
  isCompatibleHostAbi,
  type RealmPluginInstall,
  verifyRealmBundle,
} from './realm-plugins'

/**
 * Remote SERVER handler bundles (AGL-420) — the highest-risk switch in the
 * platform, default OFF everywhere. When explicitly enabled, the API
 * dispatchers load staff-signed bundles that register plugin API routes
 * in-process. Guardrails, all mandatory (unlike the client tier, none are
 * optional here):
 *
 * - `PLUGIN_REMOTE_SERVER=enabled` — the master switch.
 * - `PLUGIN_REMOTE_SERVER_BUNDLES` — an explicit per-deploy allowlist of
 *   `listingId@version` entries; nothing loads implicitly from installs.
 * - `PLUGIN_TRUST_PUBLIC_KEY` — REQUIRED; every bundle must carry a valid
 *   platform Ed25519 signature over its sha256. No key, no loading.
 * - sha256 content-addressing against the version doc, same as the client.
 *
 * Verified bytes are written to a private temp file and imported by
 * `file://` URL (node can't import blob URLs); the module's exported
 * `registerApi()` runs with the same registries first-party `/server`
 * entries use. Failures log and skip — a broken remote bundle must not
 * take the API surface down (its own paths simply stay unregistered).
 */

export interface RemoteServerBundleSource {
  /** Resolves a listing version doc to its pinned hash + signature. */
  resolveVersion(
    listingId: string,
    version: string,
  ): Promise<{
    sha256: string
    signature?: string
    trust?: string
    hostAbi?: number
  } | null>
  /** Base URL of the content-addressed artifacts origin. */
  artifactsBase: string
}

let loadedPromise: Promise<LoadedServerBundle[]> | undefined

export function remoteServerBundlesEnabled(): boolean {
  return process.env.PLUGIN_REMOTE_SERVER === 'enabled'
}

export interface LoadedServerBundle {
  listingId: string
  version: string
  sha256: string
}

export async function loadRemoteServerBundles(
  source: RemoteServerBundleSource,
): Promise<LoadedServerBundle[]> {
  if (!remoteServerBundlesEnabled()) return []
  if (!loadedPromise) {
    loadedPromise = (async () => {
      const loaded: LoadedServerBundle[] = []
      const publicKey = process.env.PLUGIN_TRUST_PUBLIC_KEY
      if (!publicKey) {
        console.error(
          'PLUGIN_REMOTE_SERVER is enabled but PLUGIN_TRUST_PUBLIC_KEY is ' +
            'not set — refusing to load any remote server bundle.',
        )
        return loaded
      }
      const allowlist = (process.env.PLUGIN_REMOTE_SERVER_BUNDLES ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
      if (!allowlist.length) return loaded
      const cacheDir = mkdtempSync(join(tmpdir(), 'aglyn-realm-'))

      for (const entry of allowlist) {
        try {
          const [listingId, version] = entry.split('@')
          if (!listingId || !version) throw new Error('malformed allowlist entry')
          const pinned = await source.resolveVersion(listingId, version)
          if (!pinned) throw new Error('unknown listing version')
          if (pinned.trust !== 'realm') throw new Error('not realm-trusted')
          if (!isCompatibleHostAbi(pinned.hostAbi)) {
            throw new Error(`built for host ABI ${pinned.hostAbi}`)
          }
          const url = `${source.artifactsBase.replace(/\/+$/, '')}/${pluginArtifactPath(
            listingId,
            version,
            pinned.sha256,
          )}`
          const response = await fetch(url)
          if (!response.ok) throw new Error(`fetch ${response.status}`)
          const bytes = await response.arrayBuffer()
          const verdict = await verifyRealmBundle(
            bytes,
            {
              listingId,
              version,
              sha256: pinned.sha256,
              trust: 'realm',
              signature: pinned.signature,
            } satisfies RealmPluginInstall,
            publicKey,
          )
          if (verdict.ok === false) throw new Error(verdict.reason)
          const file = join(cacheDir, `${listingId}-${version}.mjs`)
          writeFileSync(file, Buffer.from(bytes))
          const mod = (await import(
            /* webpackIgnore: true */ pathToFileURL(file).href
          )) as {
            registerApi?: () => void
            default?: { registerApi?: () => void }
          }
          const registerApi = mod.registerApi ?? mod.default?.registerApi
          if (typeof registerApi !== 'function') {
            throw new Error('bundle exports no registerApi()')
          }
          registerApi()
          loaded.push({ listingId, version, sha256: pinned.sha256 })
          console.info(`remote server bundle loaded: ${entry}`)
        } catch (error) {
          console.error(`remote server bundle ${entry} skipped:`, error)
        }
      }
      return loaded
    })()
  }
  return loadedPromise
}
