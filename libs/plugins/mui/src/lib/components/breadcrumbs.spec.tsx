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
import BreadcrumbsElement, { presets, schema } from './breadcrumbs'

const crumbs = (props: Record<string, unknown> = {}) => (
  <BreadcrumbsElement {...props}>
    <a href="/">{'Home'}</a>
    <a href="/section">{'Section'}</a>
    <span>{'Current'}</span>
  </BreadcrumbsElement>
)

const separators = (): string[] =>
  Array.from(document.querySelectorAll('.MuiBreadcrumbs-separator')).map(
    (node) => node.textContent ?? '',
  )

describe('Breadcrumbs element (AGL-1201)', () => {
  it('renders a navigation landmark with a default accessible name', () => {
    render(crumbs())
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
  })

  it('takes a custom landmark name', () => {
    render(crumbs({ ariaLabel: 'You are here' }))
    expect(screen.getByRole('navigation', { name: 'You are here' })).toBeTruthy()
  })

  it('falls back to a slash when the separator is cleared', () => {
    // A blank separator collapses the trail into run-on text —
    // "HomeSectionCurrent".
    render(crumbs({ separator: '' }))
    expect(separators()).toEqual(['/', '/'])
  })

  it('uses the separator that was set', () => {
    render(crumbs({ separator: '›' }))
    expect(separators()).toEqual(['›', '›'])
  })

  it('ignores collapse counts that MUI would reject', () => {
    // maxItems must be >= 1; a 0 makes MUI throw rather than degrade.
    expect(() => render(crumbs({ maxItems: 0 }))).not.toThrow()
    expect(screen.getByText('Home')).toBeTruthy()
  })

  it('collapses a long trail when asked', () => {
    render(
      <BreadcrumbsElement maxItems={2}>
        <a href="/">{'One'}</a>
        <a href="/b">{'Two'}</a>
        <a href="/c">{'Three'}</a>
        <span>{'Four'}</span>
      </BreadcrumbsElement>,
    )
    expect(screen.getByRole('button')).toBeTruthy()
    expect(screen.queryByText('Two')).toBeNull()
  })
})

describe('Breadcrumbs schema and preset', () => {
  it('hides the collapse tuning until a maximum is set', () => {
    for (const name of [
      'itemsBeforeCollapse',
      'itemsAfterCollapse',
      'expandText',
    ]) {
      const field = schema.attributes.find((a: any) => a.name === name) as any
      expect(field.condition).toEqual({ when: 'maxItems', isNotEmpty: true })
    }
  })

  it('builds the trail from Screen Links, not hardcoded paths', () => {
    // The address is resolved from the published path at render time, so
    // the trail survives a slug rename.
    const trail = (presets[0].data as any).nodes
    expect(trail[0].componentId).toBe('muiScreenLink')
    expect(trail[1].componentId).toBe('muiScreenLink')
  })

  it('renders the crumbs as text links rather than buttons', () => {
    // A breadcrumb rendered as a button gets button typography and the
    // wrong role for assistive tech (AGL-1195).
    const trail = (presets[0].data as any).nodes
    expect(trail[0].props.renderAs).toBe('link')
    expect(trail[1].props.renderAs).toBe('link')
  })

  it('does not link the current page to itself', () => {
    // The classic breadcrumb accessibility mistake.
    const last = (presets[0].data as any).nodes[2]
    expect(last.componentId).not.toBe('muiScreenLink')
    expect(last.componentId).toBe('muiTypography')
  })
})
