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
 * THE SOCIAL CARD'S ASSETS ARE READ WITH THE PAGE (AGL-2850).
 *
 * A page's head shares a card whose reference is stored beside the pixel pair
 * its picker copied. The composition already reads the documents of the images
 * and films the page places in one projected batch, so the card's references
 * join that batch rather than cost a read of their own. The reader is the real
 * one and only Firestore is stubbed, so the queries counted here are the
 * queries a page issues.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()
const mockGetScreenVersion = jest.fn()
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
  default: (...a: unknown[]) => mockGetScreenVersion(...a),
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

import composeScreenNodes, { composeNodesWithChrome } from './compose-screen-nodes'
import { MEDIA_ASSET_FACTS_PER_RENDER } from './get-media-asset-facts'

const ROOT = '_@_'
const PHOTO = 'media:site1/photo'
const SCREEN_CARD = 'media:site1/screen-card'
const HOST_CARD = 'media:site1/host-card'

/** The documents after a replace: each card and the photo changed shape. */
const REPLACED: Record<string, Record<string, unknown>> = {
  'hosts/site1/media/photo': { width: 480, height: 480 },
  'hosts/site1/media/screen-card': { width: 1080, height: 1080 },
  'hosts/site1/media/host-card': { width: 1600, height: 900 },
  // An SVG: the upload could measure nothing.
  'hosts/site1/media/svg-card': {},
}

/** A screen placing the photo as it was first picked. */
const PLACING_PHOTO = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['photo'] },
  photo: {
    $id: 'photo',
    componentId: 'image',
    parentId: ROOT,
    props: { src: PHOTO, intrinsicWidth: 1200, intrinsicHeight: 630 },
  },
}

/** A screen that places no library asset at all. */
const PLACING_NOTHING = { [ROOT]: { $id: ROOT, componentId: 'div', nodes: [] } }

const compose = (
  screenNodes: Record<string, unknown>,
  images: ReadonlyArray<string | null | undefined>,
  onFacts: jest.Mock = jest.fn(),
) =>
  composeNodesWithChrome({
    hostId: 'site1',
    screenNodes: screenNodes as never,
    socialImages: { images, onFacts },
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

describe("a page's social card is read with its placements (AGL-2850)", () => {
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

  it("reads the card's documents in the page's ONE query, ahead of its placements", async () => {
    const onFacts = jest.fn()
    const nodes = await compose(PLACING_PHOTO, [SCREEN_CARD, HOST_CARD], onFacts)
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual([
      'hosts/site1/media/screen-card',
      'hosts/site1/media/host-card',
      'hosts/site1/media/photo',
    ])
    expect(onFacts).toHaveBeenCalledTimes(1)
    expect(onFacts).toHaveBeenCalledWith({
      [SCREEN_CARD]: { width: 1080, height: 1080 },
      [HOST_CARD]: { width: 1600, height: 900 },
    })
    // The placement is answered from the same read.
    expect(placed(nodes, PHOTO)).toMatchObject({
      intrinsicWidth: 480,
      intrinsicHeight: 480,
    })
  })

  it('reads the card on a page that places no library asset, in one query', async () => {
    const onFacts = jest.fn()
    await compose(PLACING_NOTHING, [SCREEN_CARD, undefined, ''], onFacts)
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual([
      'hosts/site1/media/screen-card',
    ])
    expect(onFacts).toHaveBeenCalledWith({
      [SCREEN_CARD]: { width: 1080, height: 1080 },
    })
  })

  it('reads a document once when the card and a placement name one asset', async () => {
    const onFacts = jest.fn()
    await compose(PLACING_PHOTO, [PHOTO], onFacts)
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual(['hosts/site1/media/photo'])
    expect(onFacts).toHaveBeenCalledWith({ [PHOTO]: { width: 480, height: 480 } })
  })

  it('reports nothing for a card whose document records no pair', async () => {
    const onFacts = jest.fn()
    const nodes = await compose(PLACING_PHOTO, ['media:site1/svg-card'], onFacts)
    // Read, and found wanting: not skipped.
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(pathsRead(mockGetAll.mock.calls[0])).toContain(
      'hosts/site1/media/svg-card',
    )
    expect(onFacts).not.toHaveBeenCalled()
    expect(placed(nodes, PHOTO)).toMatchObject({ intrinsicWidth: 480 })
  })

  it('reports nothing when the read fails, and the page composes as picked', async () => {
    mockGetAll.mockRejectedValue(new Error('unavailable'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const onFacts = jest.fn()
      const nodes = await compose(PLACING_PHOTO, [SCREEN_CARD], onFacts)
      // The card was in the read that failed.
      expect(pathsRead(mockGetAll.mock.calls[0])).toContain(
        'hosts/site1/media/screen-card',
      )
      expect(onFacts).not.toHaveBeenCalled()
      expect(placed(nodes, PHOTO)).toMatchObject({
        intrinsicWidth: 1200,
        intrinsicHeight: 630,
      })
    } finally {
      logged.mockRestore()
    }
  })

  it("keeps the card's documents inside the cap on a page placing more than it", async () => {
    const ids = Array.from(
      { length: MEDIA_ASSET_FACTS_PER_RENDER + 2 },
      (_, index) => `photo${index}`,
    )
    const screen: Record<string, unknown> = {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ids },
    }
    for (const id of ids) {
      screen[id] = {
        $id: id,
        componentId: 'image',
        parentId: ROOT,
        props: { src: `media:site1/${id}` },
      }
      mockDocs.set(`hosts/site1/media/${id}`, { width: 480, height: 480 })
    }
    const onFacts = jest.fn()
    await compose(screen, [SCREEN_CARD], onFacts)
    const read = pathsRead(mockGetAll.mock.calls[0])
    expect(read).toHaveLength(MEDIA_ASSET_FACTS_PER_RENDER)
    expect(read[0]).toBe('hosts/site1/media/screen-card')
    expect(onFacts).toHaveBeenCalledWith({
      [SCREEN_CARD]: { width: 1080, height: 1080 },
    })
  })

  it('hands the card through composeScreenNodes to the same read', async () => {
    mockGetScreenVersion.mockResolvedValue({ version: { nodes: PLACING_PHOTO } })
    const onFacts = jest.fn()
    await composeScreenNodes({
      hostId: 'site1',
      screenId: 'screen-1',
      screen: { versionId: 'v1' } as never,
      socialImages: { images: [SCREEN_CARD, HOST_CARD], onFacts },
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual([
      'hosts/site1/media/screen-card',
      'hosts/site1/media/host-card',
      'hosts/site1/media/photo',
    ])
    expect(onFacts).toHaveBeenCalledWith({
      [SCREEN_CARD]: { width: 1080, height: 1080 },
      [HOST_CARD]: { width: 1600, height: 900 },
    })
  })

  it('reads nothing when neither the card nor the tree names a library asset', async () => {
    const onFacts = jest.fn()
    await compose(
      PLACING_NOTHING,
      ['https://images.example.com/card.png', undefined],
      onFacts,
    )
    expect(mockGetAll).not.toHaveBeenCalled()
    expect(onFacts).not.toHaveBeenCalled()
  })

  /**
   * WHAT THE CARD COSTS, COUNTED (AGL-2850).
   *
   * Firestore bills per document, so the cost of describing a card is the
   * number of documents it adds to the read the page already issues, measured
   * against the same page composed without one. The busiest card a surface
   * builds names three references — a collection entry's cover, the template
   * screen's image, the site default — which is the ceiling this counts, and a
   * card naming a picture the page also places adds nothing at all.
   *
   * The queries matter as much as the documents: a card must not turn one
   * round trip into two, which is what a per-node or per-surface read would
   * do on a path that runs at every ISR regeneration.
   */
  it('costs at most three documents and never a second query', async () => {
    const ENTRY_COVER = 'media:site1/entry-cover'
    mockDocs.set(`hosts/site1/media/entry-cover`, { width: 1400, height: 700 })
    const cost = async (images: ReadonlyArray<string | null | undefined>) => {
      mockGetAll.mockClear()
      await compose(PLACING_PHOTO, images)
      return {
        queries: mockGetAll.mock.calls.length,
        documents: pathsRead(mockGetAll.mock.calls[0] ?? []).length,
      }
    }
    const withoutCard = await cost([])
    expect(withoutCard).toEqual({ queries: 1, documents: 1 })
    // The busiest card: an entry's cover, the template's image, the default.
    expect(await cost([ENTRY_COVER, SCREEN_CARD, HOST_CARD])).toEqual({
      queries: 1,
      documents: withoutCard.documents + 3,
    })
    // A card that IS one of the page's own pictures is already in the read.
    expect(await cost([PHOTO])).toEqual(withoutCard)
  })
})
