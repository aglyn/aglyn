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

const mockDocs = new Map<string, { data?: unknown; status: string }>()
const mockReads: string[] = []
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const ref = build()
    if (!ref) return { data: undefined, status: 'loading' }
    mockReads.push(ref.path)
    return mockDocs.get(ref.path) ?? { data: undefined, status: 'loading' }
  },
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
}))

import { renderHook } from '@testing-library/react'
import { registerMarketingDeclarations } from '../declarations'
import {
  holdsCampaignContainers,
  useCampaignContainerAccess,
  useCampaignContainersBlocked,
} from './use-campaign-containers-blocked'

/** The console's half of `cloud/rules-crm-audience-writes.spec.mjs`, row for row (AGL-4047): the workspace's verdict. */
describe('the console reads a campaign container’s key as the rule does', () => {
  it.each([
    ['the owner', { role: 'owner' }, true],
    ['an admin', { role: 'admin' }, true],
    ['an editor', { role: 'editor' }, true],
    ['a viewer', { role: 'viewer' }, false],
    ['an editor stamped before the key existed', { role: 'editor', resolvedPermissions: { 'site.edit': true } }, true],
    ['a viewer stamped before the key existed', { role: 'viewer', resolvedPermissions: { 'site.edit': false } }, false],
    ['a viewer a custom role grants it', { role: 'viewer', resolvedPermissions: { 'marketing.campaigns': true } }, true],
    ['an admin a custom role refuses it', { role: 'admin', resolvedPermissions: { 'marketing.campaigns': false } }, false],
    ['a viewer never stamped, whose override grants it', { role: 'viewer', permissions: { 'marketing.campaigns': true } }, true],
    ['an editor never stamped, whose override refuses it', { role: 'editor', permissions: { 'marketing.campaigns': false } }, false],
    [
      'a stamp ahead of an older override',
      { role: 'editor', resolvedPermissions: { 'marketing.campaigns': true }, permissions: { 'marketing.campaigns': false } },
      true,
    ],
    ['a site collaborator on the editor role', { role: 'editor', allHosts: false }, true],
    ['a site collaborator on the viewer role', { role: 'viewer', allHosts: false }, false],
  ])('%s: %s', (_name, member, held) => {
    expect(holdsCampaignContainers(member)).toBe(held)
  })
})

describe('the page asks the verdict the rule and the route ask, off the membership it already holds', () => {
  const MEMBER = 'orgs/org1/members/u1'
  const ROLE = 'orgs/org1/roles/r1'
  const here = { visibleTo: ['host:site1'] }
  const on = (data: unknown) => ({ data, status: 'success' })
  const workspaceEditor = { role: 'editor', allHosts: true }
  const workspaceViewer = { role: 'viewer', allHosts: true }
  const siteEditor = { role: 'viewer', allHosts: false, hostAccess: { site1: 'editor' } }
  const siteAuthor = { role: 'viewer', allHosts: false, hostAccess: { site1: 'author' } }
  const raisedViewer = { role: 'viewer', allHosts: true, hostAccess: { site1: 'editor' } }
  const toggledOff = { role: 'editor', allHosts: true, hostPermissions: { site1: { 'marketing.campaigns': false } } }
  const toggledOn = { role: 'viewer', allHosts: true, hostPermissions: { site1: { 'marketing.campaigns': true } } }
  const otherSite = { role: 'viewer', allHosts: false, hostAccess: { site2: 'admin' } }
  const created = (hostId: string | null) =>
    renderHook(() => useCampaignContainersBlocked('org1', hostId)).result.current
  const opened = (hostId: string | null, campaign: { visibleTo: string[] } | undefined) =>
    renderHook(() => useCampaignContainerAccess('org1', hostId, campaign)).result.current

  beforeAll(() => registerMarketingDeclarations())
  beforeEach(() => {
    mockDocs.clear()
    mockReads.length = 0
  })
  afterEach(() => {
    // The whole cost of a verdict: never the host document.
    expect(mockReads.filter((path) => path.startsWith('hosts/'))).toEqual([])
  })

  describe('Create campaign', () => {
    it.each([
      ['a member the workspace admits', workspaceEditor, false],
      ['a member a site narrows, whom the workspace still admits', toggledOff, false],
      ['the whole workspace’s viewer, Editor here', raisedViewer, false],
      ['the whole workspace’s viewer, the key toggled on here', toggledOn, false],
      ['a collaborator, Editor here', siteEditor, false],
      ['a collaborator, Author here', siteAuthor, true],
      ['the whole workspace’s viewer, nothing here', workspaceViewer, true],
      ['a collaborator on another site', otherSite, true],
    ])('under a site: %s', (_name, member, blocked) => {
      mockDocs.set(MEMBER, on(member))
      expect(created('site1')).toBe(blocked)
      expect(mockReads.every((path) => path === MEMBER)).toBe(true)
    })

    it('stays on while the membership is out', () => {
      expect(created('site1')).toBe(false)
    })

    it('on a workspace page, the workspace’s verdict alone', () => {
      mockDocs.set(MEMBER, on(raisedViewer))
      expect(created(null)).toBe(true)
    })

    it('a reader with no membership, who is staff, is not stopped', () => {
      mockDocs.set(MEMBER, on(undefined))
      expect(created('site1')).toBe(false)
    })
  })

  describe('a custom role is the one extra read, and only where it can matter', () => {
    const onRole = { role: 'admin', allHosts: true, roleId: 'r1', resolvedPermissions: { 'marketing.campaigns': false } }

    it('holds the answer while the role is out', () => {
      mockDocs.set(MEMBER, on(onRole))
      expect(created('site1')).toBe(false)
      expect(mockReads).toContain(ROLE)
    })

    it('a role that refuses the key refuses it on the site too', () => {
      mockDocs.set(MEMBER, on(onRole))
      mockDocs.set(ROLE, on({ permissions: { 'marketing.campaigns': false } }))
      expect(created('site1')).toBe(true)
    })

    it('a member the workspace admits never reads it for Create', () => {
      mockDocs.set(MEMBER, on({ role: 'viewer', allHosts: true, roleId: 'r1', resolvedPermissions: { 'marketing.campaigns': true } }))
      expect(created('site1')).toBe(false)
      expect(mockReads).not.toContain(ROLE)
    })

    it('a collaborator’s role is a seat, not a grant, so it is never read', () => {
      mockDocs.set(MEMBER, on({ ...siteEditor, roleId: 'r1' }))
      expect(created('site1')).toBe(false)
      expect(mockReads).not.toContain(ROLE)
    })

    it('no campaign yet, no role read: a send’s report holds no container', () => {
      mockDocs.set(MEMBER, on(onRole))
      opened('site1', undefined)
      expect(mockReads).not.toContain(ROLE)
    })
  })

  describe('a campaign’s own page', () => {
    it('a site Editor edits and deletes a campaign on that one site', () => {
      mockDocs.set(MEMBER, on(siteEditor))
      expect(opened('site1', here)).toEqual({ editBlocked: false, deleteBlocked: false })
    })

    it.each([
      ['every site', ['org']],
      ['several sites', ['host:site1', 'host:site2']],
      ['another site', ['host:site2']],
    ])('the site’s verdict does not edit a campaign on %s', (_name, visibleTo) => {
      mockDocs.set(MEMBER, on(siteEditor))
      expect(opened('site1', { visibleTo }).editBlocked).toBe(true)
    })

    it('a site that turned the key off stops Delete, and the workspace’s verdict still edits', () => {
      mockDocs.set(MEMBER, on(toggledOff))
      expect(opened('site1', here)).toEqual({ editBlocked: false, deleteBlocked: true })
    })

    it('an Author here is refused both', () => {
      mockDocs.set(MEMBER, on(siteAuthor))
      expect(opened('site1', here)).toEqual({ editBlocked: true, deleteBlocked: true })
    })

    it('on a workspace page, both answer the workspace', () => {
      mockDocs.set(MEMBER, on(raisedViewer))
      expect(opened(null, here)).toEqual({ editBlocked: true, deleteBlocked: true })
    })

    it('on a workspace page, Delete needs the whole workspace, as the route does', () => {
      mockDocs.set(MEMBER, on({ role: 'editor', allHosts: false }))
      expect(opened(null, here)).toEqual({ editBlocked: false, deleteBlocked: true })
    })

    it('a reader with no membership is not stopped, and the server answers', () => {
      mockDocs.set(MEMBER, on(undefined))
      expect(opened(null, here)).toEqual({ editBlocked: false, deleteBlocked: false })
      expect(opened('site1', here)).toEqual({ editBlocked: false, deleteBlocked: false })
    })
  })
})
