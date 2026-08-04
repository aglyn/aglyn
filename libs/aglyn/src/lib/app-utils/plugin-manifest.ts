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
 * components (see `marketplace.ts`) — are code, so they never run in the
 * console/tenant origin: they load in a sandboxed iframe on a dedicated
 * plugin origin, and this manifest is the contract the install screen
 * shows verbatim and the serving layer turns into CSP. Pure module — safe
 * to import from API routes, the loader, and the host runtime alike.
 */

/** Capabilities a plugin declares; shown verbatim at install. */
/**
 * How a declared prop should be EDITED. Authoring metadata only (AGL-1049).
 *
 * Deliberately separate from `props`, which stays the security allowlist. A
 * schema entry for a name that is not in `props` widens nothing — it is
 * dropped, because the filter and the author disagreeing must resolve in the
 * filter's favour. The point of this is to make them agree, never to let a
 * publisher grant themselves a prop by describing it.
 */
export interface PluginPropSchema {
  /** Must also appear in `capabilities.props`, or this entry is ignored. */
  name: string
  /**
   * Which editor to render. Unknown values degrade to `string` rather than
   * being rejected: this is publisher-authored data, and a manifest from a
   * newer platform version must not make an older host refuse the plugin.
   */
  type?: 'string' | 'number' | 'boolean' | 'color' | 'date' | 'url' | 'select'
  label?: string
  description?: string
  /** Shown as the field's initial value, so "leave it alone" is visible. */
  default?: string | number | boolean
  /** `select` only. */
  options?: Array<{ value: string; label?: string }>
}

/**
 * A canvas element a plugin version contributes (AGL-1031).
 *
 * A first-party plugin that extends the besigner declares a `ComponentSchema`
 * and gets a first-class palette entry. A marketplace plugin doing the same
 * work got a generic "Plugin" wrapper and a JSON textarea. Where an element
 * came from is a fact about its provenance, not a different kind of thing.
 *
 * The line this must not cross: **declared schema drives AUTHORING; the
 * sandbox still owns runtime.** This is publisher-authored DATA. It never
 * becomes a React component in the host bundle — the palette entry, the label
 * and the attribute fields are host-rendered from the declaration, and the
 * saved node still resolves to a sandboxed `PluginFrame` integrity-checked
 * against the pinned sha256. Nothing here changes what executes or where.
 */
export interface PluginElementDeclaration {
  /**
   * Stable id, unique within the plugin. Saved on the node beside the listing
   * id, so renaming the display name never orphans a placed element.
   */
  id: string
  displayName: string
  description?: string
  /**
   * Drawer category. Constrained to a subset — see
   * {@link PLUGIN_ELEMENT_CATEGORIES}.
   */
  category?: string
  /**
   * An mdi icon NAME (`mdiTimerOutline`), never markup and never a path.
   *
   * A path would be arbitrary SVG from a publisher rendered into console
   * chrome; a name is looked up in the icon set the host already ships, so the
   * worst a bad value can do is render nothing.
   */
  icon?: string
  /**
   * The element's editable attributes. Intersected with `capabilities.props`
   * exactly as {@link PluginPropSchema} is — an attribute the plugin cannot
   * receive is not an attribute.
   */
  attributes?: PluginPropSchema[]
}

/**
 * Categories a third-party element may declare.
 *
 * Deliberately not the whole enum. `LAYOUT` and `NAVIGATION` are structural —
 * a third-party element appearing among the containers a page is built out of
 * invites placements the sandbox cannot honour, and taking a category away
 * later breaks every site that used it. Cheaper to decide now, as the issue
 * says; widening later is easy and narrowing is not.
 */
export const PLUGIN_ELEMENT_CATEGORIES: readonly string[] = [
  'Data Display',
  'Media',
  'Commerce',
  'Forms',
  'Input',
  'Text',
  'Sections & Blocks',
]

/** Bound on how many elements one plugin may contribute to the palette. */
export const PLUGIN_MAX_ELEMENTS = 12

export interface PluginCapabilities {
  /**
   * Outbound origins the plugin may call (`connect-src`), each an exact
   * https origin (`https://api.example.com`). Empty = no network.
   */
  network?: string[]
  /** Prop names the host passes IN through the bridge. THE allowlist. */
  props?: string[]
  /**
   * Optional editing metadata for the props above (AGL-1049). Absent on every
   * plugin published before this existed, which is why the authoring surface
   * falls back to a plain text field per declared name rather than requiring
   * it.
   */
  propSchema?: PluginPropSchema[]
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
  /**
   * Host ABI generation the bundle was built against (AGL-429). Realm and
   * remote-server loaders refuse a bundle whose declared ABI differs from
   * the running host's PLUGIN_HOST_ABI_VERSION; absent = pre-compat
   * bundle, loaded with a warning. Bumping the ABI is a breaking change.
   */
  hostAbi?: number
  capabilities?: PluginCapabilities
  /**
   * Canvas elements this version contributes to the palette (AGL-1031).
   *
   * Part of the reviewed bytes: a new element is a new version through review,
   * and a revoked version's elements vanish from the palette with it, because
   * the palette is built from the pinned install.
   */
  elements?: PluginElementDeclaration[]
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
  /**
   * Trust tier (AGL-420): 'realm' = staff-reviewed + platform-signed,
   * may load into the app realm; anything else stays in the sandboxed
   * PluginFrame. Staff-writable only.
   */
  trust?: string
  /** Ed25519 signature (base64) over the sha256 hex (AGL-420). */
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
  /** Mirrored trust tier + signature at install time (AGL-420). */
  trust?: string
  signature?: string
  installedAtMs?: number
  updatedAtMs?: number
  entitlementRef?: string
}

/** `revocations/{listingId}` — platform kill switch checked at load. */
export interface PluginRevocation {
  /**
   * Specific versions revoked, or `'all'` to kill the whole listing. This is
   * the ONLY field any reader consults — everything else on the doc records
   * who owns the entry so the two writers can coexist.
   */
  versions: string[] | 'all'
  reason?: string
  atMs?: number
  /**
   * `'takedown'` when the listing-level hide wrote it (AGL-948). Un-hiding
   * clears a takedown-owned entry, so it must not be the only record.
   */
  source?: string
  /**
   * Versions revoked by a REVIEW decision (AGL-1085), kept separately from
   * `versions` because a takedown flattens that to `'all'`. Without this,
   * un-hiding a listing would silently un-revoke versions a reviewer stopped
   * for an unrelated reason.
   */
  reviewVersions?: string[]
}

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/
export const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/
export const PLUGIN_MAX_NETWORK_ORIGINS = 10
export const PLUGIN_MAX_PROPS = 32
/** Label/description/default text is publisher-authored; keep it bounded. */
const PLUGIN_PROP_TEXT_MAX = 200
/**
 * `mdiTimerOutline` — an icon NAME from the set the host already ships.
 *
 * Never a path: a path is arbitrary SVG from a publisher rendered into console
 * chrome. A name is a lookup, so the worst an unknown one does is render
 * nothing.
 */
const MDI_ICON_NAME_PATTERN = /^mdi[A-Za-z0-9]{1,48}$/
const PROP_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'color',
  'date',
  'url',
  'select',
])
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
/**
 * Sanitizes a publisher-authored prop schema against a set of declared props.
 *
 * Shared by `capabilities.propSchema` and each element's `attributes`, so a
 * declared element cannot describe its way past the allowlist any more than a
 * top-level schema can. One implementation, one rule.
 */
function sanitizePropSchemaList(
  input: unknown,
  declared: ReadonlySet<string>,
): PluginPropSchema[] {
  if (!Array.isArray(input)) return []
  const out: PluginPropSchema[] = []
  const seen = new Set<string>()
  for (const raw of input.slice(0, PLUGIN_MAX_PROPS)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const name = entry['name']
    if (typeof name !== 'string' || !IDENTIFIER_PATTERN.test(name)) continue
    if (!declared.has(name) || seen.has(name)) continue
    seen.add(name)
    const type = PROP_SCHEMA_TYPES.has(String(entry['type']))
      ? (entry['type'] as PluginPropSchema['type'])
      : 'string'
    const next: PluginPropSchema = { name, type }
    for (const key of ['label', 'description'] as const) {
      const value = entry[key]
      if (typeof value === 'string' && value.trim()) {
        next[key] = value.trim().slice(0, PLUGIN_PROP_TEXT_MAX)
      }
    }
    const fallback = entry['default']
    if (
      typeof fallback === 'string' ||
      typeof fallback === 'number' ||
      typeof fallback === 'boolean'
    ) {
      next.default =
        typeof fallback === 'string'
          ? fallback.slice(0, PLUGIN_PROP_TEXT_MAX)
          : fallback
    }
    if (type === 'select' && Array.isArray(entry['options'])) {
      const options = (entry['options'] as unknown[])
        .map((option) => {
          const record = (option ?? {}) as Record<string, unknown>
          const value = record['value']
          if (typeof value !== 'string' || !value) return null
          const label = record['label']
          return {
            value: value.slice(0, PLUGIN_PROP_TEXT_MAX),
            ...(typeof label === 'string' && label.trim()
              ? { label: label.trim().slice(0, PLUGIN_PROP_TEXT_MAX) }
              : {}),
          }
        })
        .filter(Boolean) as Array<{ value: string; label?: string }>
      if (options.length) next.options = options.slice(0, PLUGIN_MAX_PROPS)
    }
    out.push(next)
  }
  return out
}

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

  /**
   * Editing metadata (AGL-1049). Sanitized, never trusted, and INTERSECTED
   * with the allowlist above — an entry naming a prop that is not declared in
   * `props` is dropped rather than rejected.
   *
   * Dropped and not rejected on purpose: a publisher who describes a prop they
   * forgot to declare has made an authoring mistake, not an attack, and
   * refusing the whole manifest for it would fail the publish over a label.
   * The prop still does not cross the bridge, because `filterPluginProps`
   * reads `props` and never this.
   *
   * An unknown `type` degrades to a text field rather than failing: a manifest
   * written against a newer platform must not make an older host refuse a
   * plugin that is otherwise fine.
   */
  const propSchemaInput = capabilitiesInput['propSchema']
  if (propSchemaInput !== undefined) {
    if (
      !Array.isArray(propSchemaInput) ||
      propSchemaInput.length > PLUGIN_MAX_PROPS
    ) {
      return { ok: false, error: 'Too many prop schemas declared' }
    }
    const propSchema = sanitizePropSchemaList(
      propSchemaInput,
      new Set(capabilities.props ?? []),
    )
    if (propSchema.length) capabilities.propSchema = propSchema
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

  const hostAbiRaw = raw['hostAbi']
  let hostAbi: number | undefined
  if (hostAbiRaw !== undefined) {
    hostAbi = Number(hostAbiRaw)
    if (!Number.isInteger(hostAbi) || hostAbi < 1 || hostAbi > 99) {
      return { ok: false, error: 'hostAbi must be a small positive integer' }
    }
  }

  /**
   * Declared canvas elements (AGL-1031). Sanitized hard, because every field
   * here is publisher-authored data the HOST renders into its own chrome.
   *
   * A malformed `elements` array is refused — that is a build error a
   * publisher can see and fix. A single bad ENTRY is dropped instead, so one
   * typo cannot fail a whole release.
   */
  const elementsInput = raw['elements']
  const elements: PluginElementDeclaration[] = []
  if (elementsInput !== undefined) {
    if (
      !Array.isArray(elementsInput) ||
      elementsInput.length > PLUGIN_MAX_ELEMENTS
    ) {
      return { ok: false, error: 'Too many elements declared' }
    }
    const declaredProps = new Set(capabilities.props ?? [])
    const seenIds = new Set<string>()
    for (const rawElement of elementsInput) {
      if (!rawElement || typeof rawElement !== 'object') continue
      const entryRecord = rawElement as Record<string, unknown>
      const elementId = entryRecord['id']
      const elementName = entryRecord['displayName']
      if (typeof elementId !== 'string' || !IDENTIFIER_PATTERN.test(elementId)) {
        continue
      }
      if (seenIds.has(elementId)) continue
      if (typeof elementName !== 'string' || !elementName.trim()) continue
      seenIds.add(elementId)
      const element: PluginElementDeclaration = {
        id: elementId,
        displayName: elementName.trim().slice(0, PLUGIN_PROP_TEXT_MAX),
      }
      const elementDescription = entryRecord['description']
      if (typeof elementDescription === 'string' && elementDescription.trim()) {
        element.description = elementDescription
          .trim()
          .slice(0, PLUGIN_PROP_TEXT_MAX)
      }
      // A category outside the permitted subset is DROPPED, not refused: the
      // structural ones are withheld deliberately (see
      // PLUGIN_ELEMENT_CATEGORIES), and a publisher aiming at one should still
      // get a usable element rather than a failed publish.
      const elementCategory = entryRecord['category']
      if (
        typeof elementCategory === 'string' &&
        PLUGIN_ELEMENT_CATEGORIES.includes(elementCategory)
      ) {
        element.category = elementCategory
      }
      const elementIcon = entryRecord['icon']
      if (
        typeof elementIcon === 'string' &&
        MDI_ICON_NAME_PATTERN.test(elementIcon)
      ) {
        element.icon = elementIcon
      }
      const elementAttributes = sanitizePropSchemaList(
        entryRecord['attributes'],
        declaredProps,
      )
      if (elementAttributes.length) element.attributes = elementAttributes
      elements.push(element)
    }
  }

  return {
    ok: true,
    manifest: {
      id,
      name,
      version,
      entry,
      ...(hostAbi !== undefined ? { hostAbi } : {}),
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
      ...(elements.length ? { elements } : {}),
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
 * The sandbox CSP is NOT built here (AGL-1092).
 *
 * A `pluginContentSecurityPolicy` used to live at this spot: exported,
 * unit-tested, and called by nothing. The policy that actually reaches a
 * browser is `csp()` in `tools/plugin-loader/origin/api/load.mjs`, on the
 * plugin-origin deployment, and the two disagreed — this one emitted
 * `connect-src 'none'` for a manifest with no network, which would have
 * broken every sandboxed load, since the frame fetches its own bundle from
 * its own origin. Deleted rather than reconciled: a tested policy nobody
 * serves is worse than none, because it answers a reader's question wrongly.
 * `capabilities.network` still decides the allowlist — the loader reads it
 * from the public listing-versions endpoint and appends it to `connect-src`,
 * with tests beside it (`npm run test:plugin-loader`).
 */

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

/**
 * The next `revocations/{listingId}` state after one write (AGL-1085).
 *
 * Two writers share this doc and neither may erase the other:
 *
 * * a **takedown** kills the listing, flattening `versions` to `'all'`, and
 *   un-hiding removes what it wrote (AGL-948);
 * * a **review** decision stops one version's bytes — the reviewer's only
 *   alternative used to be a full takedown, which also revokes the version
 *   customers are happily running.
 *
 * `versions` stays the single field every reader consults, so `isPluginRevoked`
 * and the loaders are untouched. `reviewVersions` is the durable record of the
 * review-owned half, which is what lets un-hiding restore rather than clear it.
 * Returns `null` when nothing is revoked any more and the doc should be
 * deleted — an empty `versions: []` would read as "revoked nothing" but keep a
 * doc around that a later reader has to interpret.
 *
 * Pure so both transitions are testable without Firestore, and colocated with
 * `isPluginRevoked` on purpose: a writer that disagreed with the reader about
 * this doc's shape is exactly how a kill switch silently stops killing.
 */
export function nextRevocationState(
  current: PluginRevocation | null | undefined,
  change:
    | { type: 'revoke-version'; version: string }
    | { type: 'unrevoke-version'; version: string }
    | { type: 'takedown' }
    | { type: 'restore' },
): PluginRevocation | null {
  const reviewVersions = [...(current?.reviewVersions ?? [])]
  const takenDown = current?.source === 'takedown'
  const withReview = (versions: string[], stillTakenDown: boolean) => {
    if (stillTakenDown) {
      return { ...current, versions: 'all' as const, reviewVersions: versions }
    }
    if (!versions.length) return null
    const { source: _source, ...rest } = current ?? {}
    return { ...rest, versions, reviewVersions: versions }
  }
  switch (change.type) {
    case 'revoke-version': {
      const next = reviewVersions.includes(change.version)
        ? reviewVersions
        : [...reviewVersions, change.version]
      return withReview(next, takenDown)
    }
    case 'unrevoke-version': {
      return withReview(
        reviewVersions.filter((entry) => entry !== change.version),
        takenDown,
      )
    }
    case 'takedown':
      return { ...current, versions: 'all', source: 'takedown', reviewVersions }
    case 'restore':
      // Only the takedown's own contribution goes away. A version a reviewer
      // stopped stays stopped — un-hiding is not a review decision.
      return withReview(reviewVersions, false)
  }
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

/** Component id of the sandboxed plugin canvas element (plugins-mui). */
export const PLUGIN_COMPONENT_ID = 'marketplacePlugin'

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
 * a `marketplacePlugin` node carries only a `listingId` in the saved screen;
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

/** One editable setting on a placed plugin, resolved for the attributes panel. */
export interface PluginPropField {
  name: string
  type: NonNullable<PluginPropSchema['type']>
  label: string
  description?: string
  default?: string | number | boolean
  options?: Array<{ value: string; label?: string }>
}

/**
 * The settings an author may edit on a placed plugin (AGL-1049).
 *
 * Driven by `capabilities.props` — THE allowlist — and decorated by
 * `propSchema` where the publisher supplied one. That order is the whole
 * security property: the list of editable settings can never be longer than
 * the list of props that cross the bridge, whatever the schema says, so a
 * publisher cannot describe their way into a prop they did not declare.
 *
 * A plugin published before `propSchema` existed still gets a field per
 * declared prop, as plain text. That is the difference between guessing key
 * names in a JSON textarea and being shown them, and it needs no manifest
 * change to work — which matters, because every plugin installed today
 * predates this.
 */
export function resolvePluginPropFields(
  manifest: { capabilities?: PluginCapabilities } | null | undefined,
): PluginPropField[] {
  const props = manifest?.capabilities?.props ?? []
  const schema = new Map(
    (manifest?.capabilities?.propSchema ?? []).map((entry) => [
      entry.name,
      entry,
    ]),
  )
  return props.map((name) => {
    const declared = schema.get(name)
    return {
      name,
      type: declared?.type ?? 'string',
      label: declared?.label ?? name,
      ...(declared?.description ? { description: declared.description } : {}),
      ...(declared?.default !== undefined ? { default: declared.default } : {}),
      ...(declared?.options ? { options: declared.options } : {}),
    }
  })
}

/**
 * Keys an author has set that the plugin will silently ignore.
 *
 * The failure this exists to surface: `filterPluginProps` drops anything not
 * in the allowlist, so a typo does not fail — it just quietly does nothing,
 * which is the worst of the options. Naming the key is the whole fix.
 */
export function unknownPluginPropKeys(
  manifest: { capabilities?: PluginCapabilities } | null | undefined,
  values: Record<string, unknown> | null | undefined,
): string[] {
  if (!values) return []
  const allowed = new Set(manifest?.capabilities?.props ?? [])
  return Object.keys(values).filter((key) => !allowed.has(key))
}

/** A declared element, resolved for the palette. */
export interface PluginPaletteElement {
  listingId: string
  elementId: string
  displayName: string
  description?: string
  category: string
  /** mdi icon NAME; the surface looks it up, never renders it as markup. */
  icon?: string
  fields: PluginPropField[]
}

/**
 * The palette entries an installed plugin contributes (AGL-1031).
 *
 * Resolved from the PINNED install, which is what makes the two guarantees in
 * the issue hold without extra machinery: an element only appears where the
 * plugin is installed, and a revoked or downgraded version's elements vanish
 * with it, because the palette is rebuilt from whatever the pin now points at.
 *
 * Attributes come back through `resolvePluginPropFields`, so an element's
 * editable fields are bounded by `capabilities.props` exactly like the generic
 * plugin element's are. A declared element cannot widen what crosses the
 * bridge; it only gives the same props a better name and a better editor.
 */
export function resolvePluginElements(
  install:
    | {
        listingId?: string
        capabilities?: PluginCapabilities
        manifest?: { elements?: PluginElementDeclaration[] }
        elements?: PluginElementDeclaration[]
      }
    | null
    | undefined,
): PluginPaletteElement[] {
  const listingId = install?.listingId
  if (!listingId) return []
  const declared = install?.elements ?? install?.manifest?.elements ?? []
  const capabilities = install?.capabilities
  return declared.map((element) => ({
    listingId,
    elementId: element.id,
    displayName: element.displayName,
    ...(element.description ? { description: element.description } : {}),
    category: element.category ?? 'Data Display',
    ...(element.icon ? { icon: element.icon } : {}),
    // Per-element attributes when declared; otherwise the plugin's whole
    // declared prop set, which is still better than a JSON box.
    fields: element.attributes?.length
      ? resolvePluginPropFields({
          capabilities: {
            props: element.attributes.map((attribute) => attribute.name),
            propSchema: element.attributes,
          },
        })
      : resolvePluginPropFields({ capabilities }),
  }))
}
