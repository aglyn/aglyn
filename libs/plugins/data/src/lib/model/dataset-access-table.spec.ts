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

jest.mock('@aglyn/tenant-feature-instance', () => ({}))
jest.mock('firebase/firestore', () => ({}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  memberHasOrgPermission: jest.fn(
    async (_orgId: string, member: { resolvedPermissions: Record<string, boolean> }, key: string) =>
      member.resolvedPermissions[key] === true,
  ),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectHostMemberPermissions } from '@aglyn/aglyn/app-utils/host-permissions'
import { resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import {
  isOrgWideMember,
  memberCanSee,
  projectHostMemberRoles,
  projectMemberScopeTokens,
} from '@aglyn/aglyn/app-utils/organizations'
import { deleteBeyondReach, oneSitePlacement as siteOf, resolvedPlacementKey } from '@aglyn/aglyn/app-utils/site-placement'
import { datasetAccessBlocked } from '../components/use-dataset-writes-blocked'
import { registerDataDeclarations } from '../declarations'
import { memberMayActOnDataset } from '../server/dataset-access.server'
import { DATA_MANAGE_PERMISSION, DATA_SITE_DELETE_PERMISSION, DATA_SITE_MANAGE_PERMISSION } from './dataset-access'

/**
 * The table `cloud/rules-dataset-access.spec.mjs` asks Firestore about (AGL-4047),
 * held here to the real projections, the approved changes, the routes' verdict
 * and the console's. The emulator suite runs plain node and cannot import these,
 * and a hand-written `[SITE_TOKEN]` fixture once hid what a collaborator's tokens
 * really reach, so nothing in the JSON is taken on trust.
 */
type Cells = Record<string, boolean>
interface Row {
  name: string
  uid: string
  member: Record<string, unknown>
  customRole?: Record<string, unknown>
  scopeTokens: string[]
  resolved: Record<string, boolean>
  before: Cells
  after: Cells
}
type Stamp = { memberRoles: Record<string, string>; memberPermissions: Record<string, Record<string, boolean>> }

const ORG = 'org-dataset-access'
const HERE = 'host-h'
const OTHER = 'host-other'
const PLACEMENTS: Record<string, string[]> = {
  Here: [`host:${HERE}`],
  Org: ['org'],
  Two: [`host:${HERE}`, `host:${OTHER}`],
  Other: [`host:${OTHER}`],
}
const TABLE: { hosts: Record<string, Stamp>; rows: Row[] } = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/rules-fixtures/dataset-access-principals.json'), 'utf8'),
)
const roster = TABLE.rows.map((row) => ({ ...row.member, $id: row.uid }))
const customRoles = new Map(TABLE.rows.filter((row) => row.customRole).map((row) => [row.member['roleId'], row.customRole]))
const named = TABLE.rows.map((row) => [row.name, row] as const)
const asMember = (row: Row) => ({ ...row.member, scopeTokens: row.scopeTokens, resolvedPermissions: row.resolved })

/** A Firestore holding the two sites as the table stamps them, and nothing else. */
const firestore = {
  collection: () => ({
    doc: (hostId: string) => ({
      get: async () => {
        const stamp = TABLE.hosts[hostId]
        const data: Record<string, unknown> = stamp ? { orgId: ORG, ...stamp } : {}
        return { exists: Boolean(stamp), get: (field: string) => data[field] }
      },
    }),
  }),
} as unknown as FirebaseFirestore.Firestore

const routeSays = (row: Row, placement: string, act: 'write' | 'delete') =>
  memberMayActOnDataset({
    firestore,
    orgId: ORG,
    uid: row.uid,
    member: asMember(row) as never,
    visibleTo: PLACEMENTS[placement],
    act,
  })

const consoleSays = (row: Row, placement: string) =>
  datasetAccessBlocked(asMember(row) as never, PLACEMENTS[placement], (row.customRole ?? null) as never)

/** Is this member narrowed on the site, the key following the site role? */
const narrowedHere = (row: Row, hostId: string, key: string) =>
  row.member['allHosts'] === true &&
  row.member['role'] === 'editor' &&
  ['author', 'viewer'].includes(String((row.member['hostAccess'] as Record<string, string> | undefined)?.[hostId] ?? '')) &&
  TABLE.hosts[hostId].memberPermissions[row.uid]?.[key] !== true

beforeAll(() => registerDataDeclarations())

describe('the fixture is what the projections write', () => {
  it.each(named)('%s: the scope tokens and the resolved keys', (_name, row) => {
    expect(row.scopeTokens).toEqual(projectMemberScopeTokens(row.member as never))
    const resolved = resolveOrgPermissions(row.member as never, (row.customRole ?? null) as never) as Record<string, boolean>
    for (const key of Object.keys(row.resolved)) expect(row.resolved[key]).toBe(resolved[key])
  })

  it.each(Object.keys(TABLE.hosts))('%s: the site’s stamps', (hostId) => {
    const stamp = TABLE.hosts[hostId]
    expect(stamp.memberRoles).toEqual(projectHostMemberRoles(roster as never, hostId))
    const permissions = projectHostMemberPermissions(roster as never, hostId, customRoles as never) as Record<
      string,
      Record<string, boolean>
    >
    expect(stamp.memberPermissions).toEqual(
      Object.fromEntries(
        Object.entries(permissions).map(([uid, keys]) => [
          uid,
          { [DATA_SITE_MANAGE_PERMISSION]: keys[DATA_SITE_MANAGE_PERMISSION], [DATA_SITE_DELETE_PERMISSION]: keys[DATA_SITE_DELETE_PERMISSION] },
        ]),
      ),
    )
  })
})

describe('the rule moved only where the four changes say', () => {
  const writesOn = (placement: string) => [`schema${placement}`, `recordEdit${placement}`]

  it.each(named)('%s: every write on a shared dataset is as it was', (_name, row) => {
    for (const placement of ['Org', 'Two']) {
      for (const cell of writesOn(placement)) expect(row.after[cell]).toBe(row.before[cell])
    }
    expect(row.after['recordDeleteOrg']).toBe(row.before['recordDeleteOrg'])
    expect(row.after['shareOrg']).toBe(row.before['shareOrg'])
  })

  it.each(named)('%s: a one-site dataset follows the site, and nothing else moves there', (_name, row) => {
    const stamp = TABLE.hosts[HERE].memberPermissions[row.uid]?.[DATA_SITE_MANAGE_PERMISSION] === true
    const narrowed = narrowedHere(row, HERE, DATA_SITE_MANAGE_PERMISSION)
    const expected = stamp || (row.before['schemaHere'] && !narrowed)
    for (const cell of ['schemaHere', 'recordEditHere', 'recordDeleteHere']) expect(row.after[cell]).toBe(expected)
    // Moving it stays with whoever could, less a site's narrowing: a site's verdict never moves it.
    expect(row.after['shareHere']).toBe(row.before['shareHere'] && !narrowed)
  })

  it.each(named)('%s: reading records follows the key and nothing else', (_name, row) => {
    for (const cell of ['readRecordsHere', 'readRecordsOrg']) {
      expect(row.after[cell]).toBe(row.before[cell] && row.resolved['data.viewRecords'])
    }
  })

  it('an editor narrowed on the site loses it, and keeps every other placement', () => {
    const row = TABLE.rows.find((candidate) => candidate.name === 'editor narrowed to Author here') as Row
    expect([row.before['schemaHere'], row.after['schemaHere']]).toEqual([true, false])
    expect(row.after['schemaOrg']).toBe(true)
    expect(row.after['schemaOther']).toBe(true)
  })

  it.each([
    'editor narrowed to Viewer here, keeps both keys',
    'editor narrowed to Viewer here, custom role keeps both keys',
    'editor narrowed to Viewer here, the site grants both keys back',
  ])('%s: answers as if never narrowed', (name) => {
    const row = TABLE.rows.find((candidate) => candidate.name === name) as Row
    expect(row.after).toEqual(row.before)
  })

  it.each([
    'collaborator (viewer doc) site Admin',
    'collaborator (viewer doc) site Editor',
    'viewer raised to Admin here',
    'viewer raised to Editor here',
  ])('%s: gains this site’s dataset, and no other, and cannot move it', (name) => {
    const row = TABLE.rows.find((candidate) => candidate.name === name) as Row
    expect([row.before['schemaHere'], row.after['schemaHere']]).toEqual([false, true])
    for (const cell of ['schemaOrg', 'schemaTwo', 'schemaOther', 'shareHere', 'shareOrg']) expect(row.after[cell]).toBe(false)
  })
})

describe('the routes answer as the rule does', () => {
  // The rule also asks reach, which the routes ask apart first (`memberCanSee`, a 404).
  it.each(named)('%s: writing, on each placement', async (_name, row) => {
    for (const placement of Object.keys(PLACEMENTS)) {
      if (!memberCanSee(asMember(row) as never, PLACEMENTS[placement])) continue
      expect(await routeSays(row, placement, 'write')).toBe(row.after[`schema${placement}`])
    }
  })

  it.each(named)('%s: deleting: the site’s verdict on one site, else the workspace key', async (_name, row) => {
    const erase = row.resolved['org.eraseRecords']
    const stamp = TABLE.hosts[HERE].memberPermissions[row.uid]?.[DATA_SITE_DELETE_PERMISSION] === true
    expect(await routeSays(row, 'Here', 'delete')).toBe(stamp || (erase && !narrowedHere(row, HERE, DATA_SITE_DELETE_PERMISSION)))
    expect(await routeSays(row, 'Org', 'delete')).toBe(erase)
  })

  it.each(named)('%s: a site-only member never deletes what is shared beyond one site', (_name, row) => {
    const beyond = !isOrgWideMember(asMember(row) as never)
    expect(deleteBeyondReach(asMember(row) as never, PLACEMENTS['Org'])).toBe(beyond)
    expect(deleteBeyondReach(asMember(row) as never, PLACEMENTS['Two'])).toBe(beyond)
    expect(deleteBeyondReach(asMember(row) as never, PLACEMENTS['Here'])).toBe(false)
  })
})

describe('the console reads the table as the rule and the route do', () => {
  it.each(named)('%s: the site’s verdict off the membership is the site’s stamp', (_name, row) => {
    for (const hostId of Object.keys(TABLE.hosts)) {
      for (const key of [DATA_SITE_MANAGE_PERMISSION, DATA_SITE_DELETE_PERMISSION]) {
        expect(resolvedPlacementKey(row.member as never, hostId, key, (row.customRole ?? null) as never)).toBe(
          TABLE.hosts[hostId].memberPermissions[row.uid]?.[key] === true,
        )
      }
    }
  })

  it.each(named)('%s: writing and deleting, on each placement', async (_name, row) => {
    for (const placement of Object.keys(PLACEMENTS)) {
      const blocked = consoleSays(row, placement)
      expect(!blocked.writes).toBe(await routeSays(row, placement, 'write'))
      const beyond = deleteBeyondReach(asMember(row) as never, PLACEMENTS[placement])
      expect(!blocked.deletes).toBe(!beyond && (await routeSays(row, placement, 'delete')))
    }
  })

  it.each(named)('%s: reading and exporting follow their keys', (_name, row) => {
    const blocked = consoleSays(row, 'Here')
    expect(blocked.records).toBe(!row.resolved['data.viewRecords'])
    expect(blocked.exports).toBe(!row.resolved['data.export'])
    expect(blocked.creates).toBe(!row.resolved[DATA_MANAGE_PERMISSION])
  })
})

describe('the placement test', () => {
  it('finds exactly one site, as the rule does', () => {
    expect(siteOf([`host:${HERE}`])).toBe(HERE)
    expect(siteOf(['org'])).toBeNull()
    expect(siteOf([`host:${HERE}`, `host:${OTHER}`])).toBeNull()
    expect(siteOf(['host:a:b'])).toBeNull()
    expect(siteOf(['host:a/b'])).toBeNull()
    expect(siteOf([])).toBeNull()
    expect(siteOf(undefined)).toBeNull()
  })
})
