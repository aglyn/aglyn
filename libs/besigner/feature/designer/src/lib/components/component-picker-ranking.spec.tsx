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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ComponentPicker from './component-picker'

// The theme the editor actually runs, so `palette.surface` and the CSS
// variable channels the tree and the picker read are the real ones.
const theme = consoleThemeCssVar

/**
 * The shape that produced the report: a pile of components that merely
 * MENTION an icon in prose, sitting in a category that sorts ahead of the
 * one holding the element actually called `Icon`.
 */
const REGISTERED = [
  {
    $id: 'spec-button',
    displayName: 'Button',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'A clickable button with an optional start icon and end icon',
  },
  {
    $id: 'spec-chip',
    displayName: 'Chip',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'Compact element that can carry an avatar or an icon',
  },
  {
    $id: 'spec-fab',
    displayName: 'Floating action',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'A floating action button, usually holding a single icon',
  },
  {
    $id: 'spec-listitem',
    displayName: 'List item',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'A row with an icon slot, primary text and secondary text',
  },
  {
    $id: 'spec-iconbutton',
    displayName: 'Icon button',
    category: Aglyn.ComponentCategory.INPUT,
    description: 'A button rendered as a bare glyph',
  },
  {
    $id: 'spec-icon',
    displayName: 'Icon',
    category: Aglyn.ComponentCategory.MEDIA,
    description: 'A single glyph from the library',
  },
  {
    $id: 'spec-avatar',
    displayName: 'Avatar',
    category: Aglyn.ComponentCategory.MEDIA,
    description: 'Shows a picture, initials or an icon for a person',
  },
]

function registerSchemas() {
  // The picker lists PRESETS (`schemasByCategory` walks `this.presets`).
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

/** Every result card, in rendered order. */
const resultLabels = () =>
  Array.from(document.querySelectorAll('.MuiCard-root')).map((card) =>
    (card.textContent || '').trim(),
  )

function searchFor(term: string) {
  render(
    <ThemeProvider theme={theme}>
      <ComponentPicker open />
    </ThemeProvider>,
  )
  fireEvent.click(screen.getByLabelText('search'))
  const input = screen.getByLabelText('search elements')
  fireEvent.change(input, { target: { value: term } })
}

/**
 * The filter loads fuse.js dynamically, so every assertion has to survive
 * the render BEFORE the results arrive — hence `waitFor` around the
 * ordering itself rather than around a proxy for "results are in".
 */
const expectOrder = (...labels: string[]) =>
  waitFor(() => {
    const rendered = resultLabels()
    expect(rendered.length).toBeGreaterThan(1)
    const positions = labels.map((label) => rendered.indexOf(label))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(positions.every((i) => i >= 0)).toBe(true)
  })

describe('ComponentPicker search ranking (AGL-2486)', () => {
  beforeEach(registerSchemas)
  afterEach(unregisterSchemas)

  it('puts the exact name match first', async () => {
    searchFor('icon')
    await waitFor(() => {
      expect(resultLabels().length).toBeGreaterThan(1)
      expect(resultLabels()[0]).toBe('Icon')
    })
  })

  it('ranks every name hit above every description-only hit', async () => {
    searchFor('icon')
    // `Icon` and `Icon button` carry the term in their NAME; the rest only
    // mention an icon in prose.
    await expectOrder('Icon', 'Icon button', 'Button')
    await expectOrder('Icon button', 'Avatar')
  })

  it('keeps the curated categories when nothing is being searched', () => {
    render(
      <ThemeProvider theme={theme}>
        <ComponentPicker open />
      </ThemeProvider>,
    )
    expect(screen.getByText(Aglyn.ComponentCategory.INPUT)).toBeTruthy()
    expect(screen.getByText(Aglyn.ComponentCategory.MEDIA)).toBeTruthy()
    expect(resultLabels().length).toBe(REGISTERED.length)
  })

  it('ranks a name prefix above a name substring', async () => {
    searchFor('but')
    await expectOrder('Button', 'Icon button')
  })
})
