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
import { render, screen } from '@testing-library/react'
import BoxElement from './box'
import InlineText, { ID, presets, schema } from './inline-text'

/** The single rendered element, whatever tag it turned out to be. */
const root = (container: HTMLElement) =>
  container.firstElementChild as HTMLElement

const styleOf = (el: Element) => getComputedStyle(el as HTMLElement)

describe('InlineText (AGL-1235)', () => {
  it('keeps its persisted component id', () => {
    // Ids are stored in screen documents; renaming orphans every instance.
    expect(ID).toBe('muiInlineText')
    expect(schema.$id).toBe('muiInlineText')
  })

  it('renders the chosen phrasing element', () => {
    const { container } = render(<InlineText element="strong">{'part of the platform'}</InlineText>)
    expect(root(container).tagName).toBe('STRONG')
    expect(screen.getByText('part of the platform')).toBeTruthy()
  })

  it('falls back to a span for a cleared or unknown element', () => {
    // A cleared SELECT attribute persists as null, and the value is written
    // verbatim into the DOM — an allow-list miss must land on `span`, not
    // on whatever the author (or a hand-edited document) typed.
    const cleared = render(<InlineText element={null as any}>{'a'}</InlineText>)
    expect(root(cleared.container).tagName).toBe('SPAN')
    const junk = render(<InlineText element={'script' as any}>{'b'}</InlineText>)
    expect(root(junk.container).tagName).toBe('SPAN')
  })

  it('is a text leaf, so the canvas edits it as text', () => {
    // `textEditable` is what makes the Attributes "Text" field and inline
    // canvas editing work. It also makes the node a leaf — which is correct
    // here: the shape that renders is SIBLING runs, not a nested span.
    expect(schema.flags?.textEditable).toBe(Aglyn.FEATURE_FLAG.ENABLED)
    expect(schema.flags?.selfClosing).toBeUndefined()
    const text = schema.attributes?.find((attr) => attr.name === 'children')
    expect(text).toBeTruthy()
  })

  it('declares every emphasis control as an attribute, so it is clickable', () => {
    // A capability only reachable by hand-editing the document is not a
    // capability: the marketing site is built by clicking.
    const names = (schema.attributes ?? []).map((attr) => attr.name)
    expect(names).toEqual(
      expect.arrayContaining(['children', 'element', 'tone', 'weight', 'decoration']),
    )
  })

  it('never offers an empty-string option value', () => {
    // The attributes form strips `''` on change, so such a pick never
    // persists and silently reverts on reload (AGL-1191). Every "unset"
    // option here is the real `inherit` sentinel instead.
    for (const attr of schema.attributes ?? []) {
      for (const option of (attr as any).options ?? []) {
        expect(option.value).not.toBe('')
      }
    }
  })

  describe('two-tone text in one sentence', () => {
    const statement = (
      <BoxElement component="p">
        <InlineText tone="secondary">{'Aglyn commerce is '}</InlineText>
        <InlineText element="strong" tone="primary" weight="bold">
          {'part of the platform'}
        </InlineText>
        <InlineText tone="secondary">{'.'}</InlineText>
      </BoxElement>
    )

    it('flows the runs as one paragraph', () => {
      const { container } = render(statement)
      const paragraph = root(container)
      expect(paragraph.tagName).toBe('P')
      // Inline runs inside a block container wrap as a single sentence.
      // If any of them were `block`, the statement would break into three
      // stacked lines and the emphasis would read as its own paragraph.
      const runs = Array.from(paragraph.children)
      expect(runs).toHaveLength(3)
      for (const run of runs) expect(styleOf(run).display).toBe('inline')
    })

    it('gives the emphasised phrase a different colour from the rest', () => {
      const { container } = render(statement)
      const [before, emphasis] = Array.from(root(container).children)
      // Theme tokens, not the design's literal #757575/#212121 — a hex
      // hardcoded into a themed site is the worse of the two mismatches.
      expect(styleOf(emphasis).color).toBeTruthy()
      expect(styleOf(emphasis).color).not.toBe(styleOf(before).color)
      expect(styleOf(emphasis).fontWeight).toBe('700')
    })
  })

  describe('text-decoration propagation', () => {
    /**
     * `text-decoration` propagates rather than inherits: a link's underline
     * is painted across its in-flow inline descendants and the descendant
     * CANNOT cancel it. jsdom does not paint, so these assert the mechanism
     * that does the cutting — an atomic inline box — not the pixels.
     */
    it('cuts a propagated decoration by making the run atomic', () => {
      const { container } = render(
        <InlineText decoration="none">{'not underlined'}</InlineText>,
      )
      const style = styleOf(root(container))
      // The load-bearing half. `textDecoration: none` alone is decorative
      // here: it does nothing against an ancestor's underline.
      expect(style.display).toBe('inline-block')
      expect(style.textDecoration).toContain('none')
    })

    it('flows and wraps normally by default', () => {
      // The cost of `inline-block` is that the run cannot break across
      // lines, so it must not be what an author gets without asking.
      const { container } = render(<InlineText>{'flows'}</InlineText>)
      expect(styleOf(root(container)).display).toBe('inline')
      const inherited = render(
        <InlineText decoration="inherit">{'flows too'}</InlineText>,
      )
      expect(styleOf(root(inherited.container)).display).toBe('inline')
    })

    it('can also add a decoration of its own', () => {
      const underlined = render(
        <InlineText decoration="underline">{'u'}</InlineText>,
      )
      expect(styleOf(root(underlined.container)).textDecoration).toContain(
        'underline',
      )
      const struck = render(
        <InlineText decoration="lineThrough">{'s'}</InlineText>,
      )
      expect(styleOf(root(struck.container)).textDecoration).toContain(
        'line-through',
      )
      // Both keep flowing — only "None" pays the wrapping cost.
      expect(styleOf(root(underlined.container)).display).toBe('inline')
    })
  })

  it('merges node styles over the baseline instead of replacing it', () => {
    // The renderer hands the node's `sx` over, so writing an `sx` literal
    // after the props spread would REPLACE it and every styled run would
    // silently lose its colour (AGL-1240/1284).
    const { container } = render(
      <InlineText tone="accent" weight="bold" sx={{ letterSpacing: '2px' }}>
        {'styled'}
      </InlineText>,
    )
    const style = styleOf(root(container))
    expect(style.letterSpacing).toBe('2px')
    expect(style.fontWeight).toBe('700')
    expect(style.color).toBeTruthy()
  })

  it('lets the Styles panel win over the declared attributes', () => {
    const { container } = render(
      <InlineText weight="bold" sx={{ fontWeight: 400 }}>
        {'authored'}
      </InlineText>,
    )
    expect(styleOf(root(container)).fontWeight).toBe('400')
  })

  it('renders a plain run when every attribute is cleared', () => {
    // Cleared SELECT attributes persist as null. A lookup miss must be
    // undefined, never a throw — an SSR throw 500s the whole page
    // (the AGL-1226 shape).
    const { container } = render(
      <InlineText
        element={null as any}
        tone={null as any}
        weight={null as any}
        decoration={null as any}
      >
        {'plain'}
      </InlineText>,
    )
    expect(root(container).tagName).toBe('SPAN')
    expect(styleOf(root(container)).display).toBe('inline')
    expect(screen.getByText('plain')).toBeTruthy()
  })

  it('ships the whole two-tone shape as one preset', () => {
    // The reason the emphasis was never authored is the assembly cost: a
    // container plus one run per style change plus a colour on each. One
    // drop has to produce the finished shape.
    const statement = presets.find((preset) =>
      preset.$id.endsWith('.statement'),
    )
    expect(statement).toBeTruthy()
    const data = statement?.data as any
    expect(data.componentId).toBe('muiBox')
    expect(data.props.component).toBe('p')
    expect(data.nodes).toHaveLength(3)
    for (const node of data.nodes) expect(node.componentId).toBe(ID)
    expect(data.nodes.map((node: any) => node.props.tone)).toEqual([
      'secondary',
      'primary',
      'secondary',
    ])
  })
})
