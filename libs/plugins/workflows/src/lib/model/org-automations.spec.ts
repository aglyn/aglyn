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
 * The org automation's vocabulary (AGL-3302): which triggers and steps it may
 * hold, what a save stores, and when it runs on a site.
 */

import {
  CLIENT_ACTION_STEP_TYPES,
  HOST_ACTION_STEP_LABELS,
} from '@aglyn/aglyn/app-utils/actions'
import { HOST_EVENT_TYPES } from '@aglyn/aglyn/app-utils/workflows'
import {
  isOrgAutomationStepType,
  isOrgAutomationTriggerEvent,
  ORG_AUTOMATION_STEP_KINDS,
  ORG_AUTOMATION_STEP_TYPES,
  ORG_AUTOMATION_TRIGGER_EVENTS,
  orgAutomationRunsOnHost,
  orgAutomationStepRefusal,
  orgAutomationStopReason,
  prunePausedHostIds,
  readOrgAutomation,
} from './org-automations'

/** A body the editor would send for a one-step automation. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Welcome every lead',
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'sendEmail', subject: 'Welcome', body: 'Thanks for writing' }],
    visibleTo: ['org'],
    ...overrides,
  }
}

describe('the vocabulary', () => {
  it('starts only on server events, and never on the page view', () => {
    for (const event of ORG_AUTOMATION_TRIGGER_EVENTS) {
      expect(HOST_EVENT_TYPES).toContain(event)
    }
    expect(isOrgAutomationTriggerEvent('pageView')).toBe(false)
    expect(isOrgAutomationTriggerEvent('memberSignOut')).toBe(false)
    // A custom event and an on-page site event are not org triggers either.
    expect(isOrgAutomationTriggerEvent('newsletterJoined')).toBe(false)
    expect(isOrgAutomationTriggerEvent('elementClick')).toBe(false)
    expect(isOrgAutomationTriggerEvent('contactCreated')).toBe(true)
  })

  it('holds no step a visitor’s page runs, and nothing that is one site’s', () => {
    for (const type of ORG_AUTOMATION_STEP_TYPES) {
      expect(CLIENT_ACTION_STEP_TYPES.has(type as never)).toBe(false)
    }
    for (const type of ['runWorkflow', 'webhookPost', 'siteAlert', 'showOverlay', 'redirect', 'runJs']) {
      expect(isOrgAutomationStepType(type)).toBe(false)
    }
    // The picker offers exactly the vocabulary, labelled as the actions
    // builder labels it.
    expect(ORG_AUTOMATION_STEP_KINDS.map((kind) => kind.value)).toEqual([
      ...ORG_AUTOMATION_STEP_TYPES,
    ])
    for (const kind of ORG_AUTOMATION_STEP_KINDS) {
      expect(kind.label).toBe(HOST_ACTION_STEP_LABELS[kind.value])
    }
  })

  it('names why a refused step is refused', () => {
    expect(orgAutomationStepRefusal({ type: 'sendEmail' })).toBeNull()
    expect(orgAutomationStepRefusal({ type: 'runWorkflow' })).toMatch(
      /“Run a workflow” belongs to one site/,
    )
    expect(orgAutomationStepRefusal({ type: 'made-up' })).toMatch(/is not a step/)
  })
})

describe('what a save stores', () => {
  it('CONTROL: reads a valid automation into its stored shape', () => {
    expect(readOrgAutomation(body())).toEqual({
      ok: true,
      value: {
        name: 'Welcome every lead',
        trigger: { event: 'formSubmission', conditions: null, combinator: null },
        steps: [
          { type: 'sendEmail', subject: 'Welcome', body: 'Thanks for writing' },
        ],
        enabled: true,
        visibleTo: ['org'],
      },
    })
  })

  it('keeps a step’s own fields and nothing a caller made up', () => {
    const read = readOrgAutomation(
      body({
        steps: [
          {
            type: 'sendEmail',
            subject: 'x'.repeat(500),
            body: 'Hello',
            injected: { anything: true },
            when: {
              conditions: [{ field: 'subscribe', op: 'notEmpty', extra: 1 }],
            },
          },
        ],
      }),
    )
    if (read.ok === false) throw new Error(read.problem)
    expect(read.value.steps).toEqual([
      {
        type: 'sendEmail',
        subject: 'x'.repeat(200),
        body: 'Hello',
        when: {
          conditions: [{ field: 'subscribe', op: 'notEmpty' }],
          combinator: 'and',
        },
      },
    ])
  })

  it('stores the conditions with a combinator, and none without them', () => {
    const read = readOrgAutomation(
      body({
        trigger: {
          event: 'contactCreated',
          conditions: [{ field: 'source', op: 'equals', value: ' form ' }],
        },
      }),
    )
    if (read.ok === false) throw new Error(read.problem)
    expect(read.value.trigger).toEqual({
      event: 'contactCreated',
      conditions: [{ field: 'source', op: 'equals', value: 'form' }],
      combinator: 'and',
    })
  })

  it('refuses a trigger an org automation cannot start on', () => {
    for (const event of ['pageView', 'newsletterJoined', 'elementClick', '']) {
      const read = readOrgAutomation(body({ trigger: { event } }))
      expect(read.ok).toBe(false)
    }
  })

  it('refuses a step that belongs to one site, naming the step', () => {
    const read = readOrgAutomation(
      body({
        steps: [
          { type: 'sendEmail', subject: 'Hi', body: 'x' },
          { type: 'webhookPost', webhookId: 'hook-1' },
        ],
      }),
    )
    expect(read).toEqual({
      ok: false,
      problem: expect.stringMatching(/^Step 2: “Send a webhook \(Business\)” belongs to one site/),
    })
  })

  it('holds each step to the actions builder’s own rules', () => {
    expect(
      readOrgAutomation(
        body({ steps: [{ type: 'sendEmail', subject: '', body: 'x' }] }),
      ),
    ).toEqual({ ok: false, problem: 'Step 1: enter the subject' })
    expect(
      readOrgAutomation(body({ steps: [{ type: 'wait', delayMinutes: 0 }] })),
    ).toEqual({ ok: false, problem: expect.stringMatching(/^Step 1: wait between/) })
    expect(readOrgAutomation(body({ steps: [] }))).toEqual({
      ok: false,
      problem: 'Add at least one step',
    })
  })

  it('refuses a nameless automation, and caps a long name', () => {
    expect(readOrgAutomation(body({ name: '  ' }))).toEqual({
      ok: false,
      problem: 'Name the automation',
    })
    const read = readOrgAutomation(body({ name: 'n'.repeat(90) }))
    if (read.ok === false) throw new Error(read.problem)
    expect(read.value.name).toHaveLength(60)
  })

  it('stores a placement it can: every site, or up to thirty named ones', () => {
    const everySite = readOrgAutomation(body({ visibleTo: ['host:a', 'org'] }))
    if (everySite.ok === false) throw new Error(everySite.problem)
    expect(everySite.value.visibleTo).toEqual(['org'])

    const named = readOrgAutomation(body({ visibleTo: ['host:a', 'host:b', 'host:a'] }))
    if (named.ok === false) throw new Error(named.problem)
    expect(named.value.visibleTo).toEqual(['host:a', 'host:b'])

    expect(readOrgAutomation(body({ visibleTo: [] })).ok).toBe(false)
    expect(readOrgAutomation(body({ visibleTo: ['nonsense'] })).ok).toBe(false)
    const tooMany = Array.from({ length: 31 }, (_, index) => `host:h${index}`)
    expect(readOrgAutomation(body({ visibleTo: tooMany })).ok).toBe(false)
  })

  it('switches on by default, and stays off when asked', () => {
    const on = readOrgAutomation(body())
    const off = readOrgAutomation(body({ enabled: false }))
    expect(on.ok && on.value.enabled).toBe(true)
    expect(off.ok && off.value.enabled).toBe(false)
  })
})

describe('where it runs', () => {
  const live = {
    enabled: true,
    visibleTo: ['org'],
    pausedHostIds: [] as string[],
    deletedAt: null,
  }

  it('runs on every site when placed on the org, and nowhere it is paused', () => {
    expect(orgAutomationRunsOnHost(live, 'site-a')).toBe(true)
    expect(
      orgAutomationStopReason({ ...live, pausedHostIds: ['site-a'] }, 'site-a'),
    ).toBe('the org automation is paused on this site')
    expect(
      orgAutomationRunsOnHost({ ...live, pausedHostIds: ['site-a'] }, 'site-b'),
    ).toBe(true)
  })

  it('runs only on the sites it names', () => {
    const placed = { ...live, visibleTo: ['host:site-a'] }
    expect(orgAutomationRunsOnHost(placed, 'site-a')).toBe(true)
    expect(orgAutomationStopReason(placed, 'site-b')).toBe(
      'the org automation no longer runs on this site',
    )
  })

  it('runs nowhere switched off, deleted or unplaced', () => {
    expect(orgAutomationStopReason({ ...live, enabled: false }, 'site-a')).toBe(
      'the org automation was switched off',
    )
    expect(orgAutomationStopReason({ ...live, deletedAt: 'then' }, 'site-a')).toBe(
      'the org automation was deleted',
    )
    expect(orgAutomationStopReason(null, 'site-a')).toBe(
      'the org automation was deleted',
    )
    // A document with no placement is seen by nobody, as every scoped
    // resource's is.
    expect(
      orgAutomationRunsOnHost({ ...live, visibleTo: undefined }, 'site-a'),
    ).toBe(false)
  })

  it('drops the pause of a site the automation no longer runs on', () => {
    expect(prunePausedHostIds(['site-a', 'site-b'], ['host:site-a'])).toEqual([
      'site-a',
    ])
    expect(prunePausedHostIds(['site-a', 'site-b'], ['org'])).toEqual([
      'site-a',
      'site-b',
    ])
  })
})
