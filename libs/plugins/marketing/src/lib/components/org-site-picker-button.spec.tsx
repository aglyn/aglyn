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
 * The org hub's way into a site's editor (AGL-3982): in an organization with
 * no sites the button stays on screen and says why, rather than going dead —
 * but only once the shell has settled the list.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { MarketingOrgMount } from './marketing-org-mount'
import { OrgSitePickerButton, ORG_SITE_PICKER_NO_SITES } from './org-site-picker-button'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))

const mount = (patch: Partial<MarketingOrgMount> = {}): MarketingOrgMount => ({
  orgId: 'org-1',
  orgSlug: 'acme',
  hosts: [],
  hostsReady: true,
  hostsPath: '/acme/hosts',
  basePath: '/acme/marketing',
  ...patch,
})

describe('OrgSitePickerButton with no sites', () => {
  it('stays on screen, disabled, with the reason', () => {
    render(<OrgSitePickerButton mount={mount()} section="overlays" label="New overlay" />)
    const button = screen.getByRole('button', { name: 'New overlay' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.closest('span')?.getAttribute('aria-label')).toBe(ORG_SITE_PICKER_NO_SITES)
  })

  it('names no reason while the list is still loading', () => {
    render(<OrgSitePickerButton mount={mount({ hostsReady: false })} section="overlays" label="New overlay" />)
    const button = screen.getByRole('button', { name: 'New overlay' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.queryByLabelText(ORG_SITE_PICKER_NO_SITES)).toBeNull()
  })

  it('THE CONTROL: one site is a link straight to its hub', () => {
    const hosts = [{ id: 'host-1', name: 'Shop', subdomain: 'shop' }] as MarketingOrgMount['hosts']
    render(<OrgSitePickerButton mount={mount({ hosts })} section="overlays" label="New overlay" />)
    expect(screen.getByText('New overlay').closest('a')?.getAttribute('href')).toBe('/acme/hosts/shop/marketing/overlays')
    expect(screen.queryByLabelText(ORG_SITE_PICKER_NO_SITES)).toBeNull()
  })
})
