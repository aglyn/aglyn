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
  mediaFolderChoices,
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

/**
 * The MOVE TO FOLDER picker (AGL-1470).
 *
 * The failure this exists to stop is silent: with `Blog/Covers` and
 * `Press/Covers` both present the picker drew two rows reading exactly
 * `Covers`, and choosing the wrong one rewrites the object to a different
 * prefix while every id-based reference keeps resolving. No error, no broken
 * image — the file is just filed where nobody will look for it.
 */
describe('mediaFolderChoices', () => {
  const TREE: Array<AglynMediaFolder & { $id: string }> = [
    { $id: 'blog', name: 'Blog', parentId: null },
    { $id: 'press', name: 'Press', parentId: null },
    { $id: 'blog-covers', name: 'Covers', parentId: 'blog' },
    { $id: 'press-covers', name: 'Covers', parentId: 'press' },
  ]

  it('gives two same-named folders under different parents distinct labels', () => {
    const labels = mediaFolderChoices(TREE).map((choice) => choice.label)
    expect(labels).toContain('Blog / Covers')
    expect(labels).toContain('Press / Covers')
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('orders the list as the sidebar draws it — each child under its parent', () => {
    expect(mediaFolderChoices(TREE).map((choice) => choice.$id)).toEqual([
      'blog',
      'blog-covers',
      'press',
      'press-covers',
    ])
  })

  it('reports a depth the picker can indent by', () => {
    const byId = Object.fromEntries(
      mediaFolderChoices(TREE).map((choice) => [choice.$id, choice]),
    )
    expect(byId['blog'].depth).toBe(0)
    expect(byId['blog-covers'].depth).toBe(1)
    expect(byId['blog-covers'].path).toEqual(['Blog', 'Covers'])
  })

  it('sorts siblings by order then name, matching the rail', () => {
    expect(
      mediaFolderChoices([
        { $id: 'b', name: 'Beta', parentId: null },
        { $id: 'a', name: 'Alpha', parentId: null },
        { $id: 'z', name: 'Zulu', parentId: null, order: -1 },
      ]).map((choice) => choice.name),
    ).toEqual(['Zulu', 'Alpha', 'Beta'])
  })

  /**
   * A folder whose parent is missing from the caller's read set is still a
   * real folder holding real files — dropping it from the picker would make
   * the destination unreachable, which is a worse failure than an unindented
   * row. Scoped collaborators see exactly this: `array-contains-any` can
   * admit a child and refuse its parent (AGL-1466).
   */
  it('keeps a folder whose parent is outside the read set', () => {
    const choices = mediaFolderChoices([
      { $id: 'orphan', name: 'Covers', parentId: 'not-in-this-read-set' },
    ])
    expect(choices).toHaveLength(1)
    expect(choices[0].label).toBe('Covers')
    expect(choices[0].depth).toBe(0)
  })

  /** A cycle must not hang the picker — it is drawn on every render. */
  it('terminates on a parent cycle', () => {
    const choices = mediaFolderChoices([
      { $id: 'a', name: 'A', parentId: 'b' },
      { $id: 'b', name: 'B', parentId: 'a' },
    ])
    expect(choices.map((choice) => choice.$id).sort()).toEqual(['a', 'b'])
  })
})
