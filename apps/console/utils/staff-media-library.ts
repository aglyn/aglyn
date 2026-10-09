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

import type {
  ListQueryDeclaration,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE STAFF MEDIA LIBRARY CARD'S WIRE SHAPE AND ORDERS.
 *
 * `/api/admin/media-library` reads one library — an organization's
 * (`orgs/{id}/media`) or a site's own (`hosts/{id}/media`) — one page at a
 * time, on a single `orderBy` plus `limit`. Every order below is ONE stored
 * field with no filter beside it, so each is answered by Firestore's
 * automatic single-field index and needs no composite. Every writer of a
 * media document (`/api/media/upload`, `/api/media/upload-url`,
 * `media-ingest.ts`) stamps all four fields, so an `orderBy` drops nothing.
 *
 * Shared by the card and the route so the header the card offers and the
 * order the route runs cannot disagree.
 */

/** Newest first: the default order, and the one the cursor walk begins with. */
export const STAFF_MEDIA_SORT: ListQuerySort = {
  path: 'createdAt',
  direction: 'desc',
  column: 'createdAt',
  label: 'Created',
}

const both = (path: string, column: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label, alone: true },
  { path, direction: 'desc', column, label, alone: true },
]

export const STAFF_MEDIA_COLUMN_SORTS: readonly ListQuerySort[] = [
  STAFF_MEDIA_SORT,
  { path: 'createdAt', direction: 'asc', column: 'createdAt', label: 'Created', alone: true },
  ...both('fileName', 'name', 'Name'),
  ...both('contentType', 'contentType', 'Type'),
  ...both('sizeBytes', 'sizeBytes', 'Size'),
]

/** The card's query: no filters, one header order at a time. */
export const STAFF_MEDIA_LIST_QUERY: ListQueryDeclaration = {
  fields: [],
  sorts: STAFF_MEDIA_COLUMN_SORTS,
}

/** The order a request asks for, when the card offers it; the default otherwise. */
export function staffMediaSort(asked: Pick<ListQuerySort, 'path' | 'direction'> | null): ListQuerySort {
  return (
    (asked &&
      STAFF_MEDIA_COLUMN_SORTS.find(
        (sort) => sort.path === asked.path && sort.direction === asked.direction,
      )) ||
    STAFF_MEDIA_SORT
  )
}

/** Which library a request reads. */
export type StaffMediaScope =
  | { kind: 'org'; orgId: string }
  | { kind: 'host'; hostId: string }

/** The scope a query names, or null when it names neither or both. */
export function staffMediaScopeFrom(
  query: Partial<Record<string, unknown>>,
): StaffMediaScope | null {
  const orgId = typeof query['orgId'] === 'string' ? query['orgId'].trim() : ''
  const hostId = typeof query['hostId'] === 'string' ? query['hostId'].trim() : ''
  if (orgId && hostId) return null
  // Ids are document ids: one segment, so a `/` can never reach a path.
  const valid = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id)
  if (orgId) return valid(orgId) ? { kind: 'org', orgId } : null
  if (hostId) return valid(hostId) ? { kind: 'host', hostId } : null
  return null
}

/** The Firestore parent of the library: `orgs/{id}` or `hosts/{id}`. */
export function staffMediaScopeBase(scope: StaffMediaScope): string {
  return scope.kind === 'org' ? `orgs/${scope.orgId}` : `hosts/${scope.hostId}`
}

/**
 * The scope segment of a CDN path for the library (`org:{id}` or the site's
 * id) — the same value `resolveMediaScope` calls `cdnScope`, and the one a
 * media signature is minted over.
 */
export function staffMediaCdnScope(scope: StaffMediaScope): string {
  return scope.kind === 'org' ? `org:${scope.orgId}` : scope.hostId
}

/** A site that uses an asset. */
export interface StaffMediaSite {
  hostId: string
  name: string
}

/** One asset as a row of the card. */
export interface StaffMediaRow {
  $id: string
  name: string
  contentType: string
  sizeBytes: number | null
  createdAtMs: number | null
  private: boolean
  /** In the library's trash: deleted, not yet purged. */
  deleted: boolean
  width: number | null
  height: number | null
  /**
   * What the card draws, or null for a type with no picture. A private
   * asset's is a short-lived signed CDN URL minted for staff; it is never
   * the raw storage URL.
   */
  thumbSrc: string | null
  /**
   * The sites that use it, from a usage scan: null in the list (a scan per
   * row is not paid for), filled in on the opened asset.
   */
  usedBy: StaffMediaSite[] | null
}

/** One page of `/api/admin/media-library`. */
export interface StaffMediaPage {
  rows: StaffMediaRow[]
  hasMore: boolean
  nextCursor: string | null
}

/** One place an asset is used, as the detail dialog lists it. */
export interface StaffMediaUsage {
  kind: string
  name: string
  hostId: string
  hostName: string
  live: boolean | null
}

/** One asset, opened: `/api/admin/media-library/asset`. */
export interface StaffMediaAsset extends StaffMediaRow {
  /** The full-size preview: signed for a private asset, the CDN for a public one. */
  previewSrc: string | null
  /** When a signed preview stops working; null for a public asset. */
  previewExpiresAtMs: number | null
  storagePath: string | null
  folderId: string | null
  alt: string | null
  description: string | null
  uploadedBy: string | null
  owner: { uid: string; email: string | null; displayName: string | null } | null
  /** The scope tokens the asset is limited to (`host:{id}`, …); empty = everyone in the library. */
  visibleTo: string[]
  usage: {
    references: StaffMediaUsage[]
    /** `full`, `published` or `partial` — an empty list means "used nowhere" only when `full`. */
    coverage: string
  } | null
}

const TYPE_WORDS: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  font: 'font',
  text: 'text',
}

/**
 * A type as a person reads it: `image/png` → `PNG image`,
 * `application/pdf` → `PDF`. Unknown or absent → `File`.
 */
export function staffMediaTypeLabel(contentType: string | null | undefined): string {
  const value = String(contentType ?? '').trim().toLowerCase()
  const [major = '', minor = ''] = value.split(';')[0].split('/')
  if (!major || !minor) return 'File'
  const subtype = minor.replace(/^(x-|vnd\.)/, '').replace(/\+xml$/, '')
  const short = subtype === 'jpeg' ? 'JPEG' : subtype === 'svg' ? 'SVG' : subtype.toUpperCase()
  if (major === 'application') return short
  return TYPE_WORDS[major] ? `${short} ${TYPE_WORDS[major]}` : short
}

/** Bytes as a person reads them. */
export function staffMediaSizeLabel(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}
