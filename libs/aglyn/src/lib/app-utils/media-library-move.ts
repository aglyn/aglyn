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

import { MEDIA_CDN_ROUTE, MEDIA_REF_PREFIX } from './media-ref'
import {
  decodeStoredNodes,
  encodeStoredNodes,
  storedNodesForm,
} from './stored-nodes'

/**
 * Moving a file between a site's library and the organization library.
 *
 * A file's address names its library: `media:org:{orgId}/{id}` for the
 * organization's, `media:{hostId}/{id}` for a site's, and the same scope sits
 * in its CDN path `/api/media/cdn/{scope}/{id}` and its storage object path
 * `orgs/{orgId}/media/…` or `hosts/{hostId}/media/…`. The media id stays the
 * same across a move; the scope does not, so every stored use has to be
 * rewritten from the old scope to the new one. This module is the pure half
 * of that: what a use looks like, and what it becomes.
 *
 * The rewrite is a STRING rewrite over every string a document holds,
 * including the node trees that are stored as compressed bytes. Those are
 * decoded, rewritten and encoded back in the form they came in, because a
 * writer that changes one value must not change how a document is stored.
 */

/** The two directions a file can go. */
export type MediaLibraryDirection = 'to-site' | 'to-org'

/** One file's move: its id, and the scopes and storage paths either side. */
export interface MediaLibraryMove {
  mediaId: string
  /** `org:{orgId}` or `{hostId}` — the library it leaves. */
  fromScope: string
  /** `org:{orgId}` or `{hostId}` — the library it lands in. */
  toScope: string
  /** Storage object path before and after, when the file has bytes. */
  fromObjectPath?: string
  toObjectPath?: string
}

const SEGMENT = '[A-Za-z0-9_-]{1,64}'
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The scope spellings a use of a file in `fromScope` can carry.
 *
 * An organization file is addressed bare (`org:O`) or qualified with the site
 * rendering it (`org:O:H`), and both are the same file. A site file has one
 * spelling.
 */
function fromScopeSource(fromScope: string): string {
  if (fromScope.startsWith('org:')) {
    const orgId = fromScope.slice('org:'.length).split(':')[0]
    return `org:${escapeRegExp(orgId)}(?::${SEGMENT})?`
  }
  return escapeRegExp(fromScope)
}

/** The scope a moved file's uses are written with. */
function toScopeOf(move: MediaLibraryMove): string {
  if (!move.toScope.startsWith('org:')) return move.toScope
  // An organization file is written bare; the page renders it for its own
  // site (`hostQualifiedScope`), the same as every file picked from there.
  return `org:${move.toScope.slice('org:'.length).split(':')[0]}`
}

interface CompiledMove {
  move: MediaLibraryMove
  reference: RegExp
  objectPaths: Array<[string, string]>
}

function compile(move: MediaLibraryMove): CompiledMove {
  const id = escapeRegExp(move.mediaId)
  const reference = new RegExp(
    `(${escapeRegExp(MEDIA_REF_PREFIX)}|${escapeRegExp(MEDIA_CDN_ROUTE)}/)` +
      `${fromScopeSource(move.fromScope)}/${id}(?![A-Za-z0-9_-])`,
    'g',
  )
  const objectPaths: Array<[string, string]> = []
  if (
    move.fromObjectPath &&
    move.toObjectPath &&
    move.fromObjectPath !== move.toObjectPath
  ) {
    // A legacy storage URL carries the path percent-encoded; a few writers
    // stored it raw. Both are the file's path as a PREFIX, so a derived
    // object (`…__w640.webp`, a poster, a rendition) maps the same way.
    objectPaths.push([
      encodeURIComponent(move.fromObjectPath),
      encodeURIComponent(move.toObjectPath),
    ])
    objectPaths.push([move.fromObjectPath, move.toObjectPath])
  }
  return { move, reference, objectPaths }
}

/** A string rewriter for a set of moves, counting what it changed. */
export interface MediaUseRewriter {
  /** The string with every use of a moved file rewritten. */
  rewrite: (value: string) => string
  /** Uses rewritten so far, per media id. */
  counts: Map<string, number>
  /** The media ids a string uses, without rewriting it. */
  usedIn: (value: string) => string[]
}

export function mediaUseRewriter(
  moves: readonly MediaLibraryMove[],
): MediaUseRewriter {
  const compiled = moves.map(compile)
  const counts = new Map<string, number>()
  const bump = (mediaId: string, by = 1) =>
    counts.set(mediaId, (counts.get(mediaId) ?? 0) + by)
  return {
    counts,
    rewrite(value) {
      let next = value
      for (const { move, reference, objectPaths } of compiled) {
        if (!next.includes(move.mediaId)) continue
        const toScope = toScopeOf(move)
        next = next.replace(reference, (_match, prefix: string) => {
          bump(move.mediaId)
          return `${prefix}${toScope}/${move.mediaId}`
        })
        for (const [from, to] of objectPaths) {
          if (!next.includes(from)) continue
          const parts = next.split(from)
          bump(move.mediaId, parts.length - 1)
          next = parts.join(to)
        }
      }
      return next
    },
    usedIn(value) {
      const ids: string[] = []
      for (const { move, reference, objectPaths } of compiled) {
        if (!value.includes(move.mediaId)) continue
        reference.lastIndex = 0
        if (
          reference.test(value) ||
          objectPaths.some(([from]) => value.includes(from))
        ) {
          ids.push(move.mediaId)
        }
        reference.lastIndex = 0
      }
      return ids
    },
  }
}

/** Plain data the walk descends into; Firestore values it leaves alone. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (ArrayBuffer.isView(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Every string inside a value rewritten; the same value when none changed. */
export function rewriteMediaUsesDeep(
  value: unknown,
  rewrite: (value: string) => string,
): unknown {
  if (typeof value === 'string') return rewrite(value)
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const rewritten = rewriteMediaUsesDeep(item, rewrite)
      if (rewritten !== item) changed = true
      return rewritten
    })
    return changed ? next : value
  }
  if (isPlainObject(value)) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const rewritten = rewriteMediaUsesDeep(child, rewrite)
      if (rewritten !== child) changed = true
      next[key] = rewritten
    }
    return changed ? next : value
  }
  return value
}

/** Fields whose node tree may be stored as compressed bytes. */
const NODE_FIELDS = ['nodes', 'elements'] as const

/**
 * The top-level fields of a document that change when its uses of the moved
 * files are rewritten, or `null` when nothing does.
 *
 * A node tree comes back in the form it was stored in: bytes stay bytes (a
 * `Uint8Array` the Admin SDK caller wraps in a `Buffer`), a map stays a map.
 */
export function mediaMovePatch(
  data: Record<string, unknown>,
  rewrite: (value: string) => string,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if ((NODE_FIELDS as readonly string[]).includes(key)) {
      const form = storedNodesForm(value)
      if (form === 'absent') continue
      const tree = decodeStoredNodes(value)
      // An undecodable tree is left exactly as it is. Writing it back would
      // be writing over something this walk could not read.
      if (!tree) continue
      const rewritten = rewriteMediaUsesDeep(tree, rewrite)
      if (rewritten === tree) continue
      patch[key] = form === 'bytes' ? encodeStoredNodes(rewritten) : rewritten
      continue
    }
    const rewritten = rewriteMediaUsesDeep(value, rewrite)
    if (rewritten !== value) patch[key] = rewritten
  }
  return Object.keys(patch).length ? patch : null
}

/** The media ids a document uses, its node trees decoded first. */
export function mediaIdsUsedBy(
  data: Record<string, unknown>,
  rewriter: Pick<MediaUseRewriter, 'usedIn'>,
): string[] {
  const found = new Set<string>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 40) return
    if (typeof value === 'string') {
      for (const id of rewriter.usedIn(value)) found.add(id)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (isPlainObject(value)) {
      for (const child of Object.values(value)) visit(child, depth + 1)
    }
  }
  for (const [key, value] of Object.entries(data)) {
    if ((NODE_FIELDS as readonly string[]).includes(key)) {
      visit(decodeStoredNodes(value), 0)
    } else {
      visit(value, 0)
    }
  }
  return [...found]
}

/** The CDN scope segment of a library. */
export const orgMediaScope = (orgId: string) => `org:${orgId}`

/**
 * Where a moved file's old address forwards (the `mediaMoves` record left in
 * the library it left), so a page cached before the move, an email already
 * sent, or a link someone copied keeps showing the file.
 */
export const MEDIA_MOVES_COLLECTION = 'mediaMoves'

/** The CDN path a moved file now answers at. */
export function movedMediaCdnPath(toScope: string, mediaId: string): string {
  return `${MEDIA_CDN_ROUTE}/${toScope}/${mediaId}`
}

/** What one use of a file looks like to the person moving it. */
export interface MediaLibraryUse {
  mediaId: string
  /** The site the use is on, or '' for the organization's own records. */
  hostId: string
  /** `screens`, `products`, `org` (workspace settings), a record's label … */
  area: string
  /** A name a person knows it by. */
  name: string
}

/** The area of a use on the workspace's own settings document. */
export const WORKSPACE_SETTINGS_AREA = 'org'

/**
 * Why a file may not go from the organization library to one site's library,
 * or `null` when it may: another site uses it, the workspace's own settings
 * (its logo) do, or a workspace record holds it (a CRM contact's files). A
 * site library is one site's, so any of those uses would break.
 */
export function orgToSiteRefusal(
  uses: readonly MediaLibraryUse[],
  hostId: string,
  siteNames: Readonly<Record<string, string>> = {},
): string | null {
  const otherSites = new Set<string>()
  const records: string[] = []
  let settings = false
  for (const use of uses) {
    if (use.hostId && use.hostId !== hostId) otherSites.add(use.hostId)
    if (use.hostId) continue
    if (use.area === WORKSPACE_SETTINGS_AREA) settings = true
    else if (!records.includes(`${use.area} "${use.name}"`)) records.push(`${use.area} "${use.name}"`)
  }
  const parts: string[] = []
  if (otherSites.size) {
    const names = [...otherSites].map((id) => siteNames[id] ?? id)
    parts.push(
      `${names.length === 1 ? 'another site uses it' : 'other sites use it'} (${names.join(', ')})`,
    )
  }
  if (settings) parts.push('the workspace uses it (its logo or settings)')
  if (records.length) {
    const shown = records.slice(0, 2).join(', ')
    const more = records.length > 2 ? ` and ${records.length - 2} more` : ''
    parts.push(`${shown}${more} ${records.length === 1 ? 'holds' : 'hold'} it`)
  }
  return parts.length ? `Stays in the organization library: ${parts.join(' and ')}` : null
}
