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
  DROP_OFF_LIVE_MS,
  DROP_OFF_RECHECK_MS,
  dropOffAutomationContent,
  dropOffMarkKey,
  dropOffVerdict,
  funnelLeftPayload,
  funnelWatches,
  normalizeDropOffWatch,
  waitLabel,
  type WatchedFunnel,
} from './drop-off'
import type { FunnelStep, JourneyStepRecord } from './funnels.types'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-06T12:00:00Z')

const STEPS: FunnelStep[] = [
  { type: 'page', key: '/pricing', match: 'exact' },
  { type: 'form', key: 'quote', label: 'Quote form' },
  { type: 'booking', key: '', label: 'Booked' },
]

const funnel = (watches: WatchedFunnel['watches']): WatchedFunnel => ({
  id: 'f1',
  name: 'Quote to booking',
  steps: STEPS,
  watches,
})

const at = (t: JourneyStepRecord['t'], k: string, ms: number): JourneyStepRecord => ({ t, k, at: ms })

describe('a drop-off watch', () => {
  it('names a step with a step after it and a wait of 1 hour to 30 days', () => {
    expect(normalizeDropOffWatch({ step: 2, afterHours: 24 }, 3)).toEqual({ watch: { step: 2, afterHours: 24 } })
    expect(normalizeDropOffWatch({ step: 3, afterHours: 24 }, 3)).toHaveProperty('error')
    expect(normalizeDropOffWatch({ step: 0, afterHours: 24 }, 3)).toHaveProperty('error')
    expect(normalizeDropOffWatch({ step: 1, afterHours: 0 }, 3)).toHaveProperty('error')
    expect(normalizeDropOffWatch({ step: 1, afterHours: 721 }, 3)).toHaveProperty('error')
    expect(normalizeDropOffWatch({ step: 1.5, afterHours: 2 }, 3)).toHaveProperty('error')
  })

  it('drops malformed and repeated watches from a stored funnel', () => {
    expect(
      funnelWatches(
        [{ step: 2, afterHours: 24 }, { step: 2, afterHours: 24 }, { step: 9, afterHours: 1 }, 'x'],
        3,
      ),
    ).toEqual([{ step: 2, afterHours: 24 }])
    expect(funnelWatches(undefined, 3)).toEqual([])
  })

  it('reads its wait as a person would', () => {
    expect(waitLabel(1)).toBe('1 hour')
    expect(waitLabel(24)).toBe('1 day')
    expect(waitLabel(72)).toBe('3 days')
  })
})

describe('whether a person left', () => {
  const watch = { step: 2, afterHours: 24 }
  const reachedForm = [at('page', '/pricing', NOW - 30 * HOUR), at('form', 'quote', NOW - 25 * HOUR)]

  it('is due when they reached the step, not the next, and the wait has passed', () => {
    const verdict = dropOffVerdict({
      funnels: [funnel([watch])],
      steps: reachedForm,
      fired: new Set(),
      lastAt: NOW - 25 * HOUR,
      now: NOW,
    })
    expect(verdict.due).toHaveLength(1)
    expect(verdict.due[0]).toMatchObject({ key: dropOffMarkKey('f1', watch), reachedAt: NOW - 25 * HOUR })
    expect(verdict.nextCheckAt).toBeNull()
  })

  it('waits until the wait has passed, and says when to look again', () => {
    const steps = [at('page', '/pricing', NOW - 2 * HOUR), at('form', 'quote', NOW - HOUR)]
    const verdict = dropOffVerdict({ funnels: [funnel([watch])], steps, fired: new Set(), lastAt: NOW - HOUR, now: NOW })
    expect(verdict.due).toEqual([])
    expect(verdict.nextCheckAt).toBe(NOW - HOUR + 24 * HOUR)
  })

  it('never fires for someone who went on to the next step, in any visit of theirs', () => {
    const steps = [...reachedForm, at('booking', 'svc', NOW - 2 * HOUR)]
    const verdict = dropOffVerdict({ funnels: [funnel([watch])], steps, fired: new Set(), lastAt: NOW, now: NOW })
    expect(verdict).toEqual({ due: [], nextCheckAt: null })
  })

  it('fires once: a mark the person already carries holds it', () => {
    const verdict = dropOffVerdict({
      funnels: [funnel([watch])],
      steps: reachedForm,
      fired: new Set([dropOffMarkKey('f1', watch)]),
      lastAt: NOW - 25 * HOUR,
      now: NOW,
    })
    expect(verdict).toEqual({ due: [], nextCheckAt: null })
  })

  it('looks again soon at a person short of the step who is still on the site, and not at one who left', () => {
    const early = [at('page', '/pricing', NOW - 10 * 60 * 1000)]
    expect(
      dropOffVerdict({ funnels: [funnel([watch])], steps: early, fired: new Set(), lastAt: NOW - 10 * 60 * 1000, now: NOW })
        .nextCheckAt,
    ).toBe(NOW + DROP_OFF_RECHECK_MS)
    expect(
      dropOffVerdict({ funnels: [funnel([watch])], steps: early, fired: new Set(), lastAt: NOW - DROP_OFF_LIVE_MS, now: NOW })
        .nextCheckAt,
    ).toBeNull()
  })

  it('hands the automation the funnel, the step, the wait and the address', () => {
    const verdict = dropOffVerdict({
      funnels: [funnel([watch])],
      steps: reachedForm,
      fired: new Set(),
      lastAt: NOW - 25 * HOUR,
      now: NOW,
    })
    expect(funnelLeftPayload(verdict.due[0], 'ada@example.com')).toEqual({
      funnelId: 'f1',
      funnelName: 'Quote to booking',
      step: 2,
      stepLabel: 'Quote form',
      nextStepLabel: 'Booked',
      afterHours: 24,
      email: 'ada@example.com',
    })
  })
})

describe('the drafted automation', () => {
  const options = { funnelId: 'f1', funnelName: 'Quote to booking', steps: STEPS, watch: { step: 2, afterHours: 72 } }

  it('starts on Left a funnel for exactly this funnel, step and wait', () => {
    const { content } = dropOffAutomationContent({ ...options, action: 'email' })
    const action = content['action'] as any
    expect(action.trigger).toEqual({
      event: 'funnelLeft',
      conditions: [
        { field: 'funnelId', op: 'equals', value: 'f1' },
        { field: 'step', op: 'equals', value: '2' },
        { field: 'afterHours', op: 'equals', value: '72' },
      ],
      combinator: 'and',
    })
  })

  it('emails the person as a mailing, never a transactional reply', () => {
    const action = dropOffAutomationContent({ ...options, action: 'email' }).content['action'] as any
    expect(action.steps).toEqual([
      expect.objectContaining({ type: 'sendEmail', toField: 'email', transactional: false }),
    ])
    expect(action.steps[0]).not.toHaveProperty('topicId')
  })

  it('or files a task naming both steps', () => {
    const action = dropOffAutomationContent({ ...options, action: 'task' }).content['action'] as any
    expect(action.steps).toEqual([
      expect.objectContaining({ type: 'createCrmTask', kind: 'email', dueInDays: 1 }),
    ])
    expect(action.steps[0].title).toContain('Quote form')
    expect(action.steps[0].title).toContain('Booked')
  })

  it('carries a name the Actions editor stores', () => {
    const { name } = dropOffAutomationContent({ ...options, funnelName: 'x'.repeat(200), action: 'email' })
    expect(name.length).toBeLessThanOrEqual(60)
  })
})
