/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * A plugin zone that belongs to a whole rail hub is a SECTION of it
 * (AGL-3711).
 *
 * Host Setup's layout drew the `hostSettings` zone after `HubSections`, so the
 * email-platform and Zapier cards ran full width under the rail, on every
 * section. Organization Settings drew `orgSettings` the same way. Each zone is
 * now an Integrations section, routed, inside the content column, and offered
 * by the rail only while the zone has a card for this reader.
 */

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'

const mockHasWidgets = { hasWidgets: false, ready: true }
const mockSlot = jest.fn((props: { slot: string }) => (
  <div data-testid={`zone-${props.slot}`} />
))
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  default: (props: { slot: string }) => mockSlot(props),
  useSlotHasWidgets: () => mockHasWidgets,
}))
jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: (props: {
    sections: { label: string; visible?: boolean }[]
    children: ReactNode
  }) => (
    <div>
      <nav>
        {props.sections
          .filter((section) => section.visible !== false)
          .map((section) => (
            <a key={section.label}>{section.label}</a>
          ))}
      </nav>
      <main data-testid="content-column">{props.children}</main>
    </div>
  ),
  useActiveSection: () => null,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useAnalytics: () => undefined }))
jest.mock('firebase/analytics', () => ({ logEvent: jest.fn() }))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'h1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: (props: { children: ReactNode }) => <>{props.children}</>,
}))
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({ currentOrg: { $id: 'o1', role: 'owner' } }),
}))
jest.mock('../app/(app)/[orgSlug]/hosts/[host]/host-settings-scope', () => ({
  HostSettingsScopeProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  useHostSettingsScope: () => ({ hostId: 'h1' }),
}))

import HostSetupSectionsLayout from '../app/(app)/[orgSlug]/hosts/[host]/setup/(sections)/layout'
import HostSetupIntegrationsSection from '../app/(app)/[orgSlug]/hosts/[host]/setup/(sections)/integrations/page'
import {
  DEFAULT_SETUP_SECTION,
  setupSections,
} from '../app/(app)/[orgSlug]/hosts/[host]/setup/setup-sections'
import PluginZoneSection from '../components/plugin-zone-section.component'

const APP = join(__dirname, '..', 'app', '(app)', '[orgSlug]')
const read = (...segments: string[]) => readFileSync(join(APP, ...segments), 'utf8')

beforeEach(() => {
  mockSlot.mockClear()
  mockHasWidgets.hasWidgets = false
})

describe('Host Setup: the hostSettings zone is the Integrations section', () => {
  it('THE REGRESSION: the layout renders no plugin zone of its own', () => {
    mockHasWidgets.hasWidgets = true
    render(
      <HostSetupSectionsLayout>
        <p>Basic details body</p>
      </HostSetupSectionsLayout>,
    )
    expect(mockSlot).not.toHaveBeenCalled()
    expect(screen.queryByTestId('zone-hostSettings')).toBeNull()
  })

  it('offers Integrations in the rail only while the zone has a card', () => {
    const { rerender } = render(
      <HostSetupSectionsLayout>
        <p>body</p>
      </HostSetupSectionsLayout>,
    )
    expect(screen.queryByText('Integrations')).toBeNull()
    expect(screen.getByText('Basic details')).toBeTruthy()

    mockHasWidgets.hasWidgets = true
    rerender(
      <HostSetupSectionsLayout>
        <p>body</p>
      </HostSetupSectionsLayout>,
    )
    expect(screen.getByText('Integrations')).toBeTruthy()
  })

  it('the section route renders the zone, inside the content column', () => {
    render(
      <HostSetupSectionsLayout>
        <HostSetupIntegrationsSection />
      </HostSetupSectionsLayout>,
    )
    const column = screen.getByTestId('content-column')
    expect(column.contains(screen.getByTestId('zone-hostSettings'))).toBe(true)
    expect(mockSlot).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 'hostSettings', hostId: 'h1' }),
    )
  })

  it('the section list: hidden unless asked for, never the default, last in the rail', () => {
    const hidden = setupSections('acme', 'shop')
    const integrations = hidden.find((section) => section.id === 'integrations')
    expect(integrations).toMatchObject({
      visible: false,
      href: '/acme/hosts/shop/setup/integrations',
    })
    expect(DEFAULT_SETUP_SECTION).not.toBe('integrations')
    expect(
      setupSections('acme', 'shop', { integrations: true }).find(
        (section) => section.id === 'integrations',
      )?.visible,
    ).toBe(true)
    // Every core section keeps no `visible` flag, so it is always drawn.
    expect(hidden.filter((section) => section.visible === false)).toHaveLength(1)
  })
})

describe('Organization Settings: the orgSettings zone is the Integrations section', () => {
  it('the layout renders no zone; the section is gated on the zone; the route renders it', () => {
    const layout = read('settings', '(sections)', 'layout.tsx')
    expect(layout).not.toMatch(/<PluginWidgetSlot\b/)
    expect(layout).toMatch(
      /section\(Route\.ORG_SETTINGS_INTEGRATIONS, 'Integrations', integrations\)/,
    )
    expect(layout).toMatch(/useSlotHasWidgets\(\s*CONSOLE_WIDGET_SLOTS\.orgSettings/)
    const page = read('settings', '(sections)', 'integrations', 'page.tsx')
    expect(page).toMatch(/slot=\{CONSOLE_WIDGET_SLOTS\.orgSettings\}/)
  })
})

describe('no rail hub layout draws a plugin zone outside its content column', () => {
  it.each([
    ['hosts/[host]/setup/(sections)/layout.tsx'],
    ['hosts/[host]/admin/(sections)/layout.tsx'],
    ['settings/(sections)/layout.tsx'],
    ['billing/(sections)/layout.tsx'],
    ['team/(sections)/layout.tsx'],
  ])('%s', (path) => {
    const source = read(...path.split('/'))
    expect(source).toMatch(/<HubSections\b/)
    expect(source).not.toMatch(/<PluginWidgetSlot\b/)
  })
})

describe('PluginZoneSection', () => {
  it('draws the zone and a fallback the zone hides once it has a card', () => {
    const { container } = render(
      <PluginZoneSection slot="hostSettings" hostId="h1" emptyLabel="Nothing yet" />,
    )
    expect(mockSlot).toHaveBeenCalledWith({ slot: 'hostSettings', hostId: 'h1' })
    const fallback = container.querySelector('[data-zone-fallback]')
    expect(fallback?.textContent).toContain('Nothing yet')
    // The zone comes first, so the `~` rule can hide what follows it.
    const section = container.querySelector('[data-zone-section="hostSettings"]')
    expect(section?.lastElementChild).toBe(fallback)
  })
})
