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
import CardElement, {
  CARD_ACTIONS_ID,
  CARD_CONTENT_ID,
  CARD_HEADER_ID,
  CARD_ID,
  CardHeaderElement,
  cardPresets,
  cardSchema,
} from './card'

/** Every node id in a preset subtree. */
const componentIds = (node: any): string[] => [
  node.componentId,
  ...(node.nodes ?? []).flatMap(componentIds),
]

describe('Card element (AGL-1201)', () => {
  it('gives a string elevation a real shadow', () => {
    const { container } = render(
      <CardElement elevation={'4' as any}>{'Body'}</CardElement>,
    )
    expect(
      (container.querySelector('.MuiPaper-root') as HTMLElement).className,
    ).toMatch(/MuiPaper-elevation4/)
  })

  it('drops the elevation on the outlined variant', () => {
    const { container } = render(
      <CardElement variant="outlined" elevation={8}>
        {'Body'}
      </CardElement>,
    )
    const root = container.querySelector('.MuiPaper-root') as HTMLElement
    expect(root.className).toMatch(/MuiPaper-outlined/)
    expect(root.className).not.toMatch(/MuiPaper-elevation8/)
  })

  it('hides the elevation control where it does nothing', () => {
    const field = cardSchema.attributes.find((a: any) => a.name === 'elevation')
    expect((field as any).condition).toEqual({
      when: 'variant',
      is: 'outlined',
      notMatch: true,
    })
  })
})

describe('Card Header', () => {
  it('renders the title and subheader as separate lines', () => {
    render(<CardHeaderElement title="Title" subheader="Sub" />)
    expect(screen.getByText('Title')).toBeTruthy()
    expect(screen.getByText('Sub')).toBeTruthy()
  })

  it('stays visible and selectable when nothing is filled in yet', () => {
    // An empty header renders zero-height, which makes the node
    // unclickable on the canvas the moment it is added.
    render(<CardHeaderElement />)
    expect(screen.getByText('Card title')).toBeTruthy()
  })

  it('does not force a placeholder title over a subheader-only header', () => {
    render(<CardHeaderElement subheader="Just a subheader" />)
    expect(screen.queryByText('Card title')).toBeNull()
    expect(screen.getByText('Just a subheader')).toBeTruthy()
  })
})

describe('Card presets', () => {
  it('drop a complete card, not an empty surface', () => {
    const ids = componentIds(cardPresets[0].data as any)
    expect(ids).toContain(CARD_ID)
    expect(ids).toContain(CARD_HEADER_ID)
    expect(ids).toContain(CARD_CONTENT_ID)
    expect(ids).toContain(CARD_ACTIONS_ID)
  })

  it('use the existing Image element rather than a second implementation', () => {
    // The Image element already carries the media-CDN srcSet, lazy
    // loading and the empty-source placeholder (AGL-74/175).
    expect(componentIds(cardPresets[0].data as any)).toContain('image')
  })

  it('keeps every preset id unique', () => {
    const ids = cardPresets.map((preset) => preset.$id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/** AGL-1451 — see the matching block in `paper.spec.tsx`. */
const cardRoot = (ui: React.ReactElement): HTMLElement => {
  const { container } = render(ui)
  return container.querySelector('.MuiPaper-root') as HTMLElement
}

describe('Card drops cleared props before MUI sees them (AGL-1451)', () => {
  it('a cleared variant renders exactly as an absent one', () => {
    const absent = cardRoot(<CardElement />).className
    expect(cardRoot(<CardElement variant={null as any} />).className).toBe(
      absent,
    )
    expect(cardRoot(<CardElement variant={'' as any} />).className).toBe(absent)
  })

  it('and that render is MUI’s own default: an elevated, rounded card', () => {
    const root = cardRoot(<CardElement variant={null as any} />)
    expect(root.className).toMatch(/MuiPaper-elevation/)
    expect(root.className).not.toMatch(/MuiPaper-outlined/)
  })

  // ---- positive control ----

  it('keeps `elevation={0}` — a deliberately flat card', () => {
    expect(cardRoot(<CardElement elevation={0} />).className).toMatch(
      /MuiPaper-elevation0/,
    )
  })

  it('keeps an explicit outlined variant', () => {
    expect(cardRoot(<CardElement variant="outlined" />).className).toMatch(
      /MuiPaper-outlined/,
    )
  })
})

describe('Card "Variant" options (AGL-1451)', () => {
  const field = (cardSchema.attributes ?? []).find(
    (a: any) => a.name === 'variant',
  ) as any

  it('never offers a value the attributes form cannot persist', () => {
    for (const option of field.options) {
      expect(option.value).not.toBe('')
      expect(option.value).not.toBeNull()
      expect(option.value).not.toBeUndefined()
    }
  })

  it('spells the default as MUI’s own value', () => {
    expect(field.options.map((o: any) => o.value)).toEqual([
      'elevation',
      'outlined',
    ])
  })
})
