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
  STAFF_AUDIT_ACTION_LABELS,
  activityActionSentence,
  describeActivity,
  describeStaffAudit,
  humanizeActivityCode,
  staffAuditActionLabel,
} from './activity-labels'
import {
  registerPluginActivityActions,
  resetPluginActivityActionsForTests,
} from '../plugin-manager/plugin-activity-actions'

const CODE = /\b[a-z]+\.[a-z]+(\.[a-z_]+)?\b/i

beforeEach(() => {
  resetPluginActivityActionsForTests()
  registerPluginActivityActions({
    pluginId: 'ai',
    group: {
      id: 'ai',
      label: 'AI',
      staffAuditLabels: { 'ai.job.resume': 'Confirmed an Aglyn AI plan' },
    },
    actions: [
      {
        key: 'ai.job.output',
        label: 'AI generated',
        sentence: 'Created {target} with Aglyn AI',
        scope: ['org', 'host'],
      },
      { key: 'ai.job.created', label: 'Started an AI generation', scope: ['org', 'host'] },
    ],
    targetTypes: { aiJob: 'AI generation' },
  })
})
afterAll(() => resetPluginActivityActionsForTests())

describe('activity rows (AGL-3660)', () => {
  it('reads an AI output as a sentence naming what was made', () => {
    expect(activityActionSentence('ai.job.output', { type: 'screen', name: 'Home' })).toBe(
      'Created page Home with Aglyn AI',
    )
  })

  it('names the site and the item as the target, the site from the log it came from', () => {
    const described = describeActivity(
      {
        action: 'ai.job.output',
        target: { type: 'screen', id: 's1', name: 'Home' },
        scopeType: 'host',
        scopeId: 'h1',
      },
      { hosts: { h1: 'Acme Bakery' } },
    )
    expect(described.action).toBe('Created page Home with Aglyn AI')
    expect(described.target).toBe('Acme Bakery · Home')
    expect(described.code).toBe('ai.job.output')
    expect(described.hostId).toBe('h1')
  })

  it('links a job row to its job', () => {
    const described = describeActivity({
      action: 'ai.job.created',
      target: { type: 'aiJob', id: 'job1', name: 'site · 120-character brief' },
      scopeType: 'org',
      scopeId: 'o1',
    })
    expect(described.jobId).toBe('job1')
    expect(described.action).toBe('Started an AI generation')
  })

  it('keeps a prose action as written and carries no code', () => {
    const described = describeActivity({ action: 'Saved the screen', target: { type: 'screen' } })
    expect(described.action).toBe('Saved the screen')
    expect(described.code).toBeNull()
  })
})

describe('staff audit rows (AGL-3660)', () => {
  it('never shows a code or a path as the visible text', () => {
    const described = describeStaffAudit(
      {
        action: 'ai.job.output',
        target: 'orgs/o1/aiJobs/job1',
        after: { resource: 'screen', label: 'Home', hostId: 'h1', credits: 4 },
      },
      { hosts: { h1: 'Acme Bakery' }, orgs: { o1: 'Acme' } },
    )
    expect(described.action).toBe('Created page Home with Aglyn AI')
    expect(described.target).toBe('Acme Bakery · Home')
    expect(described.credits).toBe(4)
    expect(described.result).toBe('Draft created')
    expect(described.jobId).toBe('job1')
    expect(described.orgId).toBe('o1')
    // The raw facts survive for the tooltip and the staff dialog.
    expect(described.code).toBe('ai.job.output')
    expect(described.path).toBe('orgs/o1/aiJobs/job1')
    expect(described.action).not.toMatch(CODE)
    expect(described.target).not.toContain('/')
  })

  it('reads a plugin-declared staff code from the plugin', () => {
    expect(staffAuditActionLabel('ai.job.resume')).toBe('Confirmed an Aglyn AI plan')
  })

  it('reads a core code from the shared map, and an unknown one as words', () => {
    expect(staffAuditActionLabel('user.impersonate')).toBe('Signed in as the account')
    expect(humanizeActivityCode('billing.invoice.paidLate')).toBe('Billing: invoice paid late')
    expect(staffAuditActionLabel('widgets.frobnicated')).not.toMatch(CODE)
  })

  it('names an account target by its address, an org by its name', () => {
    expect(
      describeStaffAudit({ action: 'user.impersonate', target: 'users/u1' }, {
        users: { u1: 'pat@example.com' },
      }).target,
    ).toBe('pat@example.com')
    expect(
      describeStaffAudit({ action: 'org.override', target: 'orgs/o1', reason: 'goodwill' }, {
        orgs: { o1: 'Acme' },
      }).target,
    ).toBe('Acme')
  })

  it('labels every core code without leaving a dotted code behind', () => {
    for (const label of Object.values(STAFF_AUDIT_ACTION_LABELS)) {
      expect(label).not.toMatch(/^[a-z]+\.[a-z]/i)
    }
  })
})
