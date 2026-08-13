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
 * Media folder hierarchy (AGL-171): first-class folders at
 * `hosts/{hostId}/mediaFolders/{folderId}` replacing the AGL-124 free-text
 * `folder` string on media docs. Console UI and any future API share these
 * helpers so depth/cycle/name rules can't disagree.
 *
 * Delete policy (documented per the issue): deleting a folder re-parents
 * its child folders and assets to the deleted folder's parent — nothing is
 * ever orphaned and no delete is blocked.
 */

import type { ScopeToken } from './scope-tokens'

export interface AglynMediaFolder {
  name: string
  /** Parent folder id; null/undefined = root. */
  parentId?: string | null
  /** Sibling sort position. */
  order?: number
}

export interface NewMediaFolderInput {
  name: string
  parentId: string | null
  /**
   * `serverTimestamp()` from whichever SDK the caller holds — this module
   * stays free of both the client and admin Firestore packages.
   */
  createdAt: unknown
  /**
   * Who may see the folder (AGL-1037). **Required**, with no default: the
   * whole of AGL-1466 was two call sites that each built the document
   * inline and each forgot the field, so the type is what stops a third.
   *
   * `null` means a SITE library — `hosts/{hostId}/mediaFolders` is private
   * by construction and stores no scope, the same rule the site-export
   * import path follows and the reason `scopedToHost` refuses a host ref.
   */
  visibleTo: readonly ScopeToken[] | null
}

/**
 * The document a media folder is created with (AGL-1466).
 *
 * Every `mediaFolders` create goes through here. Before it, the console
 * wrote `{ name, parentId, createdAt }` from the NEW FOLDER button and from
 * the legacy-string migration, so a folder in an ORG library landed with no
 * `visibleTo` — and both enforcement layers fail closed on a missing field
 * (`array-contains-any` matches nothing, the rules' `hasAny` errors). The
 * result was a library that looked right on the org page and collapsed into
 * "No folder" the moment it was opened for a site, because the folders were
 * gone and only their files remained.
 */
export function newMediaFolderDoc(
  input: NewMediaFolderInput,
): Record<string, unknown> {
  const { name, parentId, createdAt, visibleTo } = input
  // An EMPTY array is the one value that must never be stored. Unlike a
  // missing field it is a written "visible to nobody" — the backfill leaves
  // it alone by design and no read path treats it as legacy — so it is
  // permanent rather than repairable. Getting here means a caller computed
  // a scope and came back with nothing, which is a bug worth a stack trace
  // rather than a folder nobody will ever see again.
  if (visibleTo && !visibleTo.length) {
    throw new Error('A media folder cannot be created with an empty scope')
  }
  return {
    name,
    parentId,
    createdAt,
    ...(visibleTo ? { visibleTo: [...visibleTo] } : {}),
  }
}

/** Nesting cap, enforced in UI and validation (root children = depth 1). */
export const MEDIA_FOLDER_MAX_DEPTH = 5

export const MEDIA_FOLDER_NAME_MAX_LENGTH = 60

/**
 * Trims and collapses whitespace; null when empty or over the length cap
 * so callers reject rather than store junk.
 */
export function normalizeFolderName(input: string): string | null {
  const name = String(input ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name || name.length > MEDIA_FOLDER_NAME_MAX_LENGTH) return null
  return name
}

/**
 * Depth of a folder (root children = 1). Broken parent links and cycles
 * both terminate: unknown parents count as root, and a revisited id stops
 * the walk (treated as max depth so validation refuses to make it worse).
 */
export function folderDepth(
  folderId: string,
  foldersById: Record<string, AglynMediaFolder>,
): number {
  let depth = 0
  const seen = new Set<string>()
  let current: string | null | undefined = folderId
  while (current && foldersById[current]) {
    if (seen.has(current)) return MEDIA_FOLDER_MAX_DEPTH
    seen.add(current)
    depth += 1
    current = foldersById[current].parentId
  }
  return depth
}

/**
 * True when re-parenting `folderId` under `newParentId` would create a
 * cycle — i.e. the new parent is the folder itself or one of its
 * descendants (the parent chain from `newParentId` reaches `folderId`).
 */
export function wouldCreateCycle(
  folderId: string,
  newParentId: string | null | undefined,
  foldersById: Record<string, AglynMediaFolder>,
): boolean {
  const seen = new Set<string>()
  let current: string | null | undefined = newParentId
  while (current) {
    if (current === folderId) return true
    if (seen.has(current)) return true
    seen.add(current)
    current = foldersById[current]?.parentId
  }
  return false
}

/**
 * Case-insensitive sibling-name uniqueness per parent. `excludeId` skips
 * the folder being renamed/moved itself.
 */
export function isSiblingNameTaken(
  name: string,
  parentId: string | null | undefined,
  folders: Array<AglynMediaFolder & { $id: string }>,
  excludeId?: string,
): boolean {
  const target = name.trim().toLowerCase()
  const parent = parentId ?? null
  return folders.some(
    (folder) =>
      folder.$id !== excludeId &&
      (folder.parentId ?? null) === parent &&
      folder.name.trim().toLowerCase() === target,
  )
}

export interface LegacyFolderMigrationPlan {
  /** Root-level folder names that must be created (deduped, ordered). */
  foldersToCreate: string[]
  /**
   * Media doc id → legacy folder name (lower-cased key match against
   * created/existing root folders happens at execution time).
   */
  assignments: Array<{ mediaId: string; folderName: string }>
}

/**
 * Migration plan from flat AGL-124 `folder` strings: one root folder per
 * distinct legacy string (case-insensitive; existing root folders with a
 * matching name are reused, not duplicated), and a `folderId` stamp for
 * every media doc that still carries a legacy string but no `folderId`.
 */
export function planLegacyFolderMigration(
  mediaDocs: Array<{ $id: string; folder?: string; folderId?: string | null }>,
  existingFolders: Array<AglynMediaFolder & { $id: string }>,
): LegacyFolderMigrationPlan {
  const existingRootNames = new Set(
    existingFolders
      .filter((folder) => (folder.parentId ?? null) === null)
      .map((folder) => folder.name.trim().toLowerCase()),
  )
  const toCreate = new Map<string, string>()
  const assignments: LegacyFolderMigrationPlan['assignments'] = []
  for (const media of mediaDocs) {
    if (media.folderId) continue
    const name = normalizeFolderName(media.folder ?? '')
    if (!name) continue
    const key = name.toLowerCase()
    if (!existingRootNames.has(key) && !toCreate.has(key)) {
      toCreate.set(key, name)
    }
    assignments.push({ mediaId: media.$id, folderName: name })
  }
  return {
    foldersToCreate: [...toCreate.values()].sort(),
    assignments,
  }
}
