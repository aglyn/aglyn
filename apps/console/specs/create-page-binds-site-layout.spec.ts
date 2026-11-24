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
 * A NEW PAGE STARTS INSIDE THE SITE'S LAYOUT (AGL-4241).
 *
 * Pages ▸ Create new page made a page with no shared layout, so no header and
 * no footer, until its author found Properties ▸ Shared layout in the editor.
 * Three layers hold the fix:
 *
 * - `createScreenDraft` stores the chosen layout on the FIRST VERSION, where
 *   the editor's Shared layout control writes it, and nowhere else.
 * - `readNewPageLayout` reads the site and hands the choice to
 *   `newPageLayoutId`, so a new site's Home binding is what a new page gets.
 * - The Pages screen passes the choice through and offers it in the drawer.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import createScreenDraft from '../utils/create-screen-draft'
import readNewPageLayout from '../utils/read-new-page-layout'

/** An in-memory Firestore for the client reads `readNewPageLayout` takes. */
const mockStore = new Map<string, Record<string, unknown>>()
jest.mock('firebase/firestore', () => {
  const pathOf = (base: unknown, segments: string[]) =>
    [
      ...(base && typeof base === 'object' && 'path' in base
        ? [(base as { path: string }).path]
        : []),
      ...segments,
    ].join('/')
  const snapshot = (path: string) => ({
    id: path.slice(path.lastIndexOf('/') + 1),
    data: () => mockStore.get(path),
    get: (field: string) => mockStore.get(path)?.[field],
  })
  return {
    doc: (base: unknown, ...segments: string[]) => ({ path: pathOf(base, segments) }),
    collection: (base: unknown, ...segments: string[]) => ({ path: pathOf(base, segments) }),
    query: (ref: { path: string }) => ref,
    limit: () => null,
    getDoc: async (ref: { path: string }) => snapshot(ref.path),
    getDocs: async (ref: { path: string }) => ({
      docs: [...mockStore.keys()]
        .filter((key) => key.startsWith(`${ref.path}/`) && !key.slice(ref.path.length + 1).includes('/'))
        .sort()
        .map(snapshot),
    }),
  }
})

const REPO_ROOT = join(__dirname, '..', '..', '..')
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const SCREENS_PAGE = stripComments(
  readFileSync(
    join(REPO_ROOT, 'apps/console/app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx'),
    'utf8',
  ),
)

/** The two resource APIs, recording what each was sent. */
function apis() {
  const sent: { screen?: Record<string, unknown>; version?: Record<string, unknown> } = {}
  return {
    sent,
    createHostResource: async (options: { data: Record<string, unknown> }) => {
      sent.screen = options.data
    },
    createHostVersion: async (options: { data?: Record<string, unknown> }) => {
      sent.version = options.data
    },
  }
}

describe('createScreenDraft stores the layout on the first version', () => {
  it('binds the layout it is given there, and not on the page document', async () => {
    const { sent, createHostResource, createHostVersion } = apis()
    await createScreenDraft(createHostResource, createHostVersion, {
      hostId: 'host-1',
      screenId: 's1',
      versionId: 'v1',
      fields: { displayName: 'About' },
      layoutId: 'site-layout',
    })
    expect(sent.version?.['layoutId']).toBe('site-layout')
    expect(sent.screen).not.toHaveProperty('layoutId')
  })

  it('binds nothing when there is no layout', async () => {
    const { sent, createHostResource, createHostVersion } = apis()
    await createScreenDraft(createHostResource, createHostVersion, {
      hostId: 'host-1',
      screenId: 's1',
      versionId: 'v1',
      fields: { displayName: 'About' },
    })
    expect(sent.version).not.toHaveProperty('layoutId')
  })
})

describe('readNewPageLayout', () => {
  beforeEach(() => {
    mockStore.clear()
    // A new site, as `defaultSiteWrites` makes it: Home at `/`, bound to its
    // "Site header and footer" layout on the screen document.
    mockStore.set('hosts/host-1', { screens: { home: '/' } })
    mockStore.set('hosts/host-1/screens/home', { versionId: 'hv', layoutId: 'site-layout' })
    mockStore.set('hosts/host-1/screens/home/versions/hv', { screenId: 'home' })
    mockStore.set('hosts/host-1/layouts/site-layout', { displayName: 'Site header and footer' })
  })

  it('answers the layout a new site binds its Home page to, and lists the live layouts', async () => {
    mockStore.set('hosts/host-1/layouts/old', { displayName: 'Old', deletedAt: 1 })
    mockStore.set('hosts/host-1/layouts/landing', { displayName: 'Landing' })
    expect(await readNewPageLayout({} as never, 'host-1')).toEqual({
      layoutId: 'site-layout',
      layouts: [
        { id: 'landing', displayName: 'Landing' },
        { id: 'site-layout', displayName: 'Site header and footer' },
      ],
    })
  })

  it('answers none on a site with no layout', async () => {
    mockStore.delete('hosts/host-1/layouts/site-layout')
    expect(await readNewPageLayout({} as never, 'host-1')).toEqual({ layoutId: undefined, layouts: [] })
  })
})

describe('the Create new page drawer', () => {
  it('passes the layout to createScreenDraft, kept out of the page’s own fields', () => {
    expect(SCREENS_PAGE).toMatch(/layoutId: layoutChoice,\s*\.\.\.fields/)
    expect(SCREENS_PAGE).toMatch(/createScreenDraft\([\s\S]*?slug: path \?\? undefined,\s*layoutId,/)
  })

  it('offers a Shared layout select defaulting to the site’s layout, with None', () => {
    expect(SCREENS_PAGE).toContain("label: 'Shared layout'")
    expect(SCREENS_PAGE).toContain('initialValue: newPageLayout.layoutId ?? NO_LAYOUT')
    expect(SCREENS_PAGE).toContain("{ value: NO_LAYOUT, label: 'None' }")
  })
})
