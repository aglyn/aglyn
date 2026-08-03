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
import ScreenLink, { schema } from './screen-link'

/** The besigner canvas / preview: navigation suppressed. */
const renderEditor = (ui: React.ReactElement) =>
  render(
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

describe('ScreenLink renderAs (AGL-1195)', () => {
  it('is a button by default, on the live site and on the canvas', () => {
    render(<ScreenLink href="/pricing">{'Pricing'}</ScreenLink>)
    expect(screen.getByRole('button', { name: 'Pricing' })).toBeTruthy()

    renderEditor(<ScreenLink>{'Docs'}</ScreenLink>)
    expect(screen.getByRole('button', { name: 'Docs' })).toBeTruthy()
  })

  it('renders navigation as a real link when asked, not a button', () => {
    render(
      <ScreenLink renderAs="link" href="/pricing">
        {'Pricing'}
      </ScreenLink>,
    )
    const link = screen.getByRole('link', { name: 'Pricing' })
    expect(link.tagName).toBe('A')
    // A footer link that still reads as a button to assistive tech is the
    // whole bug — there must be no button in the tree.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not forward button-only props onto the link', () => {
    // `variant` means the TYPOGRAPHY variant on MUI's Link, so forwarding
    // "contained" would silently produce an unstyled element.
    const { container } = render(
      <ScreenLink
        renderAs="link"
        href="/pricing"
        variant="contained"
        size="large"
        fullWidth
      >
        {'Pricing'}
      </ScreenLink>,
    )
    const link = container.querySelector('a') as HTMLElement
    expect(link.className).not.toMatch(/MuiButton/)
    expect(link.className).toMatch(/MuiLink/)
  })

  it('keeps the canvas honest about which element will ship', () => {
    // Suppressed navigation must mirror the live shape, or the besigner
    // shows a button for something that renders as a link in production.
    renderEditor(<ScreenLink renderAs="link">{'Careers'}</ScreenLink>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Careers').className).toMatch(/MuiLink/)
  })

  it('offers the choice in the attributes panel, defaulting to Button', () => {
    const field = schema.attributes.find((a: any) => a.name === 'renderAs')
    expect(field).toBeTruthy()
    // Empty value = Button, so every link authored before this existed
    // keeps rendering exactly as it did.
    expect((field as any).options?.[0]).toMatchObject({
      value: '',
      label: 'Button',
    })
    expect((field as any).options?.map((o: any) => o.value)).toEqual([
      '',
      'link',
    ])
  })
})
