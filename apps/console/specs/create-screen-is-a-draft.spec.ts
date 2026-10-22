/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * CREATING A SCREEN PUBLISHES NOTHING (AGL-3021).
 *
 * `Screens ▸ CREATE NEW SCREEN` used to create the screen, create its first
 * version, and publish the route in one `.then` chain. Measured 2026-09-03
 * while building `/alternatives`: the row came back `Updated 1:16:07 PM` and
 * `Published 1:16:08 PM`. A blank page was live on the public site because
 * somebody clicked *create*, and the only way back was the UNPUBLISH button
 * on View details — a screen nobody visits on the way to building a page.
 *
 * The owner's decision is the whole requirement: nothing is published until a
 * user hits publish.
 *
 * ## Why the assertions are shaped this way
 *
 * A publish is not a flag, it is a document: the tenant matches request paths
 * against the host's `screens` routing map, so a screen the map does not name
 * has no address at all. That makes "did creating publish it?" answerable
 * WITHOUT mocking the publisher — read the host document back and ask whether
 * anything resolves to the new screen. `ai-job-drafts-screen.spec.ts` settles
 * the same question the same way for the AI writer, which is the path this
 * one was told to copy.
 *
 * So there are three layers here, and they fail differently:
 *
 * - THE HELPER cannot publish, which is structural: `createScreenDraft` is
 *   handed the two resource APIs and holds no `firestore` and no `user`. The
 *   behavioral block proves the consequence — two documents written, the host
 *   document untouched, no address resolving.
 * - THE SERVER DOOR cannot be told to publish: `publishedAt` is off the
 *   `RESOURCES.screen` allow-list, so a create carrying one drops it. A
 *   premise guard reads that list out of the route rather than trusting this
 *   file's copy of it, because the hole reopens if the list ever grows.
 * - THE PAGE still routes through the helper and still offers the way back.
 *   Wiring is invisible until somebody watches a live URL they did not ask
 *   for, so it is asserted over the source.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findScreenIdByRoutePath } from '@aglyn/aglyn/app-utils/screen-route'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import createScreenDraft from '../utils/create-screen-draft'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * These files explain themselves at length, and the explanations name the
 * publisher they no longer call. Only CODE may be asserted on.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const readRepo = (rel: string) =>
  stripComments(readFileSync(join(REPO_ROOT, rel), 'utf8'))

const SCREENS_PAGE =
  'apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx'
const RESOURCES_ROUTE = 'apps/console/app/api/hosts/resources/route.ts'
const HELPER = 'apps/console/utils/create-screen-draft.ts'

/**
 * Every field `/api/hosts/resources` will accept on a screen create. Anything
 * else the client sends is dropped; `createdAt`, `updatedAt` and `createdBy`
 * are stamped server-side. `publishedAt` is deliberately absent, which is the
 * property the premise guard below re-reads out of the route.
 */
const SCREEN_CREATE_FIELDS = [
  'displayName',
  'description',
  'slug',
  'seo',
  'kind',
  'versionId',
]

const NOW = '2026-09-16T04:00:00.000Z'
const CREATOR = 'uid-author'

/** Every document the fake backend holds, keyed by its Firestore path. */
let documents: Map<string, Record<string, unknown>>
/** Paths written during one test, in order — how many writes, and which. */
let written: string[]

/**
 * `/api/hosts/resources` for a screen create, as far as this question needs
 * it: the allow-list, the server stamps, and nothing else. Notably it takes
 * no host document and writes none — the route reads the routing map to count
 * billable screens and never writes it.
 */
const createHostResource = async (options: {
  hostId: string
  resource: 'screen'
  id?: string
  data: Record<string, unknown>
}) => {
  const path = `hosts/${options.hostId}/screens/${options.id}`
  const allowed: Record<string, unknown> = {}
  for (const field of SCREEN_CREATE_FIELDS) {
    if (options.data[field] !== undefined) allowed[field] = options.data[field]
  }
  documents.set(path, {
    ...allowed,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: CREATOR,
  })
  written.push(path)
  return { id: options.id as string }
}

/** `/api/hosts/versions`: one document under the screen, same stamps. */
const createHostVersion = async (options: {
  hostId: string
  kind: 'screen'
  parentId: string
  id?: string
  data?: Record<string, unknown>
}) => {
  const path = `hosts/${options.hostId}/screens/${options.parentId}/versions/${options.id}`
  documents.set(path, {
    ...(options.data ?? {}),
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: CREATOR,
  })
  written.push(path)
  return { id: options.id as string }
}

/** A site with pages already on it, so "unchanged" has something to say. */
function seedLiveSite() {
  documents = new Map<string, Record<string, unknown>>()
  written = []
  documents.set('hosts/host-1', {
    displayName: 'Marketing',
    // The routing map: screen id → composed path. This, and only this, is
    // what the tenant matches a request path against.
    screens: { home: '/', pricing: 'pricing' },
    locales: ['en'],
  })
  documents.set('hosts/host-1/screens/home', {
    displayName: 'Home',
    slug: '/',
    publishedAt: '2026-09-01T00:00:00.000Z',
  })
  documents.set('hosts/host-1/screens/pricing', {
    displayName: 'Pricing',
    slug: 'pricing',
    publishedAt: '2026-09-01T00:00:00.000Z',
  })
}

const routingMap = () =>
  (documents.get('hosts/host-1')?.['screens'] ?? {}) as Record<string, string>

const draft = (slug?: string) =>
  createScreenDraft(createHostResource, createHostVersion, {
    hostId: 'host-1',
    screenId: 'new-screen',
    versionId: 'version-1',
    fields: { displayName: 'Alternatives', description: 'Comparison hub' },
    slug,
  })

beforeEach(seedLiveSite)

describe('a created screen serves nothing until somebody publishes it', () => {
  it('writes the screen and its first version, and nothing that decides what the site serves', async () => {
    const before = new Map(
      [...documents].map(([path, data]) => [path, JSON.stringify(data)]),
    )

    await draft('alternatives')

    // Exactly two writes. A third would be the regression: the publish used
    // to be the third link in the same chain.
    expect(written.sort()).toEqual(
      [
        'hosts/host-1/screens/new-screen',
        'hosts/host-1/screens/new-screen/versions/version-1',
      ].sort(),
    )
    // Every document that existed a moment ago is byte-identical — the host
    // document, which holds the routing map, most of all.
    for (const [path, data] of before) {
      expect([path, JSON.stringify(documents.get(path))]).toEqual([path, data])
    }
    // And nothing anywhere else mentions the new screen.
    for (const [path, data] of documents) {
      if (path.startsWith('hosts/host-1/screens/new-screen')) continue
      expect([path, JSON.stringify(data).includes('new-screen')]).toEqual([
        path,
        false,
      ])
    }
  })

  it('leaves the published date empty, so the chip reads Draft', async () => {
    await draft('alternatives')
    const screen = documents.get('hosts/host-1/screens/new-screen') ?? {}
    // `Date published` on the details page is this field, and the chip is
    // green when it is set. Both stay empty.
    expect(screen).not.toHaveProperty('publishedAt')
    expect(screen).not.toHaveProperty('publishSchedule')
    // The first version exists — the besigner needs something to open — and
    // it is an empty canvas, not a published one.
    const version =
      documents.get('hosts/host-1/screens/new-screen/versions/version-1') ?? {}
    expect(version).not.toHaveProperty('publishedAt')
    expect(version['nodes']).toEqual({
      [CANVAS_ROOT_ELEMENT_ID]: {
        $id: CANVAS_ROOT_ELEMENT_ID,
        componentId: 'div',
        nodes: [],
      },
    })
  })

  it('keeps the address the author typed without giving it out', async () => {
    await draft('alternatives')
    // Stored, so the Publish control opens with it filled in…
    expect(documents.get('hosts/host-1/screens/new-screen')?.['slug']).toBe(
      'alternatives',
    )
    // …and unreachable, which is the whole difference. Core's real resolver,
    // over the real routing map.
    expect(findScreenIdByRoutePath(routingMap(), 'alternatives')).toBeUndefined()
    for (const path of ['/', 'pricing', 'alternatives']) {
      expect([path, findScreenIdByRoutePath(routingMap(), path)]).not.toEqual([
        path,
        'new-screen',
      ])
    }
  })

  it('resolves only once a publish writes the routing map, as publishScreenRoute does', async () => {
    await draft('alternatives')
    expect(findScreenIdByRoutePath(routingMap(), 'alternatives')).toBeUndefined()

    // The one door that publishes a screen, read from its own source so this
    // spec applies the write it actually makes rather than a paraphrase.
    const publisher = readRepo('apps/console/constants/screen-publishing.ts')
    const publish = publisher.slice(
      publisher.indexOf('export async function publishScreenRoute('),
      publisher.indexOf('export async function syncScreenRouteEntries('),
    )
    expect(publish).toContain('[`screens.${screenId}`]: path')
    expect(publish).toContain('{ slug, publishedAt: Timestamp.now() }')

    documents.set('hosts/host-1', {
      ...documents.get('hosts/host-1'),
      screens: { ...routingMap(), 'new-screen': 'alternatives' },
    })
    expect(findScreenIdByRoutePath(routingMap(), 'alternatives')).toBe(
      'new-screen',
    )
  })

  it('creates a screen with no address at all when none was typed', async () => {
    await draft(undefined)
    const screen = documents.get('hosts/host-1/screens/new-screen') ?? {}
    expect(screen).not.toHaveProperty('slug')
    expect(screen).not.toHaveProperty('publishedAt')
    expect(routingMap()).toEqual({ home: '/', pricing: 'pricing' })
  })

  it('cannot publish, because it is handed nothing that could', () => {
    const source = readRepo(HELPER)
    // The structural half of the guarantee, and the reason the behavioral
    // assertions above stay true under refactoring: this module has no
    // Firestore handle, no signed-in user, and no path to the publisher.
    expect(source).not.toMatch(/screen-publishing/)
    expect(source).not.toMatch(/publishScreenRoute|syncScreenRouteEntries/)
    expect(source).not.toMatch(/\bFirestore\b/)
    expect(source).not.toMatch(/publishedAt/)
  })
})

describe('the server door cannot be told to publish either', () => {
  it('keeps publishedAt off the screen create allow-list', () => {
    const route = readRepo(RESOURCES_ROUTE)
    const entry = route.slice(
      route.indexOf('  screen: {'),
      route.indexOf('  template: {'),
    )
    expect(entry).toContain('collection: ' + "'screens'")
    // The premise this file's fake backend rests on. If the allow-list grows
    // a publish key, a create could arrive already published — "a publish
    // wearing a create's clothes", as the `entry` resource puts it — and the
    // assertions above would be measuring a door that had moved.
    for (const field of SCREEN_CREATE_FIELDS) {
      expect([field, entry.includes(`'${field}'`)]).toEqual([field, true])
    }
    expect(entry).not.toContain('publishedAt')
    expect(entry).not.toContain('publishSchedule')
  })
})

describe('the Screens page', () => {
  const source = () => readRepo(SCREENS_PAGE)

  it('creates through the helper and reaches no publisher on the way', () => {
    const page = source()
    expect(page).toMatch(
      /await createScreenDraft\(createHostResource, createHostVersion, \{/,
    )
    // THE ASSERTION THIS FILE EXISTS FOR. The page still unpublishes (delete,
    // and the row menu below) and still cascades a move, so the import is not
    // empty — but nothing here publishes a route any more, which is what
    // creating used to do.
    expect(page).not.toMatch(/\bpublishScreenRoute\(/)
    expect(page).not.toMatch(/screenId: newId, user/)
  })

  it('says the new screen is a draft rather than letting the author assume', () => {
    const page = source()
    expect(page).toContain('a draft until ')
    expect(page).toContain("'you publish it'")
  })

  it('offers the way back from the row, on published screens only', () => {
    const page = source()
    // The menu item AGL-3021 asks for: unpublish where people actually are,
    // not two navigations away in View details.
    expect(page).toMatch(/key: 'unpublish'/)
    expect(page).toMatch(/label: 'Unpublish'/)
    expect(page).toMatch(
      /\.\.\.\(routingMap\?\.\[row\.\$id\] != null\s*\?\s*\[/,
    )
    expect(page).toMatch(/handleUnpublishScreen\(/)
    expect(page).toMatch(
      /unpublishScreenRoute\(firestore, \{ hostId, screenId: id, user \}\)/,
    )
  })

  it('says no to an author rather than inviting the click (AGL-2334)', () => {
    const page = source()
    // The `author` role edits content and may not publish it. Disabled with
    // the reason, not hidden and not answered with a raw permission-denied —
    // the doctrine the version-view publish card already follows.
    expect(page).toMatch(/useHostRole\(hostId\)/)
    expect(page).toMatch(/disabled: !canPublish/)
    expect(page).toMatch(/disabledReason: canPublish \? undefined : publishBlock/)
  })
})
