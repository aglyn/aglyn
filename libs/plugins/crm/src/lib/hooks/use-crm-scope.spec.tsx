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
 * ONE SCOPE HOOK, TWO LEVELS (AGL-2630).
 *
 * Under a site the hook answers as it always has: the site's group, the
 * group's read tokens, a create stamped from the same site. At the
 * ORGANIZATION level — `hostId: null` beneath the hub's mount — two things
 * must hold or the org hub is either a leak or a dead page:
 *
 *  1. A listener carries NO scope clause. The rules admit an org-wide
 *     member to every row, and a clause that kept the org's whole site list
 *     would still miss a site the list did not carry. `crmVisibleToClause`
 *     is the one place the clause is spelled, so it is what is asserted.
 *  2. A create stamps the SITE THE READER PICKED, and nothing until they
 *     have: a record stamped with no tokens is visible to nobody, and one
 *     stamped with a guessed site is filed under a brand that never met the
 *     person.
 *
 * The host→org lookup is stubbed to answer from its own arguments, so the
 * assertions are about what the hook DOES with a scope, not about Firestore.
 */

import {
  consentGroupForHost,
  crmReadTokens,
  crmScopeTokens,
  hostScopeToken,
} from '@aglyn/aglyn'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from './use-crm-org-mount'
import {
  crmScopeListable,
  crmVisibleToClause,
  useCrmScope,
} from './use-crm-scope'

jest.mock('firebase/firestore', () => ({
  where: (...args: unknown[]) => ({ type: 'where', args }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The org root from whichever identifier was handed over — a site's org
  // is `org-1`; an explicit org is itself; neither is no org at all.
  useOrgDataScope: (options: { hostId?: string; orgId?: string }) => {
    const orgId = options.orgId ?? (options.hostId ? 'org-1' : undefined)
    return {
      orgId,
      ready: true,
      scope: orgId ? (['orgs', orgId] as const) : null,
    }
  },
}))

const ORG = { $id: 'org-1' }
const HOSTS = [
  { id: 'host-a', name: 'Site A', subdomain: 'a' },
  { id: 'host-b', name: 'Site B', subdomain: 'b' },
]

/** The hub's mount, as `CrmConsolePage` publishes it at `/[orgSlug]/crm`. */
function orgMount(hosts = HOSTS, hostsReady = true) {
  return function Mount({ children }: { children: ReactNode }) {
    return (
      <CrmOrgMountProvider mount={{ orgId: 'org-1', hosts, hostsReady }}>
        {children}
      </CrmOrgMountProvider>
    )
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('useCrmScope under a site', () => {
  it("reads and writes as the site's own group", () => {
    const { result } = renderHook(() => useCrmScope({ hostId: 'host-a', org: ORG }))
    const group = consentGroupForHost(ORG, 'host-a')
    expect(result.current.level).toBe('site')
    expect(result.current.hostId).toBe('host-a')
    expect(result.current.scope).toEqual(['orgs', 'org-1'])
    expect(result.current.consentGroup).toEqual(group)
    expect(result.current.visibleTo).toEqual(crmReadTokens(group))
    expect(result.current.createHostId).toBe('host-a')
    expect(result.current.createTokens).toEqual(crmScopeTokens(ORG, group))
  })

  it('spells the scope clause exactly once, as the rules evaluate it', () => {
    const clause = crmVisibleToClause(['org', 'host:host-a'])
    expect(clause).toHaveLength(1)
    expect(clause[0]).toEqual({
      type: 'where',
      args: ['visibleTo', 'array-contains-any', ['org', 'host:host-a']],
    })
    // Nothing to ask for is not "ask for everything".
    expect(crmScopeListable([])).toBe(false)
    expect(crmScopeListable(['org'])).toBe(true)
  })
})

describe('useCrmScope at the organization level', () => {
  it('DROPS the scope clause: an org-wide member reads every row', () => {
    const { result } = renderHook(() => useCrmScope({ hostId: null, org: ORG }), {
      wrapper: orgMount(),
    })
    expect(result.current.level).toBe('org')
    expect(result.current.hostId).toBeNull()
    // The org root comes from the mount, with no site to look it up from.
    expect(result.current.scope).toEqual(['orgs', 'org-1'])
    expect(result.current.consentGroup).toBeNull()
    expect(result.current.visibleTo).toBeNull()
    // THE LISTENER: no clause, and a complete question all the same.
    expect(crmVisibleToClause(result.current.visibleTo)).toEqual([])
    expect(crmScopeListable(result.current.visibleTo)).toBe(true)
  })

  it('stamps a create from the SITE THE READER PICKED, and nothing before', () => {
    const { result } = renderHook(() => useCrmScope({ hostId: null, org: ORG }), {
      wrapper: orgMount(),
    })
    // Two sites and no pick: nothing is guessed.
    expect(result.current.createHostId).toBeNull()
    expect(result.current.createGroup).toBeNull()
    expect(result.current.createTokens).toEqual([])

    act(() => {
      // What `CrmSitePicker` calls when the reader chooses Site B.
      window.sessionStorage.setItem('aglyn.crm.createSite.org-1', 'host-b')
    })
    const { result: picked } = renderHook(
      () => useCrmScope({ hostId: null, org: ORG }),
      { wrapper: orgMount() },
    )
    const group = consentGroupForHost(ORG, 'host-b')
    expect(picked.current.createHostId).toBe('host-b')
    expect(picked.current.createGroup).toEqual(group)
    expect(picked.current.createTokens).toEqual(crmScopeTokens(ORG, group))
    // The picked site's, not the other site's.
    expect(picked.current.createGroup?.hostIds).not.toContain('host-a')
    expect(hostScopeToken('host-b')).toBeDefined()
    // Reads stay unscoped whatever was picked: the pick is about writes.
    expect(picked.current.visibleTo).toBeNull()
  })

  it('picks the only site silently when there is nothing to choose', () => {
    const { result } = renderHook(() => useCrmScope({ hostId: null, org: ORG }), {
      wrapper: orgMount([HOSTS[1]]),
    })
    expect(result.current.createHostId).toBe('host-b')
    expect(result.current.createTokens).toEqual(
      crmScopeTokens(ORG, consentGroupForHost(ORG, 'host-b')),
    )
  })

  it('forgets a remembered site the org no longer carries', () => {
    window.sessionStorage.setItem('aglyn.crm.createSite.org-1', 'host-gone')
    const { result } = renderHook(() => useCrmScope({ hostId: null, org: ORG }), {
      wrapper: orgMount(),
    })
    expect(result.current.createHostId).toBeNull()
  })

  it('resolves to no org at all when mounted nowhere', () => {
    const { result } = renderHook(() => useCrmScope({ hostId: null, org: ORG }))
    expect(result.current.scope).toBeNull()
    expect(result.current.createHostId).toBeNull()
  })
})
