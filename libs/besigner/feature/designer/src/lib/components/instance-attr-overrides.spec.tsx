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
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import ComponentPromotionContext from '../contexts/component-promotion-context'
import { elementPropsComponentMapper } from './element-props-form.component'
import { InstanceAttrOverrides } from './instance-attr-overrides.component'

/**
 * The Attributes panel's per-instance override section (AGL-1899).
 *
 * Rendered rather than unit-tested alone because the failure that matters
 * most here is not a wrong value — it is the section THROWING. This form
 * builds its fields from a component's declared attributes, and an editor the
 * form renderer does not know about makes it throw, which does not blank this
 * section: it blanks the whole Attributes panel it is nested inside. That is
 * how the email designer's panel disappeared once already (AGL-584).
 */
describe('the instance attribute-override section (AGL-1899)', () => {
  const BUTTON = 'specAttrOverrideButton'
  const STACK = 'specAttrOverrideStack'

  const definition = {
    rootId: 'root',
    nodes: {
      root: {
        $id: 'root',
        componentId: STACK,
        name: 'Card',
        nodes: ['cta'],
        props: { spacing: 2 },
      },
      cta: {
        $id: 'cta',
        parentId: 'root',
        componentId: BUTTON,
        name: 'Call to action',
        props: { variant: 'contained', size: 'medium' },
      },
    },
  } as any

  const seedInstance = (attrOverrides?: Record<string, any>) => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['inst'] },
      inst: {
        $id: 'inst',
        parentId: 'root',
        componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
        props: { refId: 'widget' },
        ...(attrOverrides ? { attrOverrides } : {}),
      },
    } as any)
    return Aglyn.canvas.getNode('inst') as Aglyn.NodeSchema
  }
  const live = () => Aglyn.canvas.getNode('inst') as any

  const renderSection = async (node?: Aglyn.NodeSchema) => {
    render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <ComponentPromotionContext.Provider
          value={{ definitions: { widget: definition } } as any}
        >
          <InstanceAttrOverrides
            node={node}
            componentMapper={elementPropsComponentMapper}
          />
        </ComponentPromotionContext.Provider>
      </ThemeProvider>,
    )
    await act(async () => undefined)
  }

  /**
   * Pick a target by the override KEY it writes, not by its label: an already
   * overridden target renders its label and the `•` marker as separate text
   * nodes, and matching on the label alone silently stops finding it the
   * moment the thing under test starts working.
   */
  const pickTarget = async (key: string) => {
    act(() => {
      fireEvent.mouseDown(screen.getByLabelText('Override target'))
    })
    await act(async () => undefined)
    const option = within(screen.getByRole('listbox')).getByRole('option', {
      name: (_name, element) => element.getAttribute('data-value') === key,
    })
    act(() => {
      fireEvent.click(option)
    })
    await act(async () => undefined)
  }

  /** Types into a field and lets the AGL-567 commit debounce elapse. */
  const typeInto = async (label: string, value: string) => {
    act(() => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    })
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
  }

  beforeAll(() => {
    ;(Aglyn.components.schemas as Record<string, any>)[BUTTON] = {
      $id: BUTTON,
      displayName: 'Button',
      attributes: [
        { name: 'variant', label: 'Variant', component: 'text-field' },
        { name: 'size', label: 'Size', component: 'text-field' },
        // Content, and an editor with no self-contained value — neither may
        // reach the panel. Both are here so their absence is an assertion
        // rather than an accident of the fixture.
        { name: 'children', label: 'Text', component: 'text-field' },
        { name: 'icon', label: 'Icon', component: 'icon-picker' },
      ],
    }
    ;(Aglyn.components.schemas as Record<string, any>)[STACK] = {
      $id: STACK,
      displayName: 'Stack',
      attributes: [
        { name: 'spacing', label: 'Spacing', component: 'text-field' },
      ],
    }
  })
  afterAll(() => {
    delete (Aglyn.components.schemas as Record<string, any>)[BUTTON]
    delete (Aglyn.components.schemas as Record<string, any>)[STACK]
  })

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    Aglyn.canvas.reset()
  })

  it('renders nothing at all for a node that is not an instance', async () => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      plain: { $id: 'plain', componentId: STACK, props: { spacing: 1 } },
    } as any)
    await renderSection(Aglyn.canvas.getNode('plain') as Aglyn.NodeSchema)
    expect(screen.queryByText('Attribute overrides')).toBeNull()
  })

  it('offers the component tree as targets and starts on the root', async () => {
    await renderSection(seedInstance())
    expect(screen.getByText('Attribute overrides')).toBeTruthy()
    // The root's own attributes, because the root is where it starts.
    expect(screen.getByLabelText('Spacing')).toBeTruthy()
    expect(screen.getByText("Using the component's attributes")).toBeTruthy()
  })

  it('shows only the overridable attributes of the picked element', async () => {
    await renderSection(seedInstance())
    await pickTarget('cta')
    expect(screen.getByLabelText('Variant')).toBeTruthy()
    expect(screen.getByLabelText('Size')).toBeTruthy()
    // Content stays the component's — this panel never becomes a second
    // writer on the same rendered string.
    expect(screen.queryByLabelText('Text')).toBeNull()
    // An icon picker writes a second prop beside itself, so it is not offered.
    expect(screen.queryByLabelText('Icon')).toBeNull()
  })

  it("shows the component's own value as the placeholder, not as a value", async () => {
    await renderSection(seedInstance())
    await pickTarget('cta')
    const variant = screen.getByLabelText('Variant') as HTMLInputElement
    // The distinction the whole layer rests on: the field is EMPTY (this
    // instance overrides nothing) while showing what it would inherit.
    expect(variant.value).toBe('')
    expect(variant.placeholder).toBe('contained')
    expect(live().attrOverrides).toBeUndefined()
  })

  it('writes an edit into the picked leaf slice, and only that slice', async () => {
    await renderSection(seedInstance())
    await pickTarget('cta')
    await typeInto('Variant', 'outlined')
    expect(live().attrOverrides).toEqual({ cta: { variant: 'outlined' } })
    // The chip counts it, and names it.
    expect(screen.getByText('Overridden here: 1')).toBeTruthy()
    expect(screen.getByText('variant')).toBeTruthy()
  })

  it('opening the panel commits nothing', async () => {
    // Seeding the form is not an edit.
    //
    // Asserting on `attrOverrides` alone would be a green check that proves
    // nothing: an on-mount commit writes the form's EMPTY values, which
    // `setAttrs` drops by key, so the node looks identical either way. What
    // distinguishes them is whether a commit happened at all — an undo entry
    // an author did not earn, and a document write on every selection.
    const transact = jest.spyOn(Aglyn.canvas, 'transact')
    await renderSection(seedInstance({ cta: { variant: 'outlined' } }))
    await pickTarget('cta')
    await act(async () => {
      jest.advanceTimersByTime(2000)
    })
    expect(transact).not.toHaveBeenCalled()
    expect(live().attrOverrides).toEqual({ cta: { variant: 'outlined' } })
    transact.mockRestore()
  })

  it("a chip's ✕ clears that override and leaves the instance clean", async () => {
    await renderSection(seedInstance({ cta: { variant: 'outlined' } }))
    await pickTarget('cta')
    expect(screen.getByText('Overridden here: 1')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByTestId('CancelIcon'))
    })
    await act(async () => undefined)
    // Cleared means the field is GONE, not stored empty: the panel and the
    // graft must both read this instance as clean.
    expect(live().attrOverrides).toBeUndefined()
    expect(screen.getByText("Using the component's attributes")).toBeTruthy()
  })

  it('an edit on one target leaves another target’s override alone', async () => {
    await renderSection(seedInstance({ cta: { variant: 'outlined' } }))
    await typeInto('Spacing', '8')
    expect(live().attrOverrides).toEqual({
      cta: { variant: 'outlined' },
      root: { spacing: '8' },
    })
  })
})
