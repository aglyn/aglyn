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
    for (const name of ['spacing', 'rowSpacing', 'columnSpacing', 'columns']) {
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
