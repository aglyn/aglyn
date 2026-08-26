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
 * What creating a collection sends (AGL-2498).
 *
 * New collections need more details to define when creating the
 * collection. The dialog asked for a name and nothing else, while a
 * collection is defined by four things — its name, the ADDRESS it serves, and
 * the two screens that render its list and its entries. Every one of the other
 * three was settings-only, so a new collection was created and then
 * immediately reopened to finish defining it.
 *
 * Those four do not travel in one request, which is the thing worth pinning:
 * `/api/hosts/collections` accepts `displayName` and `slug` on `create` and
 * writes the template pointers under a separate `templates` action. A dialog
 * that sent the pointers in the create body would have them silently dropped —
 * the route filters `data` through a per-kind allowlist — and the collection
 * would come out on the built-in pages with no error anywhere.
 */
import {
  collectionCreateBody,
  collectionTemplateBodies,
} from '../components/content/collection-create-requests'

const BASE = {
  hostId: 'h1',
  displayName: 'Case Studies',
  slug: 'case-studies',
}

describe('creating a collection (AGL-2498)', () => {
  it('sends the name and the ADDRESS, which the create action accepts', () => {
    expect(collectionCreateBody(BASE)).toEqual({
      hostId: 'h1',
      action: 'create',
      kind: 'content',
      data: { displayName: 'Case Studies', slug: 'case-studies' },
    })
  })

  it('carries NO template pointer in the create body', () => {
    // The route's `CONTENT_KEYS` allowlist is `displayName` + `slug`; a
    // pointer sent here is dropped without an error, which is the failure
    // this test exists to make impossible.
    const body = collectionCreateBody({
      ...BASE,
      listScreenId: 'scr-list',
      entryScreenId: 'scr-entry',
    })
    expect(JSON.stringify(body)).not.toContain('scr-list')
    expect(JSON.stringify(body)).not.toContain('scr-entry')
  })

  it('sends NOTHING extra for a collection on the built-in pages', () => {
    // The common case, and the one the docs teach: create, write entries,
    // then design the pages. A collection with no pointers still renders.
    expect(collectionTemplateBodies({ ...BASE, id: 'c1' })).toEqual([])
    expect(
      collectionTemplateBodies({
        ...BASE,
        id: 'c1',
        listScreenId: '',
        entryScreenId: '',
      }),
    ).toEqual([])
  })

  it('sends one pointer request per screen actually chosen', () => {
    expect(
      collectionTemplateBodies({ ...BASE, id: 'c1', listScreenId: 'scr-list' }),
    ).toEqual([
      {
        hostId: 'h1',
        action: 'templates',
        id: 'c1',
        data: { listScreenId: 'scr-list' },
      },
    ])
  })

  it('clears the superseded legacy pointer when setting the entry screen', () => {
    // `templateScreenId` is the AGL-105 field the tenant still falls back to.
    // A brand-new document must not be born carrying one, or the entry select
    // stops being the single source of truth on the day it is created.
    const [body] = collectionTemplateBodies({
      ...BASE,
      id: 'c1',
      entryScreenId: 'scr-entry',
    })
    expect(body).toEqual({
      hostId: 'h1',
      action: 'templates',
      id: 'c1',
      data: { entryScreenId: 'scr-entry', templateScreenId: null },
    })
    // `null`, not undefined: `deleteField()` does not survive JSON, and the
    // route reads null as the clear.
    expect((body.data as any).templateScreenId).toBeNull()
  })

  it('sends both, in list-then-entry order, when both are chosen', () => {
    const bodies = collectionTemplateBodies({
      ...BASE,
      id: 'c1',
      listScreenId: 'scr-list',
      entryScreenId: 'scr-entry',
    })
    expect(bodies).toHaveLength(2)
    expect((bodies[0].data as any).listScreenId).toBe('scr-list')
    expect((bodies[1].data as any).entryScreenId).toBe('scr-entry')
  })

  it('addresses the pointers at the id the create returned', () => {
    // Nothing can point at a document that does not exist yet, so these are
    // built from the create's own answer rather than from anything the dialog
    // guessed.
    for (const body of collectionTemplateBodies({
      ...BASE,
      id: 'created-id',
      listScreenId: 'a',
      entryScreenId: 'b',
    })) {
      expect(body.id).toBe('created-id')
      expect(body.action).toBe('templates')
    }
  })
})
