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
 * The per-member override writers (AGL-4047): a dotted catalog key is ONE
 * field, `null` clears it, the write re-projects before it answers, and a key
 * outside the scope is refused before anything is written.
 */

import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { registerPluginEntitlements } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'

/** Stored documents by path. */
const docs = new Map<string, Record<string, any>>()
const mockSync = jest.fn(async (..._args: unknown[]) => undefined)
const mockUpdates: unknown[][] = []

function applyUpdate(path: string, args: unknown[]): void {
  const data = structuredClone(docs.get(path) ?? {})
  for (let index = 0; index < args.length; index += 2) {
    const segments = (args[index] as FieldPath & { segments: string[] }).segments
    const value = args[index + 1]
    let node = data
    for (const segment of segments.slice(0, -1)) node = node[segment] ??= {}
    const leaf = segments[segments.length - 1]
    if (value instanceof Object && (value as { isEqual?: (o: unknown) => boolean }).isEqual?.(FieldValue.delete())) {
      delete node[leaf]
    } else {
      node[leaf] = value
    }
  }
  docs.set(path, data)
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => {
        const doc = (path: string): any => ({
          get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
          update: async (...args: unknown[]) => {
            mockUpdates.push(args)
            applyUpdate(path, args)
          },
          collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
        })
        return { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }) }
      },
    }),
  },
}))

jest.mock('./organizations', () => ({
  __esModule: true,
  syncOrgAuthProjections: (...args: unknown[]) => mockSync(...args),
  resolveMemberOrgPermissions: async (orgId: string, member: { roleId?: string } | null) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/org-permissions')
      .resolveOrgPermissions(member, member?.roleId ? (docs.get(`orgs/${orgId}/roles/${member.roleId}`) ?? null) : null),
  // The custom role by `roleId`, as the real ones read it (AGL-4047).
  resolveMemberCustomRole: async (orgId: string, member: { roleId?: string } | null) =>
    member?.roleId ? (docs.get(`orgs/${orgId}/roles/${member.roleId}`) ?? null) : null,
  resolveMemberSiteNarrowing: async (orgId: string, member: { roleId?: string } | null, hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/host-permissions')
      .siteNarrowingFor(member, hostId, member?.roleId ? (docs.get(`orgs/${orgId}/roles/${member.roleId}`) ?? null) : null),
}))

import { setHostPermissionOverrides, setMemberPermissionOverrides } from './member-permission-overrides'

const MEMBER = 'orgs/org-1/members/m1'

beforeAll(() => {
  registerPluginEntitlements({
    pluginId: 'reviews',
    orgPermissions: [
      {
        key: 'reviews.reply',
        label: 'Reply to reviews',
        description: 'x',
        roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
        hostRoleDefaults: { admin: true, editor: true, author: false, viewer: false },
      },
    ],
  })
  // A key a site narrows (AGL-4047).
  registerPluginPermissions([
    {
      key: 'desk.collect',
      pluginId: 'acme-desk',
      label: 'Collect forms',
      defaults: { admin: true, editor: true, viewer: false },
      narrowsPerSite: true,
    },
  ])
})

beforeEach(() => {
  docs.clear()
  mockUpdates.length = 0
  mockSync.mockClear()
})

describe('setMemberPermissionOverrides (AGL-4047)', () => {
  it('sets a dotted key as one field, clears one on null, and re-projects', async () => {
    docs.set(MEMBER, { role: 'editor', allHosts: true, permissions: { 'data.manage': false, 'other.kept': true } })
    const result = await setMemberPermissionOverrides({
      orgId: 'org-1',
      uid: 'm1',
      changes: { 'billing.view': true, 'data.manage': null },
    })
    expect((mockUpdates[0][0] as FieldPath & { segments: string[] }).segments).toEqual(['permissions', 'billing.view'])
    expect(docs.get(MEMBER)?.['permissions']).toEqual({ 'billing.view': true, 'other.kept': true })
    expect(result.before['billing.view']).toBe(false)
    expect(result.after['billing.view']).toBe(true)
    expect(result.before['data.manage']).toBe(false)
    expect(result.after['data.manage']).toBe(true)
    expect(mockSync).toHaveBeenCalledWith('org-1')
  })

  it('refuses a key outside the catalog before writing anything', async () => {
    docs.set(MEMBER, { role: 'editor' })
    await expect(
      setMemberPermissionOverrides({ orgId: 'org-1', uid: 'm1', changes: { 'no.such': true } }),
    ).rejects.toThrow(/not a catalog permission/)
    expect(mockUpdates).toHaveLength(0)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('sets and clears a narrowing choice in the same write, and answers the resolved choices', async () => {
    docs.set(MEMBER, { role: 'editor', allHosts: true, siteNarrowing: { 'desk.collect': true } })
    const kept = await setMemberPermissionOverrides({
      orgId: 'org-1',
      uid: 'm1',
      changes: { 'billing.view': true },
      narrowing: { 'desk.collect': false },
    })
    expect(mockUpdates).toHaveLength(1)
    expect(docs.get(MEMBER)?.['siteNarrowing']).toEqual({ 'desk.collect': false })
    expect(docs.get(MEMBER)?.['permissions']).toEqual({ 'billing.view': true })
    expect(kept.siteNarrowing['desk.collect']).toBe(false)
    const cleared = await setMemberPermissionOverrides({
      orgId: 'org-1',
      uid: 'm1',
      changes: {},
      narrowing: { 'desk.collect': null },
    })
    expect(docs.get(MEMBER)?.['siteNarrowing']).toEqual({})
    // Back to the built-in default, which follows the site role.
    expect(cleared.siteNarrowing['desk.collect']).toBe(true)
    // Every site is re-projected: the choice moves the verdict on each one that narrows them.
    expect(mockSync).toHaveBeenLastCalledWith('org-1')
  })

  it('refuses a narrowing choice for a key no site can narrow', async () => {
    docs.set(MEMBER, { role: 'editor', allHosts: true })
    await expect(
      setMemberPermissionOverrides({ orgId: 'org-1', uid: 'm1', changes: {}, narrowing: { 'billing.view': false } }),
    ).rejects.toThrow(/not a permission a site can narrow/)
    expect(mockUpdates).toHaveLength(0)
  })
})

describe('setHostPermissionOverrides (AGL-4047)', () => {
  it('sets and clears a per-site toggle on one site, leaving the others', async () => {
    docs.set(MEMBER, {
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-a': 'author', 'host-b': 'editor' },
      hostPermissions: { 'host-b': { 'reviews.reply': false } },
    })
    const granted = await setHostPermissionOverrides({
      orgId: 'org-1',
      uid: 'm1',
      hostId: 'host-a',
      changes: { 'reviews.reply': true },
    })
    expect(granted.before['reviews.reply']).toBe(false)
    expect(granted.after['reviews.reply']).toBe(true)
    expect(mockSync).toHaveBeenCalledWith('org-1', 'host-a')
    const cleared = await setHostPermissionOverrides({
      orgId: 'org-1',
      uid: 'm1',
      hostId: 'host-a',
      changes: { 'reviews.reply': null },
    })
    expect(cleared.after['reviews.reply']).toBe(false)
    expect(docs.get(MEMBER)?.['hostPermissions']).toEqual({ 'host-a': {}, 'host-b': { 'reviews.reply': false } })
  })

  it('refuses a key that is not per-site, and a site the member cannot reach', async () => {
    docs.set(MEMBER, { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor' } })
    await expect(
      setHostPermissionOverrides({ orgId: 'org-1', uid: 'm1', hostId: 'host-a', changes: { 'billing.view': true } }),
    ).rejects.toThrow(/not a per-site permission/)
    await expect(
      setHostPermissionOverrides({ orgId: 'org-1', uid: 'm1', hostId: 'host-z', changes: { 'reviews.reply': true } }),
    ).rejects.toThrow(/no access/)
    expect(mockUpdates).toHaveLength(0)
  })

  it('sets a key the site narrows for a workspace editor that site narrows (AGL-4047)', async () => {
    docs.set(MEMBER, { role: 'editor', allHosts: true, hostAccess: { 'host-a': 'viewer' } })
    const granted = await setHostPermissionOverrides({
      orgId: 'org-1',
      uid: 'm1',
      hostId: 'host-a',
      changes: { 'desk.collect': true },
    })
    expect(granted.before['desk.collect']).toBe(false)
    expect(granted.after['desk.collect']).toBe(true)
    // The per-site keys ride along at the workspace verdict, so a plugin
    // keeping a display copy of them does not read a refusal.
    expect(granted.after['reviews.reply']).toBe(true)
    expect(docs.get(MEMBER)?.['hostPermissions']).toEqual({ 'host-a': { 'desk.collect': true } })
    expect(mockSync).toHaveBeenCalledWith('org-1', 'host-a')
  })

  it('refuses, for a narrowed member, a key the site does not narrow; and the narrowed keys to anyone else (AGL-4047)', async () => {
    docs.set(MEMBER, { role: 'editor', allHosts: true, hostAccess: { 'host-a': 'viewer' } })
    await expect(
      setHostPermissionOverrides({ orgId: 'org-1', uid: 'm1', hostId: 'host-a', changes: { 'reviews.reply': true } }),
    ).rejects.toThrow(/not a per-site permission/)
    docs.set(MEMBER, { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'viewer' } })
    await expect(
      setHostPermissionOverrides({ orgId: 'org-1', uid: 'm1', hostId: 'host-a', changes: { 'desk.collect': true } }),
    ).rejects.toThrow(/not a per-site permission/)
    expect(mockUpdates).toHaveLength(0)
  })

  it('a workspace editor whose custom role keeps the key is not narrowed, so the site sets nothing (AGL-4047)', async () => {
    docs.set('orgs/org-1/roles/floor', { name: 'Floor', siteNarrowing: { 'desk.collect': false } })
    docs.set(MEMBER, { role: 'editor', allHosts: true, roleId: 'floor', hostAccess: { 'host-a': 'viewer' } })
    await expect(
      setHostPermissionOverrides({ orgId: 'org-1', uid: 'm1', hostId: 'host-a', changes: { 'desk.collect': true } }),
    ).rejects.toThrow(/not a per-site permission/)
    expect(mockUpdates).toHaveLength(0)
  })
})
