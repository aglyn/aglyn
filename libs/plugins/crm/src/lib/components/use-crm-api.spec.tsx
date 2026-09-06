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
 * `useCrmApi` names the level it is called at (AGL-2634): beneath the org
 * hub's mount the body carries `orgId`, which is what turns a call into a
 * route's org variant; under a site it carries what it always did and no
 * org, so the site variant's gates are the ones that run.
 */

import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { useCrmApi } from './use-crm-api'

let calls: Array<{ url: string; body: Record<string, unknown> }>
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({ ok: true }) }
  },
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1', getIdToken: async () => 'token' } }),
}))

function orgMount({ children }: { children: ReactNode }) {
  return (
    <CrmOrgMountProvider
      mount={{
        orgId: 'org-1',
        hosts: [{ id: 'host-a', name: 'Site A', subdomain: 'a' }],
        hostsReady: true,
        hostsPath: '/acme/hosts',
      }}
    >
      {children}
    </CrmOrgMountProvider>
  )
}

beforeEach(() => {
  calls = []
})

describe('useCrmApi', () => {
  it('posts the site and the payload under a site, and no org', async () => {
    const { result } = renderHook(() => useCrmApi('host-a'))
    await result.current('contacts-merge', { survivorId: 'c1', mergedId: 'c2' })
    expect(calls).toEqual([
      {
        url: '/api/crm/contacts-merge',
        body: { hostId: 'host-a', survivorId: 'c1', mergedId: 'c2' },
      },
    ])
  })

  it('names the org beneath the mount, beside the record’s own site', async () => {
    const { result } = renderHook(() => useCrmApi('host-a'), { wrapper: orgMount })
    await result.current('erase-person', { contactId: 'c1', email: 'a@b.c' })
    expect(calls[0].body).toEqual({
      hostId: 'host-a',
      orgId: 'org-1',
      contactId: 'c1',
      email: 'a@b.c',
    })
  })

  it('posts without a site for a record no site has captured, still naming the org', async () => {
    const { result } = renderHook(() => useCrmApi(null), { wrapper: orgMount })
    await result.current('org-activity', {
      action: 'Owner set on 3 deals',
      target: { type: 'deal' },
    })
    expect(calls[0]).toEqual({
      url: '/api/crm/org-activity',
      body: {
        hostId: null,
        orgId: 'org-1',
        action: 'Owner set on 3 deals',
        target: { type: 'deal' },
      },
    })
  })
})
