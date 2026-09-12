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
 * The besigner canvas reserves a replaced image's box the way the published
 * page does (AGL-2856).
 *
 * The page lays the asset's current pixel pair over the Image node when it is
 * composed (AGL-2833), and the `<img>` reserves its box from that pair. These
 * render the canvas's own leaf, `NodeLeaf`, around the real Image element, and
 * answer the image's document the way the console does once
 * `/api/media/replace` has rewritten it. The reserved box has to follow the
 * replacement, and has to stay on what the pick stored while nothing has
 * answered, the read has failed, or the asset measures no pair at all.
 */

import * as Aglyn from '@aglyn/aglyn'
import NodeLeaf from '@aglyn/besigner-ui/components/node-leaf'
import ComponentPromotionContext from '@aglyn/besigner-ui/contexts/component-promotion-context'
import {
  createMediaAssetFactsStore,
  MediaAssetFactsContext,
  type MediaAssetFactsStore,
} from '@aglyn/besigner-ui/contexts/media-asset-facts-context'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import Image, { schema } from './image'

const KEY = 'org:acme/photo'

/** What the pick copied onto the node from the photo as first uploaded. */
const PICKED: Record<string, unknown> = {
  src: 'media:org:acme/photo',
  alt: 'The pipeline board',
  intrinsicWidth: 1200,
  intrinsicHeight: 630,
}

/** The replacement's document, as `/api/media/replace` measured it: a square. */
const REPLACED = { width: 480, height: 480 }

const photoNode = () =>
  ({
    $id: 'photo-node',
    type: 'node',
    componentId: 'image',
    props: { ...PICKED },
    nodes: [],
  }) as never

/** The box the `<img>` reserves: its intrinsic attribute pair. */
const boxOf = (element: Element | null) =>
  element
    ? `${element.getAttribute('width')}x${element.getAttribute('height')}`
    : undefined

const picture = (root: ParentNode = document) => root.querySelector('img')

const onCanvas = (store: MediaAssetFactsStore | undefined, child: ReactNode) =>
  render(
    <MediaAssetFactsContext.Provider value={store}>
      {child}
    </MediaAssetFactsContext.Provider>,
  )

beforeAll(() => {
  Aglyn.components.registerComponent(Image as never, schema as never)
})

afterAll(() => {
  Aglyn.components.unregisterComponent('image')
})

describe('a replaced image on the besigner canvas (AGL-2856)', () => {
  it("reserves the pick's box while nothing has answered for the image", () => {
    const store = createMediaAssetFactsStore()
    onCanvas(store, <NodeLeaf node={photoNode()} />)
    expect(boxOf(picture())).toBe('1200x630')
    // The canvas asked for the image it is drawing.
    expect(store.getRetained()).toEqual([{ scope: 'org:acme', mediaId: 'photo' }])
  })

  it("follows a replace to the new image's shape", () => {
    const store = createMediaAssetFactsStore()
    onCanvas(store, <NodeLeaf node={photoNode()} />)
    act(() => store.set(KEY, REPLACED))
    expect(boxOf(picture())).toBe('480x480')
  })

  it('keeps the stored pair for an asset that measures none, as the page does', () => {
    // An SVG, or a file older than dimension capture: the page keeps the
    // stored reservation rather than dropping it, so the canvas does too.
    const store = createMediaAssetFactsStore()
    onCanvas(store, <NodeLeaf node={photoNode()} />)
    act(() => store.set(KEY, {}))
    expect(boxOf(picture())).toBe('1200x630')
  })

  it("returns to the pick's box when the answer is withdrawn", () => {
    const store = createMediaAssetFactsStore()
    onCanvas(store, <NodeLeaf node={photoNode()} />)
    act(() => store.set(KEY, REPLACED))
    act(() => store.set(KEY, undefined))
    expect(boxOf(picture())).toBe('1200x630')
  })

  it('draws the replacement without writing it into the node', () => {
    const store = createMediaAssetFactsStore()
    const node = photoNode() as { props: Record<string, unknown> }
    onCanvas(store, <NodeLeaf node={node as never} />)
    act(() => store.set(KEY, REPLACED))
    expect(boxOf(picture())).toBe('480x480')
    expect(node.props).toEqual(PICKED)
  })

  it('reserves an image inside a component instance the same way', () => {
    const store = createMediaAssetFactsStore()
    const definitions = {
      hero: {
        rootId: 'root',
        nodes: {
          root: { $id: 'root', componentId: 'div', nodes: ['still'] },
          still: {
            $id: 'still',
            componentId: 'image',
            parentId: 'root',
            props: { ...PICKED },
            nodes: [],
          },
        },
      },
    }
    const instance = {
      $id: 'inst1',
      type: 'node',
      componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
      props: { refId: 'hero' },
      nodes: [],
    }
    const { baseElement } = onCanvas(
      store,
      <ComponentPromotionContext.Provider value={{ definitions } as never}>
        <NodeLeaf node={instance as never} />
      </ComponentPromotionContext.Provider>,
    )
    const preview = baseElement.querySelector('[data-aglyn-component-preview]')
    expect(boxOf(picture(preview as ParentNode))).toBe('1200x630')
    act(() => store.set(KEY, REPLACED))
    expect(boxOf(picture(preview as ParentNode))).toBe('480x480')
  })

  it('negative control: a canvas with no source draws every image as stored', () => {
    onCanvas(undefined, <NodeLeaf node={photoNode()} />)
    expect(boxOf(picture())).toBe('1200x630')
  })
})
