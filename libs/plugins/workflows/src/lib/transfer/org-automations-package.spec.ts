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

import {
  ORG_AUTOMATION_REFERENCE_KINDS,
  orgAutomationDependencies,
  orgAutomationPackageContent,
  rawOrgAutomationContent,
  remapOrgAutomationIds,
} from './org-automations-package'

const STORED = {
  name: 'Welcome',
  enabled: true,
  pausedHostIds: ['host-1'],
  trigger: { event: 'formSubmission', conditions: null, combinator: null },
  steps: [
    { type: 'enrollList', listId: 'list-1', listName: 'Newsletter' },
    { type: 'assignCampaign', campaignId: 'camp-1', campaignName: 'Spring' },
  ],
  visibleTo: ['host:host-1', 'host:host-2'],
}

describe('an org automation as a package item (AGL-3535)', () => {
  it('carries what it does, never whether it is on or who paused it', () => {
    const content = orgAutomationPackageContent(STORED)
    expect(content).not.toBeNull()
    expect(content).not.toHaveProperty('enabled')
    expect(content).not.toHaveProperty('pausedHostIds')
  })

  it('names its sites and what its steps reach', () => {
    expect(orgAutomationDependencies(rawOrgAutomationContent(STORED))).toEqual([
      { kind: 'site', id: 'host-1' },
      { kind: 'site', id: 'host-2' },
      { kind: ORG_AUTOMATION_REFERENCE_KINDS.list, id: 'list-1' },
      { kind: ORG_AUTOMATION_REFERENCE_KINDS.campaign, id: 'camp-1' },
    ])
  })

  it('drops a site from the placement, and keeps a dropped step reference’s name to resolve by', () => {
    const moved = remapOrgAutomationIds(
      rawOrgAutomationContent(STORED),
      new Map([
        ['site/host-1', 'host-9'],
        ['site/host-2', ''],
        [`${ORG_AUTOMATION_REFERENCE_KINDS.list}/list-1`, ''],
        [`${ORG_AUTOMATION_REFERENCE_KINDS.campaign}/camp-1`, 'camp-copy'],
      ]),
    )
    expect(moved.visibleTo).toEqual(['host:host-9'])
    expect(moved.steps).toEqual([
      { type: 'enrollList', listId: '', listName: 'Newsletter' },
      { type: 'assignCampaign', campaignId: 'camp-copy', campaignName: 'Spring' },
    ])
  })
})

describe('one that runs on all sites except some (AGL-4047)', () => {
  const MARKED = {
    ...STORED,
    visibleTo: ['host:host-2', 'host:host-3'],
    scopeMode: 'allExcept',
    scopeExcept: ['host:host-1'],
  }

  it('carries the choice, never the marker or the sites in today', () => {
    const content = orgAutomationPackageContent(MARKED)
    expect(content).toMatchObject({ visibleTo: [], sharing: { mode: 'allExcept', exceptHostIds: ['host-1'] } })
    expect(content).not.toHaveProperty('scopeMode')
    expect(content).not.toHaveProperty('scopeExcept')
  })

  it('names the sites it leaves out, and moves them with the plan', () => {
    const content = orgAutomationPackageContent(MARKED)
    if (!content) throw new Error('refused')
    expect(orgAutomationDependencies(content)).toContainEqual({ kind: 'site', id: 'host-1' })
    const moved = remapOrgAutomationIds(rawOrgAutomationContent(content), new Map([['site/host-1', 'host-9']]))
    expect(moved.sharing).toEqual({ mode: 'allExcept', exceptHostIds: ['host-9'] })
    const dropped = remapOrgAutomationIds(rawOrgAutomationContent(content), new Map([['site/host-1', '']]))
    expect(dropped.sharing).toEqual({ mode: 'allExcept', exceptHostIds: [] })
  })

  it('carries nothing new for one that doesn’t', () => {
    expect(orgAutomationPackageContent(STORED)).not.toHaveProperty('sharing')
  })
})
