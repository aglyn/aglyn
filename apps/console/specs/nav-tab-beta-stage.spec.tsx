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
 * The Beta chip on a nav tab (AGL-4052): a tab whose release flag is ON and
 * staged `beta` is marked by the strip's gating and drawn with the chip.
 *
 * No flag that governs a nav tab is staged beta today (the beta-staged
 * features, Assist and the generative AI doors, have no tab of their own), so
 * the registry is staged here: the CRM's flag, as though it were beta. A
 * spec that only walked today's registry would loop over nothing and pass.
 */

import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({ usePathname: () => '/c' }))

jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    RELEASE_FLAGS: actual.RELEASE_FLAGS.map(
      (definition: { key: string }) =>
        definition.key === 'release_crm'
          ? { ...definition, stage: 'beta' }
          : definition,
    ),
  }
})

import { gateNavTabItems } from '../components/secondary-nav-bar.component'
import AppLinkTabsComponent from '../components/app-link-tabs.component'

const CONTACTS_TAB = { id: 'nav-tab-contacts', label: 'Contacts', href: '/c' }
const SETUP_TAB = { id: 'nav-tab-setup', label: 'Setup', href: '/s' }

beforeAll(() => {
  // jsdom has none; the strip observes its own width to keep the selected
  // tab in view.
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('Beta-staged nav tabs (AGL-4052)', () => {
  it('stages a released beta tab and leaves the others alone', () => {
    const [contacts, setup] = gateNavTabItems(
      [CONTACTS_TAB, SETUP_TAB],
      { release_crm: { released: true } },
      false,
    )
    expect(contacts.stage).toBe('beta')
    expect(setup.stage).toBeUndefined()
  })

  it('never stages a tab that is off, even for staff', () => {
    const [contacts] = gateNavTabItems(
      [CONTACTS_TAB],
      { release_crm: { released: false } },
      true,
    )
    expect(contacts.stage).toBeUndefined()
    expect(contacts['data-staff-only']).toBe('release_crm')
  })

  it('draws the chip after the label of a staged tab only', () => {
    const items = gateNavTabItems(
      [CONTACTS_TAB, SETUP_TAB],
      { release_crm: { released: true } },
      false,
    )
    render(<AppLinkTabsComponent items={items} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['ContactsBeta', 'Setup'])
    expect(tabs[0].querySelector('[data-release-stage="beta"]')).not.toBeNull()
    expect(tabs[1].querySelector('[data-release-stage]')).toBeNull()
    // The stage is the strip's data, never an attribute on the link.
    expect(tabs[0].getAttribute('stage')).toBeNull()
  })
})
