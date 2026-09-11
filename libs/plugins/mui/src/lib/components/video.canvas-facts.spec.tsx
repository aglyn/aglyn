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
 * The besigner canvas draws a replaced film the way the published page does
 * (AGL-2838).
 *
 * The page lays the asset's current records over the Video node when it is
 * composed (AGL-2807). These render the canvas's own leaf, `NodeLeaf`, around
 * the real Video element, and answer the film's document the way the console
 * does once `/api/media/replace` has rewritten it. The player's box and its
 * poster have to follow the replacement, and have to stay on what the pick
 * stored while nothing has answered or the read has failed.
 */

import * as Aglyn from '@aglyn/aglyn'
import NodeLeaf from '@aglyn/besigner-ui/components/node-leaf'
import ComponentPromotionContext from '@aglyn/besigner-ui/contexts/component-promotion-context'
import {
  createVideoAssetFactsStore,
  VideoAssetFactsContext,
  type VideoAssetFactsStore,
} from '@aglyn/besigner-ui/contexts/video-asset-facts-context'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import Video, { schema } from './video'

const KEY = 'org:acme/film'

/** What the pick copied onto the node from the film as first uploaded. */
const PICKED: Record<string, unknown> = {
  src: 'media:org:acme/film',
  title: 'The tour',
  durationSeconds: 2,
  intrinsicWidth: 640,
  intrinsicHeight: 360,
  posterFromSource: true,
}

/** The replacement's records, as `/api/media/replace` writes them. */
const REPLACED = {
  video: { durationMs: 3000, width: 480, height: 480 },
  poster: { width: 480, height: 480, variants: [320] },
}

const filmNode = () =>
  ({
    $id: 'film-node',
    type: 'node',
    componentId: 'video',
    props: { ...PICKED },
    nodes: [],
  }) as never

/**
 * The emotion rules scoped to an element's classes, whitespace-stripped.
 * Emotion inserts rules through `insertRule`, so they exist only in the CSSOM.
 */
const cssFor = (element: Element): string => {
  const classes = Array.from(element.classList)
  return Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
      } catch {
        return []
      }
    })
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((name) => text.includes(name)))
    .join('\n')
    .replace(/\s/g, '')
}

/** The player's reserved box, as the CSS `aspect-ratio` it was given. */
const boxOf = (element: Element | null) =>
  element ? cssFor(element).match(/aspect-ratio:([^;}]+)/)?.[1] : undefined

const player = (root: ParentNode = document) =>
  root.querySelector('video') as HTMLVideoElement

const onCanvas = (store: VideoAssetFactsStore | undefined, child: ReactNode) =>
  render(
    <VideoAssetFactsContext.Provider value={store}>
      {child}
    </VideoAssetFactsContext.Provider>,
  )

beforeAll(() => {
  Aglyn.components.registerComponent(Video as never, schema as never)
})

afterAll(() => {
  Aglyn.components.unregisterComponent('video')
})

describe('a replaced film on the besigner canvas (AGL-2838)', () => {
  it("draws the pick's shape and poster while nothing has answered for the film", () => {
    const store = createVideoAssetFactsStore()
    onCanvas(store, <NodeLeaf node={filmNode()} />)
    expect(boxOf(player())).toBe('640/360')
    expect(player().getAttribute('poster')).toContain('poster=1')
    // The canvas asked for the film it is drawing.
    expect(store.getRetained()).toEqual([{ scope: 'org:acme', mediaId: 'film' }])
  })

  it("follows a replace to the new film's frame", () => {
    const store = createVideoAssetFactsStore()
    onCanvas(store, <NodeLeaf node={filmNode()} />)
    act(() => store.set(KEY, REPLACED))
    expect(boxOf(player())).toBe('480/480')
    expect(player().getAttribute('poster')).toContain('poster=1')
  })

  it('stops showing a generated poster the replacement no longer has', () => {
    const store = createVideoAssetFactsStore()
    onCanvas(store, <NodeLeaf node={filmNode()} />)
    act(() => store.set(KEY, { video: REPLACED.video }))
    expect(boxOf(player())).toBe('480/480')
    // The pick vouched for a poster; the asset no longer does, so the canvas
    // does not draw one the published page would not ship either.
    expect(player().hasAttribute('poster')).toBe(false)
  })

  it("returns to the pick's values when the answer is withdrawn", () => {
    const store = createVideoAssetFactsStore()
    onCanvas(store, <NodeLeaf node={filmNode()} />)
    act(() => store.set(KEY, REPLACED))
    act(() => store.set(KEY, undefined))
    expect(boxOf(player())).toBe('640/360')
    expect(player().getAttribute('poster')).toContain('poster=1')
  })

  it('draws the replacement without writing it into the node', () => {
    const store = createVideoAssetFactsStore()
    const node = filmNode() as { props: Record<string, unknown> }
    onCanvas(store, <NodeLeaf node={node as never} />)
    act(() => store.set(KEY, REPLACED))
    expect(boxOf(player())).toBe('480/480')
    expect(node.props).toEqual(PICKED)
  })

  it('lets go of the film once the canvas stops drawing it', () => {
    const store = createVideoAssetFactsStore()
    const { unmount } = onCanvas(store, <NodeLeaf node={filmNode()} />)
    unmount()
    expect(store.getRetained()).toEqual([])
  })

  it('draws a film inside a component instance the same way', () => {
    const store = createVideoAssetFactsStore()
    const definitions = {
      hero: {
        rootId: 'root',
        nodes: {
          root: { $id: 'root', componentId: 'div', nodes: ['clip'] },
          clip: {
            $id: 'clip',
            componentId: 'video',
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
    expect(boxOf(player(preview as ParentNode))).toBe('640/360')
    act(() => store.set(KEY, REPLACED))
    expect(boxOf(player(preview as ParentNode))).toBe('480/480')
  })

  it('negative control: a canvas with no source draws every film as stored', () => {
    onCanvas(undefined, <NodeLeaf node={filmNode()} />)
    expect(boxOf(player())).toBe('640/360')
  })
})
