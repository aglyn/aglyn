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

import { fireEvent, render, screen } from '@testing-library/react'
import { CampaignEditDrawer, type CampaignEditDrawerProps } from './campaign-edit-drawer'

/**
 * A REFUSED SHARING CHANGE KEEPS THE CHOICE (AGL-4047, production check 11/10).
 *
 * The campaign's page saves the fields first and then asks the manage route
 * for the sharing. When the route refuses, the fields have still been
 * written, so a fresh campaign arrives with the refusal. The drawer used to
 * seed every field again from it, the sharing too, and so showed the stored
 * sharing beside a refusal of the one that was chosen.
 */
const SITES = [
  { value: 'a', label: 'Store' },
  { value: 'b', label: 'Blog' },
  { value: 'c', label: 'Shop' },
]

const stored = (overrides: Record<string, unknown> = {}): CampaignEditDrawerProps['campaign'] => ({
  name: 'Spring',
  listIds: [],
  visibleTo: ['org'],
  ...overrides,
})

function drawer(campaign: CampaignEditDrawerProps['campaign'], error: string | null = null) {
  return (
    <CampaignEditDrawer
      open
      onClose={() => undefined}
      campaign={campaign}
      lists={[]}
      topics={[]}
      sites={SITES}
      sitesReady
      error={error}
      onSubmit={() => undefined}
    />
  )
}

const checked = (name: string) => (screen.getByRole('checkbox', { name }) as HTMLInputElement).checked

describe('the campaign edit drawer after a refused sharing change', () => {
  it('keeps the sites chosen when the saved campaign comes back', () => {
    const view = render(drawer(stored()))
    fireEvent.click(screen.getByRole('radio', { name: /Selected sites/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blog' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shop' }))

    // The fields were written; the route refused the sharing.
    view.rerender(drawer(stored(), 'The campaign was saved, but who it is shared with did not change: refused'))

    expect((screen.getByRole('radio', { name: /Selected sites/ }) as HTMLInputElement).checked).toBe(true)
    expect(checked('Blog')).toBe(true)
    expect(checked('Shop')).toBe(true)
    expect(checked('Store')).toBe(false)
  })

  it('still follows the stored sharing when it really moves', () => {
    const view = render(drawer(stored()))
    expect((screen.getByRole('radio', { name: 'All sites' }) as HTMLInputElement).checked).toBe(true)

    view.rerender(drawer(stored({ visibleTo: ['host:b'] })))

    expect((screen.getByRole('radio', { name: /Selected sites/ }) as HTMLInputElement).checked).toBe(true)
    expect(checked('Blog')).toBe(true)
  })
})
