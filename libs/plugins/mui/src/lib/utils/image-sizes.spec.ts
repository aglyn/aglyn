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

import { imageSizes, type LayoutNode, layoutBandWidths } from './image-sizes'

/** A chain of nodes, innermost first, each the parent of the one before. */
const chain = (...nodes: LayoutNode[]): LayoutNode => {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    nodes[index].parent = nodes[index + 1]
  }
  return nodes[0]
}

const sizesFor = (image: LayoutNode, extra: Record<string, unknown> = {}) =>
  imageSizes({ layoutWidths: layoutBandWidths(image), ...extra }).sizes

describe('imageSizes — what the element states (AGL-3485)', () => {
  it('reads a plain number in sx as pixels, as MUI does', () => {
    expect(imageSizes({ sx: { width: 240 } })).toEqual({
      sizes: '240px',
      small: true,
    })
  })

  it('reads a responsive pixel width per band', () => {
    expect(imageSizes({ sx: { width: { xs: 120, md: '320px' } } }).sizes).toBe(
      '(min-width: 900px) 320px, 120px',
    )
  })

  it('turns a responsive pixel height into widths at the asset shape', () => {
    expect(
      imageSizes({
        sx: { height: { xs: 44, md: 56 }, width: 'auto' },
        intrinsicWidth: 1200,
        intrinsicHeight: 986,
      }),
    ).toEqual({ sizes: '(min-width: 900px) 68px, 54px', small: true })
  })

  it('lets the node sx win over the attribute, as the render does', () => {
    expect(imageSizes({ width: '600px', sx: [{ width: 100 }] }).sizes).toBe(
      '100px',
    )
  })

  it('needs width auto to read a height: a 100% box is as wide as its slot', () => {
    expect(
      imageSizes({ sx: { height: 56 }, intrinsicWidth: 2, intrinsicHeight: 1 })
        .sizes,
    ).toBe('100vw')
  })

  it('is not small with no evidence at all', () => {
    expect(imageSizes({})).toEqual({ sizes: '100vw', small: false })
  })
})

describe('layoutBandWidths — what the layout states (AGL-3485)', () => {
  it('caps a full-width image in a Container at its max width less gutters', () => {
    const image = chain(
      { componentId: 'image' },
      { componentId: 'muiContainer', props: { maxWidth: 'md' } },
    )
    expect(sizesFor(image)).toBe(
      '(min-width: 900px) 852px, (min-width: 600px) calc(100vw - 48px), calc(100vw - 32px)',
    )
  })

  it("reads a cleared Container max width as MUI's lg, and false as none", () => {
    const cleared = chain(
      { componentId: 'image' },
      { componentId: 'muiContainer', props: { maxWidth: null } },
    )
    expect(sizesFor(cleared)).toContain('(min-width: 1200px) 1152px')
    const fluid = chain(
      { componentId: 'image' },
      {
        componentId: 'muiContainer',
        props: { maxWidth: false, disableGutters: true },
      },
    )
    expect(sizesFor(fluid)).toBe('100vw')
  })

  it('multiplies a third inside a half', () => {
    const image = chain(
      { componentId: 'image' },
      { componentId: 'muiGrid', props: { size: 4 } },
      { componentId: 'muiGrid', props: { container: true } },
      { componentId: 'muiGrid', props: { size: 'xs:12 md:6' } },
      { componentId: 'muiGrid', props: { container: true } },
    )
    expect(sizesFor(image)).toBe('(min-width: 900px) 16.7vw, 33.3vw')
  })

  it("takes a Grid row's spacing out of each cell", () => {
    const image = chain(
      { componentId: 'image' },
      { componentId: 'muiGrid', props: { size: 6 } },
      { componentId: 'muiGrid', props: { container: true, spacing: 4 } },
    )
    // Half the row less half of one 32px gap.
    expect(sizesFor(image)).toBe('calc(50vw - 16px)')
  })

  it('gives a grid child the tracks it spans', () => {
    const wide: LayoutNode = { componentId: 'muiBox', sx: { gridColumn: 'span 2' } }
    const image = chain(
      { componentId: 'image' },
      wide,
      { componentId: 'muiBox', sx: { gridTemplateColumns: '1fr 1fr 1fr' } },
    )
    expect(sizesFor(image)).toBe('66.7vw')
  })

  it('shrinks by a share width or max width and caps by a pixel one', () => {
    expect(
      sizesFor(
        chain(
          { componentId: 'image' },
          { componentId: 'muiStack', sx: { maxWidth: { md: '75%' } } },
        ),
      ),
    ).toBe('(min-width: 900px) 75vw, 100vw')
    expect(
      sizesFor(
        chain(
          { componentId: 'image', sx: { maxWidth: 400 } },
          { componentId: 'muiBox', sx: { width: 0.5 } },
        ),
      ),
    ).toBe('(min-width: 900px) 400px, 50vw')
  })

  it('knows nothing of a page with nothing stated', () => {
    expect(
      layoutBandWidths(chain({ componentId: 'image' }, { componentId: 'muiBox' })),
    ).toEqual({})
  })
})

describe('layoutBandWidths — a parent chain that loops (AGL-3565)', () => {
  it('terminates when the root is its own parent, as stored pages are', () => {
    const root: LayoutNode = { componentId: 'div' }
    root.parent = root
    const box: LayoutNode = {
      componentId: 'muiBox',
      sx: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' },
      parent: root,
    }
    const image: LayoutNode = { componentId: 'image', parent: box }
    expect(layoutBandWidths(image)).toEqual(
      layoutBandWidths({ componentId: 'image', parent: { ...box, parent: undefined } }),
    )
  })

  it('terminates on a longer cycle too', () => {
    const a: LayoutNode = { componentId: 'muiBox' }
    const b: LayoutNode = { componentId: 'muiBox', parent: a }
    a.parent = b
    expect(() => layoutBandWidths({ componentId: 'image', parent: a })).not.toThrow()
  })
})
