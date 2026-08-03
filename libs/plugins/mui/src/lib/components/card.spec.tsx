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
