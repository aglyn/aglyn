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
 * The Emails hub a CRM surface links to (AGL-2634): the site in the URL
 * under a site, and at the organization level — where the URL names none
 * — the mount's answer for the site it was asked about, or nothing.
 */

import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { useEmailsHubPath } from './use-emails-hub-path'

let params: Record<string, string> = {}
jest.mock('next/navigation', () => ({
  useParams: () => params,
}))

function orgMount({ children }: { children: ReactNode }) {
  return (
    <CrmOrgMountProvider
      mount={{
        orgId: 'org-1',
        hosts: [
          { id: 'host-a', name: 'Site A', subdomain: 'a' },
          { id: 'host-b', name: 'Site B', subdomain: null },
        ],
        hostsReady: true,
        hostsPath: '/acme/hosts',
      }}
    >
      {children}
    </CrmOrgMountProvider>
  )
}

describe('useEmailsHubPath', () => {
  it('names the site in the URL under a site, whatever site it was asked about', () => {
    params = { orgSlug: 'acme', host: 'shop' }
    expect(renderHook(() => useEmailsHubPath()).result.current).toBe('/acme/hosts/shop/emails')
    expect(renderHook(() => useEmailsHubPath('host-a')).result.current).toBe(
      '/acme/hosts/shop/emails',
    )
  })

  it('answers the mount’s site at the organization level, and nothing for a site it cannot name', () => {
    params = { orgSlug: 'acme' }
    expect(
      renderHook(() => useEmailsHubPath('host-a'), { wrapper: orgMount }).result.current,
    ).toBe('/acme/hosts/a/emails')
    expect(
      renderHook(() => useEmailsHubPath('host-b'), { wrapper: orgMount }).result.current,
    ).toBeNull()
    expect(renderHook(() => useEmailsHubPath(null), { wrapper: orgMount }).result.current).toBeNull()
  })

  it('answers nothing on a surface mounted nowhere', () => {
    params = {}
    expect(renderHook(() => useEmailsHubPath('host-a')).result.current).toBeNull()
  })
})
