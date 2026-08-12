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

import { render, screen } from '@testing-library/react'
import ImageListElement, {
  IMAGE_LIST_ID,
  IMAGE_LIST_ITEM_ID,
  ImageListItemElement,
  imageListItemSchema,
  imageListPresets,
  imageListSchema,
  toCount,
} from './image-list'

const tile = (props: Record<string, unknown> = {}) => (
  <ImageListItemElement {...props}>
    <img alt="" src="https://example.test/a.png" />
  </ImageListItemElement>
)

describe('toCount (AGL-1201)', () => {
  it('accepts the string a number field round-trips as', () => {
    expect(toCount('3')).toBe(3)
    expect(toCount(3)).toBe(3)
  })

  it('falls back rather than passing NaN into the grid math', () => {
    expect(toCount('many', 3)).toBe(3)
    expect(toCount('', 3)).toBe(3)
    expect(toCount(null, 3)).toBe(3)
    expect(toCount(-2, 3)).toBe(3)
  })
})

describe('Image List element', () => {
  it('renders its tiles', () => {
    render(<ImageListElement>{tile()}</ImageListElement>)
    expect(document.querySelectorAll('.MuiImageListItem-root')).toHaveLength(1)
  })

  it('forces auto rows on masonry, whatever row height was set', () => {
    // A fixed rowHeight silently defeats the entire masonry variant —
    // every image gets cropped to the same box.
    const { container } = render(
      <ImageListElement variant="masonry" rowHeight={200}>
        {tile()}
      </ImageListElement>,
    )
    const root = container.querySelector('.MuiImageList-masonry') as HTMLElement
    expect(root).toBeTruthy()
    expect(root.style.height).toBe('')
  })

  it('renders a caption bar only when there is caption text', () => {
    const { container, rerender } = render(
      <ImageListElement>{tile()}</ImageListElement>,
    )
    expect(container.querySelector('.MuiImageListItemBar-root')).toBeNull()
    rerender(
      <ImageListElement>{tile({ title: 'Sunset' })}</ImageListElement>,
    )
    expect(screen.getByText('Sunset')).toBeTruthy()
  })
})

describe('Image List schema and presets', () => {
  it('hides row height on masonry, where MUI ignores it', () => {
    const field = imageListSchema.attributes.find(
      (a: any) => a.name === 'rowHeight',
    ) as any
    expect(field.condition).toEqual({
      when: 'variant',
      is: 'masonry',
      notMatch: true,
    })
  })

  it('leaves the tile spans unconditional', () => {
    // The variant that reads them lives on the PARENT list, and a
    // `condition` is evaluated against this node's own attribute form —
    // one referencing `variant` here would hide them permanently.
    for (const name of ['cols', 'rows']) {
      const field = imageListItemSchema.attributes.find(
        (a: any) => a.name === name,
      ) as any
      expect(field.condition).toBeUndefined()
      expect(field.description).toMatch(/Quilted/)
    }
  })

  it('only accepts Image List Items as children', () => {
    expect((imageListSchema as any).restrictChildren[1].components).toEqual([
      IMAGE_LIST_ITEM_ID,
    ])
  })

  it('ships presets whose tiles use the existing Image element', () => {
    // Re-implementing an <img> here would lose the media-CDN srcSet, the
    // lazy loading and the empty-source placeholder (AGL-74/175).
    const gallery = imageListPresets[0].data as any
    expect(gallery.componentId).toBe(IMAGE_LIST_ID)
    expect(gallery.nodes.length).toBeGreaterThan(0)
    for (const item of gallery.nodes) {
      expect(item.componentId).toBe(IMAGE_LIST_ITEM_ID)
      expect(item.nodes[0].componentId).toBe('image')
    }
  })

  it('does not pin a row height on the masonry preset', () => {
    const masonry = imageListPresets[1].data as any
    expect(masonry.props.variant).toBe('masonry')
    expect(masonry.props.rowHeight).toBeUndefined()
  })
})

/** AGL-1451 — cleared values must reach MUI as absences, not as `''`. */
const listRoot = (ui: React.ReactElement): HTMLElement => {
  const { container } = render(ui)
  return container.querySelector('.MuiImageList-root') as HTMLElement
}

describe('Image List drops cleared props before MUI sees them (AGL-1451)', () => {
  it('a cleared variant renders exactly as an absent one', () => {
    const absent = listRoot(<ImageListElement>{tile()}</ImageListElement>)
    for (const cleared of [null, '']) {
      const root = listRoot(
        <ImageListElement variant={cleared as any}>{tile()}</ImageListElement>,
      )
      expect(root.className).toBe(absent.className)
      expect(root.getAttribute('style')).toBe(absent.getAttribute('style'))
    }
  })

  it('and that render is the standard grid, MUI’s own default', () => {
    const root = listRoot(
      <ImageListElement variant={null as any}>{tile()}</ImageListElement>,
    )
    expect(root.className).toMatch(/MuiImageList-standard/)
    expect(root.className).not.toMatch(/MuiImageList-masonry/)
  })

  it('a cleared caption position renders as an absent one', () => {
    const { container: absent } = render(tile({ title: 'A' }))
    const { container: cleared } = render(
      tile({ title: 'A', barPosition: null }),
    )
    expect(cleared.innerHTML).toBe(absent.innerHTML)
    expect(
      absent.querySelector('.MuiImageListItemBar-root')?.className,
    ).toMatch(/positionBottom/)
  })

  // ---- positive controls ----

  it('keeps `gap={0}` — a deliberately gapless grid', () => {
    // The falsy value an author can mean: 0 is a real gap, and MUI's own
    // default is 4, so a guard that ate it would visibly change the page.
    const root = listRoot(
      <ImageListElement gap={0}>{tile()}</ImageListElement>,
    )
    expect(root.getAttribute('style')).toContain('gap: 0;')
    // and not the 4px MUI would have applied had the 0 been eaten
    expect(root.getAttribute('style')).not.toContain('gap: 4px')
  })

  it('keeps an explicit variant', () => {
    const root = listRoot(
      <ImageListElement variant="masonry">{tile()}</ImageListElement>,
    )
    expect(root.className).toMatch(/MuiImageList-masonry/)
  })
})

describe('Image List option values (AGL-1451)', () => {
  const every = [
    ...(imageListSchema.attributes ?? []),
    ...(imageListItemSchema.attributes ?? []),
  ]

  it('never offers a value the attributes form cannot persist', () => {
    for (const attribute of every) {
      for (const option of (attribute as any).options ?? []) {
        expect(option.value).not.toBe('')
        expect(option.value).not.toBeNull()
        expect(option.value).not.toBeUndefined()
      }
    }
  })

  it('names MUI’s own defaults rather than dropping the options', () => {
    const variant = (imageListSchema.attributes ?? []).find(
      (a: any) => a.name === 'variant',
    ) as any
    const bar = (imageListItemSchema.attributes ?? []).find(
      (a: any) => a.name === 'barPosition',
    ) as any
    expect(variant.options[0].value).toBe('standard')
    expect(bar.options[0].value).toBe('bottom')
  })
})
