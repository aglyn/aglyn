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
 * A CRM record's audit line goes to the feed the ACT belongs to (AGL-2738).
 *
 * Under a site: the site's own feed, client-direct, as it always has. At the
 * organization hub, where `hostId` is `null` by design: the org feed through
 * `crm/org-activity`, because a client-direct append to the RECORD's site is
 * gated on `canWriteHostContent` — a role in that site's `memberRoles` — while
 * the record write the line describes was gated on the org role, and an
 * org-wide member can hold the second without the first.
 *
 * The last case is the one that made this a bug rather than a refusal: a
 * refused line used to be swallowed whole, so a feature that logged nothing
 * looked exactly like a person who did nothing.
 */

import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useCrmActivityLogger } from './use-crm-activity-logger'
import { CrmOrgMountProvider } from './use-crm-org-mount'

/** Every line the client-direct host logger was handed. */
let hostLines: Array<{
  hostId: string | undefined
  action: string
  target: unknown
}>
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHostActivityLogger:
    (hostId: string | undefined) => (action: string, target: unknown) =>
      void hostLines.push({ hostId, action, target }),
}))

/** Every call the hook made to the CRM API, and what the route should answer. */
let posted: Array<{ route: string; payload: Record<string, unknown> }>
let answer: { ok: boolean; status: number; error?: string }
jest.mock('../components/use-crm-api', () => ({
  useCrmApi: () => async (route: string, payload: Record<string, unknown>) => {
    posted.push({ route, payload })
    return {
      response: { ok: answer.ok, status: answer.status },
      payload: answer.error ? { error: answer.error } : { ok: true },
    }
  },
}))

/** What reached Cloud Error Reporting. */
let beaconed: Array<{ message: string; kind?: string }>
jest.mock('@aglyn/aglyn/app-utils/error-beacon', () => ({
  reportHandledError: (error: unknown, options?: { kind?: string }) =>
    void beaconed.push({
      message: error instanceof Error ? error.message : String(error),
      kind: options?.kind,
    }),
}))

function orgMount({ children }: { children: ReactNode }) {
  return (
    <CrmOrgMountProvider
      mount={{
        orgId: 'org-1',
        hosts: [
          { id: 'host-a', name: 'Site A', subdomain: 'a' },
          { id: 'host-b', name: 'Site B', subdomain: 'b' },
        ],
        hostsReady: true,
        hostsPath: '/acme/hosts',
      }}
    >
      {children}
    </CrmOrgMountProvider>
  )
}

const TARGET = { type: 'deal', id: 'deal-1', name: 'Renewal' } as const

beforeEach(() => {
  hostLines = []
  posted = []
  beaconed = []
  answer = { ok: true, status: 200 }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('useCrmActivityLogger', () => {
  it('writes the site feed client-direct under a site', async () => {
    const { result } = renderHook(() => useCrmActivityLogger('host-a'))
    await act(async () => {
      result.current('Deleted deal', TARGET)
    })
    expect(hostLines).toEqual([
      { hostId: 'host-a', action: 'Deleted deal', target: TARGET },
    ])
    expect(posted).toEqual([])
  })

  it('posts the org feed line at the hub, where there is no site in scope', async () => {
    const { result } = renderHook(() => useCrmActivityLogger(null), {
      wrapper: orgMount,
    })
    await act(async () => {
      result.current('Deleted deal', TARGET)
    })
    expect(posted).toEqual([
      {
        route: 'org-activity',
        payload: { action: 'Deleted deal', target: TARGET },
      },
    ])
    // Never both: the org-wide feed merges the org's collection with every
    // site's, so a line written twice is read twice.
    expect(hostLines).toEqual([])
  })

  it('keeps writing the site feed for a surface the hub mounts UNDER a site', async () => {
    // The lead page is addressed `leads/{hostId}/{leadId}` at the org level
    // and is handed that site, so the mount alone must not decide the door.
    const { result } = renderHook(() => useCrmActivityLogger('host-b'), {
      wrapper: orgMount,
    })
    await act(async () => {
      result.current('Deleted deal', TARGET)
    })
    expect(hostLines).toEqual([
      { hostId: 'host-b', action: 'Deleted deal', target: TARGET },
    ])
    expect(posted).toEqual([])
  })

  it('reports a line the route REFUSED rather than dropping it in silence', async () => {
    // `authorizedFetch` resolves for a 403 as readily as for a 200, so this
    // arrives through the success path and leaves no trace unless it is
    // raised. A permission gap that logs nothing is the failure this closes.
    answer = {
      ok: false,
      status: 403,
      error:
        'Logging organization activity requires the data permission across the whole workspace',
    }
    const { result } = renderHook(() => useCrmActivityLogger(null), {
      wrapper: orgMount,
    })
    await act(async () => {
      result.current('Deleted deal', TARGET)
    })
    expect(beaconed).toEqual([
      {
        kind: 'crm-activity-write',
        message:
          'crm/org-activity refused the line (403): Logging organization ' +
          'activity requires the data permission across the whole workspace',
      },
    ])
  })

  it('says nothing to the reader about a line it could not write', async () => {
    // An audit miss must not answer "your record saved" with a message about
    // the log. The beacon and one console line are the whole signal.
    answer = { ok: false, status: 500 }
    const { result } = renderHook(() => useCrmActivityLogger(null), {
      wrapper: orgMount,
    })
    await act(async () => {
      result.current('Deleted deal', TARGET)
    })
    expect(beaconed).toEqual([
      {
        kind: 'crm-activity-write',
        message: 'crm/org-activity refused the line (500)',
      },
    ])
  })
})
