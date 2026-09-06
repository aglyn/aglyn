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
 * The stage door names the level it is called at (AGL-2634). Under a site
 * the body carries the mounted site, as it always has. Beneath the org
 * hub's mount it carries the ORG and the deal's own site beside it — the
 * route's org variant — and a deal no site captured is no longer refused
 * on the client: the org variant is what moves it.
 */

import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from './use-crm-org-mount'
import { useDealStageApi } from './use-deal-stage-api'

let calls: Array<{ url: string; body: Record<string, unknown> }>
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      json: async () => ({ ok: true, dealId: 'd1', stageId: 'won', status: 'won' }),
    }
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

describe('useDealStageApi', () => {
  it('runs as the mounted site under a site, whatever site the deal names', async () => {
    const { result } = renderHook(() => useDealStageApi('host-a'))
    await result.current.moveToStage({ $id: 'd1', hostId: 'host-b' }, 'negotiation')
    expect(calls[0].body).toEqual({ hostId: 'host-a', dealId: 'd1', stageId: 'negotiation' })
  })

  it('refuses a deal with no site under a site, before any request', async () => {
    const { result } = renderHook(() => useDealStageApi(null))
    await expect(result.current.markWon({ $id: 'd1' })).rejects.toThrow(/names no site/)
    expect(calls).toEqual([])
  })

  it('names the org beneath the mount, with the deal’s own site beside it', async () => {
    const { result } = renderHook(() => useDealStageApi(null), { wrapper: orgMount })
    await result.current.markLost({ $id: 'd1', hostId: 'host-b' }, 'Budget cut')
    expect(calls[0].body).toEqual({
      hostId: 'host-b',
      orgId: 'org-1',
      dealId: 'd1',
      status: 'lost',
      lostReason: 'Budget cut',
    })
  })

  it('moves a deal no site captured beneath the mount — the org variant is what moves it', async () => {
    const { result } = renderHook(() => useDealStageApi(null), { wrapper: orgMount })
    await result.current.moveToStage({ $id: 'd1' }, 'negotiation')
    expect(calls[0].body).toEqual({
      hostId: null,
      orgId: 'org-1',
      dealId: 'd1',
      stageId: 'negotiation',
    })
  })
})
