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

import * as Aglyn from '@aglyn/aglyn'
import { recordCanvasRenderedWidths } from './record-canvas-rendered-widths'

const fill = (props: Record<string, Record<string, unknown>>) =>
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      type: Aglyn.NodeType.NODE,
      componentId: 'box',
      nodes: Object.keys(props),
    },
    ...Object.fromEntries(
      Object.entries(props).map(([id, nodeProps]) => [
        id,
        {
          $id: id,
          type: Aglyn.NodeType.NODE,
          parentId: Aglyn.NODE_ROOT_ID,
          componentId: 'image',
          props: nodeProps,
        },
      ]),
    ),
  } as never)

const propsOf = (id: string) =>
  (Aglyn.canvas.toJSON().nodes as Record<string, { props?: any }>)[id]?.props

afterEach(() => {
  Aglyn.canvas.clearNodes()
  Aglyn.clearRecordedRenderedWidths()
})

describe('recordCanvasRenderedWidths (AGL-3485)', () => {
  it('writes what the canvas measured onto the node, keeping its other props', () => {
    fill({ hero: { src: 'media:site/a', renderedWidths: { xs: 100 } } })
    Aglyn.recordRenderedWidth('hero', 'lg', 62.5)
    expect(recordCanvasRenderedWidths(Aglyn.canvas)).toBe(1)
    expect(propsOf('hero')).toEqual({
      src: 'media:site/a',
      renderedWidths: { xs: 100, lg: 62.5 },
    })
  })

  it('leaves a node alone when nothing moved past the tolerance', () => {
    fill({ hero: { src: 'x', renderedWidths: { lg: 62.5 } } })
    Aglyn.recordRenderedWidth('hero', 'lg', 62.7)
    expect(recordCanvasRenderedWidths(Aglyn.canvas)).toBe(0)
  })

  it("ignores a recording for a node this canvas does not hold", () => {
    fill({ hero: { src: 'x' } })
    Aglyn.recordRenderedWidth('layout__logo', 'lg', 5)
    expect(recordCanvasRenderedWidths(Aglyn.canvas)).toBe(0)
  })

  it('reads its measurements from any source it is handed', () => {
    fill({ card: { src: 'x' } })
    const written = recordCanvasRenderedWidths(Aglyn.canvas, {
      nodeIds: () => ['card'],
      widthsFor: () => ({ md: 33.3 }),
    })
    expect(written).toBe(1)
    expect(propsOf('card')?.renderedWidths).toEqual({ md: 33.3 })
  })
})
