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
import Stack, { presets, schema } from './stack'

const attribute = (name: string) =>
  schema.attributes.find((a: any) => a.name === name) as any

const values = (name: string) =>
  attribute(name).options.map((option: any) => option.value)

const root = (container: HTMLElement) =>
  container.querySelector('.MuiStack-root') as HTMLElement

describe('Stack covers the MUI Stack API (AGL-2486)', () => {
  it('exposes every authorable prop the API lists', () => {
    // https://mui.com/material-ui/api/stack/ — direction, divider, spacing,
    // useFlexGap. `children`, `component` and `sx` are the canvas's and the
    // styles panel's jobs, and justifyContent/alignItems/flexWrap are the
    // flex properties Stack passes through `sx`.
    const names = schema.attributes.map((a: any) => a.name)
    for (const prop of [
      'direction',
      'divider',
      'spacing',
      'useFlexGap',
      'justifyContent',
      'alignItems',
      'flexWrap',
    ]) {
      expect(names).toContain(prop)
    }
  })

  it('offers the cross-axis alignment values, and no `""` sentinel', () => {
    // AGL-1453: a `''` option cannot survive a save, and alignItems is
    // pushed into `sx` so `dropClearedProps` never sees it.
    expect(values('alignItems')).toEqual([
      'stretch',
      'flex-start',
      'center',
      'flex-end',
      'baseline',
    ])
    for (const name of ['alignItems', 'flexWrap', 'divider', 'direction']) {
      expect(values(name)).not.toContain('')
      expect(values(name).some((v: unknown) => v == null)).toBe(false)
    }
  })

  it('makes `useFlexGap` a switch, not a text box', () => {
    expect(attribute('useFlexGap').component).toBe('switch')
  })
})

describe('the rendered Stack applies the new props', () => {
  it('puts alignItems and flexWrap on the element', () => {
    const { container } = render(
      <Stack direction="row" alignItems="center" flexWrap="wrap">
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    const style = getComputedStyle(root(container))
    expect(style.alignItems).toBe('center')
    expect(style.flexWrap).toBe('wrap')
  })

  it('switches Stack from margins to `gap` for useFlexGap', () => {
    const withGap = render(
      <Stack direction="row" spacing={2} useFlexGap>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    expect(getComputedStyle(root(withGap.container)).gap).not.toBe('')
    withGap.unmount()

    const withMargins = render(
      <Stack direction="row" spacing={2}>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    // The control: without the flag MUI spaces children with margins, so
    // the assertion above is reading a real difference and not a constant.
    expect(getComputedStyle(root(withMargins.container)).gap).toBe('')
  })
})

describe('the divider attribute names a style, not a node', () => {
  it('draws a rule between children', () => {
    const { container } = render(
      <Stack divider="line">
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    expect(container.querySelectorAll('.MuiDivider-root')).toHaveLength(1)
  })

  it('orients the rule ACROSS the stack, not along it', () => {
    // A horizontal rule between two side-by-side children is invisible.
    const row = render(
      <Stack direction="row" divider="line">
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    expect(
      row.container.querySelector('.MuiDivider-vertical'),
    ).toBeTruthy()
    row.unmount()

    const column = render(
      <Stack direction="column" divider="line">
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    expect(
      column.container.querySelector('.MuiDivider-vertical'),
    ).toBeNull()
    expect(column.container.querySelector('.MuiDivider-root')).toBeTruthy()
  })

  it('never renders an unknown value as literal text between children', () => {
    // MUI's own prop takes a NODE, so a stray string would print itself
    // between every pair of children on a published page.
    const { container } = render(
      <Stack divider={'constructor' as any}>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    expect(container.querySelector('.MuiDivider-root')).toBeNull()
    expect(container.textContent).toBe('ab')
  })

  it('renders nothing for a CLEARED divider', () => {
    const { container } = render(
      <Stack divider={null as any}>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    expect(container.querySelector('.MuiDivider-root')).toBeNull()
    expect(container.textContent).toBe('ab')
  })

  it('names only styles the component can build', () => {
    // A schema option the component does not honour is a control that
    // silently does nothing.
    for (const style of values('divider')) {
      const { container, unmount } = render(
        <Stack divider={style}>
          <div>{'a'}</div>
          <div>{'b'}</div>
        </Stack>,
      )
      expect(container.querySelector('.MuiDivider-root')).toBeTruthy()
      unmount()
    }
  })
})

/**
 * The backward-compatibility proof for AGL-2486: nothing about a Stack built
 * before this change may render differently. Every prop added here is
 * OPTIONAL and absent from stored documents, so the assertion is that a node
 * carrying only the old prop set renders exactly what it did.
 */
describe('a Stack stored before the new props renders identically', () => {
  const STORED = [
    {},
    { direction: 'row' },
    { direction: 'column' },
    { direction: 'row', spacing: 2 },
    { direction: 'row', justifyContent: 'space-between' },
    { direction: 'column', justifyContent: 'center', spacing: 3 },
  ]

  it.each(STORED)('%p adds no divider and no gap', (props) => {
    const { container } = render(
      <Stack {...(props as any)}>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    // The new props default to absent, so MUI's own defaults still apply:
    // no divider element, and spacing still applied as margins.
    expect(container.querySelector('.MuiDivider-root')).toBeNull()
    expect(getComputedStyle(root(container)).gap).toBe('')
    expect(container.textContent).toBe('ab')
  })

  it.each(STORED)('%p keeps the direction and justification it had', (props) => {
    const { container } = render(
      <Stack {...(props as any)}>
        <div>{'a'}</div>
        <div>{'b'}</div>
      </Stack>,
    )
    const style = getComputedStyle(root(container))
    if ((props as any).direction) {
      expect(style.flexDirection).toBe((props as any).direction)
    }
    if ((props as any).justifyContent) {
      expect(style.justifyContent).toBe((props as any).justifyContent)
    }
  })

  it('leaves the shipped presets alone', () => {
    // The presets are what "a Stack built before this change" was made of.
    expect(presets.map((preset) => (preset.data as any).props)).toEqual([
      { direction: 'row' },
      { direction: 'column' },
    ])
  })
})

describe('the existing attributes are untouched', () => {
  it('still offers the same Direction and Justify Content values', () => {
    expect(values('direction')).toEqual([
      'column',
      'column-reverse',
      'row',
      'row-reverse',
    ])
    expect(values('justifyContent')).toEqual([
      'flex-start',
      'center',
      'flex-end',
      'space-between',
      'space-around',
      'space-evenly',
    ])
  })

  it('still carries the repeat attributes', () => {
    const names = schema.attributes.map((a: any) => a.name)
    for (const prop of [
      'repeatDataset',
      'repeatLimit',
      'repeatFilter',
      'repeatSort',
    ]) {
      expect(names).toContain(prop)
    }
  })

  it('still strips the compose-time repeat props from the DOM', () => {
    render(
      <Stack repeatDataset="ds1" repeatLimit={5} data-testid="stack">
        <div>{'a'}</div>
      </Stack>,
    )
    const element = screen.getByTestId('stack')
    expect(element.getAttribute('repeatDataset')).toBeNull()
    expect(element.getAttribute('repeatdataset')).toBeNull()
  })
})
