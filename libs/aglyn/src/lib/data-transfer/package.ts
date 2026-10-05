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

/*==========================================
 * PACKAGES — site items (pages, layouts, components, emails…) carried as one file.
 *
 * A package is a manifest and the items it lists. Each manifest entry
 * names the item's kind and id, its slug or name, a content hash, and the
 * items it depends on (a page on its layout, a layout on its components).
 *
 * ## Content hashes
 *
 * `sha256:` + the hex SHA-256 of the item's stable JSON — keys sorted at
 * every depth, `undefined` dropped — through WebCrypto, which both the
 * browser and Node provide. Equal hashes mean an import would change
 * nothing, so the item is `identical` and skipped by default.
 *
 * ## Importing an item
 *
 * Each item is matched to what the site already holds — by id, then slug,
 * then name, within its kind — and is `new`, `identical` or `differs`;
 * an item whose dependencies are neither in the package nor on the site is
 * flagged `missingDependency`. For a colliding item the person chooses:
 * replace it (as a new version), keep both (a new id and slug), skip it,
 * or merge it (for the kinds that merge key by key, like site settings).
 *=========================================*/

/** The format tag every package carries. */
export const TRANSFER_PACKAGE_FORMAT = 'aglyn-package'

/** The manifest version this module reads and writes. */
export const TRANSFER_PACKAGE_VERSION = 2

/** An item another item needs. */
export interface PackageDependency {
  kind: string
  id: string
}

/** One item as the manifest lists it. */
export interface PackageManifestItem {
  kind: string
  $id: string
  slug?: string
  name?: string
  contentHash: string
  deps: PackageDependency[]
}

export interface PackageManifest {
  format: typeof TRANSFER_PACKAGE_FORMAT
  version: typeof TRANSFER_PACKAGE_VERSION
  items: PackageManifestItem[]
  /** When the package was made (ms since epoch). */
  createdAt?: number
  /** Where it came from, for the import screen ("Site: Acme"). */
  source?: string
}

/** A whole package: the manifest and each item's content by {@link packageItemKey}. */
export interface TransferPackage<T = unknown> {
  manifest: PackageManifest
  items: Record<string, T>
}

/** The key an item is filed under: `<kind>/<id>`. */
export function packageItemKey(item: { kind: string; $id?: string; id?: string }): string {
  return `${item.kind}/${item.$id ?? item.id ?? ''}`
}

/**
 * JSON with every object's keys sorted, at every depth, and `undefined`
 * dropped (as `JSON.stringify` drops it). Dates are their ISO string;
 * a non-finite number is `null`. Two values that are the same data are
 * the same text, whatever order their keys were written in.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? 'null'
}

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((entry) => (entry === undefined ? null : canonical(entry)))
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      sorted[key] = canonical(source[key])
    }
    return sorted
  }
  return value
}

/** The hash prefix every content hash carries. */
export const CONTENT_HASH_PREFIX = 'sha256:'

/**
 * The content hash of a value: `sha256:` + hex of its {@link stableJson}.
 * Uses WebCrypto (`globalThis.crypto.subtle`), present in browsers and Node.
 */
export async function contentHash(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Content hashing needs WebCrypto (crypto.subtle).')
  const bytes = new TextEncoder().encode(stableJson(value))
  const digest = await subtle.digest('SHA-256', bytes)
  return CONTENT_HASH_PREFIX + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A manifest read from a file, or why it cannot be. */
export type PackageManifestRead = { ok: true; manifest: PackageManifest } | { ok: false; problems: string[] }

/**
 * A manifest from untrusted JSON. Every problem is reported, not just the
 * first: a wrong format or version, an item without a kind, id or hash, a
 * malformed dependency, an id listed twice.
 */
export function readPackageManifest(raw: unknown): PackageManifestRead {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, problems: ['The file is not a package.'] }
  const source = raw as Record<string, unknown>
  if (source['format'] !== TRANSFER_PACKAGE_FORMAT) {
    problems.push(`The file's format is ${JSON.stringify(source['format'] ?? null)}, not "${TRANSFER_PACKAGE_FORMAT}".`)
  }
  if (source['version'] !== TRANSFER_PACKAGE_VERSION) {
    problems.push(`The package is version ${String(source['version'])}; this reads version ${TRANSFER_PACKAGE_VERSION}.`)
  }
  if (!Array.isArray(source['items'])) problems.push('The package lists no items.')
  const items: PackageManifestItem[] = []
  const seen = new Set<string>()
  for (const [index, entry] of (Array.isArray(source['items']) ? source['items'] : []).entries()) {
    const item = (entry ?? {}) as Record<string, unknown>
    const where = `Item ${index + 1}`
    const kind = typeof item['kind'] === 'string' ? item['kind'].trim() : ''
    const id = typeof item['$id'] === 'string' ? item['$id'].trim() : ''
    const hash = typeof item['contentHash'] === 'string' ? item['contentHash'] : ''
    if (!kind) problems.push(`${where} has no kind.`)
    if (!id) problems.push(`${where} has no id.`)
    if (!hash.startsWith(CONTENT_HASH_PREFIX)) problems.push(`${where} has no content hash.`)
    const deps: PackageDependency[] = []
    for (const dep of Array.isArray(item['deps']) ? item['deps'] : []) {
      const d = (dep ?? {}) as Record<string, unknown>
      if (typeof d['kind'] === 'string' && d['kind'] && typeof d['id'] === 'string' && d['id']) {
        deps.push({ kind: d['kind'], id: d['id'] })
      } else {
        problems.push(`${where} has a dependency without a kind and id.`)
      }
    }
    if (item['deps'] !== undefined && !Array.isArray(item['deps'])) problems.push(`${where} has dependencies that are not a list.`)
    const key = `${kind}/${id}`
    if (kind && id && seen.has(key)) problems.push(`${where} repeats ${key}.`)
    seen.add(key)
    items.push({
      kind,
      $id: id,
      ...(typeof item['slug'] === 'string' ? { slug: item['slug'] } : {}),
      ...(typeof item['name'] === 'string' ? { name: item['name'] } : {}),
      contentHash: hash,
      deps,
    })
  }
  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    manifest: {
      format: TRANSFER_PACKAGE_FORMAT,
      version: TRANSFER_PACKAGE_VERSION,
      items,
      ...(typeof source['createdAt'] === 'number' ? { createdAt: source['createdAt'] } : {}),
      ...(typeof source['source'] === 'string' ? { source: source['source'] } : {}),
    },
  }
}

/** A dependency that is not in the package (and, where asked, not on the site). */
export interface MissingPackageDependency {
  /** The item that needs it, by {@link packageItemKey}. */
  item: string
  dependency: PackageDependency
}

/** The items in an order that installs every dependency before what needs it. */
export interface PackageDependencyOrder {
  order: PackageManifestItem[]
  missing: MissingPackageDependency[]
  /** Each cycle as item keys; its items are appended to `order` in manifest order. */
  cycles: string[][]
}

/**
 * Dependencies first (Kahn's algorithm, ties in manifest order). A
 * dependency outside the package is reported as missing unless `available`
 * says the site has it. Items on a cycle cannot be ordered: each strongly
 * connected group is reported and its items appended last.
 */
export function packageDependencyOrder(
  items: readonly PackageManifestItem[],
  available: (dependency: PackageDependency) => boolean = () => false,
): PackageDependencyOrder {
  const byKey = new Map(items.map((item) => [packageItemKey(item), item]))
  const missing: MissingPackageDependency[] = []
  const needs = new Map<string, Set<string>>()
  const neededBy = new Map<string, string[]>()
  for (const item of items) {
    const key = packageItemKey(item)
    const set = new Set<string>()
    for (const dep of item.deps) {
      const depKey = packageItemKey(dep)
      if (byKey.has(depKey)) {
        if (!set.has(depKey)) {
          set.add(depKey)
          neededBy.set(depKey, [...(neededBy.get(depKey) ?? []), key])
        }
      } else if (!available(dep)) {
        missing.push({ item: key, dependency: dep })
      }
    }
    needs.set(key, set)
  }
  const order: PackageManifestItem[] = []
  const placed = new Set<string>()
  const position = new Map(items.map((item, at) => [packageItemKey(item), at]))
  const byPosition = (a: string, b: string): number => (position.get(a) ?? 0) - (position.get(b) ?? 0)
  const ready = items.filter((item) => needs.get(packageItemKey(item))?.size === 0).map(packageItemKey)
  while (ready.length) {
    // Ties go in manifest order: the earliest ready item is placed next.
    ready.sort(byPosition)
    const key = ready.shift() as string
    if (placed.has(key)) continue
    placed.add(key)
    order.push(byKey.get(key) as PackageManifestItem)
    for (const dependent of neededBy.get(key) ?? []) {
      const set = needs.get(dependent) as Set<string>
      set.delete(key)
      if (set.size === 0) ready.push(dependent)
    }
  }
  const rest = items.filter((item) => !placed.has(packageItemKey(item)))
  const cycles = stronglyConnected(rest, byKey).filter(
    (group) => group.length > 1 || (byKey.get(group[0] as string)?.deps.some((dep) => packageItemKey(dep) === group[0]) ?? false),
  )
  return { order: [...order, ...rest], missing, cycles }
}

/** Tarjan's strongly connected components over the given items' in-package edges. */
function stronglyConnected(
  items: readonly PackageManifestItem[],
  byKey: ReadonlyMap<string, PackageManifestItem>,
): string[][] {
  const keys = new Set(items.map(packageItemKey))
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const groups: string[][] = []
  let counter = 0
  const visit = (key: string): void => {
    index.set(key, counter)
    low.set(key, counter)
    counter += 1
    stack.push(key)
    onStack.add(key)
    for (const dep of byKey.get(key)?.deps ?? []) {
      const next = packageItemKey(dep)
      if (!keys.has(next)) continue
      if (!index.has(next)) {
        visit(next)
        low.set(key, Math.min(low.get(key) as number, low.get(next) as number))
      } else if (onStack.has(next)) {
        low.set(key, Math.min(low.get(key) as number, index.get(next) as number))
      }
    }
    if (low.get(key) === index.get(key)) {
      const group: string[] = []
      let member: string | undefined
      do {
        member = stack.pop() as string
        onStack.delete(member)
        group.push(member)
      } while (member !== key)
      groups.push(group.reverse())
    }
  }
  for (const key of keys) if (!index.has(key)) visit(key)
  return groups
}

/**
 * The selected items and everything they depend on inside the package,
 * transitively — the export picker's "include dependencies". Returns keys
 * in manifest order.
 */
export function packageDependencyClosure(
  items: readonly PackageManifestItem[],
  selected: Iterable<string>,
): string[] {
  const byKey = new Map(items.map((item) => [packageItemKey(item), item]))
  const included = new Set<string>()
  const queue = [...selected].filter((key) => byKey.has(key))
  while (queue.length) {
    const key = queue.pop() as string
    if (included.has(key)) continue
    included.add(key)
    for (const dep of byKey.get(key)?.deps ?? []) {
      const depKey = packageItemKey(dep)
      if (byKey.has(depKey) && !included.has(depKey)) queue.push(depKey)
    }
  }
  return items.map(packageItemKey).filter((key) => included.has(key))
}

/** An item the site already holds. */
export interface ExistingPackageItem {
  kind: string
  id: string
  slug?: string
  name?: string
  contentHash: string
}

/** How an incoming item compares with what the site holds. */
export type PackageItemComparison = 'new' | 'identical' | 'differs'

/** The status the import screen shows: the comparison, unless a dependency is missing. */
export type PackageItemStatus = PackageItemComparison | 'missingDependency'

export interface PackageItemMatch {
  item: PackageManifestItem
  status: PackageItemStatus
  comparison: PackageItemComparison
  existing?: ExistingPackageItem
  matchedBy?: 'id' | 'slug' | 'name'
  /** Dependencies neither in the package nor on the site. */
  missing: PackageDependency[]
}

function caseless(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Every manifest item against what the site holds: matched by id, then
 * slug, then name, within its kind; compared by content hash; and checked
 * for dependencies that exist in neither place.
 */
export function matchPackageItems(
  manifest: Pick<PackageManifest, 'items'>,
  existing: readonly ExistingPackageItem[],
): PackageItemMatch[] {
  const inPackage = new Set(manifest.items.map(packageItemKey))
  const onSite = new Set(existing.map((item) => `${item.kind}/${item.id}`))
  return manifest.items.map((item) => {
    const sameKind = existing.filter((entry) => entry.kind === item.kind)
    let found: ExistingPackageItem | undefined = sameKind.find((entry) => entry.id === item.$id)
    let matchedBy: PackageItemMatch['matchedBy'] = found ? 'id' : undefined
    if (!found && item.slug) {
      found = sameKind.find((entry) => entry.slug && caseless(entry.slug) === caseless(item.slug))
      if (found) matchedBy = 'slug'
    }
    if (!found && item.name) {
      found = sameKind.find((entry) => entry.name && caseless(entry.name) === caseless(item.name))
      if (found) matchedBy = 'name'
    }
    const comparison: PackageItemComparison = !found ? 'new' : found.contentHash === item.contentHash ? 'identical' : 'differs'
    const missing = item.deps.filter((dep) => {
      const key = packageItemKey(dep)
      return !inPackage.has(key) && !onSite.has(key)
    })
    return {
      item,
      status: missing.length ? 'missingDependency' : comparison,
      comparison,
      ...(found ? { existing: found, matchedBy } : {}),
      missing,
    }
  })
}

/** What to do with an incoming item that collides with one the site holds. */
export type PackageCollisionChoice = 'replace' | 'keepBoth' | 'skip' | 'merge'

/** What to do with an item: create it (new), or a collision choice. */
export type PackageItemDecision = 'create' | PackageCollisionChoice

/** What to do about a dependency the package and the site both lack. */
export type PackageMissingDependencyChoice =
  | { action: 'mapTo'; id: string }
  | { action: 'dropReference' }
  | { action: 'skipItem' }

/**
 * The decision proposed before the person chooses: create a new item, skip
 * an identical one, and skip a differing one — replacing is never assumed;
 * `needsChoice` marks the items the person must decide.
 */
export function proposePackageDecision(match: PackageItemMatch): { decision: PackageItemDecision; needsChoice: boolean } {
  if (match.comparison === 'new') return { decision: 'create', needsChoice: match.missing.length > 0 }
  if (match.comparison === 'identical') return { decision: 'skip', needsChoice: match.missing.length > 0 }
  return { decision: 'skip', needsChoice: true }
}

/** The decisions an item may take; `merge` only for kinds that merge key by key. */
export function packageDecisionsFor(match: PackageItemMatch, mergeable = false): PackageItemDecision[] {
  if (match.comparison === 'new') return ['create', 'skip']
  return mergeable ? ['replace', 'keepBoth', 'skip', 'merge'] : ['replace', 'keepBoth', 'skip']
}

/**
 * The slug a kept-both copy takes: `<slug>-copy`, then `-copy-2`, `-copy-3`…
 * until none of `taken` (compared caselessly).
 */
export function keepBothSlug(slug: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(caseless))
  const base = `${slug.replace(/-copy(?:-\d+)?$/, '')}-copy`
  if (!used.has(caseless(base))) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!used.has(caseless(candidate))) return candidate
  }
}

/**
 * The manifest for a set of items. Hashes each item's content; `deps` and
 * the slug and name come from `describe`. Items are listed in the order given.
 */
export async function buildPackageManifest<T>(
  items: readonly { kind: string; id: string; content: T }[],
  describe: (item: { kind: string; id: string; content: T }) => {
    slug?: string
    name?: string
    deps?: PackageDependency[]
  } = () => ({}),
  meta: Pick<PackageManifest, 'createdAt' | 'source'> = {},
): Promise<TransferPackage<T>> {
  const entries: PackageManifestItem[] = []
  const contents: Record<string, T> = {}
  for (const item of items) {
    const described = describe(item)
    const entry: PackageManifestItem = {
      kind: item.kind,
      $id: item.id,
      ...(described.slug ? { slug: described.slug } : {}),
      ...(described.name ? { name: described.name } : {}),
      contentHash: await contentHash(item.content),
      deps: described.deps ?? [],
    }
    entries.push(entry)
    contents[packageItemKey(entry)] = item.content
  }
  return {
    manifest: { format: TRANSFER_PACKAGE_FORMAT, version: TRANSFER_PACKAGE_VERSION, items: entries, ...meta },
    items: contents,
  }
}
