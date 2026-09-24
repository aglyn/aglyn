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

import { HostViewType } from '@aglyn/aglyn'
import {
  allPlacementCopyStrings,
  describePart,
  EMAIL_PLACEMENT_STYLE_NOTE,
  describeParts,
  type PartEntry,
  type PartNode,
  placementCopy,
  placementKindFor,
  propDefaultsOf,
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

  it.each(['component', 'form', 'layout', 'email'] as const)(
    'never shows a %s author the storage vocabulary',
    (kind) => {
      for (const text of allPlacementCopyStrings(kind)) {
        expect(text).not.toMatch(BANNED)
      }
    },
  )

  /**
   * A reusable block placed in an email (AGL-3287): the author has an email
   * open, not a page, and every element there is a block — so the section
   * says so, and never mentions a page.
   */
  it('words a block placed in an email for the email it is in', () => {
    const email = placementCopy('email')
    expect(email.sectionTitle).toBe('Change it in this email only')
    expect(email.intro).toBe(
      'Changes here affect this email only. The block itself, and every ' +
        'other email using it, stay the same.',
    )
    expect(email.wholePart).toBe('Whole block')
    expect(email.summary(0)).toBe('No changes in this email yet')
    expect(email.summary(2)).toBe('2 changes in this email')
    expect(email.resetField('Color')).toBe("Reset Color to the block's value")
    for (const text of allPlacementCopyStrings('email')) {
      expect(text).not.toMatch(/\bpages?\b|\bcomponent\b/i)
    }
  })

  it('reads a placement on an email canvas as a block in that email', () => {
    expect(placementKindFor(false, HostViewType.EMAIL)).toBe('email')
    expect(placementKindFor(false, HostViewType.SCREEN)).toBe('component')
    expect(placementKindFor(false, undefined)).toBe('component')
    // A placed form stays a form wherever it is.
    expect(placementKindFor(true, HostViewType.EMAIL)).toBe('form')
  })

  it('tells an email author where a block changes its look, since the Styles tab cannot', () => {
    // The one string that names a tab: it is not in the sweep above because
    // "Attributes" is the tab's on-screen label, not storage vocabulary.
    expect(EMAIL_PLACEMENT_STYLE_NOTE).toBe(
      "In emails, change a block's look with its settings in the Attributes tab.",
    )
    expect(allPlacementCopyStrings('email')).not.toContain(
      EMAIL_PLACEMENT_STYLE_NOTE,
    )
  })

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
    icon: { componentId: 'icon', parentId: 'iconRow', props: {} },
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

  it("names an email block's parts by what they are, not by the drawer's label (AGL-3287)", () => {
    const header: Record<string, PartNode> = {
      band: { componentId: 'emailSection', nodes: ['logo', 'name'] },
      logo: { componentId: 'emailImage', parentId: 'band', props: { alt: 'Logo' } },
      name: {
        componentId: 'emailText',
        parentId: 'band',
        props: { children: 'Your company' },
      },
    }
    const part = (id: string, isRoot = false): PartEntry => ({
      componentInternalId: id,
      componentId: header[id]?.componentId,
      isRoot,
    })
    expect(describePart(part('band', true), header, { kind: 'email' })).toBe(
      'Whole block',
    )
    expect(describePart(part('logo'), header, { kind: 'email' })).toBe(
      'Image: Logo',
    )
    expect(describePart(part('name'), header, { kind: 'email' })).toBe(
      'Text: "Your company"',
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

  it('reads an unset property token as the default the page shows (AGL-3293)', () => {
    expect(
      describePart(entry('bound'), nodes, {
        propDefaults: { headline: 'Every product works together.' },
      }),
    ).toBe('Text: "Every product works together."')
    // The page's own value still wins over the default.
    expect(
      describePart(entry('bound'), nodes, {
        propValues: { headline: 'Ship faster' },
        propDefaults: { headline: 'Every product works together.' },
      }),
    ).toBe('Text: "Ship faster"')
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

/**
 * The marketing site's Explore the platform band, as the Developers page
 * places it (AGL-3293): a section → container → heading group and a grid of
 * cards, each card a Stack with its own fill, border and shadow holding a row
 * of two icon boxes, a title link and a line of text. The picker used to name
 * every icon and box in every card after the band's eyebrow, name the grid
 * after its first card, and name the unset lede "Lede".
 */
describe('describeParts on the Explore the platform band (AGL-3293)', () => {
  const card = (
    id: string,
    title: string,
    body: string,
    plateIcon: string,
  ): Record<string, PartNode> => ({
    [id]: {
      componentId: 'muiStack',
      parentId: 'grid',
      nodes: [`${id}Row`, `${id}Title`, `${id}Body`],
      sx: {
        bgcolor: 'background.paper',
        border: '1px solid',
        boxShadow: 1,
      },
    },
    [`${id}Row`]: {
      componentId: 'muiStack',
      parentId: id,
      nodes: [`${id}Plate`, `${id}ArrowBox`],
    },
    [`${id}Plate`]: {
      componentId: 'muiStack',
      parentId: `${id}Row`,
      nodes: [`${id}PlateIcon`],
      sx: { bgcolor: '#F1F3F5', borderRadius: '8px' },
    },
    [`${id}PlateIcon`]: {
      componentId: 'icon',
      parentId: `${id}Plate`,
      props: { iconId: plateIcon },
    },
    [`${id}ArrowBox`]: {
      componentId: 'muiStack',
      parentId: `${id}Row`,
      nodes: [`${id}Arrow`],
    },
    [`${id}Arrow`]: {
      componentId: 'icon',
      parentId: `${id}ArrowBox`,
      props: { iconId: 'arrow-top-right' },
    },
    [`${id}Title`]: {
      componentId: 'muiScreenLink',
      parentId: id,
      props: { children: title },
    },
    [`${id}Body`]: {
      componentId: 'muiTypography',
      parentId: id,
      props: { children: body },
    },
  })

  const nodes: Record<string, PartNode> = {
    band: { componentId: 'section', nodes: ['container'] },
    container: {
      componentId: 'muiContainer',
      parentId: 'band',
      nodes: ['heading', 'grid', 'docs'],
    },
    heading: {
      componentId: 'muiStack',
      parentId: 'container',
      nodes: ['eyebrow', 'headline', 'lede'],
    },
    eyebrow: {
      componentId: 'muiTypography',
      parentId: 'heading',
      props: { children: '{{prop.eyebrow}}' },
    },
    headline: {
      componentId: 'muiTypography',
      parentId: 'heading',
      props: { children: '{{prop.headline}}' },
    },
    lede: {
      componentId: 'muiTypography',
      parentId: 'heading',
      props: { children: '{{prop.lede}}' },
    },
    grid: {
      componentId: 'muiStack',
      parentId: 'container',
      nodes: ['besigner', 'console', 'commerce'],
    },
    ...card('besigner', 'Besigner', 'Design on a live canvas.', 'view-grid-outline'),
    ...card('console', 'Console', 'Every site in one place.', 'view-dashboard-outline'),
    ...card('commerce', 'Commerce', 'Products and checkout.', 'shopping-outline'),
    docs: {
      componentId: 'muiScreenLink',
      parentId: 'container',
      props: { children: '{{prop.docsLabel}}' },
    },
  }

  /** Every part in tree order, as `listInstanceStyleTargets` offers them. */
  const order: string[] = []
  const walk = (id: string) => {
    order.push(id)
    const children = nodes[id]?.nodes
    if (Array.isArray(children)) for (const child of children) walk(child)
  }
  walk('band')
  const entries = order.map((id) => ({
    key: id === 'band' ? 'root' : id,
    componentInternalId: id,
    componentId: nodes[id]?.componentId,
    isRoot: id === 'band',
  }))

  const definition = {
    rootId: 'band',
    nodes,
    props: [
      { name: 'eyebrow', type: 'text', defaultValue: 'ONE PLATFORM' },
      { name: 'headline', type: 'text', defaultValue: 'Every product works.' },
      {
        name: 'lede',
        type: 'richText',
        defaultValue: 'Every product below runs on the same platform.',
      },
      { name: 'docsLabel', type: 'text', defaultValue: 'Read the docs →' },
      { name: 'hideDocs', type: 'boolean' },
    ],
  }

  const labels = describeParts(entries, nodes, {
    propValues: {
      eyebrow: 'THE FULL STACK, BUILT IN',
      headline: 'Everything a modern site needs.',
    },
    propDefaults: propDefaultsOf(definition),
  })
  const label = (id: string) => labels.get(id === 'band' ? 'root' : id)

  it('reads the declared defaults off the definition', () => {
    expect(propDefaultsOf(definition)).toEqual({
      eyebrow: 'ONE PLATFORM',
      headline: 'Every product works.',
      lede: 'Every product below runs on the same platform.',
      docsLabel: 'Read the docs →',
    })
    expect(propDefaultsOf(undefined)).toEqual({})
    expect(propDefaultsOf({ rootId: 'x', nodes: {} })).toEqual({})
  })

  it('names the band, its heading and its lines as the page shows them', () => {
    expect(label('band')).toBe('Whole component')
    expect(label('container')).toBe('Container: THE FULL STACK, BUILT IN')
    expect(label('eyebrow')).toBe('Text: "THE FULL STACK, BUILT IN"')
    expect(label('headline')).toBe('Text: "Everything a modern site needs."')
    expect(label('lede')).toBe('Text: "Every product below runs on the…"')
    expect(label('docs')).toBe('Link: Read the docs →')
    // Stacked lines of a heading are not a collection to list.
    expect(label('heading')).toBe('Group: THE FULL STACK, BUILT IN')
  })

  it('names the grid by its cards, never by its first card alone', () => {
    expect(label('grid')).toBe('Group: Besigner, Console, Commerce')
    expect(label('besigner')).toBe('Card: Besigner')
    expect(label('grid')).not.toBe(label('besigner'))
  })

  it('places every icon and box in its own card, not in the band', () => {
    for (const id of order) {
      expect(label(id)).not.toContain('(in THE FULL STACK')
    }
    expect(label('besignerArrow')).toBe('Icon: Arrow top right (in Besigner card)')
    expect(label('consoleArrow')).toBe('Icon: Arrow top right (in Console card)')
    expect(label('besignerArrowBox')).toBe(
      'Icon box: Arrow top right (in Besigner card)',
    )
    expect(label('besignerPlateIcon')).toBe('Icon: View grid outline')
    expect(label('besignerPlate')).toBe('Icon box: View grid outline')
    expect(label('besignerRow')).toBe('Icons: View grid outline, Arrow top ri…')
  })

  it('gives every part a name no other part has', () => {
    const all = [...labels.values()]
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(order.length)
  })

  it('numbers twins that even their place cannot tell apart', () => {
    const twins: Record<string, PartNode> = {
      root: { componentId: 'muiStack', nodes: ['a', 'b'] },
      a: { componentId: 'muiBox', parentId: 'root' },
      b: { componentId: 'muiBox', parentId: 'root' },
    }
    const named = describeParts(
      ['root', 'a', 'b'].map((id) => ({
        key: id,
        componentInternalId: id,
        componentId: twins[id].componentId,
        isRoot: id === 'root',
      })),
      twins,
    )
    expect(named.get('a')).toBe('Group #1')
    expect(named.get('b')).toBe('Group #2')
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
