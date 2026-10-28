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
import { useCanErasePeople } from './use-can-erase-people'

/**
 * Who may file a privacy erasure (AGL-4047): "Privacy requests"
 * (`org.privacy`) over the whole workspace, as the catalog resolves it from
 * the member's own document and their custom role — the key the route asks.
 */

const docs = new Map<string, Record<string, unknown>>()
let loading = false

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const ref = build()
    if (!ref) return { status: 'loading', data: undefined }
    if (loading) return { status: 'loading', data: undefined }
    return { status: 'success', data: docs.get(ref.path) }
  },
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

const verdict = () => renderHook(() => useCanErasePeople('org-1')).result.current

beforeEach(() => {
  docs.clear()
  loading = false
})

describe('useCanErasePeople (AGL-4047)', () => {
  it('lets an owner and an admin file one by default, and nobody else', () => {
    for (const [role, expected] of [
      ['owner', true],
      ['admin', true],
      ['editor', false],
      ['viewer', false],
    ] as const) {
      docs.set('orgs/org-1/members/uid-1', { role, allHosts: true })
      expect([role, verdict()]).toEqual([role, { canErase: expected, ready: true }])
    }
  })

  it('follows a custom role and an override, both ways', () => {
    docs.set('orgs/org-1/roles/privacy', { permissions: { 'org.privacy': true } })
    docs.set('orgs/org-1/members/uid-1', { role: 'editor', allHosts: true, roleId: 'privacy' })
    expect(verdict().canErase).toBe(true)
    docs.set('orgs/org-1/members/uid-1', { role: 'admin', permissions: { 'org.privacy': false } })
    expect(verdict().canErase).toBe(false)
  })

  it('never lets a site collaborator file one, granted the key or not', () => {
    docs.set('orgs/org-1/members/uid-1', {
      role: 'viewer',
      allHosts: false,
      hostAccess: { 'host-1': 'admin' },
      permissions: { 'org.privacy': true },
    })
    expect(verdict().canErase).toBe(false)
  })

  it('is not ready while the membership is read', () => {
    loading = true
    expect(verdict()).toEqual({ canErase: false, ready: false })
  })
})
