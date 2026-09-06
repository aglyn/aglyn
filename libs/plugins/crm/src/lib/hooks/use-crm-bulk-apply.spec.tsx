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
 * The bulk bars' one org line (AGL-2634): beneath the org hub's mount the
 * sentence the bar put in the snackbar is posted once as the org feed's
 * line for the action, under the bar's record kind — and NOT under a site,
 * not for an action that changed nothing, and not for a job whose route
 * wrote a line per record already.
 */

import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useCrmBulkApply } from './use-crm-bulk-apply'
import { CrmOrgMountProvider } from './use-crm-org-mount'

let posted: Array<{ route: string; payload: Record<string, unknown> }>
jest.mock('../components/use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, unknown>) => {
    posted.push({ route, payload })
    return { response: { ok: true }, payload: { ok: true } }
  },
}))
let notices: string[]
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: unknown) => void notices.push(String(message)),
  }),
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

const run = (done: number, extra: Partial<Parameters<ReturnType<typeof useCrmBulkApply>['apply']>[0]> = {}) => ({
  attempted: 3,
  skipped: [],
  job: async () => ({ done, refused: [] }),
  done: (count: number) => `Owner set on ${count} deals`,
  ...extra,
})

beforeEach(() => {
  posted = []
  notices = []
})

describe('useCrmBulkApply', () => {
  it('posts the snackbar sentence as the org line beneath the mount', async () => {
    const { result } = renderHook(() => useCrmBulkApply({ recordKind: 'deal' }), {
      wrapper: orgMount,
    })
    await act(async () => {
      await result.current.apply(run(3))
    })
    expect(notices).toEqual(['Owner set on 3 deals'])
    expect(posted).toEqual([
      {
        route: 'org-activity',
        payload: { action: 'Owner set on 3 deals', target: { type: 'deal' } },
      },
    ])
  })

  it('posts nothing under a site, where the bar logs into the site feed itself', async () => {
    const { result } = renderHook(() => useCrmBulkApply({ recordKind: 'deal' }))
    await act(async () => {
      await result.current.apply(run(3))
    })
    expect(notices).toEqual(['Owner set on 3 deals'])
    expect(posted).toEqual([])
  })

  it('posts nothing for an action that changed nothing, a job the route logged, or a bar that names no kind', async () => {
    const { result } = renderHook(() => useCrmBulkApply({ recordKind: 'deal' }), {
      wrapper: orgMount,
    })
    await act(async () => {
      await result.current.apply(run(0))
      await result.current.apply(run(2, { loggedByRoute: true }))
    })
    const anonymous = renderHook(() => useCrmBulkApply(), { wrapper: orgMount })
    await act(async () => {
      await anonymous.result.current.apply(run(2))
    })
    expect(notices).toEqual(['Nothing was changed', 'Owner set on 2 deals', 'Owner set on 2 deals'])
    expect(posted).toEqual([])
  })
})
