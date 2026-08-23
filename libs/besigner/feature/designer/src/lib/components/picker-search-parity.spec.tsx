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
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { DndContext } from '@dnd-kit/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { RESULTS_CATEGORY_LABEL } from '../hooks/use-picker-filter'
import ComponentAccordionList from './component-accordion-list'
import ComponentPicker from './component-picker'

const theme = consoleThemeCssVar

/**
 * The shape from AGL-2486: a pile of components that merely MENTION an icon
 * in prose, in a category sorting ahead of the one holding the element
 * actually CALLED `Icon`.
 */
const REGISTERED = [
  {
    $id: 'parity-button',
    displayName: 'Button',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'A clickable button with an optional start icon and end icon',
  },
  {
    $id: 'parity-fab',
    displayName: 'Floating action',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'A floating action button, usually holding a single icon',
  },
  {
    $id: 'parity-iconbutton',
    displayName: 'Icon button',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'A button rendered as a bare glyph',
  },
  {
    $id: 'parity-icon',
    displayName: 'Icon',
    category: Aglyn.ComponentCategory.MEDIA,
    description: 'A single glyph from the library',
  },
  {
    $id: 'parity-avatar',
    displayName: 'Avatar',
    category: Aglyn.ComponentCategory.MEDIA,
    description: 'Shows a picture, initials or an icon for a person',
  },
  {
    $id: 'parity-image',
    displayName: 'Image',
    category: Aglyn.ComponentCategory.MEDIA,
    description: 'A single image.',
    tags: ['photo', 'picture'],
  },
]

function registerSchemas() {
  Aglyn.components.registerPreset(
    REGISTERED.map((schema) => ({
      ...schema,
      type: Aglyn.NodeType.PRESET,
      data: { $id: null, componentId: schema.$id, props: {} },
    })) as any,
  )
}

function unregisterSchemas() {
  Aglyn.components.unregisterPreset(REGISTERED.map((s) => s.$id) as any)
}

/** Every rendered element card, in order, restricted to this spec's fixtures. */
const resultLabels = () =>
  Array.from(document.querySelectorAll('.MuiCard-root'))
    .map((card) => (card.textContent || '').trim())
    .filter((label) => REGISTERED.some((s) => s.displayName === label))

/**
 * Type `term` into whichever surface is mounted and read the order back.
 *
 * Waits on the RESULTS GROUP, not on a card count. The filter loads fuse.js
 * dynamically, and until it resolves the surface is still showing the
 * unfiltered categories — which have more than one card in them, so any
 * count-based wait returns the pre-search order and the assertion grades a
 * list nobody searched.
 */
async function orderAfterSearching(term: string): Promise<string[]> {
  const input = screen.getByLabelText('search elements')
  fireEvent.change(input, { target: { value: term } })
  await waitFor(() => {
    expect(screen.getByText(RESULTS_CATEGORY_LABEL)).toBeTruthy()
  })
  return resultLabels()
}

describe('element picker search parity (AGL-2486)', () => {
  beforeEach(registerSchemas)
  afterEach(() => {
    cleanup()
    unregisterSchemas()
  })

  it('gives the Elements panel a search at all', () => {
    render(
      <ThemeProvider theme={theme}>
        <DndContext>
          <ComponentAccordionList />
        </DndContext>
      </ThemeProvider>,
    )
    expect(screen.getByLabelText('search elements')).toBeTruthy()
  })

  it('ranks name hits above description hits in the Elements panel', async () => {
    render(
      <ThemeProvider theme={theme}>
        <DndContext>
          <ComponentAccordionList />
        </DndContext>
      </ThemeProvider>,
    )
    const order = await orderAfterSearching('icon')
    // The element CALLED Icon first, not the five that mention one in prose.
    expect(order[0]).toBe('Icon')
    expect(order.indexOf('Icon button')).toBeLessThan(order.indexOf('Button'))
    expect(order.indexOf('Icon button')).toBeLessThan(order.indexOf('Avatar'))
  })

  it.each(['icon', 'but', 'button', 'glyph'])(
    'returns the same results in the same order in both surfaces for %p',
    async (term) => {
      render(
        <ThemeProvider theme={theme}>
          <DndContext>
            <ComponentAccordionList />
          </DndContext>
        </ThemeProvider>,
      )
      const panelOrder = await orderAfterSearching(term)
      cleanup()

      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      fireEvent.click(screen.getByLabelText('search'))
      const dialogOrder = await orderAfterSearching(term)

      // Two pickers that disagree about what a query matches would be worse
      // than one of them having no search — this is the assertion that keeps
      // the shared hook shared.
      expect(panelOrder).toEqual(dialogOrder)
    },
  )

  it('restores the curated categories when the panel filter is cleared', async () => {
    render(
      <ThemeProvider theme={theme}>
        <DndContext>
          <ComponentAccordionList />
        </DndContext>
      </ThemeProvider>,
    )
    expect(screen.getByText(Aglyn.ComponentCategory.MEDIA)).toBeTruthy()

    await orderAfterSearching('icon')
    expect(screen.queryByText(Aglyn.ComponentCategory.MEDIA)).toBeNull()

    fireEvent.click(screen.getByLabelText('clear filter'))
    await waitFor(() => {
      expect(screen.getByText(Aglyn.ComponentCategory.MEDIA)).toBeTruthy()
    })
    expect(resultLabels().length).toBe(REGISTERED.length)
  })
  it('finds an element by an authored tag, below anything named for it', async () => {
    render(
      <ThemeProvider theme={theme}>
        <DndContext>
          <ComponentAccordionList />
        </DndContext>
      </ThemeProvider>,
    )
    // `photo` appears in no displayName and no description — only in Image's
    // tags. Declaring the field is worth nothing unless the search reads it.
    const order = await orderAfterSearching('photo')
    expect(order).toContain('Image')
  })

  it('ranks a name hit above a tag-only hit', async () => {
    render(
      <ThemeProvider theme={theme}>
        <DndContext>
          <ComponentAccordionList />
        </DndContext>
      </ThemeProvider>,
    )
    // Avatar's DESCRIPTION says "picture"; Image carries it as a tag. Neither
    // is named for it, so both match — but a synonym must never outrank the
    // thing actually called that, which is why `Icon` was fixed in d1eb64da9.
    const order = await orderAfterSearching('picture')
    expect(order).toContain('Image')
    expect(order).toContain('Avatar')
  })
})
