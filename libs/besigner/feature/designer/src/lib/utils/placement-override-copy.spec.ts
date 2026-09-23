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

import {
  allPlacementCopyStrings,
  describePart,
  type PartEntry,
  type PartNode,
  placementCopy,
  styleChangeLabel,
  truncatePreview,
} from './placement-override-copy'

/**
 * The words a site owner reads when changing one page's copy of a shared
 * component or form (AGL-3288).
 */
describe('placement override copy (AGL-3288)', () => {
  /**
   * The storage vocabulary, which means nothing to someone who has never
   * built a website. It may live in identifiers; it may not reach the screen.
   */
  const BANNED = /\b(attributes?|overrides?|overridden|instances?|targets?|root)\b/i

  it.each(['component', 'form', 'layout'] as const)(
    'never shows a %s author the storage vocabulary',
    (kind) => {
      for (const text of allPlacementCopyStrings(kind)) {
        expect(text).not.toMatch(BANNED)
      }
    },
  )

  it('names the section, the picker and the whole placement plainly', () => {
    const component = placementCopy('component')
    expect(component.sectionTitle).toBe('Change it on this page only')
    expect(component.intro).toBe(
      'Changes here affect this spot only. The component itself, and every ' +
        'other page using it, stay the same.',
    )
    expect(component.partPickerLabel).toBe('Which part?')
    expect(component.wholePart).toBe('Whole component')
    const form = placementCopy('form')
    expect(form.wholePart).toBe('Whole form')
    expect(form.intro).toContain('The form itself')
  })

  it('counts changes in words, and says so when there are none', () => {
    const copy = placementCopy('component')
    expect(copy.summary(0)).toBe('No changes on this page yet')
    expect(copy.summary(1)).toBe('1 change on this page')
    expect(copy.summary(3)).toBe('3 changes on this page')
    expect(copy.resetField('Variant')).toBe(
      "Reset Variant to the component's value",
    )
    expect(placementCopy('form').resetField('Label')).toBe(
      "Reset Label to the form's value",
    )
  })
})

describe('describePart (AGL-3288)', () => {
  /**
   * The shape of the marketing site's product card: a card holding a title,
   * a paragraph, a link and an icon.
   */
  const nodes: Record<string, PartNode> = {
    root: { componentId: 'muiStack', nodes: ['card'] },
    card: {
      componentId: 'muiCard',
      parentId: 'root',
      nodes: ['iconRow', 'lede', 'more'],
    },
    iconRow: {
      componentId: 'muiStack',
      parentId: 'card',
      nodes: ['icon', 'title'],
    },
    icon: { componentId: 'icon', parentId: 'iconRow', props: { icon: 'x' } },
    title: {
      componentId: 'muiTypography',
      parentId: 'iconRow',
      props: { children: 'Besigner' },
    },
    lede: {
      componentId: 'muiTypography',
      parentId: 'card',
      props: {
        children: 'Design on a live canvas and publish in one click',
      },
    },
    more: {
      componentId: 'muiScreenLink',
      parentId: 'card',
      props: { children: 'Read the docs →' },
    },
    cta: { componentId: 'muiButton', props: { children: 'Start free' } },
    photo: { componentId: 'image', props: { alt: 'A team at work' } },
    email: {
      componentId: 'formField',
      props: { label: 'Work email', fieldName: 'email' },
    },
    bound: {
      componentId: 'muiTypography',
      props: { children: '{{prop.headline}}' },
    },
    named: {
      componentId: 'muiStack',
      name: 'Pricing strip',
      nodes: ['cta'],
    },
    genericName: {
      componentId: 'muiTypography',
      name: 'Typography',
      props: { children: 'Hello' },
    },
    lonely: { componentId: 'muiBox' },
  }

  const entry = (id: string, isRoot = false): PartEntry => ({
    componentInternalId: id,
    componentId: nodes[id]?.componentId,
    name: nodes[id]?.name,
    isRoot,
  })

  it('calls the outermost element the whole component, or the whole form', () => {
    expect(describePart(entry('root', true), nodes)).toBe('Whole component')
    expect(describePart(entry('root', true), nodes, { kind: 'form' })).toBe(
      'Whole form',
    )
  })

  it('names a container by the first words inside it', () => {
    expect(describePart(entry('card'), nodes)).toBe('Card: Besigner')
  })

  it('quotes running text and cuts it short', () => {
    expect(describePart(entry('lede'), nodes)).toBe(
      'Text: "Design on a live canvas and pub…"',
    )
  })

  it('names links, buttons and images by what they show', () => {
    expect(describePart(entry('more'), nodes)).toBe('Link: Read the docs →')
    expect(describePart(entry('cta'), nodes)).toBe('Button: Start free')
    expect(describePart(entry('photo'), nodes)).toBe('Image: A team at work')
  })

  it('places an element with no words by what surrounds it', () => {
    expect(describePart(entry('icon'), nodes)).toBe('Icon (in Besigner card)')
  })

  it('names a form field by its label', () => {
    expect(describePart(entry('email'), nodes, { kind: 'form' })).toBe(
      'Field: Work email',
    )
  })

  it("fills a property token from this page's values, or names it", () => {
    expect(
      describePart(entry('bound'), nodes, {
        propValues: { headline: 'Ship faster' },
      }),
    ).toBe('Text: "Ship faster"')
    expect(describePart(entry('bound'), nodes)).toBe('Text: "Headline"')
  })

  it("prefers the name the definition's author gave, but not a type label", () => {
    expect(describePart(entry('named'), nodes)).toBe('Pricing strip')
    expect(describePart(entry('genericName'), nodes)).toBe('Text: "Hello"')
  })

  it('falls back to the friendly type name', () => {
    expect(describePart(entry('lonely'), nodes)).toBe('Group')
    expect(
      describePart(
        { componentInternalId: 'gone', componentId: 'section', isRoot: false },
        nodes,
      ),
    ).toBe('Section')
    expect(
      describePart({ componentInternalId: 'x', isRoot: false }, undefined),
    ).toBe('Part')
  })

  it('never names a part by its raw type or id', () => {
    for (const id of Object.keys(nodes)) {
      const label = describePart(entry(id, id === 'root'), nodes)
      expect(label).not.toMatch(/\bmui[A-Z]|Typography|Stack\b/)
      expect(label).not.toBe(id)
    }
  })

  it('truncates at 32 characters with an ellipsis', () => {
    expect(truncatePreview('short')).toBe('short')
    const cut = truncatePreview('a'.repeat(40))
    expect(cut).toHaveLength(32)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('styleChangeLabel (AGL-3288)', () => {
  it("uses the panel's own field label first", () => {
    expect(styleChangeLabel('borderRadius', { borderRadius: 'Corner Radius' })).toBe(
      'Corner Radius',
    )
  })

  it('names spacing shorthands and spells out anything else', () => {
    expect(styleChangeLabel('mt')).toBe('Top margin')
    expect(styleChangeLabel('paddingInline')).toBe('Left & right padding')
    expect(styleChangeLabel('borderTopColor')).toBe('Border top color')
    expect(styleChangeLabel('& .headline')).toBe('Custom CSS')
  })
})
