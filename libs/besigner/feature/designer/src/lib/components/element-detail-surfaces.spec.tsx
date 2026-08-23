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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import ComponentAccordionList from './component-accordion-list'
import ComponentPicker from './component-picker'

const theme = consoleThemeCssVar

const HOLDER_ID = 'surfaces-holder'
const ONLY_CHILD_ID = 'surfaces-only-child'
const PLAIN_ID = 'surfaces-plain'

const COMPONENTS: any[] = [
  {
    $id: HOLDER_ID,
    pluginId: 'mui',
    displayName: 'Surfaces Holder',
    description: 'A holder that only takes one kind of child.',
    category: Aglyn.ComponentCategory.SURFACE,
    restrictChildren: [
      Aglyn.LinealDirectiveFlag.LIMIT_TO,
      { components: [ONLY_CHILD_ID] },
    ],
  },
  {
    $id: ONLY_CHILD_ID,
    pluginId: 'mui',
    displayName: 'Surfaces Only Child',
    category: Aglyn.ComponentCategory.SURFACE,
  },
  {
    $id: PLAIN_ID,
    pluginId: 'mui',
    displayName: 'Surfaces Plain',
    category: Aglyn.ComponentCategory.LAYOUT,
  },
]

/** The picker lists PRESETS, so each component gets one. */
const PRESETS = COMPONENTS.map((schema) => ({
  $id: `${schema.$id}-preset`,
  type: Aglyn.NodeType.PRESET,
  displayName: schema.displayName,
  description: schema.description,
  category: schema.category,
  data: { $id: null, componentId: schema.$id, props: {} },
}))

const cardFor = (name: string) =>
  Array.from(document.querySelectorAll('.MuiCard-root')).find(
    (card) => (card.textContent || '').trim() === name,
  ) as HTMLElement

const details = () =>
  Array.from(document.querySelectorAll('[data-testid="element-detail"]'))

const renderPanel = () =>
  render(
    <ThemeProvider theme={theme}>
      <DndContext>
        <ComponentAccordionList />
      </DndContext>
    </ThemeProvider>,
  )

describe('element detail in both picker surfaces (AGL-2486)', () => {
  beforeAll(() => {
    COMPONENTS.forEach((schema) =>
      Aglyn.components.registerComponent((() => null) as any, schema),
    )
  })
  beforeEach(() => Aglyn.components.registerPreset(PRESETS as any))
  afterEach(() => {
    cleanup()
    Aglyn.components.unregisterPreset(PRESETS.map((p) => p.$id) as any)
  })

  describe('the Choose element dialog', () => {
    it('shows real detail on selecting, before Confirm', () => {
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      // Nothing selected: no detail, and no Confirm to press.
      expect(details().length).toBe(0)

      fireEvent.click(cardFor('Surfaces Holder'))

      // The authored line...
      expect(
        screen.getByText('A holder that only takes one kind of child.'),
      ).toBeTruthy()
      // ...and a fact nobody wrote, read off restrictChildren.
      expect(screen.getByText('Only accepts Surfaces Only Child')).toBeTruthy()
      // All of it BEFORE the commit.
      expect(screen.getByText('Confirm')).toBeTruthy()
    })

    it('shows derived facts for an element with no prose at all', () => {
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      fireEvent.click(cardFor('Surfaces Plain'))
      expect(details().length).toBe(1)
      expect(screen.getByText('Holds other elements')).toBeTruthy()
    })

    it('links to the catalog section for the element category', () => {
      render(
        <ThemeProvider theme={theme}>
          <ComponentPicker open />
        </ThemeProvider>,
      )
      fireEvent.click(cardFor('Surfaces Plain'))
      const link = screen.getByText('Learn more') as HTMLAnchorElement
      expect(link.getAttribute('href')).toContain(
        '/building-sites/besigner/element-catalog',
      )
      // Layout category → the catalog's Layout section, derived not mapped.
      expect(link.getAttribute('href')).toContain('#layout')
    })
  })

  describe('the Elements panel', () => {
    it('shows the same detail on hover', () => {
      renderPanel()
      expect(details().length).toBe(0)

      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      expect(screen.getByText('Only accepts Surfaces Only Child')).toBeTruthy()
    })

    it('keeps exactly one detail open across several hovers', () => {
      renderPanel()
      fireEvent.mouseEnter(cardFor('Surfaces Holder').parentElement)
      fireEvent.mouseEnter(cardFor('Surfaces Plain').parentElement)
      fireEvent.mouseEnter(cardFor('Surfaces Only Child').parentElement)
      // The bug this design avoids: several tips open at once.
      expect(details().length).toBe(1)
    })

    it('never puts the detail region inside the grid it describes', () => {
      renderPanel()
      const card = cardFor('Surfaces Holder')
      fireEvent.mouseEnter(card.parentElement)
      const region = details()[0]
      // A region that does not CONTAIN the cards cannot cover one or
      // swallow the click meant for it — the structural version of the
      // "tooltips blocked clicks" failure.
      expect(region.contains(card)).toBe(false)
      expect(card.contains(region)).toBe(false)
    })

    it('pins on click and unpins on clicking the same card again', () => {
      renderPanel()
      const holder = cardFor('Surfaces Holder')
      fireEvent.click(holder.parentElement)
      // Pinned: moving the pointer away leaves it up.
      fireEvent.mouseLeave(holder.parentElement)
      expect(screen.getByText('Only accepts Surfaces Only Child')).toBeTruthy()

      fireEvent.click(cardFor('Surfaces Holder').parentElement)
      fireEvent.mouseLeave(cardFor('Surfaces Holder').parentElement)
      expect(details().length).toBe(0)
    })
  })
})
