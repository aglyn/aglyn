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
 * A PLACED FILM COMPOSES FROM ITS ASSET, NOT FROM ITS PICK (AGL-2807).
 *
 * `composeNodesWithChrome` is the one pipeline every published tree passes
 * through — the page, a lazy panel's patch, an unlocked screen, a collection
 * or author page — so the overlay is pinned HERE, on the tree the page ships:
 * a film the screen places, a film a layout places, a film nobody can answer
 * for, and the `VideoObject` the page derives from what ships.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()
const mockGetVideoAssetFacts = jest.fn()

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
jest.mock('./get-video-asset-facts', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetVideoAssetFacts(...a),
}))

import { pageVideoObjects } from '@aglyn/aglyn/server'
import { composeNodesWithChrome } from './compose-screen-nodes'

const ROOT = '_@_'
const FILM = 'media:site1/film'

/** What a pick of the film as first uploaded copied: 2 s, 640x360, a poster. */
const PICKED = {
  src: FILM,
  title: 'The tour',
  description: 'What the product does.',
  uploadDate: '2026-09-10',
  durationSeconds: 2,
  intrinsicWidth: 640,
  intrinsicHeight: 360,
  posterFromSource: true,
}

/** The replacement's records: 3 s, square, with a regenerated poster. */
const REPLACED = new Map([
  [
    'site1/film',
    {
      video: { durationMs: 3000, width: 480, height: 480 },
      poster: { width: 480, height: 480, variants: [] },
    },
  ],
])

const screenPlacing = (props: Record<string, unknown>) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['tour'] },
  tour: { $id: 'tour', componentId: 'video', parentId: ROOT, props },
})

const EMPTY_SCREEN = { [ROOT]: { $id: ROOT, componentId: 'div', nodes: [] } }

/** A layout that places the film itself, around the slot the screen fills. */
const LAYOUT_PLACING_FILM = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero', 'slot'] },
  hero: { $id: 'hero', componentId: 'video', parentId: ROOT, props: PICKED },
  slot: { $id: 'slot', componentId: 'layoutSlot', parentId: ROOT, nodes: [] },
}

const compose = (screenNodes: Record<string, unknown>, layoutId?: string) =>
  composeNodesWithChrome({
    hostId: 'site1',
    screenNodes: screenNodes as never,
    ...(layoutId ? { layoutId } : {}),
  })

/** The props of every Video node in a composed tree. */
const filmsIn = (nodes: Record<string, any>) =>
  Object.values(nodes)
    .filter((node) => node?.componentId === 'video')
    .map((node) => node.props as Record<string, unknown>)

describe('a placed film composes from its asset (AGL-2807)', () => {
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
    mockGetVideoAssetFacts.mockResolvedValue(REPLACED)
  })

  it("ships the replaced film's length, shape and poster, not the pick's", async () => {
    expect(filmsIn(await compose(screenPlacing(PICKED)))).toEqual([
      expect.objectContaining({
        durationSeconds: 3,
        intrinsicWidth: 480,
        intrinsicHeight: 480,
        posterFromSource: true,
      }),
    ])
  })

  it('publishes the VideoObject from what it ships', async () => {
    const nodes = await compose(screenPlacing(PICKED))
    expect(
      pageVideoObjects(nodes, { origin: 'https://acme.example', hostId: 'site1' }),
    ).toEqual([expect.objectContaining({ duration: 'PT3S' })])
  })

  it('keeps the stored props for a film the reader cannot answer for', async () => {
    mockGetVideoAssetFacts.mockResolvedValue(new Map())
    expect(filmsIn(await compose(screenPlacing(PICKED)))).toEqual([PICKED])
  })

  it("asks about the screen's film once, alongside the chrome reads", async () => {
    await compose(screenPlacing(PICKED))
    expect(mockGetVideoAssetFacts).toHaveBeenCalledTimes(1)
    expect(mockGetVideoAssetFacts).toHaveBeenCalledWith({
      hostId: 'site1',
      refs: [{ scope: 'site1', mediaId: 'film' }],
    })
  })

  it('reaches a film a LAYOUT places, which the screen never names', async () => {
    mockGetPublishedLayoutVersion.mockResolvedValue({
      version: { nodes: LAYOUT_PLACING_FILM },
      layout: {},
    })
    const films = filmsIn(await compose(EMPTY_SCREEN, 'layout-1'))
    expect(films).toEqual([
      expect.objectContaining({ durationSeconds: 3, intrinsicWidth: 480 }),
    ])
    expect(mockGetVideoAssetFacts).toHaveBeenCalledWith({
      hostId: 'site1',
      refs: [{ scope: 'site1', mediaId: 'film' }],
    })
  })

  it('reads nothing for a page that places no library film', async () => {
    const hotlinked = screenPlacing({ src: 'https://videos.example.com/x.mp4' })
    await compose(hotlinked)
    await compose(EMPTY_SCREEN)
    expect(mockGetVideoAssetFacts).not.toHaveBeenCalled()
  })
})
