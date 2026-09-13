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
 * A COMPONENT PROPERTY DRIVES A NON-TEXT FIELD, ON THE PUBLISHED PAGE
 * (AGL-2871).
 *
 * Inside a reusable component a field with no text box can be bound to one of
 * the component's properties, and each page that places the component sets
 * the value. The graft is unit-tested beside itself;
 * what only this can see is the rest of the tenant pipeline running after it —
 * repeatables, bindings, host tokens, denormalizing — any stage of which could
 * turn a real `false` back into text or drop the value on the floor before the
 * element reads it.
 *
 * So the fixtures run through `composeNodesWithChrome`, the function every
 * published page is composed by, with only its reads stubbed.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetComponents = jest.fn()
const mockGetVariables = jest.fn()
const mockGetFunctions = jest.fn()
const mockGetDatasets = jest.fn()
const mockGetWorkflows = jest.fn()
const mockGetPluginInstalls = jest.fn()
const mockGetForms = jest.fn()

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

import { composeNodesWithChrome } from './compose-screen-nodes'

const ROOT = '_@_'

/**
 * The marketing hero film: its player opens in a lightbox or plays in place,
 * and shows or hides the browser controls, per placement.
 */
const HERO_FILM = {
  rootId: 'f-root',
  nodes: {
    'f-root': { $id: 'f-root', componentId: 'muiStack', nodes: ['f-video'] },
    'f-video': {
      $id: 'f-video',
      componentId: 'video',
      parentId: 'f-root',
      props: {
        src: 'https://cdn.example.com/hero.mp4',
        poster: 'https://cdn.example.com/hero.jpg',
        lightbox: '{{prop.playInLightbox}}',
        controls: '{{prop.showControls}}',
      },
    },
  },
  props: [
    { name: 'playInLightbox', type: 'boolean', label: 'Play in a lightbox' },
    { name: 'showControls', type: 'boolean', defaultValue: 'true' },
  ],
}

/** A page placing the film once, with whatever this page chose. */
const pagePlacingFilm = (propValues?: Record<string, unknown>) => ({
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero'] },
  hero: {
    $id: 'hero',
    componentId: 'reusableInstance',
    parentId: ROOT,
    props: { refId: 'heroFilm', ...(propValues ? { propValues } : {}) },
    nodes: [],
  },
})

const compose = (screenNodes: Record<string, unknown>) =>
  composeNodesWithChrome({ hostId: 'h1', screenNodes: screenNodes as never })

/** The film's player as the page ships it. */
const video = (nodes: Record<string, any>) => nodes['cmp__hero__f-video']

describe('component properties driving non-text fields on the published page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPublishedLayoutVersion.mockResolvedValue({
      version: { nodes: {} },
      layout: {},
    })
    mockGetComponents.mockResolvedValue({
      definitions: { heroFilm: HERO_FILM },
    })
    mockGetVariables.mockResolvedValue([])
    mockGetFunctions.mockResolvedValue([])
    mockGetDatasets.mockResolvedValue([])
    mockGetWorkflows.mockResolvedValue([])
    mockGetPluginInstalls.mockResolvedValue([])
    mockGetForms.mockResolvedValue({ forms: {} })
  })

  describe('a switch bound to a Yes / no property', () => {
    it('reaches the element as a real boolean, whichever way the page set it', async () => {
      const lightbox = video(await compose(pagePlacingFilm({ playInLightbox: true })))
      expect(lightbox.props.lightbox).toBe(true)

      // The string a checkbox round-tripped through text can arrive as. As a
      // string it is non-empty, which the player would read as "open in a
      // lightbox".
      const inPlace = video(
        await compose(pagePlacingFilm({ playInLightbox: 'false' })),
      )
      expect(inPlace.props.lightbox).toBe(false)
    })

    it("uses the property's default where the page chose nothing", async () => {
      const unset = video(await compose(pagePlacingFilm()))
      expect(unset.props.controls).toBe(true)
      // No default declared: a Yes / no nobody set is a no.
      expect(unset.props.lightbox).toBe(false)

      const hidden = video(
        await compose(pagePlacingFilm({ showControls: false })),
      )
      expect(hidden.props.controls).toBe(false)
    })

    it('keeps every value the component set for itself', async () => {
      const shipped = video(await compose(pagePlacingFilm({ playInLightbox: true })))
      expect(shipped.props).toMatchObject({
        src: 'https://cdn.example.com/hero.mp4',
        poster: 'https://cdn.example.com/hero.jpg',
      })
    })
  })
})
