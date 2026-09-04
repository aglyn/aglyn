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
import LinkableButton, { schema as buttonSchema } from './button'
import ScreenLink, { schema as screenLinkSchema } from './screen-link'

/** A published site whose routing map knows about `pricing`, and nothing else. */
const renderSite = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider
      value={{ screens: { pricing: 'pricing' } }}
    >
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

/** The besigner canvas / preview: navigation suppressed. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

const anchor = (container: HTMLElement) =>
  container.querySelector('a') as HTMLElement

const attribute = (schemaAttrs: any[] | undefined, name: string) =>
  schemaAttrs?.find((attr) => attr.name === name)

describe('Where a link opens is authorable', () => {
  it('stamps nothing when the author never picked — every link authored before this', () => {
    // The baseline the whole feature has to preserve: adding the control
    // must not move one byte of already-published markup.
    const { container } = render(
      <ScreenLink href="https://docs.aglyn.com">{'Docs'}</ScreenLink>,
    )
    expect(anchor(container).hasAttribute('target')).toBe(false)
    expect(anchor(container).hasAttribute('rel')).toBe(false)
  })

  it('treats the Same tab pick as unset rather than an explicit attribute', () => {
    // `'_self'` persists as a real value because `''` cannot (AGL-1191), but
    // it resolves to the browser default, which is no attribute at all.
    const { container } = render(
      <ScreenLink target="_self" href="https://docs.aglyn.com">
        {'Docs'}
      </ScreenLink>,
    )
    expect(anchor(container).hasAttribute('target')).toBe(false)
  })

  it('opens an outside destination in a new tab, with the opener severed', () => {
    const { container } = render(
      <ScreenLink target="_blank" href="https://docs.aglyn.com">
        {'Docs'}
      </ScreenLink>,
    )
    expect(anchor(container).getAttribute('target')).toBe('_blank')
    expect(anchor(container).getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('keeps the referrer on a new tab that stays on the site', () => {
    // `noreferrer` on a link to one of the site's own screens would make the
    // landing page read as direct traffic in its own analytics.
    const { container } = renderSite(
      <ScreenLink target="_blank" screenId="pricing">
        {'Pricing'}
      </ScreenLink>,
    )
    expect(anchor(container).getAttribute('target')).toBe('_blank')
    expect(anchor(container).getAttribute('rel')).toBe('noopener')
  })

  it('opens a named window when the author names one', () => {
    const { container } = render(
      <ScreenLink
        target="custom"
        targetName="aglyn-preview"
        href="https://docs.aglyn.com"
      >
        {'Docs'}
      </ScreenLink>,
    )
    expect(anchor(container).getAttribute('target')).toBe('aglyn-preview')
  })

  it('never lets the Custom sentinel reach the DOM as a window name', () => {
    // An author mid-edit — Custom picked, nothing typed yet. `target="custom"`
    // would open a window literally named that, and every unnamed link on the
    // site would then share it.
    const { container } = render(
      <ScreenLink target="custom" href="https://docs.aglyn.com">
        {'Docs'}
      </ScreenLink>,
    )
    expect(anchor(container).hasAttribute('target')).toBe(false)
  })

  it('carries the choice in Screen Link text mode too', () => {
    const { container } = render(
      <ScreenLink renderAs="link" target="_blank" href="https://docs.aglyn.com">
        {'Docs'}
      </ScreenLink>,
    )
    expect(anchor(container).getAttribute('target')).toBe('_blank')
  })

  it('carries the choice on a Button in link mode', () => {
    const { container } = render(
      <LinkableButton target="_blank" href="https://docs.aglyn.com">
        {'Docs'}
      </LinkableButton>,
    )
    expect(anchor(container).getAttribute('target')).toBe('_blank')
    expect(anchor(container).getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('never stamps a target on a Button that is a real button', () => {
    // No href, no browsing context to choose. `target` on a `<button>` is a
    // form attribute with entirely different meaning.
    render(<LinkableButton target="_blank">{'Save'}</LinkableButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.hasAttribute('target')).toBe(false)
  })

  it('never stamps a target on the inert canvas placeholder', () => {
    const { container } = renderEditor(
      <ScreenLink target="_blank" href="https://docs.aglyn.com">
        {'Docs'}
      </ScreenLink>,
    )
    expect(container.querySelector('[target]')).toBeNull()
  })
})

describe('The dropdown reads as plain English, not as HTML', () => {
  it.each([
    ['Screen Link', screenLinkSchema],
    ['Button', buttonSchema],
  ])('offers %s an "Open link in" select', (_name, schema) => {
    const field = attribute(schema.attributes, 'target')
    expect(field?.component).toBe(Aglyn.FieldComponentType.SELECT)
    expect(field?.label).toBe('Open link in')
    expect(field?.options?.map((option: any) => option.label)).toEqual([
      'Same tab',
      'New tab',
      'Custom window name',
    ])
    // The point of the control: no author should ever have to know that the
    // value behind "New tab" is spelled `_blank`.
    for (const option of field?.options ?? []) {
      expect(option.label).not.toMatch(/^_/)
    }
  })

  it.each([
    ['Screen Link', screenLinkSchema],
    ['Button', buttonSchema],
  ])('hides %s’s window-name box until Custom is picked', (_name, schema) => {
    const field = attribute(schema.attributes, 'targetName')
    expect(field?.component).toBe(Aglyn.FieldComponentType.TEXT_FIELD)
    expect(field?.condition).toEqual({ when: 'target', is: 'custom' })
  })
})
