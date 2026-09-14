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

// A stand-in icon catalog, mocked at the subpath the picker imports: the real
// one loads ~6,600 icons asynchronously, and nothing here is about it.
jest.mock('@aglyn/shared-ui-jsx/hooks/mdi-icon/use-mdi-icons-fuzzy', () => {
  const catalog = [{ id: 'mdiRocket', name: 'Rocket', path: 'M13,22', tags: [] }]
  return { useMdiIconsFuzzy: () => [catalog, catalog, jest.fn(), jest.fn()] }
})
jest.mock('@aglyn/shared-ui-jsx/components/grid-list', () => ({
  GridList: ({ items, renderItemContent }: any) => (
    <div>{items.map((item: any, i: number) => renderItemContent(item, i))}</div>
  ),
}))

import * as Aglyn from '@aglyn/aglyn'
import { parseCondition } from '@aglyn/shared-ui-jsx-forms'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ComponentPromotionContext from '../contexts/component-promotion-context'
import ElementPropsForm, {
  buildPropertyField,
  elementPropsComponentMapper,
  propertyFieldCondition,
  resolveAttributeField,
} from './element-props-form.component'
import { PropertyValuesForm } from './property-values-form.component'
import { SCREEN_LINK_FIELD_COMPONENT } from './screen-link-field.component'
import { TOKEN_TEXT_FIELD_COMPONENT } from './token-text-field.component'

/**
 * Every property kind is edited with the control the Attributes panel draws
 * for a coded component's attribute of that kind (AGL-2893).
 *
 * `property-kinds.spec.ts` pins that the kinds ARE the attribute schema's
 * field kinds. This pins the other half: that the panel can draw every one of
 * those field kinds, and that a property of a kind resolves to exactly the
 * control an attribute of that kind resolves to — one renderer, no look-alike.
 */

const PROP_TYPES = Object.keys(
  Aglyn.REUSABLE_PROP_KINDS,
) as Aglyn.ReusableComponentPropType[]
const VALUE_FIELD_KINDS = Object.keys(
  Aglyn.FIELD_KIND_PROPERTY_TYPES,
) as Aglyn.FieldComponentType[]

const ANSWERS = [
  { value: 'primary', label: 'Blue' },
  { value: 'secondary', label: 'Magenta' },
]

/** A property of a kind, with what the kind needs to be drawn at all. */
const propertyOf = (
  type: Aglyn.ReusableComponentPropType,
  extra?: Partial<Aglyn.ReusableComponentProp>,
): Aglyn.ReusableComponentProp => ({
  name: `p_${type.replace(/-/g, '_')}`,
  type,
  label: `${Aglyn.REUSABLE_PROP_KINDS[type].label} property`,
  ...(Aglyn.REUSABLE_PROP_KINDS[type].options ? { options: ANSWERS } : {}),
  ...extra,
})

const isRegistered = (component: unknown) =>
  String(component) in elementPropsComponentMapper

describe('the Attributes panel draws every field kind that holds a value (AGL-2893)', () => {
  it.each(VALUE_FIELD_KINDS)('draws a %s attribute', (component) => {
    const field = resolveAttributeField({ name: 'value', component })
    expect(isRegistered(field['component'])).toBe(true)
  })
})

describe('a property is drawn with its kind’s attribute control (AGL-2893)', () => {
  it.each(PROP_TYPES)('draws a %s property as an attribute of its kind', (type) => {
    const kind = Aglyn.REUSABLE_PROP_KINDS[type]
    const prop = propertyOf(type)
    const asProperty = resolveAttributeField(
      buildPropertyField(prop, { name: `propValues.${prop.name}`, role: 'value' }),
    )
    expect(isRegistered(asProperty['component'])).toBe(true)
    if (type === 'href') {
      // The screen picker with the external-address escape hatch built in.
      expect(asProperty['component']).toBe(SCREEN_LINK_FIELD_COMPONENT)
      return
    }
    const asAttribute = resolveAttributeField({
      name: 'value',
      component: kind.field,
      ...(kind.fieldProps ?? {}),
    })
    expect(asProperty['component']).toBe(asAttribute['component'])
  })

  it('draws the controls a page author reaches for by name', () => {
    const drawn = (type: Aglyn.ReusableComponentPropType) =>
      resolveAttributeField(
        buildPropertyField(propertyOf(type), { name: 'value', role: 'value' }),
      )
    expect(drawn('boolean')['component']).toBe(Aglyn.FieldComponentType.SWITCH)
    expect(drawn('icon')['component']).toBe(Aglyn.FieldComponentType.ICON_PICKER)
    expect(drawn('color-picker')['component']).toBe(
      Aglyn.FieldComponentType.COLOR_PICKER,
    )
    expect(drawn('css-dimension')['component']).toBe(
      Aglyn.FieldComponentType.CSS_DIMENSION,
    )
    expect(drawn('image')['component']).toBe(TOKEN_TEXT_FIELD_COMPONENT)
    expect(drawn('date-picker')).toMatchObject({
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'date',
    })
    expect(drawn('product-select')['component']).toBe(Aglyn.FieldComponentType.SELECT)
    expect(drawn('choice')).toMatchObject({
      component: Aglyn.FieldComponentType.SELECT,
      options: ANSWERS,
    })
  })

  it('configures a kind with its settings, as the attribute field reads them', () => {
    const slider = buildPropertyField(
      propertyOf('slider', { settings: { min: 1, max: 12, step: 1 } }),
      { name: 'value', role: 'value' },
    )
    expect(slider).toMatchObject({ min: 1, max: 12, step: 1 })
    const several = buildPropertyField(
      propertyOf('choice', { settings: { isMulti: true } }),
      { name: 'value', role: 'value' },
    )
    expect(several['isMulti']).toBe(true)
    const weights = [{ value: 'fontWeightBold', label: 'Bold' }]
    const scale = buildPropertyField(
      propertyOf('theme-scale', { settings: { scale: 'fontWeight' } }),
      { name: 'value', role: 'value', themeScales: { fontWeight: weights } },
    )
    expect(scale['scaleOptions']).toBe(weights)
  })

  it("hands the property's own help to the field's help tip", () => {
    const field = buildPropertyField(
      propertyOf('color-picker', { description: 'The band behind the headline.' }),
      { name: 'value', role: 'value' },
    )
    expect(field['help']).toEqual({
      title: 'Color property',
      excerpt: 'The band behind the headline.',
    })
  })
})

describe("a property's condition decides where its field shows (AGL-2893)", () => {
  const declared: Aglyn.ReusableComponentProp[] = [
    { name: 'showCta', type: 'boolean', defaultValue: 'true' },
    {
      name: 'ctaLabel',
      type: 'text',
      condition: { when: 'showCta', is: true },
    },
    { name: 'tint', type: 'choice', options: ANSWERS },
    {
      name: 'tintNote',
      type: 'text',
      condition: { or: [{ when: 'tint', is: 'secondary' }, { when: 'tint', isEmpty: true }] },
    },
  ]
  const pathOf = (name: string) => `propValues.${name}`
  const shows = (propName: string, propValues: Record<string, unknown>) => {
    const prop = declared.find((entry) => entry.name === propName)
    return parseCondition(
      propertyFieldCondition(prop?.condition, declared, pathOf) as never,
      { propValues },
      { name: pathOf(propName) } as never,
    ).visible
  }

  it("reads an unset property as the default it renders with", () => {
    // `showCta` is unset, so its default of yes decides.
    expect(shows('ctaLabel', {})).toBe(true)
    expect(shows('ctaLabel', { showCta: false })).toBe(false)
    // The text spelling of a no is a no here too.
    expect(shows('ctaLabel', { showCta: 'false' })).toBe(false)
  })

  it('evaluates the schema operators, combined', () => {
    expect(shows('tintNote', {})).toBe(true)
    expect(shows('tintNote', { tint: 'secondary' })).toBe(true)
    expect(shows('tintNote', { tint: 'primary' })).toBe(false)
  })
})

describe('every property kind renders on an instance, with no field dropped (AGL-2893)', () => {
  it('draws a field for each kind the component declares', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const declared = PROP_TYPES.map((type) =>
      propertyOf(type, {
        ...(type === 'theme-scale' ? { settings: { scale: 'fontWeight' } } : {}),
        ...(type === 'preset-choice' ? { settings: { presets: 'cornerRadius' } } : {}),
      }),
    )
    render(
      <ComponentPromotionContext.Provider
        value={{
          definitions: {
            sink: { rootId: 'root', nodes: {}, props: declared } as never,
          },
        }}
      >
        <ElementPropsForm
          node={
            {
              $id: 'sink-instance',
              type: 'node',
              componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
              props: { refId: 'sink' },
              componentSchema: { attributes: [] },
              nodes: [],
            } as never
          }
        />
      </ComponentPromotionContext.Provider>,
    )
    for (const prop of declared) {
      expect(
        (await screen.findAllByText(String(prop.label), undefined, { timeout: 20000 }))
          .length,
      ).toBeGreaterThan(0)
    }
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes('unregistered editor')),
    ).toBe(false)
    warn.mockRestore()
  }, 60000)
})

describe('the Properties dialog edits a default with the same control (AGL-2893)', () => {
  it('declares a Yes / no default with a switch, stored as a real boolean', async () => {
    const onChange = jest.fn()
    render(
      <PropertyValuesForm
        declared={[{ name: 'value', type: 'boolean', label: 'Default' }]}
        role="default"
        onChange={onChange}
      />,
    )
    fireEvent.click(
      await screen.findByRole('switch', { name: 'Default' }, { timeout: 10000 }),
    )
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ value: true }))
  })

  it("hides a page's field while its condition does not hold", async () => {
    render(
      <PropertyValuesForm
        declared={[
          { name: 'showCta', type: 'boolean', label: 'Show the call to action' },
          {
            name: 'ctaLabel',
            type: 'text',
            label: 'Call to action label',
            condition: { when: 'showCta', is: true },
          },
        ]}
        values={{ showCta: false }}
        noun="layout"
        onChange={jest.fn()}
      />,
    )
    const toggle = await screen.findByRole(
      'switch',
      { name: 'Show the call to action' },
      { timeout: 10000 },
    )
    expect(screen.queryByText('Call to action label')).toBeNull()
    fireEvent.click(toggle)
    expect(
      (await screen.findAllByText('Call to action label', undefined, { timeout: 10000 }))
        .length,
    ).toBeGreaterThan(0)
  })
})
