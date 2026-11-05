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

import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { registerCrmDeclarations } from '../declarations'
import { CrmOrgMountProvider } from './use-crm-org-mount'
import { useStageMoveBlocked } from './use-stage-move-blocked'

/**
 * What a stage control asks before it switches off (AGL-4047): the same answer
 * the routes give, on a site off the site's stamp and role, at the org hub off
 * the member and their custom role, and never a refusal it has not read yet.
 */

let docs: Record<string, { status: string; data?: unknown }>
let uid: string | null
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: uid ? { uid } : null }),
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const built = build()
    return built ? (docs[built.path] ?? { status: 'loading' }) : { status: 'idle' }
  },
}))

function orgMount({ children }: { children: ReactNode }) {
  return (
    <CrmOrgMountProvider
      mount={{
        orgId: 'org-1',
        hosts: [{ id: 'host-a', name: 'Site A', subdomain: 'a' }],
        hostsReady: true,
        orgSlug: 'acme',
        hostsPath: '/acme/hosts',
      }}
    >
      {children}
    </CrmOrgMountProvider>
  )
}

const onSite = () => renderHook(() => useStageMoveBlocked('host-a')).result.current
const atOrg = () => renderHook(() => useStageMoveBlocked(null), { wrapper: orgMount }).result.current

beforeAll(() => registerCrmDeclarations())
beforeEach(() => {
  docs = {}
  uid = 'u'
})

describe('on a site', () => {
  it.each([
    ['admin', false],
    ['editor', false],
    ['author', true],
    ['viewer', true],
  ])('a site %s: blocked %s, as the route answers', (role, blocked) => {
    docs['hosts/host-a'] = { status: 'success', data: { memberRoles: { u: role } } }
    expect(onSite()).toBe(blocked)
  })

  it('reads the stamp first, either way', () => {
    docs['hosts/host-a'] = {
      status: 'success',
      data: { memberRoles: { u: 'viewer' }, memberPermissions: { u: { 'crm.moveStages': true } } },
    }
    expect(onSite()).toBe(false)
    docs['hosts/host-a'] = {
      status: 'success',
      data: { memberRoles: { u: 'admin' }, memberPermissions: { u: { 'crm.moveStages': false } } },
    }
    expect(onSite()).toBe(true)
  })

  it('never reads as refused before it has read', () => {
    expect(onSite()).toBe(false)
    uid = null
    docs['hosts/host-a'] = { status: 'success', data: { memberRoles: {} } }
    expect(onSite()).toBe(false)
  })
})

describe('at the organization hub', () => {
  const member = (data: unknown) => {
    docs['orgs/org-1/members/u'] = { status: 'success', data }
  }

  it.each([
    ['an owner', { role: 'owner' }, false],
    ['an org-wide editor', { role: 'editor', allHosts: true }, false],
    ['an org-wide viewer', { role: 'viewer', allHosts: true }, true],
    ['a viewer granted "Manage data", which it follows', { role: 'viewer', allHosts: true, permissions: { 'data.manage': true } }, false],
    ['an admin refused the key itself', { role: 'admin', permissions: { 'crm.moveStages': false } }, true],
    ['a site collaborator, whose reach is refused', { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'admin' } }, true],
  ])('%s: blocked %s, as the route answers', (_name, data, blocked) => {
    member(data)
    expect(atOrg()).toBe(blocked)
  })

  it('applies a custom role once it has read it', () => {
    member({ role: 'editor', allHosts: true, roleId: 'r' })
    expect(atOrg()).toBe(false)
    docs['orgs/org-1/roles/r'] = { status: 'success', data: { permissions: { 'crm.moveStages': false } } }
    expect(atOrg()).toBe(true)
  })

  it('leaves it to the server for a reader with no membership, who is staff', () => {
    docs['orgs/org-1/members/u'] = { status: 'success', data: undefined }
    expect(atOrg()).toBe(false)
  })
})
