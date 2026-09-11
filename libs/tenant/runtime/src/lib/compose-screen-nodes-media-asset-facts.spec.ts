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
 * A PLACED ASSET COMPOSES FROM ITS DAM DOCUMENT, NOT FROM ITS PICK (AGL-2807,
 * AGL-2833).
 *
 * `composeNodesWithChrome` is the one pipeline every published tree passes
 * through (the page, an unlocked screen, a collection, author or search page),
 * so the overlay is pinned HERE, on the tree the page ships. The reader is the
 * real one and only Firestore is stubbed, so the queries counted below are the
 * queries a page issues: one for every image and film it places, a layout's
 * included, bounded by the cap, and a failure that leaves the page as picked.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()
const mockDocs = new Map<string, Record<string, unknown>>()
const mockGetAll = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetComponents(...a),
}))
jest.mock('./get-forms', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetForms(...a),
}))
jest.mock('./get-datasets', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetDatasets(...a),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPluginInstalls(...a),
}))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetVariables(...a),
  getFunctions: (...a: unknown[]) => mockGetFunctions(...a),
  getWorkflows: (...a: unknown[]) => mockGetWorkflows(...a),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin'),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        doc: (path: string) => ({ path }),
        getAll: (...args: unknown[]) => mockGetAll(...args),
      }),
    }),
  },
}))

import { pageVideoObjects } from '@aglyn/aglyn/server'
import { composeNodesWithChrome } from './compose-screen-nodes'
import { MEDIA_ASSET_FACTS_PER_RENDER } from './get-media-asset-facts'

const ROOT = '_@_'
const PHOTO = 'media:site1/photo'
const FILM = 'media:site1/film'
const LOGO = 'media:site1/logo'

/** What a pick of the photo as first uploaded copied: a 1200x630 card. */
const PICKED_PHOTO = {
  src: PHOTO,
  alt: 'The pipeline board',
  intrinsicWidth: 1200,
  intrinsicHeight: 630,
}

/** What a pick of the film as first uploaded copied: 2 s, 640x360, a poster. */
const PICKED_FILM = {
  src: FILM,
  title: 'The tour',
  description: 'What the product does.',
  uploadDate: '2026-09-10',
  durationSeconds: 2,
  intrinsicWidth: 640,
  intrinsicHeight: 360,
  posterFromSource: true,
}

/** The documents after a replace: a square photo and a 3 s square film. */
const REPLACED: Record<string, Record<string, unknown>> = {
  'hosts/site1/media/photo': { width: 480, height: 480 },
  'hosts/site1/media/film': {
    video: { durationMs: 3000, width: 480, height: 480 },
    poster: { width: 480, height: 480, variants: [] },
  },
  'hosts/site1/media/logo': { width: 290, height: 88 },
}

type Placement = { componentId: string; props: Record<string, unknown> }

/** A screen placing each node under its root, in the order given. */
const screenPlacing = (placements: Record<string, Placement>) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: Object.keys(placements) },
  ...Object.fromEntries(
    Object.entries(placements).map(([id, node]) => [
      id,
      { $id: id, parentId: ROOT, ...node },
    ]),
  ),
})

const PHOTO_AND_FILM = screenPlacing({
  photo: { componentId: 'image', props: PICKED_PHOTO },
  tour: { componentId: 'video', props: PICKED_FILM },
})

/** A layout that places a logo of its own around the slot the screen fills. */
const LAYOUT_PLACING_LOGO = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['logo', 'slot'] },
  logo: {
    $id: 'logo',
    componentId: 'image',
    parentId: ROOT,
    props: { src: LOGO, alt: 'Acme' },
  },
  slot: { $id: 'slot', componentId: 'layoutSlot', parentId: ROOT, nodes: [] },
}

const compose = (screenNodes: Record<string, unknown>, layoutId?: string) =>
  composeNodesWithChrome({
    hostId: 'site1',
    screenNodes: screenNodes as never,
    ...(layoutId ? { layoutId } : {}),
  })

/** The props of the node placing `src` in a composed tree. */
const placed = (nodes: Record<string, any>, src: string) =>
  Object.values(nodes).find((node) => node?.props?.src === src)?.props as
    | Record<string, unknown>
    | undefined

/** The document references one `getAll` asked for, without its read options. */
const pathsRead = (call: unknown[]) =>
  call
    .filter((arg): arg is { path: string } =>
      typeof (arg as { path?: unknown })?.path === 'string',
    )
    .map((arg) => arg.path)

describe('a placed asset composes from its DAM document (AGL-2807, AGL-2833)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPublishedLayoutVersion.mockResolvedValue({
      version: { nodes: {} },
      layout: {},
    })
    mockGetComponents.mockResolvedValue({ definitions: {} })
    mockGetVariables.mockResolvedValue([])
    mockGetFunctions.mockResolvedValue([])
    mockGetDatasets.mockResolvedValue([])
    mockGetWorkflows.mockResolvedValue([])
    mockGetPluginInstalls.mockResolvedValue([])
    mockGetForms.mockResolvedValue({ forms: {} })
    mockDocs.clear()
    Object.entries(REPLACED).forEach(([path, data]) => mockDocs.set(path, data))
    mockGetAll.mockReset()
    mockGetAll.mockImplementation(async (...args: unknown[]) =>
      pathsRead(args).map((path) => {
        const data = mockDocs.get(path)
        return { exists: data !== undefined, get: (field: string) => data?.[field] }
      }),
    )
  })

  it("ships the replaced image's shape and the replaced film's facts, not the pick's", async () => {
    const nodes = await compose(PHOTO_AND_FILM)
    expect(placed(nodes, PHOTO)).toEqual({
      ...PICKED_PHOTO,
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
    expect(placed(nodes, FILM)).toMatchObject({
      durationSeconds: 3,
      intrinsicWidth: 480,
      intrinsicHeight: 480,
      posterFromSource: true,
    })
  })

  it('publishes the VideoObject from what it ships', async () => {
    const nodes = await compose(PHOTO_AND_FILM)
    expect(
      pageVideoObjects(nodes, { origin: 'https://acme.example', hostId: 'site1' }),
    ).toEqual([expect.objectContaining({ duration: 'PT3S' })])
  })

  it("answers the screen's film and image and the layout's logo with ONE query", async () => {
    mockGetPublishedLayoutVersion.mockResolvedValue({
      version: { nodes: LAYOUT_PLACING_LOGO },
      layout: {},
    })
    const nodes = await compose(PHOTO_AND_FILM, 'layout-1')
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(pathsRead(mockGetAll.mock.calls[0]).sort()).toEqual([
      'hosts/site1/media/film',
      'hosts/site1/media/logo',
      'hosts/site1/media/photo',
    ])
    expect(placed(nodes, LOGO)).toMatchObject({ intrinsicWidth: 290, intrinsicHeight: 88 })
    expect(placed(nodes, PHOTO)).toMatchObject({ intrinsicWidth: 480 })
    expect(placed(nodes, FILM)).toMatchObject({ durationSeconds: 3 })
  })

  it('ships every stored value when the read fails', async () => {
    mockGetAll.mockRejectedValue(new Error('unavailable'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const nodes = await compose(PHOTO_AND_FILM)
      expect(placed(nodes, PHOTO)).toEqual(PICKED_PHOTO)
      expect(placed(nodes, FILM)).toEqual(PICKED_FILM)
    } finally {
      logged.mockRestore()
    }
  })

  it('reads at most the cap, films first then images from the top, and keeps the pick on the rest', async () => {
    const count = MEDIA_ASSET_FACTS_PER_RENDER + 2
    const ids = Array.from({ length: count }, (_, index) => `photo${index}`)
    // The map lists the photos in reverse and the film sits at the bottom of
    // the document, so neither the map's order nor the page's alone decides
    // which documents are read.
    const screen: Record<string, unknown> = {}
    for (const id of [...ids].reverse()) {
      screen[id] = {
        $id: id,
        componentId: 'image',
        parentId: ROOT,
        props: { src: `media:site1/${id}`, intrinsicWidth: 1200, intrinsicHeight: 630 },
      }
      mockDocs.set(`hosts/site1/media/${id}`, { width: 480, height: 480 })
    }
    screen['tour'] = { $id: 'tour', componentId: 'video', parentId: ROOT, props: PICKED_FILM }
    screen[ROOT] = { $id: ROOT, componentId: 'div', nodes: [...ids, 'tour'] }

    const nodes = await compose(screen)

    expect(mockGetAll).toHaveBeenCalledTimes(1)
    const answered = ids.slice(0, MEDIA_ASSET_FACTS_PER_RENDER - 1)
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual([
      'hosts/site1/media/film',
      ...answered.map((id) => `hosts/site1/media/${id}`),
    ])
    expect(placed(nodes, FILM)).toMatchObject({ durationSeconds: 3 })
    for (const id of answered) {
      expect(placed(nodes, `media:site1/${id}`)).toMatchObject({ intrinsicWidth: 480 })
    }
    for (const id of ids.slice(MEDIA_ASSET_FACTS_PER_RENDER - 1)) {
      expect(placed(nodes, `media:site1/${id}`)).toMatchObject({
        intrinsicWidth: 1200,
        intrinsicHeight: 630,
      })
    }
  })

  it('reads nothing for a page that places no library asset', async () => {
    await compose(
      screenPlacing({
        still: { componentId: 'image', props: { src: 'https://images.example.com/x.png' } },
        clip: { componentId: 'video', props: { src: 'https://videos.example.com/x.mp4' } },
      }),
    )
    await compose({ [ROOT]: { $id: ROOT, componentId: 'div', nodes: [] } })
    expect(mockGetAll).not.toHaveBeenCalled()
  })
})
