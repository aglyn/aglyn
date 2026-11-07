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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { holdsStampedSiteKey, projectHostMemberPermissions } from '@aglyn/aglyn/app-utils/host-permissions'
import { resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { isOrgWideMember, projectHostMemberRoles, projectMemberScopeTokens } from '@aglyn/aglyn/app-utils/organizations'
import {
  holdsCampaignContainers,
  siteHoldsCampaignContainers,
  workspaceManagesCampaigns,
} from '../components/use-campaign-containers-blocked'
import { registerMarketingDeclarations } from '../declarations'
import { campaignPlacedOnlyOn } from './campaign-container'
import { MARKETING_CAMPAIGNS_SITE_ROLE_PRESET } from './marketing-permissions'

/**
 * The table `cloud/rules-campaign-site-gain.spec.mjs` asks Firestore about
 * (AGL-4047), held here to the real projections, the route's verdict and the
 * console's. The emulator suite runs plain node and cannot import these, and a
 * hand-written `[SITE_TOKEN]` fixture once hid what a collaborator's tokens
 * really reach, so nothing in the JSON is taken on trust.
 */
type Writes = Record<
  'createHere' | 'createOrg' | 'createOther' | 'updateHere' | 'updateOrg' | 'updateOther' | 'updateTwoSites' | 'rescopeHere',
  boolean
>
interface Row {
  name: string
  uid: string
  member: Record<string, unknown>
  customRole?: Record<string, unknown>
  scopeTokens: string[]
  resolvedKey: boolean
  routeSite: boolean
  routeOrg: boolean
  workspaceVerdict: boolean
  before: Writes
  after: Writes
}
type Stamp = { memberRoles: Record<string, string>; memberPermissions: Record<string, Record<string, boolean>> }

const KEY = 'marketing.campaigns'
const HERE = 'host-h'
const TABLE: { hosts: Record<string, Stamp>; rows: Row[] } = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/rules-fixtures/campaign-verdict-principals.json'), 'utf8'),
)
const roster = TABLE.rows.map((row) => ({ ...row.member, $id: row.uid }))
const customRoles = new Map(TABLE.rows.filter((row) => row.customRole).map((row) => [row.member['roleId'], row.customRole]))
const asMember = (row: Row) => ({ ...row.member, resolvedPermissions: { [KEY]: row.resolvedKey } })
const named = TABLE.rows.map((row) => [row.name, row] as const)

beforeAll(() => registerMarketingDeclarations())

describe('the fixture is what the projections write', () => {
  it.each(named)('%s: the scope tokens and the resolved key', (_name, row) => {
    expect(row.scopeTokens).toEqual(projectMemberScopeTokens(row.member as never))
    expect(row.resolvedKey).toBe(
      (resolveOrgPermissions(row.member as never, (row.customRole ?? null) as never) as Record<string, boolean>)[KEY],
    )
  })

  it.each(Object.keys(TABLE.hosts))('%s: the site’s stamps', (hostId) => {
    const stamp = TABLE.hosts[hostId]
    expect(stamp.memberRoles).toEqual(projectHostMemberRoles(roster as never, hostId))
    const permissions = projectHostMemberPermissions(roster as never, hostId, customRoles as never) as Record<
      string,
      Record<string, boolean>
    >
    expect(stamp.memberPermissions).toEqual(
      Object.fromEntries(Object.entries(permissions).map(([uid, keys]) => [uid, { [KEY]: keys[KEY] }])),
    )
  })

  it('holds a collaborator’s real `org` token, the one a hand-written fixture hid', () => {
    const collaborators = TABLE.rows.filter((row) => row.member['allHosts'] === false)
    expect(collaborators.length).toBeGreaterThan(0)
    for (const row of collaborators) expect(row.scopeTokens).toEqual(['org', `host:${HERE}`])
  })
})

describe('the routes answer as the table says', () => {
  it.each(named)('%s', (_name, row) => {
    expect(holdsStampedSiteKey(TABLE.hosts[HERE], row.uid, KEY, MARKETING_CAMPAIGNS_SITE_ROLE_PRESET)).toBe(row.routeSite)
    expect(isOrgWideMember(row.member as never) && row.resolvedKey).toBe(row.routeOrg)
  })
})

describe('nobody loses, and the gain is only the gain', () => {
  it.each(named)('%s: every Yes stays, and only the one site moves', (_name, row) => {
    for (const write of Object.keys(row.before) as Array<keyof Writes>) {
      if (row.before[write]) expect(row.after[write]).toBe(true)
    }
    expect(row.after).toEqual({
      ...row.before,
      createHere: row.before.createHere || row.routeSite,
      updateHere: row.before.updateHere || row.routeSite,
    })
  })

  it('keeps the rows where the rule allows and the route refuses', () => {
    const kept = TABLE.rows.filter((row) => row.after.updateHere && !row.routeSite).map((row) => row.name)
    expect(kept).toEqual(
      expect.arrayContaining(['editor narrowed to Author here', 'per-site toggle OFF: admin', 'collaborator (editor doc) site Viewer']),
    )
  })

  it('a site Admin or Editor on the viewer role gains create and edit on the one site', () => {
    for (const name of ['collaborator (viewer doc) site Admin', 'collaborator (viewer doc) site Editor']) {
      const row = TABLE.rows.find((candidate) => candidate.name === name) as Row
      expect([row.before.createHere, row.before.updateHere]).toEqual([false, false])
      expect([row.after.createHere, row.after.updateHere]).toEqual([true, true])
    }
  })
})

describe('the console reads the table as the rule and the route do', () => {
  const place = (visibleTo: string[]) => ({ visibleTo })
  const siteVerdict = (row: Row, hostId: string) =>
    siteHoldsCampaignContainers(asMember(row), hostId, (row.customRole ?? null) as never)
  /** Edit as the card asks it: the workspace's verdict, or the site's where it counts. */
  const canEdit = (row: Row, hostId: string | null, visibleTo: string[]) =>
    holdsCampaignContainers(asMember(row)) ||
    (Boolean(hostId) && campaignPlacedOnlyOn(place(visibleTo), String(hostId)) && siteVerdict(row, String(hostId)))

  it.each(named)('%s: the site’s verdict off the membership is the site’s stamp, on both sites', (_name, row) => {
    for (const hostId of Object.keys(TABLE.hosts)) {
      expect(siteVerdict(row, hostId)).toBe(TABLE.hosts[hostId].memberPermissions[row.uid]?.[KEY] === true)
    }
  })

  it.each(named)('%s: Edit under the site, on each placement', (_name, row) => {
    expect(canEdit(row, HERE, [`host:${HERE}`])).toBe(row.after.updateHere)
    expect(canEdit(row, HERE, ['org'])).toBe(row.after.updateOrg)
    expect(canEdit(row, HERE, [`host:${HERE}`, 'host:host-other'])).toBe(row.after.updateTwoSites)
  })

  /*
   * Shared with all sites except some, down to this one site (AGL-4047): the
   * rule's `scopePlacement` hands the one-site verdict nothing, so it answers as
   * a campaign on several sites does, for every member kind in the table.
   */
  it.each(named)('%s: Edit of a campaign shared with all sites except some, reaching this site alone', (_name, row) => {
    const marked = (place([`host:${HERE}`]) as Record<string, unknown>)
    const answer = (fields: Record<string, unknown>) =>
      holdsCampaignContainers(asMember(row)) ||
      (campaignPlacedOnlyOn({ ...marked, ...fields } as never, HERE) && siteVerdict(row, HERE))
    expect(answer({ scopeMode: 'allExcept', scopeExcept: ['host:host-other'] })).toBe(row.after.updateTwoSites)
    expect(answer({ scopeMode: null })).toBe(row.after.updateTwoSites)
  })

  it.each(named)('%s: on a workspace page, the workspace’s verdict', (_name, row) => {
    expect(canEdit(row, null, [`host:${HERE}`])).toBe(row.workspaceVerdict)
  })

  it.each(named)('%s: Delete answers the route, under the site and with none named', (_name, row) => {
    expect(siteVerdict(row, HERE)).toBe(row.routeSite)
    expect(workspaceManagesCampaigns(asMember(row))).toBe(row.routeOrg)
  })
})
