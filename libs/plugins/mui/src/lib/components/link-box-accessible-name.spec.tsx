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
 * A Link Container's link has a name, or is deliberately a duplicate
 * (AGL-2886).
 *
 * Found while building the /product cards: each card has a title link and a
 * small arrow to the same page, and the only way to make the arrow a link is
 * to wrap its Icon in a Link Container. That renders `<a href><svg/></a>` —
 * a link with no name, announced as "link" and nothing else, and a second tab
 * stop to a destination the title already offers.
 *
 * Names are asserted with `getByRole('link', { name })`, which asks the
 * accessibility tree the question a screen reader asks, so a regression that
 * drops the attribute fails here rather than passing on markup that merely
 * looks right.
 */

import * as Aglyn from '@aglyn/aglyn'
import { mdiShapePlus } from '@aglyn/shared-data-mdi'
import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { ID as boxId } from './box'
import Icon, { ID as iconId } from './icon'
import { ID as imageId } from './image'
import LinkBox, { ID, schema } from './link-box'
import {
  linkContainerLabelFieldProps,
  UNNAMED_LINK_CONTAINER_WARNING,
} from './link-box-accessible-name'
import { ID as listItemTextId } from './list-item-text'
import { ID as stackId } from './stack'
import { ID as typographyId } from './typography'

/** A published site whose routing map knows about `about`. */
const onSite = (ui: React.ReactElement) => (
  <Aglyn.ScreenLinkContext.Provider
    value={{ screens: { about: 'company/about' } }}
  >
    {ui}
  </Aglyn.ScreenLinkContext.Provider>
)

const renderSite = (ui: React.ReactElement) => render(onSite(ui))

/** The besigner canvas: the same routing map, with navigation suppressed. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider
      value={{ screens: { about: 'company/about' }, suppressNavigation: true }}
    >
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

/** The single rendered element, whatever tag it turned out to be. */
const root = (container: HTMLElement) =>
  container.firstElementChild as HTMLElement

/** The card's arrow: a real Icon, which draws an SVG and no text. */
const arrow = <Icon iconPath={mdiShapePlus.path} />

describe('Accessible label on a published page (AGL-2886)', () => {
  it('names a link whose only content is an icon', () => {
    renderSite(
      <LinkBox screenId="about" ariaLabel="About the company">
        {arrow}
      </LinkBox>,
    )
    const link = screen.getByRole('link', { name: 'About the company' })
    expect(link.getAttribute('href')).toBe('/company/about')
  })

  it('is in the server-rendered page, before any client code runs', () => {
    const html = renderToString(
      onSite(
        <LinkBox screenId="about" ariaLabel="About the company">
          {arrow}
        </LinkBox>,
      ),
    )
    expect(html).toContain('aria-label="About the company"')
    expect(html).toContain('href="/company/about"')
  })

  it('is the defect it exists for: without one, the link has no name', () => {
    // Negative control. The anchor is in the accessibility tree as a link
    // whose computed name is empty, which is what a screen reader reads out
    // as just "link".
    renderSite(<LinkBox screenId="about">{arrow}</LinkBox>)
    expect(screen.getByRole('link', { name: '' })).toBeTruthy()
    expect(screen.getByRole('link').hasAttribute('aria-label')).toBe(false)
  })

  it('trims the label, and renders no attribute for a blank one', () => {
    const { container, rerender } = renderSite(
      <LinkBox screenId="about" ariaLabel="  About the company ">
        {arrow}
      </LinkBox>,
    )
    expect(root(container).getAttribute('aria-label')).toBe('About the company')

    rerender(
      onSite(
        <LinkBox screenId="about" ariaLabel="   ">
          {arrow}
        </LinkBox>,
      ),
    )
    expect(root(container).hasAttribute('aria-label')).toBe(false)
  })

  it('takes a binding, resolved by the page before the element renders', () => {
    // The published page resolves `{{var:…}}` in every string prop of every
    // node before rendering, so a bound label reaches the anchor as text.
    const nodes = {
      arrow: {
        $id: 'arrow',
        componentId: ID,
        props: { screenId: 'about', ariaLabel: 'About {{var:idCompany01}}' },
      },
    }
    const bound = Aglyn.resolveNodesBindings(nodes as never, {
      idCompany01: { name: 'Company', type: 'text', value: 'Aglyn' },
    } as never) as typeof nodes
    renderSite(<LinkBox {...bound.arrow.props}>{arrow}</LinkBox>)
    expect(screen.getByRole('link', { name: 'About Aglyn' })).toBeTruthy()
  })

  it('carries the same label on the canvas', () => {
    const { container } = renderEditor(
      <LinkBox screenId="about" ariaLabel="About the company">
        {arrow}
      </LinkBox>,
    )
    expect(root(container).tagName).toBe('A')
    expect(root(container).getAttribute('aria-label')).toBe('About the company')
  })
})

describe('Duplicate of another link (AGL-2886)', () => {
  it('leaves the accessibility tree and the tab order, and still navigates', () => {
    const { container } = renderSite(
      <LinkBox screenId="about" redundant>
        {arrow}
      </LinkBox>,
    )
    const anchor = root(container)
    expect(anchor.getAttribute('aria-hidden')).toBe('true')
    expect(anchor.getAttribute('tabindex')).toBe('-1')
    // A pointer still has somewhere to go.
    expect(anchor.getAttribute('href')).toBe('/company/about')
    // Nothing is announced: the card's title link is the one a screen
    // reader meets.
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('is in the server-rendered page as well', () => {
    const html = renderToString(
      onSite(
        <LinkBox screenId="about" redundant>
          {arrow}
        </LinkBox>,
      ),
    )
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('href="/company/about"')
  })

  it('drops a label nothing would announce', () => {
    const { container } = renderSite(
      <LinkBox screenId="about" ariaLabel="About the company" redundant>
        {arrow}
      </LinkBox>,
    )
    expect(root(container).hasAttribute('aria-label')).toBe(false)
  })

  it('renders the same attributes on the canvas', () => {
    const { container } = renderEditor(
      <LinkBox screenId="about" redundant>
        {arrow}
      </LinkBox>,
    )
    expect(root(container).getAttribute('aria-hidden')).toBe('true')
    expect(root(container).getAttribute('tabindex')).toBe('-1')
  })

  it("reads a bound switch's 'false' as a no", () => {
    // A switch bound to a Yes / no property can arrive as the string.
    const { container } = renderSite(
      <LinkBox screenId="about" redundant={'false' as never}>
        {arrow}
      </LinkBox>,
    )
    expect(root(container).hasAttribute('aria-hidden')).toBe(false)
    expect(root(container).hasAttribute('tabindex')).toBe(false)
  })
})

describe('the Link Container schema (AGL-2886)', () => {
  const attribute = (name: string) =>
    schema.attributes?.find((field) => field.name === name)

  it('offers Accessible label as a text attribute, like Section does', () => {
    const label = attribute('ariaLabel')
    expect(label?.['label']).toBe('Accessible label')
    // Text fields are what the Attributes panel draws with the token editor,
    // which is what lets a label take a binding.
    expect(label?.component).toBe(Aglyn.FieldComponentType.TEXT_FIELD)
    // Hidden once the link is a duplicate: a control that does nothing is
    // worse than no control.
    expect(label?.condition).toEqual({
      when: 'redundant',
      is: true,
      notMatch: true,
    })
    expect(label?.resolveProps).toBe(linkContainerLabelFieldProps)
  })

  it('offers Duplicate of another link as a switch that says when to use it', () => {
    const duplicate = attribute('redundant')
    expect(duplicate?.['label']).toBe('Duplicate of another link')
    expect(duplicate?.component).toBe(Aglyn.FieldComponentType.SWITCH)
    expect(duplicate?.description).toMatch(/goes to the same place/)
    expect(duplicate?.description).toMatch(/Leave it off when this is the only link/)
  })
})

describe('the Accessible label warning (AGL-2886)', () => {
  type Node = Aglyn.NodeSchema<any>

  const node = (
    $id: string,
    componentId: string,
    props: Record<string, unknown> = {},
    nodes: string[] = [],
    extra: Partial<Node> = {},
  ): Node => ({ $id, type: 'node', componentId, props, nodes, ...extra }) as Node

  const lookup =
    (...nodes: Node[]) =>
    (id: string) =>
      nodes.find((candidate) => candidate.$id === id)

  const box = (...children: string[]) => node('card-arrow', ID, {}, children)

  /** The field's helper text for a box, a document and the live form values. */
  const helperText = (
    container: Node,
    getNode: (id: string) => Node | undefined,
    values: { label?: unknown; redundant?: unknown } = {},
  ) =>
    linkContainerLabelFieldProps(
      {},
      { input: { value: values.label ?? '' } },
      { getState: () => ({ values: { redundant: values.redundant } }) },
      { node: container, getNode },
    ).helperText

  const glyph = node('glyph', iconId, { iconId: 'arrow-top-right' })

  it('warns for a box holding only an icon, and names both ways out', () => {
    const warning = helperText(box('glyph'), lookup(glyph))
    expect(warning).toBe(UNNAMED_LINK_CONTAINER_WARNING)
    expect(warning).toMatch(/Duplicate of another link/)
  })

  it('warns for an empty box', () => {
    expect(helperText(box(), lookup())).toBe(UNNAMED_LINK_CONTAINER_WARNING)
  })

  it('looks through layout containers to the icon inside', () => {
    const doc = lookup(
      node('frame', boxId, {}, ['row']),
      node('row', stackId, {}, ['glyph']),
      glyph,
    )
    expect(helperText(box('frame'), doc)).toBe(UNNAMED_LINK_CONTAINER_WARNING)
  })

  it('is satisfied by text inside, at any depth', () => {
    const doc = lookup(
      node('frame', boxId, {}, ['glyph', 'title']),
      glyph,
      node('title', typographyId, { children: 'Datasets' }),
    )
    expect(helperText(box('frame'), doc)).toBeUndefined()
  })

  it('counts a binding and formatted text as text', () => {
    expect(
      helperText(
        box('title'),
        lookup(node('title', typographyId, { children: '{{entry.title}}' })),
      ),
    ).toBeUndefined()
    expect(
      helperText(
        box('title'),
        lookup(node('title', typographyId, { html: '<b>Datasets</b>' })),
      ),
    ).toBeUndefined()
  })

  it("counts an image's alt text, unless the image is decorative", () => {
    const named = node('shot', imageId, { src: 'media:x', alt: 'Datasets' })
    expect(helperText(box('shot'), lookup(named))).toBeUndefined()

    const decorative = node('shot', imageId, {
      src: 'media:x',
      alt: 'Datasets',
      decorative: true,
    })
    expect(helperText(box('shot'), lookup(decorative))).toBe(
      UNNAMED_LINK_CONTAINER_WARNING,
    )
    expect(
      helperText(box('shot'), lookup(node('shot', imageId, { src: 'media:x' }))),
    ).toBe(UNNAMED_LINK_CONTAINER_WARNING)
  })

  it('stays quiet about elements whose words it cannot read', () => {
    // List Item Text keeps its lines in props of its own, and a component
    // placement keeps its words in the definition. Neither is provably silent.
    expect(
      helperText(
        box('lines'),
        lookup(node('lines', listItemTextId, { primary: 'Datasets' })),
      ),
    ).toBeUndefined()
    expect(
      helperText(
        box('card'),
        lookup(node('card', Aglyn.REUSABLE_INSTANCE_COMPONENT_ID, { refId: 'c1' })),
      ),
    ).toBeUndefined()
    // A child id the document no longer resolves is an unknown too.
    expect(helperText(box('gone'), lookup())).toBeUndefined()
  })

  it('does not count text the page hides', () => {
    const doc = lookup(
      glyph,
      node('title', typographyId, { children: 'Datasets' }, [], { hidden: true }),
    )
    expect(helperText(box('glyph', 'title'), doc)).toBe(
      UNNAMED_LINK_CONTAINER_WARNING,
    )
  })

  it('clears once a label is typed, but not for a blank one', () => {
    const doc = lookup(glyph)
    expect(helperText(box('glyph'), doc, { label: 'Datasets' })).toBeUndefined()
    expect(helperText(box('glyph'), doc, { label: '{{prop.title}}' })).toBeUndefined()
    expect(helperText(box('glyph'), doc, { label: '   ' })).toBe(
      UNNAMED_LINK_CONTAINER_WARNING,
    )
  })

  it('clears for a duplicate, and while a binding decides that per page', () => {
    const doc = lookup(glyph)
    expect(helperText(box('glyph'), doc, { redundant: true })).toBeUndefined()
    expect(
      helperText(box('glyph'), doc, { redundant: '{{prop.duplicate}}' }),
    ).toBeUndefined()
    expect(helperText(box('glyph'), doc, { redundant: false })).toBe(
      UNNAMED_LINK_CONTAINER_WARNING,
    )
  })

  it('says nothing without the Attributes panel context', () => {
    // An instance's attribute overrides and any other form call it with
    // data-driven-forms' three arguments only.
    expect(
      linkContainerLabelFieldProps({}, { input: { value: '' } }, {}),
    ).toEqual({})
  })
})
