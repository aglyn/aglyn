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

import { render, screen, within, fireEvent } from '@testing-library/react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { CrmSitePicker } from './crm-site-picker'

const HOSTS = [
  { id: 'host-a', name: 'Site A', subdomain: 'a' },
  { id: 'host-b', name: 'Site B', subdomain: 'b' },
]

function renderPicker(props: Partial<Parameters<typeof CrmSitePicker>[0]> = {}) {
  return render(
    <CrmOrgMountProvider
      mount={{ orgId: 'org-1', hosts: HOSTS, hostsReady: true, orgSlug: 'acme', hostsPath: '/acme/hosts' }}
    >
      <CrmSitePicker hostId={null} {...props} />
    </CrmOrgMountProvider>,
  )
}

const openMenu = (name: RegExp) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  return within(screen.getByRole('listbox'))
}

beforeEach(() => window.sessionStorage.clear())

/** The site is a source to tag, not a scope to choose (AGL-4122). */
describe('CrmSitePicker in an org whose records belong to every site', () => {
  it('reads Source site, is not required, and offers None first', () => {
    renderPicker({ optional: true })
    const box = screen.getByRole('combobox', { name: /Source site/ })
    expect(box.getAttribute('aria-required')).not.toBe('true')
    const options = openMenu(/Source site/).getAllByRole('option')
    expect(options[0].textContent).toBe('None')
    expect(options.map((option) => option.textContent)).toEqual(['None', 'Site A', 'Site B'])
  })

  it('remembers a pick, and None clears it', () => {
    renderPicker({ optional: true })
    fireEvent.click(openMenu(/Source site/).getByRole('option', { name: 'Site B' }))
    expect(window.sessionStorage.getItem('aglyn.crm.createSite.org-1')).toBe('host-b')
    fireEvent.click(openMenu(/Source site/).getByRole('option', { name: 'None' }))
    expect(window.sessionStorage.getItem('aglyn.crm.createSite.org-1')).toBeNull()
  })
})

describe('CrmSitePicker in an org that keeps its sites apart', () => {
  it('reads Site, is required, and offers no None', () => {
    renderPicker()
    const options = openMenu(/Site/).getAllByRole('option')
    expect(options.map((option) => option.textContent)).not.toContain('None')
  })
})

describe('CrmSitePicker under a site', () => {
  it('renders nothing: the site is known', () => {
    const { container } = renderPicker({ hostId: 'host-a', optional: true })
    expect(container.textContent).toBe('')
  })
})
