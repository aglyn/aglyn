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
import Grid, { ID, parseOffset, parseSpan, presets, schema } from './grid'

describe('parseSpan (AGL-1201)', () => {
  it('reads a bare span, and the auto/grow keywords', () => {
    expect(parseSpan('6')).toBe(6)
    expect(parseSpan(6)).toBe(6)
    expect(parseSpan('auto')).toBe('auto')
    expect(parseSpan('grow')).toBe('grow')
  })

  it('reads per-breakpoint pairs, in either separator style', () => {
    expect(parseSpan('xs:12 md:6')).toEqual({ xs: 12, md: 6 })
    expect(parseSpan('xs=12, md=6, lg=4')).toEqual({ xs: 12, md: 6, lg: 4 })
    expect(parseSpan('SM:6')).toEqual({ sm: 6 })
    expect(parseSpan('xs:12 md:auto')).toEqual({ xs: 12, md: 'auto' })
  })

  it('treats blanks as unset rather than as a zero-width column', () => {
    // A `size` of 0 collapses the cell completely; an empty field must
    // mean "MUI decides", not "hide this".
    expect(parseSpan('')).toBeUndefined()
    expect(parseSpan(null)).toBeUndefined()
    expect(parseSpan(undefined)).toBeUndefined()
  })

  it('rejects a partly-parseable list instead of applying half of it', () => {
    // Half a breakpoint map is a layout that silently differs from what
    // the author typed — worse than no layout at all.
    expect(parseSpan('xs:12 md:')).toBeUndefined()
    expect(parseSpan('xs:12 nonsense')).toBeUndefined()
    expect(parseSpan('xxl:12')).toBeUndefined()
    expect(parseSpan('twelve')).toBeUndefined()
  })
})

describe('parseOffset', () => {
  it('accepts the offsets MUI has', () => {
    expect(parseOffset('2')).toBe(2)
    expect(parseOffset('auto')).toBe('auto')
    expect(parseOffset('xs:0 md:2')).toEqual({ xs: 0, md: 2 })
  })

  it('drops `grow`, which is a span keyword and not an offset', () => {
    // MUI's GridOffset is 'auto' | number; a `grow` offset is not a
    // wider gap, it is a value the layout cannot use at all.
    expect(parseOffset('grow')).toBeUndefined()
    expect(parseOffset('xs:grow md:2')).toEqual({ md: 2 })
    expect(parseOffset('xs:grow')).toBeUndefined()
  })
})

describe('Grid element', () => {
  it('renders a container that lays its children out', () => {
    const { container } = render(
      <Grid container spacing={2}>
        <Grid size="6">{'Cell'}</Grid>
      </Grid>,
    )
    expect(screen.getByText('Cell')).toBeTruthy()
    expect(container.querySelector('.MuiGrid-container')).toBeTruthy()
  })

  it('does not mark an item as a container', () => {
    // A cell that is also a container swallows the parent's spacing and
    // nests a second grid context.
    const { container } = render(<Grid size="6">{'Cell'}</Grid>)
    expect(container.querySelector('.MuiGrid-container')).toBeNull()
  })

  it('coerces spacing and columns that were persisted as strings', () => {
    // Number-typed attribute fields round-trip as strings; MUI's spacing
    // math produces NaN gaps from a string.
    const { container } = render(
      <Grid container spacing={'3' as any} columns={'10' as any}>
        <Grid size="5">{'Cell'}</Grid>
      </Grid>,
    )
    const root = container.querySelector('.MuiGrid-container') as HTMLElement
    expect(root).toBeTruthy()
    expect(root.className).not.toMatch(/NaN/)
  })
})

describe('Grid schema and presets', () => {
  it('offers the v6+ size/offset API, not the removed xs/md props', () => {
    // MUI dropped `item` and the per-breakpoint props in v6; this repo is
    // on v9, where `xs={12}` is silently ignored.
    const names = schema.attributes.map((a: any) => a.name)
    expect(names).toContain('size')
    expect(names).toContain('offset')
    expect(names).not.toContain('item')
    for (const legacy of ['xs', 'sm', 'md', 'lg', 'xl']) {
      expect(names).not.toContain(legacy)
    }
  })

  it('hides container-only and item-only controls in the other mode', () => {
    const by = (name: string) =>
      schema.attributes.find((a: any) => a.name === name) as any
    for (const name of [
      'spacing',
      'rowSpacing',
      'columnSpacing',
      'columns',
      // AGL-2486: both are container props in MUI and do nothing on a cell.
      'direction',
      'wrap',
    ]) {
      expect(by(name).condition).toEqual({ when: 'container', is: true })
    }
    for (const name of ['size', 'offset']) {
      expect(by(name).condition).toEqual({
        when: 'container',
        is: true,
        notMatch: true,
      })
    }
    expect(by('container').condition).toBeUndefined()
  })

  it('ships a preset that is already a working responsive row', () => {
    // An empty grid container renders as nothing at all, so dropping the
    // preset would look like it did nothing.
    const row = presets[0].data as any
    expect(row.componentId).toBe(ID)
    expect(row.props.container).toBe(true)
    expect(row.nodes).toHaveLength(3)
    for (const cell of row.nodes) {
      expect(cell.componentId).toBe(ID)
      expect(cell.props.container).toBeUndefined()
      // Stacks on mobile, thirds from md up.
      expect(parseSpan(cell.props.size)).toEqual({ xs: 12, md: 4 })
      expect(cell.nodes.length).toBeGreaterThan(0)
    }
  })
})

describe('the container props MUI has, and only those (AGL-2486)', () => {
  const by = (name: string) =>
    schema.attributes.find((a: any) => a.name === name) as any
  const values = (name: string) =>
    by(name).options.map((option: any) => option.value)

  it('exposes every prop on the MUI v9 Grid API', () => {
    // https://mui.com/material-ui/api/grid/ — columns, columnSpacing,
    // container, direction, offset, rowSpacing, size, spacing, wrap.
    // `children` and `sx` are the canvas's and the styles panel's jobs.
    const names = schema.attributes.map((a: any) => a.name)
    for (const prop of [
      'columns',
      'columnSpacing',
      'container',
      'direction',
      'offset',
      'rowSpacing',
      'size',
      'spacing',
      'wrap',
    ]) {
      expect(names).toContain(prop)
    }
  })

  it('never offers a column direction, which Grid does not honour', () => {
    // MUI's own API doc: "Only `row` and `row-reverse` are supported.
    // `column` and `column-reverse` are not supported, because the Grid
    // component is designed to subdivide layouts into columns, not rows."
    // A control that silently does nothing is worse than no control.
    expect(values('direction')).toEqual(['row', 'row-reverse'])
    expect(values('direction')).not.toContain('column')
    expect(values('direction')).not.toContain('column-reverse')
  })

  it('offers exactly MUI\'s three wrap values', () => {
    expect(values('wrap').sort()).toEqual(
      ['nowrap', 'wrap', 'wrap-reverse'].sort(),
    )
  })

  it('applies direction and wrap to the rendered container', () => {
    const { container } = render(
      <Grid container direction="row-reverse" wrap="nowrap">
        <Grid size="6">{'Cell'}</Grid>
      </Grid>,
    )
    const root = container.querySelector('.MuiGrid-container') as HTMLElement
    expect(root).toBeTruthy()
    expect(getComputedStyle(root).flexDirection).toBe('row-reverse')
    expect(getComputedStyle(root).flexWrap).toBe('nowrap')
  })

  it('drops a CLEARED direction rather than handing MUI a null', () => {
    // The AGL-1226 shape: a cleared select persists as `null`, MUI resolves
    // direction as a responsive value, `null.xs` throws during SSR.
    expect(() =>
      render(
        <Grid container direction={null as any} wrap={null as any}>
          <Grid size="6">{'Cell'}</Grid>
        </Grid>,
      ),
    ).not.toThrow()
  })
})

describe('Span and Offset are authored per breakpoint (AGL-2486)', () => {
  const by = (name: string) =>
    schema.attributes.find((a: any) => a.name === name) as any

  it('uses the breakpoint row, not a free-text box', () => {
    expect(by('size').component).toBe(
      Aglyn.FieldComponentType.BREAKPOINT_SPAN,
    )
    expect(by('offset').component).toBe(
      Aglyn.FieldComponentType.BREAKPOINT_SPAN,
    )
  })

  it('withholds `grow` from Offset and lets it start at zero', () => {
    // MUI's GridOffset is `'auto' | number`; `grow` is a span keyword.
    expect(by('offset').allowGrow).toBe(false)
    expect(by('offset').minSpan).toBe(0)
    // Span keeps the default: grow allowed, list starts at 1.
    expect(by('size').allowGrow).toBeUndefined()
    expect(by('size').minSpan).toBeUndefined()
  })
})

/**
 * The backward-compatibility proof for AGL-2486.
 *
 * Changing HOW Span and Offset are authored must not change what a page
 * already built resolves to. These are the stored strings the text box could
 * produce, read straight off nodes of the shape the besigner persists, and
 * asserted against the props MUI actually receives.
 */
describe('a page stored before the breakpoint row resolves identically', () => {
  /** Node props exactly as a screen document carries them. */
  const STORED_NODES = [
    { props: { size: '6' }, size: 6, offset: undefined },
    { props: { size: 6 }, size: 6, offset: undefined },
    { props: { size: 'auto' }, size: 'auto', offset: undefined },
    { props: { size: 'grow' }, size: 'grow', offset: undefined },
    {
      props: { size: 'xs:12 md:4' },
      size: { xs: 12, md: 4 },
      offset: undefined,
    },
    {
      props: { size: 'xs=12, md=6, lg=4' },
      size: { xs: 12, md: 6, lg: 4 },
      offset: undefined,
    },
    { props: { size: 'SM:6' }, size: { sm: 6 }, offset: undefined },
    {
      props: { size: 'xs:12 md:auto' },
      size: { xs: 12, md: 'auto' },
      offset: undefined,
    },
    { props: { size: '6', offset: '2' }, size: 6, offset: 2 },
    {
      props: { size: 'xs:12 md:6', offset: 'xs:0 md:2' },
      size: { xs: 12, md: 6 },
      offset: { xs: 0, md: 2 },
    },
    { props: { size: '6', offset: 'auto' }, size: 6, offset: 'auto' },
    // Unparseable then, unparseable now — MUI must still receive nothing.
    { props: { size: 'xs:12 md:' }, size: undefined, offset: undefined },
    { props: { size: 'xxl:12' }, size: undefined, offset: undefined },
    { props: { size: 'twelve' }, size: undefined, offset: undefined },
    { props: { size: '' }, size: undefined, offset: undefined },
    { props: { size: null as any }, size: undefined, offset: undefined },
    // `grow` is not an offset; it was dropped before and still is.
    { props: { size: '6', offset: 'grow' }, size: 6, offset: undefined },
    {
      props: { size: '6', offset: 'xs:grow md:2' },
      size: 6,
      offset: { md: 2 },
    },
  ]

  it.each(STORED_NODES)(
    'resolves $props to the same MUI props',
    ({ props, size, offset }) => {
      expect(parseSpan((props as any).size)).toEqual(size)
      expect(parseOffset((props as any).offset)).toEqual(offset)
    },
  )

  it('is measured over a corpus that carries every stored shape', () => {
    // A corpus that lost its responsive or unparseable rows would make the
    // assertion above pass by having nothing hard left in it.
    const stored = STORED_NODES.map((row) => `${(row.props as any).size}`)
    expect(stored.filter((v) => v.includes(':')).length).toBeGreaterThan(4)
    expect(
      STORED_NODES.filter((row) => row.size === undefined).length,
    ).toBeGreaterThan(3)
    expect(
      STORED_NODES.filter((row) => row.offset !== undefined).length,
    ).toBeGreaterThan(2)
  })

  it('renders an existing responsive cell with the same MUI classes', () => {
    const { container } = render(
      <Grid container spacing={2}>
        <Grid size="xs:12 md:4">{'Column one'}</Grid>
      </Grid>,
    )
    const cell = container.querySelector(
      '.MuiGrid-root:not(.MuiGrid-container)',
    ) as HTMLElement
    expect(cell).toBeTruthy()
    expect(cell.className).toContain('MuiGrid-grid-xs-12')
    expect(cell.className).toContain('MuiGrid-grid-md-4')
  })
})
