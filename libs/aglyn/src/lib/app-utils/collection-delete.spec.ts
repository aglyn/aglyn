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
 * AGL-1324: a collection delete must refuse while anything still depends on
 * it, and the refusal must NAME the dependency.
 *
 * The assertions that matter here are the refusals and the wording. A spec
 * that only checked "an empty collection deletes" would pass against a
 * function that returns null unconditionally — which is the state being
 * fixed (no gate at all, because no delete at all).
 */

import {
  collectionDeleteDenial,
  collectionTemplateBindings,
  type CollectionTemplateScreen,
} from './collection-delete'

const screens = (
  map: Record<string, CollectionTemplateScreen>,
): Record<string, CollectionTemplateScreen> => map

describe('collectionTemplateBindings (AGL-1324)', () => {
  it('reports the list and entry template screens by name', () => {
    const bindings = collectionTemplateBindings(
      { listScreenId: 's1', entryScreenId: 's2' },
      screens({ s1: { displayName: 'Blog index' }, s2: { displayName: 'Post' } }),
    )
    expect(bindings).toEqual([
      { role: 'list', screenId: 's1', screenName: 'Blog index' },
      { role: 'entry', screenId: 's2', screenName: 'Post' },
    ])
  })

  it('honours templateScreenId as the legacy entry fallback', () => {
    // Mirrors `resolveCollectionTemplateScreenId`: entry route is
    // `entryScreenId || templateScreenId`, so a collection still on the old
    // pointer is bound just as much as one on the new one.
    expect(
      collectionTemplateBindings(
        { templateScreenId: 'legacy' },
        screens({ legacy: { displayName: 'Article' } }),
      ),
    ).toEqual([{ role: 'entry', screenId: 'legacy', screenName: 'Article' }])
  })

  it('prefers entryScreenId when both entry pointers are set', () => {
    const bindings = collectionTemplateBindings(
      { entryScreenId: 'new', templateScreenId: 'old' },
      screens({ new: { displayName: 'New' }, old: { displayName: 'Old' } }),
    )
    expect(bindings.map((b) => b.screenId)).toEqual(['new'])
  })

  it('dedupes one screen serving both routes', () => {
    // One screen is one thing to detach, not two.
    const bindings = collectionTemplateBindings(
      { listScreenId: 'both', entryScreenId: 'both' },
      screens({ both: { displayName: 'Everything' } }),
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0].role).toBe('list')
  })

  it('drops a binding whose screen is gone or soft-deleted', () => {
    // Otherwise deleting a SCREEN makes its collection permanently
    // undeletable — the AGL-1324 bug, one level down.
    expect(
      collectionTemplateBindings({ listScreenId: 'missing' }, screens({})),
    ).toEqual([])
    expect(
      collectionTemplateBindings(
        { listScreenId: 'dead' },
        screens({ dead: { displayName: 'Old', deletedAt: 12345 } }),
      ),
    ).toEqual([])
  })

  it('treats cleared and empty pointers as unbound', () => {
    expect(collectionTemplateBindings({}, screens({}))).toEqual([])
    expect(
      collectionTemplateBindings(
        { listScreenId: '', entryScreenId: '   ' },
        screens({ '': { displayName: 'nope' } }),
      ),
    ).toEqual([])
    expect(collectionTemplateBindings(null, screens({}))).toEqual([])
  })

  it('falls back to the screen id when the screen has no name', () => {
    expect(
      collectionTemplateBindings(
        { listScreenId: 'abc123' },
        screens({ abc123: {} }),
      )[0].screenName,
    ).toBe('abc123')
  })
})

describe('collectionDeleteDenial (AGL-1324)', () => {
  it('allows an unreferenced, empty collection', () => {
    expect(
      collectionDeleteDenial({
        displayName: 'Legal',
        entryCount: 0,
        bindings: [],
      }),
    ).toBeNull()
  })

  it('blocks a template-bound collection and names the screen', () => {
    const denial = collectionDeleteDenial({
      displayName: 'Blog',
      entryCount: 0,
      bindings: [{ role: 'list', screenId: 's1', screenName: 'Blog index' }],
    })
    expect(denial?.status).toBe(409)
    expect(denial?.blockers).toEqual(['template-bound'])
    // Naming the screen is the point — "cannot delete" without it leaves the
    // user with no next action.
    expect(denial?.error).toContain('Blog index')
    expect(denial?.error).toContain('list template')
  })

  it('names every bound screen, not just the first', () => {
    const denial = collectionDeleteDenial({
      displayName: 'Blog',
      entryCount: 0,
      bindings: [
        { role: 'list', screenId: 's1', screenName: 'Blog index' },
        { role: 'entry', screenId: 's2', screenName: 'Post detail' },
      ],
    })
    expect(denial?.error).toContain('Blog index')
    expect(denial?.error).toContain('Post detail')
  })

  it('blocks a collection that still has entries, with the count', () => {
    const denial = collectionDeleteDenial({
      displayName: 'Blog',
      entryCount: 12,
      bindings: [],
    })
    expect(denial?.status).toBe(409)
    expect(denial?.blockers).toEqual(['has-entries'])
    expect(denial?.error).toContain('12 entries')
  })

  it('does not cascade entries away — refusing is the semantic', () => {
    // The guard exists so that deleting a collection can never be the act
    // that destroys published entries. If this ever returns null with
    // entries present, the cascade became silent.
    expect(
      collectionDeleteDenial({
        displayName: 'Blog',
        entryCount: 1,
        bindings: [],
      }),
    ).not.toBeNull()
  })

  it('counts one entry in the singular', () => {
    expect(
      collectionDeleteDenial({
        displayName: 'Blog',
        entryCount: 1,
        bindings: [],
      })?.error,
    ).toContain('1 entry.')
  })

  it('reports both blockers at once', () => {
    // Two trips through a destructive dialog to learn a fact knowable on the
    // first reads as the product changing its mind.
    const denial = collectionDeleteDenial({
      displayName: 'Blog',
      entryCount: 3,
      bindings: [{ role: 'entry', screenId: 's2', screenName: 'Post' }],
    })
    expect(denial?.blockers).toEqual(['template-bound', 'has-entries'])
    expect(denial?.error).toContain('Post')
    expect(denial?.error).toContain('3 entries')
  })

  it('still produces a usable sentence for an unnamed collection', () => {
    expect(
      collectionDeleteDenial({
        displayName: '',
        entryCount: 2,
        bindings: [],
      })?.error,
    ).toContain('This collection')
  })
})
