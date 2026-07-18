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

import { pluginArtifactPath } from '../app-utils/plugin-manifest'

/**
 * Trusted-realm remote plugins (AGL-420). Community bundles normally run
 * inside the cross-origin sandboxed PluginFrame; listings a staff member
 * has REVIEWED AND SIGNED (`trust: 'realm'`) may instead load into the app
 * realm and register real components/runtimes — first-party-grade
 * extensions installed from the marketplace.
 *
 * Trust chain, all of which must hold before a byte executes:
 * 1. The install doc pins {version, sha256}; the fetched bundle's SHA-256
 *    must match (content-addressing — a swapped artifact can't load).
 * 2. The version doc carries an Ed25519 `signature` over the sha256 hex,
 *    made by the platform signing key (staff publish flow). When a public
 *    key is configured, verification is MANDATORY and fails closed —
 *    including on runtimes without WebCrypto Ed25519 support.
 * 3. Bundles import nothing: the host injects its React/registry
 *    singletons through `globalThis.__AGLYN_PLUGIN_HOST__` (see
 *    {@link setRealmPluginHost}), so there is exactly one registry/React
 *    instance — the same invariant that keeps first-party canvases from
 *    rendering blank.
 *
 * Everything here is isomorphic (WebCrypto only, no node imports) so the
 * client barrel stays browser-safe; the server-side loader for API
 * handler bundles lives in realm-server.ts (node-only, /server entry).
 */

export const PLUGIN_HOST_ABI_VERSION = 1

/** The pinned install shape the loaders consume (installs + version doc). */
export interface RealmPluginInstall {
  listingId: string
  version: string
  sha256: string
  /** Staff-granted tier; anything but 'realm' never realm-loads. */
  trust?: string
  /** Ed25519 signature (base64) over the sha256 hex string. */
  signature?: string
  /** Host ABI the bundle targets (AGL-429); mismatches never load. */
  hostAbi?: number
}

/**
 * ABI gate (AGL-429): a declared `hostAbi` must equal the running host's
 * generation; absent = pre-compat bundle, allowed (with a loader warning)
 * so existing installs keep working across the introduction of the field.
 */
export function isCompatibleHostAbi(hostAbi: number | undefined): boolean {
  return hostAbi === undefined || hostAbi === PLUGIN_HOST_ABI_VERSION
}

export interface LoadRealmPluginsOptions {
  /** Base URL of the content-addressed artifacts origin. */
  artifactsBase: string
  /**
   * Base64 raw Ed25519 public key. When set, unsigned or badly-signed
   * bundles are rejected; when unset, signature checking is skipped and
   * the Firestore trust flag + sha pinning are the whole gate (dev mode).
   */
  publicKeyBase64?: string
}

const decodeBase64 = (value: string): Uint8Array => {
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  }
  // Node without atob (never in practice on >=16, kept for safety).
  return new Uint8Array(Buffer.from(value, 'base64'))
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verifies the platform Ed25519 signature over a sha256 hex string.
 * Fails CLOSED: any import/verify error (including runtimes without
 * WebCrypto Ed25519) returns false.
 */
export async function verifyRealmSignature(
  shaHex: string,
  signatureBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      decodeBase64(publicKeyBase64) as unknown as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return await globalThis.crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      decodeBase64(signatureBase64) as unknown as ArrayBuffer,
      new TextEncoder().encode(shaHex),
    )
  } catch {
    return false
  }
}

/**
 * Verifies fetched bundle bytes against a pinned install: content hash
 * always; platform signature when a public key is configured. Returns the
 * reason on failure so callers can log precisely.
 */
export async function verifyRealmBundle(
  bytes: ArrayBuffer,
  install: RealmPluginInstall,
  publicKeyBase64?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const digest = await sha256Hex(bytes)
  if (digest !== install.sha256) {
    return { ok: false, reason: `sha256 mismatch (got ${digest.slice(0, 12)}…)` }
  }
  if (publicKeyBase64) {
    if (!install.signature) return { ok: false, reason: 'missing signature' }
    const valid = await verifyRealmSignature(
      install.sha256,
      install.signature,
      publicKeyBase64,
    )
    if (!valid) return { ok: false, reason: 'invalid signature' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Host ABI + client loader (browser only past this point).
// ---------------------------------------------------------------------------

const HOST_GLOBAL = '__AGLYN_PLUGIN_HOST__'

/**
 * Publishes the host ABI realm bundles build against. The APP composes it
 * (React/jsxRuntime must come from the app bundle so singletons hold) —
 * core only owns the slot and the version stamp.
 */
export function setRealmPluginHost(host: Record<string, unknown>): void {
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL] = {
    version: PLUGIN_HOST_ABI_VERSION,
    ...host,
  }
}

const loaded = new Map<string, Promise<void>>()

/**
 * Fetches, verifies, and executes realm bundles in the app realm. Each
 * bundle default-exports (or exports) `register(host)`; failures are
 * logged and skipped — a broken marketplace plugin must never take the
 * console or a site down. Idempotent per listing@version.
 */
export async function loadRealmPlugins(
  installs: readonly RealmPluginInstall[],
  options: LoadRealmPluginsOptions,
): Promise<void> {
  const host = (globalThis as Record<string, unknown>)[HOST_GLOBAL]
  const realmInstalls = installs.filter((install) => install.trust === 'realm')
  // Fail closed (AGL-507): without the trust public key we cannot verify
  // bundle signatures, so refuse to load any realm plugin rather than fall
  // back to sha256-only — mirroring the mandatory server-side key check
  // (realm-server.ts). Silently degrading here contradicted the documented
  // "verification is MANDATORY and fails closed" contract.
  if (realmInstalls.length > 0 && !options.publicKeyBase64) {
    console.error(
      `realm plugins: refusing to load ${realmInstalls.length} bundle(s) — ` +
        'NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY is not configured, so signatures ' +
        'cannot be verified',
    )
    return
  }
  await Promise.all(
    realmInstalls.map((install) => {
        const key = `${install.listingId}@${install.version}`
        let promise = loaded.get(key)
        if (!promise) {
          promise = (async () => {
            const url = `${options.artifactsBase.replace(/\/+$/, '')}/${pluginArtifactPath(
              install.listingId,
              install.version,
              install.sha256,
            )}`
            const response = await fetch(url)
            if (!response.ok) throw new Error(`fetch ${response.status}`)
            if (!isCompatibleHostAbi(install.hostAbi)) {
              throw new Error(
                `built for host ABI ${install.hostAbi}, host is ${PLUGIN_HOST_ABI_VERSION}`,
              )
            }
            if (install.hostAbi === undefined) {
              console.warn(
                `realm plugin ${key}: no hostAbi declared (pre-AGL-429 bundle)`,
              )
            }
            const bytes = await response.arrayBuffer()
            const verdict = await verifyRealmBundle(
              bytes,
              install,
              options.publicKeyBase64,
            )
            if (verdict.ok === false) throw new Error(verdict.reason)
            const blobUrl = URL.createObjectURL(
              new Blob([bytes], { type: 'text/javascript' }),
            )
            try {
              const mod = (await import(/* webpackIgnore: true */ blobUrl)) as {
                register?: (host: unknown) => void
                default?: { register?: (host: unknown) => void }
              }
              const register = mod.register ?? mod.default?.register
              if (typeof register !== 'function') {
                throw new Error('bundle exports no register(host)')
              }
              register(host)
            } finally {
              URL.revokeObjectURL(blobUrl)
            }
          })().catch((error) => {
            loaded.delete(key)
            console.error(`realm plugin ${key} failed to load:`, error)
          })
          loaded.set(key, promise)
        }
        return promise
      }),
  )
}
