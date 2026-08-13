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

import {
  type AglynMediaFolder,
  folderDepth,
  isSiblingNameTaken,
  MEDIA_FOLDER_MAX_DEPTH,
  newMediaFolderDoc,
  normalizeFolderName,
  planLegacyFolderMigration,
  wouldCreateCycle,
} from './media-folders'
import { ORG_SCOPE_TOKEN } from './scope-tokens'

describe('normalizeFolderName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeFolderName('  Hero   Images ')).toBe('Hero Images')
  })

  it('rejects empty and oversized names', () => {
    expect(normalizeFolderName('   ')).toBeNull()
    expect(normalizeFolderName('x'.repeat(61))).toBeNull()
  })
})

describe('folderDepth', () => {
  const folders: Record<string, AglynMediaFolder> = {
    a: { name: 'A', parentId: null },
    b: { name: 'B', parentId: 'a' },
    c: { name: 'C', parentId: 'b' },
  }

  it('counts the parent chain', () => {
    expect(folderDepth('a', folders)).toBe(1)
    expect(folderDepth('c', folders)).toBe(3)
  })

  it('terminates on cycles at max depth', () => {
    const cyclic = {
      a: { name: 'A', parentId: 'b' },
      b: { name: 'B', parentId: 'a' },
    }
    expect(folderDepth('a', cyclic)).toBe(MEDIA_FOLDER_MAX_DEPTH)
  })
})

describe('wouldCreateCycle', () => {
  const folders: Record<string, AglynMediaFolder> = {
    a: { name: 'A', parentId: null },
    b: { name: 'B', parentId: 'a' },
    c: { name: 'C', parentId: 'b' },
  }

  it('refuses moving a folder under itself or a descendant', () => {
    expect(wouldCreateCycle('a', 'a', folders)).toBe(true)
    expect(wouldCreateCycle('a', 'c', folders)).toBe(true)
  })

  it('allows legal moves', () => {
    expect(wouldCreateCycle('c', 'a', folders)).toBe(false)
    expect(wouldCreateCycle('c', null, folders)).toBe(false)
  })
})

describe('isSiblingNameTaken', () => {
  const folders = [
    { $id: 'a', name: 'Hero', parentId: null },
    { $id: 'b', name: 'products', parentId: null },
    { $id: 'c', name: 'Hero', parentId: 'b' },
  ]

  it('matches case-insensitively within the same parent only', () => {
    expect(isSiblingNameTaken('hero', null, folders)).toBe(true)
    expect(isSiblingNameTaken('hero', 'b', folders)).toBe(true)
    expect(isSiblingNameTaken('hero', 'a', folders)).toBe(false)
  })

  it('excludes the folder being renamed', () => {
    expect(isSiblingNameTaken('Hero', null, folders, 'a')).toBe(false)
  })
})

describe('planLegacyFolderMigration', () => {
  it('creates one root folder per distinct legacy string and assigns docs', () => {
    const plan = planLegacyFolderMigration(
      [
        { $id: 'm1', folder: 'Hero' },
        { $id: 'm2', folder: ' hero ' },
        { $id: 'm3', folder: 'Products' },
        { $id: 'm4' },
        { $id: 'm5', folder: 'Hero', folderId: 'existing' },
      ],
      [],
    )
    expect(plan.foldersToCreate).toEqual(['Hero', 'Products'])
    expect(plan.assignments).toHaveLength(3)
    expect(plan.assignments.map((a) => a.mediaId)).toEqual(['m1', 'm2', 'm3'])
  })

  it('reuses existing root folders case-insensitively', () => {
    const plan = planLegacyFolderMigration(
      [{ $id: 'm1', folder: 'hero' }],
      [{ $id: 'f1', name: 'Hero', parentId: null }],
    )
    expect(plan.foldersToCreate).toEqual([])
    expect(plan.assignments).toEqual([{ mediaId: 'm1', folderName: 'hero' }])
  })
})

/**
 * AGL-1466: a folder document is only ever built here.
 *
 * The console wrote `{ name, parentId, createdAt }` from two places and
 * neither carried `visibleTo`, so every folder created through the product
 * landed unscoped — invisible to the `array-contains-any` folder listener
 * that runs whenever the library is opened for a site, which collapsed the
 * whole tree into "No folder". The field is not optional-with-a-default at
 * the call site any more: it is a required input of the one function that
 * shapes the document, so a third creation path cannot forget it.
 */
describe('newMediaFolderDoc', () => {
  const CREATED_AT = { __sentinel: 'serverTimestamp' }

  it('stores the scope it was given, alongside the folder fields', () => {
    expect(
      newMediaFolderDoc({
        name: 'Product',
        parentId: null,
        createdAt: CREATED_AT,
        visibleTo: [ORG_SCOPE_TOKEN],
      }),
    ).toEqual({
      name: 'Product',
      parentId: null,
      createdAt: CREATED_AT,
      visibleTo: [ORG_SCOPE_TOKEN],
    })
  })

  it('keeps a restricted scope verbatim under a parent', () => {
    expect(
      newMediaFolderDoc({
        name: 'Mockups',
        parentId: 'folder-1',
        createdAt: CREATED_AT,
        visibleTo: ['host:h1'],
      }),
    ).toMatchObject({ parentId: 'folder-1', visibleTo: ['host:h1'] })
  })

  /**
   * A SITE library (`hosts/{hostId}/mediaFolders`) is private by
   * construction and carries no scope — the import route documents the same
   * rule, and `scopedToHost` refuses to filter a host ref. Writing `['org']`
   * there would invent a token naming an org the path does not name.
   */
  it('omits the field entirely for a site library', () => {
    const doc = newMediaFolderDoc({
      name: 'Evergreen',
      parentId: null,
      createdAt: CREATED_AT,
      visibleTo: null,
    })
    expect(doc).toEqual({ name: 'Evergreen', parentId: null, createdAt: CREATED_AT })
    expect('visibleTo' in doc).toBe(false)
  })

  /**
   * An empty array is the one value that must never be stored: it is a
   * WRITTEN "visible to nobody", which the backfill deliberately leaves
   * alone and which no read path treats as legacy. Reaching this means a
   * caller computed a scope and got nothing, so it fails loudly rather than
   * quietly writing the thing that caused this issue.
   */
  it('refuses an empty scope rather than storing an unreadable folder', () => {
    expect(() =>
      newMediaFolderDoc({
        name: 'Nowhere',
        parentId: null,
        createdAt: CREATED_AT,
        visibleTo: [],
      }),
    ).toThrow(/scope/i)
  })
})
