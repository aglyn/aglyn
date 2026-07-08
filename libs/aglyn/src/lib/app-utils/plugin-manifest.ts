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
 * Executable-plugin manifest, artifact-path, CSP, and revocation helpers
 * (AGL-45), per the accepted AGL-43 design. Plugins — unlike declarative
 * components (see `community.ts`) — are code, so they never run in the
 * console/tenant origin: they load in a sandboxed iframe on a dedicated
 * plugin origin, and this manifest is the contract the install screen
 * shows verbatim and the serving layer turns into CSP. Pure module — safe
 * to import from API routes, the loader, and the host runtime alike.
 */

/** Capabilities a plugin declares; shown verbatim at install. */
export interface PluginCapabilities {
  /**
   * Outbound origins the plugin may call (`connect-src`), each an exact
   * https origin (`https://api.example.com`). Empty = no network.
   */
  network?: string[]
  /** Prop names the host passes IN through the bridge. */
  props?: string[]
  /** Event names the plugin may emit OUT through the bridge. */
  events?: string[]
  /** Rendered iframe region size (host reserves this box). */
  size?: { width?: number; height?: number }
}

export interface PluginManifest {
  /** Stable plugin id (matches the listing); persisted, never renamed. */
  id: string
  /** Human name shown in the drawer + install screen. */
  name: string
  /** Semver-ish version string (`1.2.0`); must match the artifact version. */
  version: string
  /** Bundle entry the loader imports on the plugin origin. */
  entry: string
  capabilities?: PluginCapabilities
  /** Besigner lineal rules the registered component honors (AGL-45 §4). */
  restrictParent?: string[]
  restrictChildren?: string[]
  description?: string
}

/** A published, content-addressed version of a plugin listing. */
export interface PluginListingVersion {
  version: string
  /** Content hash of the artifact bundle (integrity check at load). */
  sha256: string
  signature?: string
  changelog?: string
  createdAtMs?: number
  manifest: PluginManifest
}

/** `hosts/{hostId}/installs/{listingId}` — a pinned plugin install. */
export interface PluginInstall {
  listingId: string
  version: string
  sha256: string
  installedAtMs?: number
  updatedAtMs?: number
  entitlementRef?: string
}

/** `revocations/{listingId}` — platform kill switch checked at load. */
export interface PluginRevocation {
  /** Specific versions revoked, or `'all'` to kill the whole listing. */
  versions: string[] | 'all'
  reason?: string
  atMs?: number
}

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/
export const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/
export const PLUGIN_MAX_NETWORK_ORIGINS = 10
export const PLUGIN_MAX_PROPS = 32
export const PLUGIN_MAX_EVENTS = 32
export const PLUGIN_MAX_SIZE_PX = 4096
const HTTPS_ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/**
 * Validates a manifest at publish time. Returns the normalized manifest or
 * a human-readable error — the publish Cloud Function refuses to store a
 * bundle whose manifest doesn't pass, so bad capabilities never reach a
 * consumer's install screen.
 */
export function validatePluginManifest(
  input: unknown,
): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Manifest must be an object' }
  }
  const raw = input as Record<string, unknown>
  const id = String(raw['id'] ?? '')
  if (!PLUGIN_ID_PATTERN.test(id)) {
    return { ok: false, error: 'Invalid plugin id' }
  }
  const version = String(raw['version'] ?? '')
  if (!PLUGIN_VERSION_PATTERN.test(version)) {
    return { ok: false, error: 'Version must be semver (e.g. 1.0.0)' }
  }
  const name = String(raw['name'] ?? '').trim()
  if (!name || name.length > 80) {
    return { ok: false, error: 'Name is required (max 80 chars)' }
  }
  const entry = String(raw['entry'] ?? '').trim()
  // Entry is a relative bundle path — absolute URLs would let a plugin
  // point the loader at an off-origin script.
  if (!entry || /^[a-z][a-z0-9+.-]*:/i.test(entry) || entry.startsWith('//')) {
    return { ok: false, error: 'Entry must be a relative bundle path' }
  }

  const capabilitiesInput = (raw['capabilities'] ?? {}) as Record<
    string,
    unknown
  >
  const capabilities: PluginCapabilities = {}

  const network = capabilitiesInput['network']
  if (network !== undefined) {
    if (!Array.isArray(network) || network.length > PLUGIN_MAX_NETWORK_ORIGINS) {
      return { ok: false, error: 'Too many network origins declared' }
    }
    for (const origin of network) {
      if (typeof origin !== 'string' || !HTTPS_ORIGIN_PATTERN.test(origin)) {
        return {
          ok: false,
          error: `Network origin "${origin}" must be an https origin`,
        }
      }
    }
    if (network.length) capabilities.network = [...new Set(network as string[])]
  }

  for (const key of ['props', 'events'] as const) {
    const list = capabilitiesInput[key]
    if (list === undefined) continue
    const max = key === 'props' ? PLUGIN_MAX_PROPS : PLUGIN_MAX_EVENTS
    if (!Array.isArray(list) || list.length > max) {
      return { ok: false, error: `Too many ${key} declared` }
    }
    for (const name of list) {
      if (typeof name !== 'string' || !IDENTIFIER_PATTERN.test(name)) {
        return { ok: false, error: `Invalid ${key} name "${name}"` }
      }
    }
    if (list.length) capabilities[key] = [...new Set(list as string[])]
  }

  const size = capabilitiesInput['size'] as
    | { width?: unknown; height?: unknown }
    | undefined
  if (size) {
    const width = Number(size.width ?? 0)
    const height = Number(size.height ?? 0)
    if (
      (size.width !== undefined &&
        (!Number.isFinite(width) || width < 0 || width > PLUGIN_MAX_SIZE_PX)) ||
      (size.height !== undefined &&
        (!Number.isFinite(height) ||
          height < 0 ||
          height > PLUGIN_MAX_SIZE_PX))
    ) {
      return { ok: false, error: 'Declared size is out of range' }
    }
    capabilities.size = {
      ...(size.width !== undefined ? { width } : {}),
      ...(size.height !== undefined ? { height } : {}),
    }
  }

  const restrict = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const ids = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    )
    return ids.length ? [...new Set(ids)] : undefined
  }

  return {
    ok: true,
    manifest: {
      id,
      name,
      version,
      entry,
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
      ...(restrict(raw['restrictParent'])
        ? { restrictParent: restrict(raw['restrictParent']) }
        : {}),
      ...(restrict(raw['restrictChildren'])
        ? { restrictChildren: restrict(raw['restrictChildren']) }
        : {}),
      ...(typeof raw['description'] === 'string'
        ? { description: String(raw['description']).slice(0, 500) }
        : {}),
    },
  }
}

/**
 * Content-addressed artifact object path in the isolated artifacts bucket.
 * Immutable per `{listingId}/{version}/{sha256}` — a new build is a new
 * path, so a consumer's pinned install can never be swapped underneath it.
 */
export function pluginArtifactPath(
  listingId: string,
  version: string,
  sha256: string,
): string {
  return `artifacts/${listingId}/${version}/${sha256}.bundle`
}

/**
 * Builds the plugin-origin `Content-Security-Policy` from a manifest:
 * `default-src 'none'` plus only what the manifest declares. `connect-src`
 * is the network allowlist (or 'none'); `frame-ancestors` is the caller-
 * supplied aglyn origin allowlist so only our apps may frame it.
 */
export function pluginContentSecurityPolicy(
  manifest: PluginManifest,
  frameAncestors: string[],
): string {
  const connect = manifest.capabilities?.network?.length
    ? manifest.capabilities.network.join(' ')
    : "'none'"
  const ancestors = frameAncestors.length ? frameAncestors.join(' ') : "'none'"
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    `connect-src ${connect}`,
    `frame-ancestors ${ancestors}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/**
 * True when a pinned version is killed — the whole listing (`'all'`) or the
 * specific version. Loaders check this before executing and render a safe
 * placeholder when true (AGL-45 §3.5 kill switch).
 */
export function isPluginRevoked(
  revocation: PluginRevocation | null | undefined,
  version: string,
): boolean {
  if (!revocation) return false
  if (revocation.versions === 'all') return true
  return (
    Array.isArray(revocation.versions) && revocation.versions.includes(version)
  )
}

/** Methods a host-mediated plugin fetch may use (AGL-191). */
export const PLUGIN_FETCH_METHODS = ['GET', 'POST'] as const
export type PluginFetchMethod = (typeof PLUGIN_FETCH_METHODS)[number]
/** Request/response body cap for host-mediated fetch (bytes). */
export const PLUGIN_FETCH_MAX_BODY_BYTES = 256 * 1024

/**
 * True when `url`'s origin is an exact match against the manifest's
 * declared `network` allowlist (AGL-191). The host re-checks this before
 * proxying a plugin's `fetch-request`, so a plugin can only reach origins
 * it declared at install (and the install screen surfaced). No allowlist =
 * no host-mediated network; https-only.
 */
export function isPluginNetworkAllowed(
  url: string,
  capabilities: PluginCapabilities | undefined,
): boolean {
  const allow = capabilities?.network
  if (!allow?.length) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return allow.includes(parsed.origin)
  } catch {
    return false
  }
}

/** Component id of the sandboxed plugin canvas element (plugins-ui-mui). */
export const PLUGIN_COMPONENT_ID = 'communityPlugin'

/** Resolved install data injected into a plugin node's props at compose. */
export interface ResolvedPluginInstall {
  listingId: string
  version: string
  sha256: string
  capabilities?: PluginCapabilities
  revoked?: boolean
}

/**
 * Compose-time injection (AGL-45), mirroring `attachFunctionDefinitions`:
 * a `communityPlugin` node carries only a `listingId` in the saved screen;
 * the tenant compose pass resolves that to the host's pinned install
 * (version/sha256/capabilities) and the kill-switch state, and stamps them
 * onto the node's props so `PluginFrame` renders without a client read.
 * Unknown/uninstalled listings leave the node untouched (it shows a safe
 * "not installed" placeholder rather than taking the screen down).
 */
export function attachPluginInstalls<T extends Record<string, any>>(
  nodes: T,
  installsByListingId: Record<string, ResolvedPluginInstall | undefined>,
): T {
  if (!Object.keys(installsByListingId).length) return nodes
  const next: Record<string, any> = {}
  for (const [id, node] of Object.entries(nodes)) {
    const listingId =
      node?.componentId === PLUGIN_COMPONENT_ID
        ? node?.props?.listingId
        : undefined
    const install = listingId
      ? installsByListingId[String(listingId)]
      : undefined
    next[id] = install
      ? {
          ...node,
          props: {
            ...node.props,
            version: install.version,
            sha256: install.sha256,
            capabilities: install.capabilities,
            revoked: Boolean(install.revoked),
          },
        }
      : node
  }
  return next as T
}
