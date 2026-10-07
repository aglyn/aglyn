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

import { MEDIA_TYPE_OPTIONS, MEDIA_SORT_LABELS, MEDIA_SORTS, mediaQuery, type MediaSort } from '@aglyn/aglyn/app-utils/media-filter'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import type { DamScope } from '@aglyn/mobile-core'
import type { ListFilterRequest } from '@aglyn/shared-util-tools/list-query/list-filter'

/*==========================================
 * THE MEDIA LIBRARY, AS THE CONSOLE'S DAM READS IT.
 *
 * One library at a time: the picked site's own (`hosts/{hostId}/media`,
 * private to the site, no scope clause) or the workspace's shared one
 * (`orgs/{orgId}/media`). In the workspace library a member who does not
 * reach the whole workspace must carry the scope clause (`visibleTo
 * array-contains-any` their tokens), or the rules refuse the whole list;
 * an org-wide member reads everything without it. The query itself is
 * `mediaQuery`, the console's own: folder and scope as its base, the Type
 * clause, the search word (a name range under the scope clause), one order.
 *
 * Uploading follows `resolveMediaScope`, the gate every DAM route passes:
 * a site's library takes a site admin, editor or author
 * (`hostRoleCanWrite` on the site's `memberRoles`); the workspace library
 * takes any workspace role but viewer. The app offers the upload only to
 * them, and the route decides anyway (plan, quota, lockdown).
 *=========================================*/

export type MediaLibrary = { kind: 'site'; hostId: string } | { kind: 'org'; orgId: string }

/** A media document, as the upload routes write it (`{ $id, ...data }`). */
export interface MediaDoc {
  $id: string
  fileName?: string
  contentType?: string
  kind?: string
  sizeBytes?: number
  width?: number
  height?: number
  alt?: string
  url?: string
  cdnPath?: string
  private?: boolean
  folderId?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

export interface MediaFolderDoc {
  $id: string
  name?: string
  parentId?: string | null
  order?: number
}

/** The upload routes' scope for a library. */
export function damScopeOf(library: MediaLibrary): DamScope {
  return library.kind === 'site' ? { hostId: library.hostId } : { orgId: library.orgId }
}

/** The collection the library lives in, as path segments. */
export function libraryPath(library: MediaLibrary, collection: 'media' | 'mediaFolders' = 'media'): string[] {
  return library.kind === 'site' ? ['hosts', library.hostId, collection] : ['orgs', library.orgId, collection]
}

/** Whether the reader may add to or replace in this library, as `resolveMediaScope` decides. */
export function canWriteLibrary(
  library: MediaLibrary,
  access: { orgRole: string | null; hostRole: unknown },
): boolean {
  if (library.kind === 'org') return Boolean(access.orgRole) && access.orgRole !== 'viewer'
  return hostRoleCanWrite(access.hostRole)
}

/** The Type chips: every type, then the console's own Type options. */
export const MEDIA_TYPE_CHIPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All types' },
  ...MEDIA_TYPE_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })),
]

/** The sort chips, by the console's labels. */
export const MEDIA_SORT_CHIPS: ReadonlyArray<{ value: MediaSort; label: string }> = MEDIA_SORTS.map((sort) => ({
  value: sort,
  label: MEDIA_SORT_LABELS[sort],
}))

/** Every file, the files in no folder, or one folder's files. */
export type MediaFolderPick = 'all' | 'root' | string

export interface MediaView {
  type: string
  folder: MediaFolderPick
  sort: MediaSort
  search: readonly string[]
}

/** The console's query for one view of a library. `scopeTokens` is null for a reader who needs no scope clause. */
export function mediaViewQuery(view: MediaView, scopeTokens: readonly string[] | null) {
  const clauses: ListFilterRequest[] = view.type === 'all' ? [] : [{ field: 'type', op: 'equals', value: view.type }]
  return mediaQuery({
    clauses,
    sort: view.sort,
    folder: view.folder === 'all' || view.folder === 'root' ? view.folder : [view.folder],
    scopeTokens,
    search: view.search,
  }).plan
}

/**
 * Where a thumbnail or a preview is fetched from: the asset's CDN path on
 * the console's origin, asking for a generated width (the console's
 * `mediaThumbnailSrc`, which reads `window.location` and so cannot run
 * here), else its stored URL (a private asset, or one from before the CDN).
 */
export function mediaImageUrl(media: Pick<MediaDoc, 'cdnPath' | 'url'>, origin: string, width: number): string | null {
  if (media.cdnPath) {
    const base = `${origin.replace(/\/+$/, '')}${media.cdnPath}`
    return media.cdnPath.includes('?') ? base : `${base}?w=${width}`
  }
  return media.url || null
}

/** The Ionicons glyph for a file that has no picture to show. */
export function mediaKindIcon(kind: string | undefined): string {
  if (kind === 'video') return 'videocam-outline'
  if (kind === 'pdf') return 'document-text-outline'
  if (kind === 'image') return 'image-outline'
  return 'document-outline'
}

/** `1920 × 1080`, or null when the document has no pixel size. */
export function mediaDimensions(media: Pick<MediaDoc, 'width' | 'height'>): string | null {
  return media.width && media.height ? `${media.width} × ${media.height}` : null
}

/** The grid's columns: two on a phone, more on a tablet's wider list pane. */
export function mediaGridColumns(width: number, split: boolean): number {
  if (!split) return width >= 600 ? 4 : 2
  return 3
}
