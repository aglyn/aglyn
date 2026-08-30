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
 * The three flow steps, as the model sees them.
 *
 * Everything here is pure, which is the point: an author cannot save a wait
 * the scheduler could not honor, a guard the evaluator would read differently
 * from the trigger's, or a flow whose client half would run the steps its
 * server half is still waiting on.
 */

import {
  evaluateStepGuard,
  FLOW_WAIT_MAX_MINUTES,
  FLOW_WAIT_MIN_MINUTES,
  hostActionStepsForClient,
  isFlowSuspendingStep,
  type HostAction,
  type HostActionStep,
  validateHostAction,
} from './actions'

const flow = (steps: HostActionStep[]): HostAction => ({
  name: 'Welcome series',
  trigger: { event: 'formSubmission' },
  steps,
})

describe('a wait an author saves is a wait the scheduler can honor', () => {
  it('accepts a whole number of minutes inside the band', () => {
    expect(
      validateHostAction(
        flow([
          { type: 'wait', delayMinutes: 60 * 24 * 3 },
          { type: 'sendEmail', subject: 'Still there?', body: 'Hello' },
        ]),
      ),
    ).toBeNull()
  })

  it('refuses a wait shorter than the beat that would resume it', () => {
    // The resume beat runs on a minute, so anything under one is a delay
    // nothing can deliver — it would read as imprecision rather than as the
    // refusal it is.
    expect(
      validateHostAction(flow([{ type: 'wait', delayMinutes: 0 }])),
    ).toContain(`${FLOW_WAIT_MIN_MINUTES} minute`)
  })

  it('refuses a wait past the ceiling', () => {
    expect(
      validateHostAction(
        flow([{ type: 'wait', delayMinutes: FLOW_WAIT_MAX_MINUTES + 1 }]),
      ),
    ).toContain(`${FLOW_WAIT_MAX_MINUTES} minutes`)
  })

  it('refuses a fractional wait', () => {
    // A non-integer would be stored, multiplied into a millisecond instant
    // and silently rounded by whatever read it back.
    expect(
      validateHostAction(flow([{ type: 'wait', delayMinutes: 1.5 }])),
    ).toContain('wait between')
  })

  it('accepts the boundary values themselves', () => {
    expect(
      validateHostAction(
        flow([{ type: 'wait', delayMinutes: FLOW_WAIT_MIN_MINUTES }]),
      ),
    ).toBeNull()
    expect(
      validateHostAction(
        flow([{ type: 'wait', delayMinutes: FLOW_WAIT_MAX_MINUTES }]),
      ),
    ).toBeNull()
  })
})

describe('a wait for an event always has a deadline', () => {
  it('accepts a known event with a timeout', () => {
    expect(
      validateHostAction(
        flow([
          {
            type: 'waitForEvent',
            eventName: 'orderPaid',
            timeoutMinutes: 4320,
          },
          { type: 'sendEmail', subject: 'Come back', body: 'Hello' },
        ]),
      ),
    ).toBeNull()
  })

  it('refuses a wait for nothing', () => {
    expect(
      validateHostAction(
        flow([{ type: 'waitForEvent', eventName: '', timeoutMinutes: 60 }]),
      ),
    ).toContain('pick the event to wait for')
  })

  it('refuses an unbounded wait', () => {
    // A `waitForEvent` with no deadline is an enrollment that lives for ever
    // — storage nobody is looking at, for a person nobody will ever mail.
    expect(
      validateHostAction(
        flow([
          { type: 'waitForEvent', eventName: 'orderPaid', timeoutMinutes: 0 },
        ]),
      ),
    ).toContain('give up after')
  })
})

describe('a step condition reads exactly as the trigger’s does', () => {
  it('runs the step when the clause passes', () => {
    expect(
      evaluateStepGuard(
        { conditions: [{ field: 'plan', op: 'equals', value: 'pro' }] },
        { plan: 'Pro' },
      ),
    ).toBe(true)
  })

  it('skips the step when it does not', () => {
    expect(
      evaluateStepGuard(
        { conditions: [{ field: 'orderId', op: 'notEmpty' }] },
        { orderId: '' },
      ),
    ).toBe(false)
  })

  it('passes with no guard at all, so every pre-flow step still runs', () => {
    expect(evaluateStepGuard(undefined, {})).toBe(true)
    expect(evaluateStepGuard(null, { anything: 1 })).toBe(true)
    expect(evaluateStepGuard({ conditions: [] }, {})).toBe(true)
  })

  it('honors the OR combinator', () => {
    const guard = {
      conditions: [
        { field: 'a', op: 'equals' as const, value: 'yes' },
        { field: 'b', op: 'equals' as const, value: 'yes' },
      ],
      combinator: 'or' as const,
    }
    expect(evaluateStepGuard(guard, { a: 'yes', b: 'no' })).toBe(true)
    expect(evaluateStepGuard(guard, { a: 'no', b: 'no' })).toBe(false)
  })

  it('requires every clause under the default AND', () => {
    const guard = {
      conditions: [
        { field: 'a', op: 'equals' as const, value: 'yes' },
        { field: 'b', op: 'equals' as const, value: 'yes' },
      ],
    }
    expect(evaluateStepGuard(guard, { a: 'yes', b: 'no' })).toBe(false)
    expect(evaluateStepGuard(guard, { a: 'yes', b: 'yes' })).toBe(true)
  })

  it('refuses a guard the evaluator could not act on', () => {
    expect(
      validateHostAction(
        flow([
          {
            type: 'exitFlow',
            when: { conditions: [{ field: '', op: 'equals', value: 'x' }] },
          },
        ]),
      ),
    ).toContain('name the field the condition checks')
    expect(
      validateHostAction(
        flow([
          {
            type: 'exitFlow',
            when: { conditions: [{ field: 'a', op: 'equals', value: '' }] },
          },
        ]),
      ),
    ).toContain('enter the value the condition compares against')
  })
})

describe('the browser never gets the steps the server is still waiting on', () => {
  it('truncates at the first wait', () => {
    /*
     * The client engine runs its slice the moment the trigger fires. A popup
     * authored for three days later would otherwise appear at once — the
     * delay would look correct in the run history and be ignored on the page.
     */
    const steps: HostActionStep[] = [
      { type: 'siteAlert', message: 'Thanks' },
      { type: 'wait', delayMinutes: 4320 },
      { type: 'showOverlay', overlayId: 'promo' },
    ]
    expect(hostActionStepsForClient(steps).map((step) => step.type)).toEqual([
      'siteAlert',
    ])
  })

  it('truncates at a wait for an event too', () => {
    const steps: HostActionStep[] = [
      { type: 'waitForEvent', eventName: 'orderPaid', timeoutMinutes: 60 },
      { type: 'siteAlert', message: 'Nope' },
    ]
    expect(hostActionStepsForClient(steps)).toEqual([])
  })

  it('leaves a flow with no wait completely alone', () => {
    const steps: HostActionStep[] = [
      { type: 'siteAlert', message: 'Thanks' },
      { type: 'showOverlay', overlayId: 'promo' },
    ]
    expect(hostActionStepsForClient(steps)).toHaveLength(2)
  })

  it('names both suspending steps and nothing else', () => {
    expect(isFlowSuspendingStep({ type: 'wait', delayMinutes: 1 })).toBe(true)
    expect(
      isFlowSuspendingStep({
        type: 'waitForEvent',
        eventName: 'orderPaid',
        timeoutMinutes: 1,
      }),
    ).toBe(true)
    // `exitFlow` ends a run; it does not suspend one, and a client that
    // truncated at it would drop steps that legitimately run in the browser.
    expect(isFlowSuspendingStep({ type: 'exitFlow' })).toBe(false)
    expect(isFlowSuspendingStep({ type: 'siteAlert', message: 'x' })).toBe(
      false,
    )
  })
})
