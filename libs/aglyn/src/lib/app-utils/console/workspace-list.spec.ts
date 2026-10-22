/**
 * @jest-environment jsdom
 */
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

import type { UserOrgMembership } from '../../foundation/definitions/organization.types'
import {
  arrangeWorkspaces,
  compareWorkspaces,
  needsWorkspacePlans,
  readPinnedOrgs,
  togglePinnedOrg,
  workspaceMatchesSearch,
  WORKSPACE_FILTER_FIELDS,
  WORKSPACE_FILTER_OPTIONS,
} from './workspace-list'

/** The chooser as it read before AGL-3762: membership order, not names. */
const ORGS: UserOrgMembership[] = [
  { $id: 'org-edr', orgName: 'EDR Construction', slug: 'edr', role: 'owner' },
  { $id: 'org-rtr', orgName: 'Ready To Roll', slug: 'ready-to-roll', role: 'admin' },
  { $id: 'org-elv', orgName: 'Elevated Concepts', slug: 'elevated', role: 'editor' },
  { $id: 'org-tst', orgName: 'Test Org', slug: 'test-org', role: 'viewer' },
  { $id: 'org-agl', orgName: 'Aglyn LLC', slug: 'aglyn', role: 'owner' },
] as UserOrgMembership[]

const names = (rows: readonly { orgName?: string }[]) =>
  rows.map((row) => row.orgName)

describe('the workspace list order (AGL-3762)', () => {
  it('sorts by name, A to Z, whatever order the memberships arrive in', () => {
    expect(names(arrangeWorkspaces(ORGS))).toEqual([
      'Aglyn LLC',
      'EDR Construction',
      'Elevated Concepts',
      'Ready To Roll',
      'Test Org',
    ])
    expect(names(arrangeWorkspaces([...ORGS].reverse()))).toEqual(
      names(arrangeWorkspaces(ORGS)),
    )
  })

  it('ignores case and accents, and reads digits as numbers', () => {
    const rows = [
      { $id: 'a', orgName: 'zeta' },
      { $id: 'b', orgName: 'Émile' },
      { $id: 'c', orgName: 'alpha' },
      { $id: 'd', orgName: 'Site 10' },
      { $id: 'e', orgName: 'Site 2' },
      { $id: 'f', orgName: 'Beta' },
    ] as UserOrgMembership[]
    expect(names(arrangeWorkspaces(rows))).toEqual([
      'alpha',
      'Beta',
      'Émile',
      'Site 2',
      'Site 10',
      'zeta',
    ])
  })

  it('names a workspace with no name by its slug, then its id', () => {
    const rows = [
      { $id: 'org-z', orgName: 'Mango' },
      { $id: 'org-a', slug: 'banana' },
      { $id: 'apple' },
    ] as UserOrgMembership[]
    expect(arrangeWorkspaces(rows).map((row) => row.$id)).toEqual([
      'apple',
      'org-a',
      'org-z',
    ])
  })

  it('is a TOTAL order, so a page boundary never moves between renders', () => {
    const twins = [
      { $id: 'org-2', orgName: 'Acme', slug: 'acme-b' },
      { $id: 'org-3', orgName: 'Acme', slug: 'acme-a' },
      { $id: 'org-1', orgName: 'ACME', slug: 'acme-a' },
    ] as UserOrgMembership[]
    const once = arrangeWorkspaces(twins).map((row) => row.$id)
    expect(once).toEqual(['org-1', 'org-3', 'org-2'])
    expect(arrangeWorkspaces([...twins].reverse()).map((row) => row.$id)).toEqual(
      once,
    )
    const [a, b] = arrangeWorkspaces(twins)
    expect(compareWorkspaces(a, a)).toBe(0)
    expect(compareWorkspaces(a, b)).toBeLessThan(0)
  })

  it('puts pinned workspaces first, each group still in name order', () => {
    const rows = arrangeWorkspaces(ORGS, { pinned: ['org-tst', 'org-edr'] })
    expect(names(rows)).toEqual([
      'EDR Construction',
      'Test Org',
      'Aglyn LLC',
      'Elevated Concepts',
      'Ready To Roll',
    ])
    expect(rows.map((row) => row.pinned)).toEqual([true, true, false, false, false])
  })

  it('ignores a pin for a workspace the reader no longer belongs to', () => {
    const rows = arrangeWorkspaces(ORGS, { pinned: ['org-gone'] })
    expect(rows).toHaveLength(ORGS.length)
    expect(rows.every((row) => !row.pinned)).toBe(true)
    expect(rows.map((row) => row.$id)).not.toContain('org-gone')
  })
})

describe('the workspace search (AGL-3762)', () => {
  it('finds a workspace by the start of any word of its name or slug', () => {
    const find = (...words: string[]) =>
      names(arrangeWorkspaces(ORGS, { search: words }))
    expect(find('roll')).toEqual(['Ready To Roll'])
    expect(find('READY')).toEqual(['Ready To Roll'])
    expect(find('elev')).toEqual(['Elevated Concepts'])
    expect(find('test-org')).toEqual([])
    expect(find('test', 'org')).toEqual(['Test Org'])
    expect(find('e')).toEqual(['EDR Construction', 'Elevated Concepts'])
    // A word in the middle of another word is not the start of one.
    expect(find('oll')).toEqual([])
    expect(find()).toHaveLength(ORGS.length)
  })

  it('folds accents both ways', () => {
    const row = { $id: 'x', orgName: 'Café Émile', slug: 'cafe' } as UserOrgMembership
    expect(workspaceMatchesSearch(row, ['emile'])).toBe(true)
    expect(workspaceMatchesSearch(row, ['Émi'])).toBe(true)
    expect(workspaceMatchesSearch(row, ['bistro'])).toBe(false)
  })
})

describe('the workspace filters (AGL-3762)', () => {
  it('offers only plan, role and pinned — fields the rows really carry', () => {
    expect(WORKSPACE_FILTER_FIELDS.map((field) => field.column)).toEqual([
      'plan',
      'role',
      'pinned',
    ])
    expect(WORKSPACE_FILTER_OPTIONS['role'].map((option) => option.value)).toEqual([
      'owner',
      'admin',
      'editor',
      'viewer',
    ])
    expect(WORKSPACE_FILTER_OPTIONS['plan'].map((option) => option.value)).toContain(
      'free',
    )
  })

  it('narrows by the reader’s role in each workspace', () => {
    const rows = arrangeWorkspaces(ORGS, {
      clauses: [{ field: 'role', op: 'equals', value: 'owner' }],
    })
    expect(names(rows)).toEqual(['Aglyn LLC', 'EDR Construction'])
  })

  it('narrows by plan, from the plans it is handed', () => {
    const plans = {
      'org-edr': 'business',
      'org-rtr': 'free',
      'org-elv': 'business',
      'org-tst': 'free',
      'org-agl': 'enterprise',
    }
    const rows = arrangeWorkspaces(ORGS, {
      plans,
      clauses: [{ field: 'plan', op: 'equals', value: 'business' }],
    })
    expect(names(rows)).toEqual(['EDR Construction', 'Elevated Concepts'])
    expect(rows.map((row) => row.plan)).toEqual(['business', 'business'])
    expect(needsWorkspacePlans([{ field: 'plan', op: 'equals', value: 'free' }])).toBe(
      true,
    )
    expect(needsWorkspacePlans([{ field: 'role', op: 'equals', value: 'owner' }])).toBe(
      false,
    )
  })

  it('narrows to the pinned workspaces, or to the rest', () => {
    const pinned = ['org-rtr']
    expect(
      names(
        arrangeWorkspaces(ORGS, {
          pinned,
          clauses: [{ field: 'pinned', op: 'is', value: 'true' }],
        }),
      ),
    ).toEqual(['Ready To Roll'])
    expect(
      arrangeWorkspaces(ORGS, {
        pinned,
        clauses: [{ field: 'pinned', op: 'is', value: 'false' }],
      }),
    ).toHaveLength(ORGS.length - 1)
  })

  it('adds the search and every clause together', () => {
    const rows = arrangeWorkspaces(ORGS, {
      search: ['e'],
      clauses: [{ field: 'role', op: 'equals', value: 'owner' }],
    })
    expect(names(rows)).toEqual(['EDR Construction'])
  })
})

describe('the stored pins (AGL-3762)', () => {
  it('reads a list of ids, and nothing else, from the account document', () => {
    expect(readPinnedOrgs({ pinnedOrgs: ['a', 'b', 'a'] })).toEqual(['a', 'b'])
    expect(readPinnedOrgs({ pinnedOrgs: ['a', 7, '', null] })).toEqual(['a'])
    expect(readPinnedOrgs({ pinnedOrgs: 'a' })).toEqual([])
    expect(readPinnedOrgs(undefined)).toEqual([])
  })

  it('pins and unpins one workspace at a time', () => {
    expect(togglePinnedOrg([], 'a')).toEqual(['a'])
    expect(togglePinnedOrg(['a', 'b'], 'a')).toEqual(['b'])
  })
})
