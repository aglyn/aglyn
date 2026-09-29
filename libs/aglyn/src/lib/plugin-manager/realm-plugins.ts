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

import { pluginArtifactPath } from '../app-utils/plugin-artifact-path'
import type { PluginContributions } from './plugin-contributions'
import { capturePluginStyles } from './plugin-styles'

/**
 * Trusted-realm remote plugins (AGL-420). Marketplace bundles normally run
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
  /**
   * The pinned version's manifest id (AGL-3116): the `pluginId` its own
   * elements carry, which is how a page shows it uses an undeclared plugin.
   */
  pluginId?: string
  /**
   * The namespace the pinned version was published under (AGL-3390),
   * `<publisher handle>.<manifest id>`: the `pluginId` its components carry
   * and the prefix of their ids. Absent on a version published before
   * identities existed.
   */
  identity?: string
  /**
   * What the pinned version declares it contributes (AGL-3116); absent when
   * it declares nothing, and then the default in `plugin-contributions.ts`
   * decides where it loads.
   */
  contributes?: PluginContributions
}

/**
 * ABI gate (AGL-429): a declared `hostAbi` must equal the running host's
 * generation; absent = pre-compat bundle, allowed (with a loader warning)
 * so existing installs keep working across the introduction of the field.
 */
export function isCompatibleHostAbi(hostAbi: number | undefined): boolean {
  return hostAbi === undefined || hostAbi === PLUGIN_HOST_ABI_VERSION
}

/** What a realm bundle's module exports. */
export interface RealmBundleModule {
  register?: (host: unknown) => void
  default?: { register?: (host: unknown) => void }
}

/**
 * The slice of the component registry a realm load is held to (AGL-3390):
 * the app passes core's `components`, whose maps these are.
 */
export interface RealmRegistry {
  factories: Record<string, unknown>
  schemas: Record<string, { pluginId?: string } | undefined>
  presets: Record<string, { pluginId?: string } | undefined>
  registerComponent(factory: never, schema: never): void
  unregisterComponent(id: string): void
  registerPreset(preset: never): void
  unregisterPreset(id: string): void
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
  /**
   * The registry every bundle's registrations are checked against
   * (AGL-3390). See {@link realmRegistrationProblems}.
   */
  registry?: RealmRegistry
  /**
   * Turns verified bytes into a module. The browser's default imports a blob
   * URL; a server, which cannot import one, passes a `data:` URL importer.
   */
  importModule?: (bytes: ArrayBuffer) => Promise<RealmBundleModule>
  /** Aborts an artifact fetch that has not answered, in milliseconds. */
  fetchTimeoutMs?: number
}

/** A copy of the registry's three maps, taken before a bundle runs. */
export interface RealmRegistrySnapshot {
  factories: Record<string, unknown>
  schemas: Record<string, { pluginId?: string } | undefined>
  presets: Record<string, { pluginId?: string } | undefined>
}

export function snapshotRealmRegistry(
  registry: RealmRegistrySnapshot,
): RealmRegistrySnapshot {
  return {
    factories: { ...registry.factories },
    schemas: { ...registry.schemas },
    presets: { ...registry.presets },
  }
}

/** The keys whose value differs between two maps, including added and removed. */
function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((key) => before[key] !== after[key])
}

/**
 * What a realm bundle registered that it may not have (AGL-3390).
 *
 * The registry is process-global: on a server it holds every site's
 * elements. A bundle is therefore held to three rules:
 *
 * - It replaces and removes nothing that was registered before it ran.
 * - A component id containing a `.` is a marketplace namespace
 *   (`<identity>.<role>`), and a bundle may use only its own.
 * - A bundle published with an identity registers every component in that
 *   namespace, and every component and preset names that identity as its
 *   plugin, which is what the renderer's per-site gate reads.
 *
 * Empty when the bundle kept to them.
 */
export function realmRegistrationProblems(
  before: RealmRegistrySnapshot,
  after: RealmRegistrySnapshot,
  install: Pick<RealmPluginInstall, 'identity'>,
): string[] {
  const problems: string[] = []
  const identity = install.identity
  const components = new Set([
    ...changedKeys(before.factories, after.factories),
    ...changedKeys(before.schemas, after.schemas),
  ])
  for (const id of components) {
    const existed = id in before.factories || id in before.schemas
    const exists = id in after.factories || id in after.schemas
    if (existed) {
      problems.push(`${exists ? 'replaces' : 'removes'} component ${id}`)
      continue
    }
    const inOwnNamespace = Boolean(identity) && id.startsWith(`${identity}.`)
    if (id.includes('.') && !inOwnNamespace) {
      problems.push(`registers ${id} outside its namespace`)
    } else if (identity && !inOwnNamespace) {
      problems.push(`registers ${id}, which is not ${identity}.<role>`)
    } else if (identity && after.schemas[id]?.pluginId !== identity) {
      problems.push(`registers ${id} under another plugin id`)
    }
  }
  for (const id of changedKeys(before.presets, after.presets)) {
    if (id in before.presets) {
      problems.push(`${id in after.presets ? 'replaces' : 'removes'} preset ${id}`)
    } else if (identity && after.presets[id]?.pluginId !== identity) {
      problems.push(`registers preset ${id} under another plugin id`)
    }
  }
  return problems
}

/** Puts the registry back the way `before` had it, for every key that moved. */
function restoreRealmRegistry(
  registry: RealmRegistry,
  before: RealmRegistrySnapshot,
): void {
  const components = new Set([
    ...changedKeys(before.factories, registry.factories),
    ...changedKeys(before.schemas, registry.schemas),
  ])
  for (const id of components) {
    const factory = before.factories[id]
    const schema = before.schemas[id]
    if (factory && schema) {
      registry.registerComponent(factory as never, schema as never)
    } else {
      registry.unregisterComponent(id)
    }
  }
  for (const id of changedKeys(before.presets, registry.presets)) {
    const preset = before.presets[id]
    if (preset) registry.registerPreset(preset as never)
    else registry.unregisterPreset(id)
  }
}

/** Imports verified bytes in a browser, through a blob URL. */
async function importFromBlob(bytes: ArrayBuffer): Promise<RealmBundleModule> {
  const blobUrl = URL.createObjectURL(
    new Blob([bytes], { type: 'text/javascript' }),
  )
  try {
    return (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ blobUrl
    )) as RealmBundleModule
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

const decodeBase64 = (value: string): Uint8Array => {
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  }
  // Node without atob (never in practice on the pinned runtime, kept for
  // safety). Reached through `globalThis` rather than as a bare global: a
  // free `Buffer` identifier makes a browser bundler inject its 22 KB
  // polyfill for a branch no browser can enter.
  return new Uint8Array(globalThis.Buffer.from(value, 'base64'))
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

/**
 * `PLUGIN_HOST_GLOBAL` (`app-utils/plugin-host-abi.ts`), spelled out: this
 * module ships on every published page and the ABI module's key lists would
 * ride along for one string. `realm-plugins.spec.ts` holds the two equal.
 */
const HOST_GLOBAL = '__AGLYN_PLUGIN_HOST__'

/**
 * Publishes the host ABI realm bundles build against. The APP composes it
 * (React/jsxRuntime/MUI must come from the app bundle so singletons hold) —
 * core only owns the slot, the version stamp and the key list
 * (`PLUGIN_HOST_ABI_KEYS`).
 */
export function setRealmPluginHost(host: Record<string, unknown>): void {
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL] = {
    version: PLUGIN_HOST_ABI_VERSION,
    ...host,
  }
}

const loaded = new Map<string, Promise<void>>()

/** The tail of the queue {@link runExclusively} runs work on. */
let registering: Promise<unknown> = Promise.resolve()

/** Runs `work` after every earlier call's work has settled. */
function runExclusively<T>(work: () => Promise<T>): Promise<T> {
  const run = registering.then(
    (): Promise<T> => work(),
    (): Promise<T> => work(),
  )
  registering = run.catch((): undefined => undefined)
  return run
}

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
  const runBundle = async (
    bytes: ArrayBuffer,
    install: RealmPluginInstall,
  ): Promise<void> => {
    const registry = options.registry
    const before = registry ? snapshotRealmRegistry(registry) : null
    // AGL-2486: module evaluation and `register()` both run inside
    // the style capture, because a bundler's `import './x.css'`
    // compiles to a `document.head.appendChild(<style>)` at module
    // EVAL time — before `register` is ever called. Anything the
    // bundle injects in that window is mirrored into the besigner
    // canvas's closed shadow root, which a document-level rule
    // otherwise cannot reach at all (measured: no effect on the
    // canvas, wins outright on the published page). See
    // `plugin-styles.tsx`.
    await capturePluginStyles(install.listingId, async () => {
      const mod = await (options.importModule ?? importFromBlob)(bytes)
      const register = mod.register ?? mod.default?.register
      if (typeof register !== 'function') {
        throw new Error('bundle exports no register(host)')
      }
      register(host)
    })
    // Held to its namespace (AGL-3390). A bundle that broke a rule is
    // undone whole, not in part: half a plugin is harder to reason
    // about than none, and the published page already treats a
    // plugin that failed to load as absent.
    if (registry && before) {
      const problems = realmRegistrationProblems(
        before,
        snapshotRealmRegistry(registry),
        install,
      )
      if (problems.length) {
        restoreRealmRegistry(registry, before)
        throw new Error(`refused: ${problems.join('; ')}`)
      }
    }
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
            const response = await fetch(
              url,
              options.fetchTimeoutMs
                ? { signal: AbortSignal.timeout(options.fetchTimeoutMs) }
                : undefined,
            )
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
            // One bundle runs at a time: the check below reads what changed in
            // the registry while THIS bundle ran, and another bundle's
            // registrations landing in the same window would be blamed on it.
            await runExclusively(() => runBundle(bytes, install))
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
