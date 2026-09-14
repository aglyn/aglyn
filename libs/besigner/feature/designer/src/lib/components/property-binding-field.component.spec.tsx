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

// A stand-in icon catalog: the real one loads ~6,600 icons asynchronously, and
// nothing here is about the catalog. Mocked at the subpath the picker imports.
jest.mock('@aglyn/shared-ui-jsx/hooks/mdi-icon/use-mdi-icons-fuzzy', () => {
  const catalog = [
    { id: 'mdiRocket', name: 'Rocket', path: 'M13,22L11,18', tags: [] },
  ]
  return { useMdiIconsFuzzy: () => [catalog, catalog, jest.fn(), jest.fn()] }
})

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { BindingPickerContext } from '../contexts/binding-picker-context'
import ElementPropsForm, {
  elementPropsComponentMapper,
} from './element-props-form.component'
import {
  describePropertyBinding,
  PROPERTY_BINDING_FIELD_COMPONENT,
  withPropertyBinding,
} from './property-binding-field.component'

/**
 * A switch or checkbox inside a reusable component can be bound to one of the
 * component's properties (AGL-2871).
 *
 * Exercised through the real Attributes form, so what is pinned is what an
 * author meets: the `{}` among the field's corner controls, a picker offering
 * only the properties that can drive the field, the property shown in place
 * of the control once bound, and a way back out — and, underneath, the token
 * the graft reads committed through the panel's own autosave.
 */

/** The Video element's two boolean kinds, and a text field beside them. */
const ATTRIBUTES = [
  {
    name: 'lightbox',
    label: 'Open in a lightbox',
    description: 'Open the film in a dialog.',
    component: Aglyn.FieldComponentType.SWITCH,
  },
  {
    name: 'controls',
    label: 'Controls',
    component: Aglyn.FieldComponentType.CHECKBOX,
  },
  {
    name: 'title',
    label: 'Video title',
    component: Aglyn.FieldComponentType.TEXT_FIELD,
  },
]

const COMPONENT_PROPS: Aglyn.ReusableComponentProp[] = [
  { name: 'playInLightbox', type: 'boolean', label: 'Play in a lightbox' },
  { name: 'showControls', type: 'boolean', defaultValue: 'true' },
  { name: 'headline', type: 'text', label: 'Headline' },
]

describe('binding a switch or checkbox to a property (AGL-2871)', () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    // The debounced commit (AGL-567) flushes on unmount; keep it off the real
    // canvas store, which does not hold this node.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
  })

  /** `null` for an editor that is not a component editor. */
  const mount = (
    props: Record<string, unknown>,
    componentProps: Aglyn.ReusableComponentProp[] | null = COMPONENT_PROPS,
  ) =>
    render(
      <BindingPickerContext.Provider
        value={{ componentProps: componentProps ?? undefined }}
      >
        <ElementPropsForm
          node={
            {
              $id: 'agl2871-video',
              type: 'node',
              componentId: 'unregistered-video',
              props,
              componentSchema: { attributes: ATTRIBUTES },
              nodes: [],
            } as never
          }
        />
      </BindingPickerContext.Provider>,
    )

  /** The props the LAST commit wrote. */
  const lastCommit = (): Record<string, unknown> => {
    const calls = updateNodeProps.mock.calls
    return (calls[calls.length - 1]?.[1] ?? {}) as Record<string, unknown>
  }

  const bindButton = (label: string) =>
    screen.findByRole(
      'button',
      { name: `Bind ${label} to a property` },
      { timeout: 10000 },
    )

  it('offers only the Yes / no properties, and commits the token the graft reads', async () => {
    const { unmount } = mount({})
    fireEvent.click(await bindButton('Open in a lightbox'))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Play in a lightbox')).toBeTruthy()
    expect(within(menu).getByText('showControls')).toBeTruthy()
    // A text property cannot drive a switch, so it is never on offer.
    expect(within(menu).queryByText('Headline')).toBeNull()

    fireEvent.click(within(menu).getByText('Play in a lightbox'))

    // The control gives way to the property it now follows.
    expect(
      await screen.findByRole('button', {
        name: 'Open in a lightbox: bound to Play in a lightbox. Change or remove the binding',
      }),
    ).toBeTruthy()
    expect(
      screen.getByText('Each page sets this with the Play in a lightbox property.'),
    ).toBeTruthy()

    unmount()
    expect(lastCommit()['lightbox']).toBe('{{prop.playInLightbox}}')
  })

  it('gives a checkbox the same binding', async () => {
    const { unmount } = mount({})
    fireEvent.click(await bindButton('Controls'))
    fireEvent.click(within(await screen.findByRole('menu')).getByText('showControls'))
    unmount()
    expect(lastCommit()['controls']).toBe('{{prop.showControls}}')
  })

  it('shows a stored binding as the property, and removing it restores the control', async () => {
    const { unmount } = mount({ lightbox: '{{prop.playInLightbox}}' })
    fireEvent.click(
      await screen.findByRole(
        'button',
        {
          name: 'Open in a lightbox: bound to Play in a lightbox. Change or remove the binding',
        },
        { timeout: 10000 },
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    // The switch is back, still carrying its `{}`.
    expect(await bindButton('Open in a lightbox')).toBeTruthy()
    unmount()
    // A commit happened — an absent value is not merely an absent save.
    expect(updateNodeProps).toHaveBeenCalled()
    expect(lastCommit()['lightbox']).toBeUndefined()
  })

  it('warns about a binding to a property the component no longer declares', async () => {
    mount({ lightbox: '{{prop.removedFlag}}' })
    expect(
      await screen.findByText(
        /This component declares no property by that name/,
        undefined,
        { timeout: 10000 },
      ),
    ).toBeTruthy()
  })

  it('says where a Yes / no property comes from when the component has none', async () => {
    mount({}, [{ name: 'headline', type: 'text' }])
    fireEvent.click(await bindButton('Open in a lightbox'))
    expect(
      await screen.findByText(
        'This component has no Yes / no or Checkbox properties yet. Add one under File ▸ Properties…, then bind it here.',
      ),
    ).toBeTruthy()
  })

  it('negative control: outside a component editor there is nothing to bind to', async () => {
    mount({}, null)
    // Both controls are on screen, so an absent `{}` is not just a field
    // that has not loaded yet.
    await screen.findByText('Open in a lightbox', undefined, { timeout: 10000 })
    await screen.findByText('Controls', undefined, { timeout: 10000 })
    expect(
      screen.queryByRole('button', { name: /to a property$/ }),
    ).toBeNull()
  })
})

describe('binding a dropdown or a Screen picker to a property (AGL-2871)', () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
  })

  /** A Screen Link's own dropdown and Screen picker. */
  const LINK_ATTRIBUTES = [
    {
      name: 'screenId',
      label: 'Screen',
      component: Aglyn.FieldComponentType.SCREEN_SELECT,
    },
    {
      name: 'variant',
      label: 'Variant',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'text', label: 'Text' },
        { value: 'outlined', label: 'Outlined' },
        { value: 'contained', label: 'Contained' },
      ],
    },
  ]

  const CARD_PROPS: Aglyn.ReusableComponentProp[] = [
    {
      name: 'linkStyle',
      type: 'choice',
      label: 'Link style',
      options: [
        { value: 'text', label: 'Plain' },
        { value: 'outlined', label: 'Outlined' },
      ],
    },
    { name: 'moreLink', type: 'href', label: 'More link' },
    { name: 'featured', type: 'boolean', label: 'Featured' },
  ]

  const mount = (
    props: Record<string, unknown>,
    attributes: Array<Record<string, unknown>> = LINK_ATTRIBUTES,
    componentProps: Aglyn.ReusableComponentProp[] = CARD_PROPS,
  ) =>
    render(
      <BindingPickerContext.Provider value={{ componentProps }}>
        <ElementPropsForm
          node={
            {
              $id: 'agl2871-link',
              type: 'node',
              componentId: 'unregistered-screen-link',
              props,
              componentSchema: { attributes },
              nodes: [],
            } as never
          }
        />
      </BindingPickerContext.Provider>,
    )

  const lastCommit = (): Record<string, unknown> => {
    const calls = updateNodeProps.mock.calls
    return (calls[calls.length - 1]?.[1] ?? {}) as Record<string, unknown>
  }

  const bindButton = (label: string) =>
    screen.findByRole(
      'button',
      { name: `Bind ${label} to a property` },
      { timeout: 10000 },
    )

  it('offers a dropdown only the Choice properties', async () => {
    const { unmount } = mount({})
    fireEvent.click(await bindButton('Variant'))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Link style')).toBeTruthy()
    expect(within(menu).queryByText('More link')).toBeNull()
    expect(within(menu).queryByText('Featured')).toBeNull()

    fireEvent.click(within(menu).getByText('Link style'))
    expect(
      await screen.findByText('Each page sets this with the Link style property.'),
    ).toBeTruthy()
    unmount()
    expect(lastCommit()['variant']).toBe('{{prop.linkStyle}}')
  })

  it("binds a Screen Link's Screen picker to a Link property", async () => {
    const { unmount } = mount({})
    fireEvent.click(await bindButton('Screen'))

    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByText('Link style')).toBeNull()
    fireEvent.click(within(menu).getByText('More link'))
    unmount()
    expect(lastCommit()['screenId']).toBe('{{prop.moreLink}}')
  })

  it('names the values a Choice offers that the dropdown does not', async () => {
    mount({ variant: '{{prop.linkStyle}}' }, LINK_ATTRIBUTES, [
      {
        name: 'linkStyle',
        type: 'choice',
        label: 'Link style',
        options: [
          { value: 'outlined', label: 'Outlined' },
          { value: 'pill', label: 'Pill' },
        ],
      },
    ])
    expect(
      await screen.findByText(
        /This field does not offer pill, so a page that chooses it gets the field's own default\. Give Link style values from: Text \(text\), Outlined \(outlined\), Contained \(contained\)\./,
        undefined,
        { timeout: 10000 },
      ),
    ).toBeTruthy()
  })

  it('offers a dropdown that takes several answers only the properties that hold several (AGL-2893)', async () => {
    const { unmount } = mount(
      {},
      [
        ...LINK_ATTRIBUTES,
        {
          name: 'tags',
          label: 'Tags',
          component: Aglyn.FieldComponentType.SELECT,
          isMulti: true,
          options: [{ value: 'a', label: 'A' }],
        },
      ],
      [
        ...CARD_PROPS,
        {
          name: 'topics',
          type: 'choice',
          label: 'Topics',
          options: [{ value: 'a' }],
          settings: { isMulti: true },
        },
      ],
    )
    fireEvent.click(await bindButton('Tags'))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Topics')).toBeTruthy()
    // One answer cannot fill a list, so a single Choice is not on offer.
    expect(within(menu).queryByText('Link style')).toBeNull()
    fireEvent.click(within(menu).getByText('Topics'))
    unmount()
    expect(lastCommit()['tags']).toBe('{{prop.topics}}')
  })
})

describe('binding an icon picker to an Icon property (AGL-2871)', () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
  })

  /** The Icon element's own picker, as its schema declares it. */
  const ICON_ATTRIBUTES = [
    {
      name: 'iconId',
      label: 'Icon',
      description: 'Pick any icon from the library.',
      component: Aglyn.FieldComponentType.ICON_PICKER,
    },
  ]

  const mount = (props: Record<string, unknown>) =>
    render(
      <BindingPickerContext.Provider
        value={{
          componentProps: [
            { name: 'productIcon', type: 'icon', label: 'Product icon' },
            { name: 'featured', type: 'boolean', label: 'Featured' },
          ],
        }}
      >
        <ElementPropsForm
          node={
            {
              $id: 'agl2871-icon',
              type: 'node',
              componentId: 'icon',
              props,
              componentSchema: { attributes: ICON_ATTRIBUTES },
              nodes: [],
            } as never
          }
        />
      </BindingPickerContext.Provider>,
    )

  it('offers only the Icon properties, and the bound element keeps no stale path', async () => {
    // The icon the element was drawn with before it was bound.
    const { unmount } = mount({ iconId: 'mdiRocket', iconPath: 'M13,22L11,18' })
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Bind Icon to a property' },
        { timeout: 10000 },
      ),
    )
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByText('Featured')).toBeNull()
    fireEvent.click(within(menu).getByText('Product icon'))

    expect(
      await screen.findByText('Each page sets this with the Product icon property.'),
    ).toBeTruthy()
    unmount()
    const calls = updateNodeProps.mock.calls
    const committed = calls[calls.length - 1]?.[1] as Record<string, unknown>
    expect(committed['iconId']).toBe('{{prop.productIcon}}')
    // The page's pick brings its own path at render; this one would outlive
    // the binding otherwise.
    expect(committed['iconPath']).toBeUndefined()
  })

  it('keeps the help tip the schema gives the picker', async () => {
    mount({})
    expect(
      await screen.findByRole(
        'button',
        { name: 'Help: Icon' },
        { timeout: 10000 },
      ),
    ).toBeTruthy()
  })
})

describe('describePropertyBinding', () => {
  const choice: Aglyn.ReusableComponentProp = {
    name: 'tint',
    type: 'choice',
    options: [
      { value: 'primary', label: 'Blue' },
      { value: 'pink', label: 'Pink' },
    ],
  }
  const known = { label: 'Tint', group: 'property', known: true } as const

  it('names a property the component no longer declares', () => {
    expect(
      describePropertyBinding({
        token: '{{prop.gone}}',
        resolved: { label: 'gone', group: 'property', known: false },
        bindingProps: [choice],
      }),
    ).toEqual({
      text: expect.stringMatching(/declares no property by that name/),
      error: true,
    })
  })

  it('names a declared property of the wrong kind', () => {
    expect(
      describePropertyBinding({
        token: '{{prop.headline}}',
        resolved: { label: 'Headline', group: 'property', known: true },
        bindingProps: [choice],
        bindingKinds: 'Choice',
      }).text,
    ).toBe(
      'Headline is not a Choice property, so it cannot set this field. Bind ' +
        'one that is, or remove the binding.',
    )
  })

  it('lists the choices a dropdown cannot show, and the values it can', () => {
    expect(
      describePropertyBinding({
        token: '{{prop.tint}}',
        resolved: known,
        bindingProps: [choice],
        fieldOptions: [
          { value: 'primary', label: 'Primary' },
          { value: 'secondary', label: 'Secondary' },
        ],
      }),
    ).toEqual({
      text:
        "This field does not offer pink, so a page that chooses it gets the " +
        "field's own default. Give Tint values from: Primary (primary), " +
        'Secondary (secondary).',
      error: true,
    })
  })

  it('says only what the binding does when nothing is wrong', () => {
    expect(
      describePropertyBinding({
        token: '{{ prop.tint }}',
        resolved: known,
        bindingProps: [choice],
        fieldOptions: [{ value: 'primary' }, { value: 'pink' }],
      }),
    ).toEqual({
      text: 'Each page sets this with the Tint property.',
      error: false,
    })
  })
})

describe('withPropertyBinding', () => {
  const control = elementPropsComponentMapper[Aglyn.FieldComponentType.SWITCH]
  const field = {
    name: 'autoPlay',
    label: 'Autoplay',
    component: Aglyn.FieldComponentType.SWITCH,
  }

  it('wraps a switch inside a component editor with its Yes / no properties', () => {
    const wrapped = withPropertyBinding(field, {
      declaredComponent: Aglyn.FieldComponentType.SWITCH,
      componentProps: COMPONENT_PROPS,
      control: control as never,
    }) as Record<string, any>
    expect(wrapped.component).toBe(PROPERTY_BINDING_FIELD_COMPONENT)
    // Registered, or the panel throws and blanks every attribute (AGL-584).
    expect(PROPERTY_BINDING_FIELD_COMPONENT in elementPropsComponentMapper).toBe(
      true,
    )
    expect(wrapped.bindingControl).toBe(control)
    expect(wrapped.bindingOptions.map((option: any) => option.token)).toEqual([
      '{{prop.playInLightbox}}',
      '{{prop.showControls}}',
    ])
  })

  it('leaves a field alone where a binding could not work', () => {
    const options = {
      declaredComponent: Aglyn.FieldComponentType.SWITCH,
      componentProps: COMPONENT_PROPS,
      control: control as never,
    }
    // Not a component editor.
    expect(withPropertyBinding(field, { ...options, componentProps: undefined })).toBe(field)
    // Nothing writable.
    const readOnly = { ...field, isReadOnly: true }
    expect(withPropertyBinding(readOnly, options)).toBe(readOnly)
    // No control to fall back to.
    expect(withPropertyBinding(field, { ...options, control: undefined })).toBe(field)
    // A kind no property drives.
    const text = { ...field, component: Aglyn.FieldComponentType.TEXT_FIELD }
    expect(
      withPropertyBinding(text, {
        ...options,
        declaredComponent: Aglyn.FieldComponentType.TEXT_FIELD,
      }),
    ).toBe(text)
    // A checkbox LIST holds an array of answers, so a yes or a no is never
    // offered to it.
    const list = {
      ...field,
      component: Aglyn.FieldComponentType.CHECKBOX,
      options: [{ value: 'a', label: 'A' }],
    }
    const wrappedList = withPropertyBinding(list, {
      ...options,
      declaredComponent: Aglyn.FieldComponentType.CHECKBOX,
    }) as Record<string, any>
    expect(wrappedList.bindingOptions).toEqual([])
  })
})

/**
 * Every field kind the Attributes panel draws can be bound to a property of a
 * compatible kind (AGL-2893) — a color picker to a Color, a size to a Size, a
 * document to formatted or long text — and never to one it could not show.
 */
describe('binding every field kind to a property (AGL-2893)', () => {
  const PROPS: Aglyn.ReusableComponentProp[] = [
    { name: 'accent', type: 'color-picker', label: 'Accent' },
    { name: 'width', type: 'css-dimension', label: 'Width' },
    { name: 'body', type: 'richText', label: 'Body' },
    { name: 'doc', type: 'markdown', label: 'Document' },
    { name: 'launch', type: 'date-picker', label: 'Launch day' },
    { name: 'product', type: 'product-select', label: 'Product' },
    { name: 'flag', type: 'boolean', label: 'Flag' },
  ]
  const control = (kind: Aglyn.FieldComponentType) =>
    elementPropsComponentMapper[kind as keyof typeof elementPropsComponentMapper]

  const offered = (declaredComponent: Aglyn.FieldComponentType, extra = {}) =>
    (
      withPropertyBinding(
        { name: 'value', label: 'Value', component: declaredComponent, ...extra },
        {
          declaredComponent,
          componentProps: PROPS,
          control: (control(declaredComponent) ??
            control(Aglyn.FieldComponentType.SELECT)) as never,
        },
      ) as Record<string, any>
    ).bindingOptions?.map((option: any) => option.label)

  it.each([
    [Aglyn.FieldComponentType.COLOR_PICKER, ['Accent']],
    [Aglyn.FieldComponentType.CSS_DIMENSION, ['Width']],
    [Aglyn.FieldComponentType.MARKDOWN, ['Body', 'Document']],
    [Aglyn.FieldComponentType.DATE_PICKER, ['Launch day']],
    [Aglyn.FieldComponentType.PRODUCT_SELECT, ['Product']],
    [Aglyn.FieldComponentType.SWITCH, ['Flag']],
  ] as const)('offers a %s field only the properties it can show', (kind, labels) => {
    expect(offered(kind)).toEqual(labels)
  })

  it('names what to add in the words of the kinds that would fit', () => {
    const wrapped = withPropertyBinding(
      { name: 'value', label: 'Value', component: Aglyn.FieldComponentType.RADIO },
      {
        declaredComponent: Aglyn.FieldComponentType.RADIO,
        componentProps: [],
        control: control(Aglyn.FieldComponentType.RADIO) as never,
        owner: 'layout',
      },
    ) as Record<string, any>
    expect(wrapped.bindingEmptyText).toBe(
      'This layout has no Choice, Radio buttons or Toggle buttons properties yet. ' +
        'Add one under File ▸ Properties…, then bind it here.',
    )
  })

  it('binds a color picker in the rendered panel, committing the token the graft reads', async () => {
    const updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
    const { unmount } = render(
      <BindingPickerContext.Provider value={{ componentProps: PROPS }}>
        <ElementPropsForm
          node={
            {
              $id: 'agl2893-band',
              type: 'node',
              componentId: 'unregistered-band',
              props: {},
              componentSchema: {
                attributes: [
                  {
                    name: 'color',
                    label: 'Band color',
                    component: Aglyn.FieldComponentType.COLOR_PICKER,
                  },
                ],
              },
              nodes: [],
            } as never
          }
        />
      </BindingPickerContext.Provider>,
    )
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Bind Band color to a property' },
        { timeout: 10000 },
      ),
    )
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByText('Width')).toBeNull()
    fireEvent.click(within(menu).getByText('Accent'))
    expect(
      await screen.findByText('Each page sets this with the Accent property.'),
    ).toBeTruthy()
    unmount()
    const calls = updateNodeProps.mock.calls
    expect((calls[calls.length - 1]?.[1] as Record<string, unknown>)['color']).toBe(
      '{{prop.accent}}',
    )
    updateNodeProps.mockRestore()
  })
})
