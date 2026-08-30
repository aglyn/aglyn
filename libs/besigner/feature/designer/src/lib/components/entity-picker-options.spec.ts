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

/**
 * What an entity picker OFFERS, and what it says when it can offer nothing.
 *
 * The demand half — which list a node's attributes ask the provider to read —
 * is pinned by `entity-picker-demand.spec.ts`. This is the other half, and
 * the two used to be written twice: the panel asked for one list by attribute
 * type and read its options out of another by a second switch that keyed off
 * whether a list happened to be defined. That second switch is why a besigner
 * surface with no picker context dropped the attribute from the panel
 * entirely — no control at all, which reads as a component that simply has no
 * such setting.
 *
 * The Form element is the case that made it matter. `formId` is the form's
 * whole identity: a caption is what it replaced, and a caption made a rename
 * split one submission list into two.
 */
import * as Aglyn from '@aglyn/aglyn'
import {
  buildEntityPickerField,
  elementPropsComponentMapper,
  ENTITY_PICKER_KINDS,
  entityPickerBrowseNotice,
  entityPickerNoMatchText,
  entityPickerPlaceholder,
  entitySelectionOption,
} from './element-props-form.component'
import { SCREEN_LINK_FIELD_COMPONENT } from './screen-link-field.component'

const formIdField = {
  name: 'formId',
  label: 'Form',
  component: Aglyn.FieldComponentType.FORM_SELECT,
} as Aglyn.AglynAttributeSchema

/** A picker context of the shape every besigner surface's provider hands down. */
const contextWith = (
  overrides: Partial<Aglyn.EntityPickerContextValue>,
): Aglyn.EntityPickerContextValue => ({
  request: () => undefined,
  ...overrides,
})

const optionsOf = (field: { options?: Array<{ value: string }> }) =>
  (field.options ?? []).map((option) => option.value)

const labelsOf = (field: { options?: Array<{ label: string }> }) =>
  (field.options ?? []).map((option) => option.label)

describe('a form is placed by id, not by the caption an author typed', () => {
  const context = contextWith({
    forms: [
      { id: 'form-2', label: 'Contact us' },
      { id: 'form-1', label: 'Apply now' },
    ],
    status: { forms: 'ready' },
  })

  it('stores the form id as the option value', () => {
    const field = buildEntityPickerField(formIdField, 'forms', context)
    // Sorted by the name the author reads, valued by the id the node keeps.
    expect(optionsOf(field)).toEqual(['', 'form-1', 'form-2'])
    expect(labelsOf(field)).toEqual(['None', 'Apply now', 'Contact us'])
  })

  it('never offers a display name as the stored value', () => {
    // The defect this replaced: `?form=Contact` filtered on a caption, so
    // renaming the form split its submission history in two.
    const field = buildEntityPickerField(formIdField, 'forms', context)
    const captions = (context.forms ?? []).map((form) => form.label)
    for (const value of optionsOf(field)) {
      expect(captions).not.toContain(value)
    }
  })

  it('renders as a SELECT the attributes panel can actually draw', () => {
    const field = buildEntityPickerField(formIdField, 'forms', context)
    // AGL-584: an editor type missing from the mapper is dropped by the
    // panel's unknown-editor filter, which is the failure being removed.
    expect(field.component).toBe(Aglyn.FieldComponentType.SELECT)
    expect(String(field.component) in elementPropsComponentMapper).toBe(true)
  })

  it('keeps the attribute name, so the choice saves onto `formId`', () => {
    const field = buildEntityPickerField(formIdField, 'forms', context)
    expect(field.name).toBe('formId')
    expect(field.label).toBe('Form')
  })

  it('is not coerced into a screen picker', () => {
    // A component `Link` prop only accepts screens, and a form reference
    // routed through that editor would store a screen id or nothing at all.
    const field = buildEntityPickerField(formIdField, 'forms', context)
    expect(field.component).not.toBe(SCREEN_LINK_FIELD_COMPONENT)
    expect(field.component).not.toBe(Aglyn.FieldComponentType.SCREEN_SELECT)
    // And a screen picker is not an entity list, in the other direction.
    expect(
      ENTITY_PICKER_KINDS[Aglyn.FieldComponentType.SCREEN_SELECT],
    ).toBeUndefined()
  })
})

describe('an empty picker is distinguishable from a broken one', () => {
  const empty = (state: Aglyn.EntityListState) =>
    entityPickerPlaceholder('forms', state, 0)

  it('says where forms are made when the site genuinely has none', () => {
    expect(empty('ready')).toMatch(/no forms/i)
    // The whole point: an author who has never made one is told where to.
    expect(empty('ready')).toMatch(/Forms page/)
  })

  it('says the read failed rather than reporting no forms', () => {
    expect(empty('error')).toMatch(/could not load/i)
    expect(empty('error')).not.toMatch(/no forms/i)
  })

  it('says it is still loading rather than reporting no forms', () => {
    expect(empty('loading')).toMatch(/loading/i)
    expect(empty('loading')).not.toMatch(/no forms/i)
  })

  it('says the editor cannot list them when no context is provided', () => {
    expect(empty('unavailable')).toMatch(/cannot list forms/i)
    expect(empty('unavailable')).not.toMatch(/no forms/i)
  })

  it('gives the four reasons four different sentences', () => {
    // The failure this exists to remove is four identical empty dropdowns.
    const said = ['ready', 'error', 'loading', 'unavailable'].map((state) =>
      empty(state as Aglyn.EntityListState),
    )
    expect(new Set(said).size).toBe(4)
  })

  it('says plain "None" once there is something to choose', () => {
    expect(entityPickerPlaceholder('forms', 'ready', 3)).toBe('None')
    // A stale state cannot re-label a picker that has options in it.
    expect(entityPickerPlaceholder('forms', 'loading', 3)).toBe('None')
  })

  it('names its own kind, so a product picker never says "forms"', () => {
    expect(entityPickerPlaceholder('products', 'ready', 0)).toMatch(
      /no products/i,
    )
    expect(entityPickerPlaceholder('datasets', 'ready', 0)).toMatch(/Data page/)
  })
})

describe('a picker with nothing to offer is still a picker', () => {
  it('renders the field on a surface that provides no context at all', () => {
    // It used to vanish: the panel decided an attribute WAS an entity picker
    // by whether a list was defined, so no provider meant no field.
    const field = buildEntityPickerField(formIdField, 'forms', undefined)
    expect(field.component).toBe(Aglyn.FieldComponentType.SELECT)
    expect(field.name).toBe('formId')
    expect(optionsOf(field)).toEqual([''])
    expect(labelsOf(field)[0]).toMatch(/cannot list forms/i)
  })

  it('treats a context with no `request` as no provider', () => {
    // `request` is the contract's own "a provider is mounted" member — it is
    // documented as absent wherever nothing lists entities.
    expect(Aglyn.entityListState({}, 'forms')).toBe('unavailable')
    expect(Aglyn.entityListState(undefined, 'forms')).toBe('unavailable')
    expect(
      Aglyn.entityListState(
        contextWith({ status: { forms: 'ready' } }),
        'forms',
      ),
    ).toBe('ready')
  })

  it('holds an unreported kind at loading, never at ready', () => {
    // A provider that has not said anything about `forms` has not settled
    // one, and an empty list from it must not be sold as the site's answer.
    expect(Aglyn.entityListState(contextWith({}), 'forms')).toBe('loading')
    const field = buildEntityPickerField(formIdField, 'forms', contextWith({}))
    expect(labelsOf(field)[0]).toMatch(/loading/i)
  })

  it('says the site has none only once the read has settled', () => {
    const field = buildEntityPickerField(
      formIdField,
      'forms',
      contextWith({ forms: [], status: { forms: 'ready' } }),
    )
    expect(labelsOf(field)[0]).toMatch(/no forms/i)
  })
})

describe('every entity picker resolves its options from one table', () => {
  it('maps each attribute type to the list it displays', () => {
    expect(ENTITY_PICKER_KINDS).toMatchObject({
      [Aglyn.FieldComponentType.PRODUCT_SELECT]: 'products',
      [Aglyn.FieldComponentType.COLLECTION_SELECT]: 'collections',
      [Aglyn.FieldComponentType.CATEGORY_SELECT]: 'categories',
      [Aglyn.FieldComponentType.DATASET_SELECT]: 'datasets',
      [Aglyn.FieldComponentType.FORM_SELECT]: 'forms',
    })
  })

  it('covers every list the picker context can hand out', () => {
    // Derived, not hand-listed: a list the context offers with no attribute
    // type pointing at it is a picker nobody can place.
    const kinds: Aglyn.EntityPickerKind[] = [
      'products',
      'collections',
      'categories',
      'datasets',
      'forms',
    ]
    expect(Object.values(ENTITY_PICKER_KINDS).sort()).toEqual([...kinds].sort())
  })

  it('leaves DATASET_FIELD_SELECT out — it lists fields, not datasets', () => {
    expect(
      ENTITY_PICKER_KINDS[Aglyn.FieldComponentType.DATASET_FIELD_SELECT],
    ).toBeUndefined()
  })

  it('negative control: an ordinary text attribute is not a picker', () => {
    expect(
      ENTITY_PICKER_KINDS[Aglyn.FieldComponentType.TEXT_FIELD],
    ).toBeUndefined()
  })
})


/**
 * A stored value is not an option in a list — it is a fact about the node,
 * and the picker owes it a label whatever the browse window happens to hold.
 *
 * This is the half that let the window come down from hundreds of documents.
 * The options and the current selection used to be one bulk read, so the list
 * had to be wide enough to contain whatever an author picked last month — and
 * past that width the picker rendered a bound element as UNBOUND, which reads
 * as "nothing chosen" and is repaired by choosing again.
 */
describe('a stored value renders its label, in or out of the window', () => {
  const listed = contextWith({
    forms: [{ id: 'form-1', label: 'Apply now' }],
    status: { forms: 'ready' },
  })

  it('adds nothing when the window already offers the value', () => {
    expect(entitySelectionOption(listed, 'forms', 'form-1')).toBeUndefined()
    expect(
      optionsOf(buildEntityPickerField(formIdField, 'forms', listed, 'form-1')),
    ).toEqual(['', 'form-1'])
  })

  it('offers a resolved value the window does NOT hold', () => {
    const context = contextWith({
      forms: [{ id: 'form-1', label: 'Apply now' }],
      status: { forms: 'ready' },
      resolved: { forms: { 'form-900': { id: 'form-900', label: 'Careers' } } },
    })
    const field = buildEntityPickerField(
      formIdField,
      'forms',
      context,
      'form-900',
    )
    expect(optionsOf(field)).toEqual(['', 'form-1', 'form-900'])
    expect(labelsOf(field)).toContain('Careers')
  })

  it('never rewrites the stored value while naming it', () => {
    // Naming a reference must not change it, or opening the panel and
    // pressing Save would convert a recoverable id into something else.
    const context = contextWith({
      status: { forms: 'ready' },
      resolved: { forms: { 'form-900': null } },
    })
    expect(entitySelectionOption(context, 'forms', 'form-900')?.value).toBe(
      'form-900',
    )
  })

  it('names a value whose document is GONE rather than dropping it', () => {
    const context = contextWith({
      status: { forms: 'ready' },
      resolved: { forms: { 'form-900': null } },
    })
    const option = entitySelectionOption(context, 'forms', 'form-900')
    expect(option?.label).toMatch(/unavailable form/i)
    expect(option?.label).toContain('form-900')
  })

  it('shows the raw id while a resolution is still in flight', () => {
    // Never a warning here. Flashing "unavailable" over every live reference
    // for the beat before the keyed read lands teaches authors to ignore the
    // one warning that means something.
    const context = contextWith({
      status: { forms: 'ready' },
      resolve: () => undefined,
    })
    expect(entitySelectionOption(context, 'forms', 'form-900')).toEqual({
      value: 'form-900',
      label: 'form-900',
    })
  })

  it('marks a value a settled picker can never look up', () => {
    // No resolver and a settled list: there is no answer coming, so the raw
    // value is all there will ever be — and unmarked it reads as a resolved
    // NAME, which is exactly what a caption stored where an id belongs is.
    const option = entitySelectionOption(listed, 'forms', 'Apply now')
    expect(option?.label).toMatch(/unrecognized form/i)
    expect(option?.label).not.toBe('Apply now')
  })

  it('adds nothing at all when the node carries no value', () => {
    expect(entitySelectionOption(listed, 'forms', '')).toBeUndefined()
    expect(entitySelectionOption(listed, 'forms', undefined)).toBeUndefined()
    expect(
      optionsOf(buildEntityPickerField(formIdField, 'forms', listed)),
    ).toEqual(['', 'form-1'])
  })
})

/**
 * Which selections are worth a keyed read, and — the part that matters for
 * cost — which are not.
 */
describe('a keyed read is asked for only when nothing else can answer', () => {
  const base = {
    request: () => undefined,
    resolve: () => undefined,
  }

  it('asks for an id the settled window does not hold', () => {
    expect(
      Aglyn.entityValueNeedsResolution(
        { ...base, forms: [], status: { forms: 'ready' } },
        'forms',
        'form-900',
      ),
    ).toBe('form-900')
  })

  it('asks for nothing when the window already holds it', () => {
    expect(
      Aglyn.entityValueNeedsResolution(
        {
          ...base,
          forms: [{ id: 'form-1', label: 'Apply now' }],
          status: { forms: 'ready' },
        },
        'forms',
        'form-1',
      ),
    ).toBeUndefined()
  })

  it('waits for the browse read rather than racing it', () => {
    // Asking while the listener is still loading would spend a keyed read on
    // nearly every picker on every site — moving the cost rather than
    // removing it.
    expect(
      Aglyn.entityValueNeedsResolution(
        { ...base, forms: [], status: { forms: 'loading' } },
        'forms',
        'form-900',
      ),
    ).toBeUndefined()
  })

  it('asks once, including when the answer was that it is gone', () => {
    expect(
      Aglyn.entityValueNeedsResolution(
        {
          ...base,
          forms: [],
          status: { forms: 'ready' },
          resolved: { forms: { 'form-900': null } },
        },
        'forms',
        'form-900',
      ),
    ).toBeUndefined()
  })

  it('asks for nothing on a surface that cannot resolve at all', () => {
    expect(
      Aglyn.entityValueNeedsResolution(
        { request: () => undefined, forms: [], status: { forms: 'ready' } },
        'forms',
        'form-900',
      ),
    ).toBeUndefined()
    expect(
      Aglyn.entityValueNeedsResolution(undefined, 'forms', 'form-900'),
    ).toBeUndefined()
  })

  it('asks for nothing when the node carries no value', () => {
    const context = { ...base, forms: [], status: { forms: 'ready' } }
    expect(Aglyn.entityValueNeedsResolution(context, 'forms', '')).toBeUndefined()
    expect(Aglyn.entityValueNeedsResolution(context, 'forms', '   ')).toBeUndefined()
    expect(Aglyn.entityValueNeedsResolution(context, 'forms', 42)).toBeUndefined()
  })
})

/**
 * A list that is a page must SAY it is a page.
 *
 * "Not in the picker" and "does not exist" are the same empty dropdown, and
 * only one of them is a fact about the author's site. The inbox's form filter
 * carries the same sentence for the same reason.
 */
describe('a truncated browse says so, and says how far it reaches', () => {
  it('says nothing when the list IS the site', () => {
    expect(
      entityPickerBrowseNotice(
        'forms',
        contextWith({ status: { forms: 'ready' } }),
      ),
    ).toBeUndefined()
    expect(
      entityPickerBrowseNotice(
        'forms',
        contextWith({ truncated: { forms: false } }),
      ),
    ).toBeUndefined()
  })

  it('names the window size, and the number is the constant', () => {
    const notice = entityPickerBrowseNotice(
      'forms',
      contextWith({ truncated: { forms: true } }),
    ) as string
    expect(notice).toContain(String(Aglyn.ENTITY_PICKER_BROWSE_LIMIT))
    expect(notice).toContain('Showing the first 25 forms')
    expect(notice).toMatch(/this site has more/i)
  })

  it('promises a whole-collection search only where one exists', () => {
    // Products carry `nameTokens`/`nameLower`; the other four do not. A
    // picker that promised a catalog-wide search and then ran one over 25
    // rows would be a worse lie than saying nothing.
    const searchable = entityPickerBrowseNotice(
      'products',
      contextWith({
        truncated: { products: true },
        searchable: { products: true },
      }),
    ) as string
    expect(searchable).toMatch(/search all of them/i)
    const bounded = entityPickerBrowseNotice(
      'forms',
      contextWith({ truncated: { forms: true }, searchable: { forms: false } }),
    ) as string
    expect(bounded).toMatch(/narrows these 25 only/i)
    expect(bounded).not.toMatch(/search all/i)
  })

  it('names its own kind, so a product picker never says "forms"', () => {
    expect(
      entityPickerBrowseNotice(
        'products',
        contextWith({ truncated: { products: true } }),
      ),
    ).toContain('products')
  })
})

describe('"no match" is a statement about the list it searched', () => {
  it('says the window when the window is all it looked at', () => {
    const text = entityPickerNoMatchText(
      'forms',
      contextWith({ truncated: { forms: true }, searchable: { forms: false } }),
    )
    expect(text).toMatch(/first 25 forms/i)
    expect(text).toMatch(/this site has more/i)
  })

  it('says plainly no match when it really did look everywhere', () => {
    expect(
      entityPickerNoMatchText(
        'products',
        contextWith({
          truncated: { products: true },
          searchable: { products: true },
        }),
      ),
    ).toBe('No products match.')
    expect(entityPickerNoMatchText('products', contextWith({}))).toBe(
      'No products match.',
    )
  })
})

describe('the picker is typable, and typing asks the provider', () => {
  it('is searchable, so 25 rows can be narrowed by typing', () => {
    // Without this the dropdown's input is READ-ONLY and a list of any size
    // could only be scrolled.
    const field = buildEntityPickerField(formIdField, 'forms', contextWith({}))
    expect((field as { isSearchable?: boolean }).isSearchable).toBe(true)
  })

  it('forwards a typed character to the provider, with its kind', () => {
    const asked: Array<[string, string]> = []
    const field = buildEntityPickerField(
      formIdField,
      'forms',
      contextWith({ search: (kind, text) => asked.push([kind, text]) }),
    ) as { onSearchInput?: (text: string, reason?: string) => void }
    field.onSearchInput?.('cont', 'input')
    expect(asked).toEqual([['forms', 'cont']])
  })

  it('ignores the field describing itself, which is not a search', () => {
    // Autocomplete emits `reset` on mount and again on every selection.
    // Treating those as queries would spend a search read on opening the
    // panel — the read this whole arc is about not making.
    const asked: Array<[string, string]> = []
    const field = buildEntityPickerField(
      formIdField,
      'forms',
      contextWith({ search: (kind, text) => asked.push([kind, text]) }),
    ) as { onSearchInput?: (text: string, reason?: string) => void }
    field.onSearchInput?.('Apply now', 'reset')
    field.onSearchInput?.('Apply now', 'selectOption')
    field.onSearchInput?.('', 'clear')
    expect(asked).toEqual([])
  })

  it('offers no search handler on a surface with no provider', () => {
    const field = buildEntityPickerField(formIdField, 'forms', undefined) as {
      onSearchInput?: unknown
    }
    expect(field.onSearchInput).toBeUndefined()
  })
})
