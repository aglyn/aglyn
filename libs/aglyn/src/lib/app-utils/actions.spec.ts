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
  ACTION_MAX_CONDITIONS,
  BASIC_CLIENT_ACTION_STEP_TYPES,
  CLIENT_ACTION_STEP_TYPES,
  evaluateTriggerCondition,
  evaluateTriggerConditions,
  type HostAction,
  type HostActionStep,
  HOST_ACTION_STEP_LABELS,
  isBasicClientActionStep,
  isClientStepEntitled,
  isCustomEventName,
  isSiteEventType,
  normalizeTriggerConditions,
  validateHostAction,
  WEBHOOK_URL_PATTERN,
} from './actions'

const base: HostAction = {
  name: 'Welcome',
  trigger: { event: 'formSubmission' },
  steps: [{ type: 'siteAlert', message: 'Thanks!' }],
}

describe('validateHostAction', () => {
  it('accepts a well-formed action', () => {
    expect(validateHostAction(base)).toBeNull()
  })

  it('rejects missing name, trigger, or steps', () => {
    expect(validateHostAction({ ...base, name: ' ' })).toMatch(/Name/)
    expect(
      validateHostAction({ ...base, trigger: { event: '' } }),
    ).toMatch(/trigger/)
    expect(validateHostAction({ ...base, steps: [] })).toMatch(/step/)
  })

  it('accepts custom trigger events and validates their format', () => {
    expect(
      validateHostAction({ ...base, trigger: { event: 'cart-updated' } }),
    ).toBeNull()
    expect(
      validateHostAction({ ...base, trigger: { event: 'no spaces!' } }),
    ).toMatch(/Custom event/)
  })

  it('validates frequency caps (AGL-274)', () => {
    expect(
      validateHostAction({
        ...base,
        trigger: { ...base.trigger, cooldownMinutes: 0 },
      }),
    ).toMatch(/Cooldown/)
    expect(
      validateHostAction({
        ...base,
        trigger: { ...base.trigger, cooldownMinutes: 30 },
      }),
    ).toBeNull()
  })

  it('validates per-step required fields', () => {
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'runWorkflow', workflowName: '' }],
      }),
    ).toMatch(/Step 1/)
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'customEvent', eventName: 'formSubmission' }],
      }),
    ).toMatch(/Step 1/)
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'datasetAppend', datasetName: '' }],
      }),
    ).toMatch(/Step 1/)
  })
})

describe('nav-menu interactions surface (AGL-562)', () => {
  it('treats hover enter/leave as element-scoped site events', () => {
    for (const event of ['elementHoverEnter', 'elementHoverLeave']) {
      expect(isSiteEventType(event)).toBe(true)
      expect(
        validateHostAction({ ...base, trigger: { event } }),
      ).toMatch(/selector/)
      expect(
        validateHostAction({
          ...base,
          trigger: { event, selector: '[data-aglyn="leaf:n1"]' },
        }),
      ).toBeNull()
    }
  })

  it('requires a target for element show/hide steps', () => {
    for (const type of [
      'showElement',
      'hideElement',
      'toggleElement',
    ] as const) {
      expect(
        validateHostAction({ ...base, steps: [{ type, selector: ' ' }] }),
      ).toMatch(/Step 1/)
      expect(
        validateHostAction({
          ...base,
          steps: [{ type, selector: '[data-aglyn="leaf:n1"]' }],
        }),
      ).toBeNull()
    }
  })

  it('accepts drawer commands with and without an explicit target', () => {
    for (const type of ['openDrawer', 'closeDrawer', 'toggleDrawer'] as const) {
      expect(validateHostAction({ ...base, steps: [{ type }] })).toBeNull()
      expect(
        validateHostAction({
          ...base,
          steps: [{ type, drawerNodeId: 'node-9' }],
        }),
      ).toBeNull()
    }
  })

  it('accepts menu commands with and without an explicit target (AGL-568)', () => {
    for (const type of ['openMenu', 'closeMenu', 'toggleMenu'] as const) {
      expect(validateHostAction({ ...base, steps: [{ type }] })).toBeNull()
      expect(
        validateHostAction({
          ...base,
          steps: [{ type, menuNodeId: 'node-9' }],
        }),
      ).toBeNull()
    }
  })

  it('classifies the new UI steps as client steps with labels', () => {
    for (const type of [
      'showElement',
      'hideElement',
      'toggleElement',
      'openDrawer',
      'closeDrawer',
      'toggleDrawer',
      'openMenu',
      'closeMenu',
      'toggleMenu',
    ] as const) {
      expect(CLIENT_ACTION_STEP_TYPES.has(type)).toBe(true)
      expect(HOST_ACTION_STEP_LABELS[type]).toBeTruthy()
    }
  })

  it('accepts the every-time repeat flag on the trigger', () => {
    expect(
      validateHostAction({
        ...base,
        trigger: {
          event: 'elementClick',
          selector: '.menu-button',
          everyTime: true,
        },
      }),
    ).toBeNull()
  })
})

describe('evaluateTriggerCondition (AGL-557)', () => {
  const payload = {
    event: 'formSubmission',
    subscribe: 'Yes',
    topics: 'Products, Pricing',
    comments: '  ',
    rating: 4,
  }

  it('always passes without a condition or field', () => {
    expect(evaluateTriggerCondition(undefined, payload)).toBe(true)
    expect(evaluateTriggerCondition(null, payload)).toBe(true)
    expect(
      evaluateTriggerCondition({ field: '  ', op: 'equals' }, payload),
    ).toBe(true)
  })

  it('equals compares trimmed + case-insensitive', () => {
    const condition = { field: 'subscribe', op: 'equals' as const }
    expect(
      evaluateTriggerCondition({ ...condition, value: 'yes' }, payload),
    ).toBe(true)
    expect(
      evaluateTriggerCondition({ ...condition, value: ' YES ' }, payload),
    ).toBe(true)
    expect(
      evaluateTriggerCondition({ ...condition, value: 'no' }, payload),
    ).toBe(false)
    // Non-string payload values coerce (rating fields arrive numeric).
    expect(
      evaluateTriggerCondition(
        { field: 'rating', op: 'equals', value: '4' },
        payload,
      ),
    ).toBe(true)
  })

  it('contains matches checkbox-group joins and never matches empty', () => {
    const condition = { field: 'topics', op: 'contains' as const }
    expect(
      evaluateTriggerCondition({ ...condition, value: 'pricing' }, payload),
    ).toBe(true)
    expect(
      evaluateTriggerCondition({ ...condition, value: 'Support' }, payload),
    ).toBe(false)
    expect(
      evaluateTriggerCondition({ ...condition, value: '' }, payload),
    ).toBe(false)
  })

  it('notEmpty treats missing and whitespace values as empty', () => {
    expect(
      evaluateTriggerCondition({ field: 'subscribe', op: 'notEmpty' }, payload),
    ).toBe(true)
    expect(
      evaluateTriggerCondition({ field: 'comments', op: 'notEmpty' }, payload),
    ).toBe(false)
    expect(
      evaluateTriggerCondition({ field: 'missing', op: 'notEmpty' }, payload),
    ).toBe(false)
  })

  it('a missing field never matches equals/contains', () => {
    expect(
      evaluateTriggerCondition(
        { field: 'missing', op: 'equals', value: '' },
        payload,
      ),
    ).toBe(true) // both sides empty — validation forbids saving this shape
    expect(
      evaluateTriggerCondition(
        { field: 'missing', op: 'equals', value: 'x' },
        payload,
      ),
    ).toBe(false)
    expect(
      evaluateTriggerCondition(
        { field: 'missing', op: 'contains', value: 'x' },
        payload,
      ),
    ).toBe(false)
  })

  it('an unknown operator never matches', () => {
    expect(
      evaluateTriggerCondition(
        { field: 'subscribe', op: 'regex' as any, value: '.*' },
        payload,
      ),
    ).toBe(false)
  })

  it('validateHostAction enforces the condition shape', () => {
    const withCondition = (condition: any) =>
      validateHostAction({
        ...base,
        trigger: { ...base.trigger, condition },
      })
    expect(
      withCondition({ field: 'subscribe', op: 'notEmpty' }),
    ).toBeNull()
    expect(
      withCondition({ field: 'subscribe', op: 'equals', value: 'Yes' }),
    ).toBeNull()
    expect(withCondition({ field: '', op: 'notEmpty' })).toMatch(/field/)
    expect(
      withCondition({ field: 'subscribe', op: 'equals', value: ' ' }),
    ).toMatch(/value/)
    expect(
      withCondition({ field: 'subscribe', op: 'regex', value: 'x' }),
    ).toMatch(/operator/)
    // Null clears a previously-set condition (merge-set semantics).
    expect(withCondition(null)).toBeNull()
  })

  it('single-condition triggers evaluate unchanged through the list API', () => {
    // Backward compat (AGL-565): pre-565 docs carry `condition` only.
    expect(
      evaluateTriggerConditions(
        { condition: { field: 'subscribe', op: 'equals', value: 'yes' } },
        payload,
      ),
    ).toBe(true)
    expect(
      evaluateTriggerConditions(
        { condition: { field: 'subscribe', op: 'equals', value: 'no' } },
        payload,
      ),
    ).toBe(false)
    expect(evaluateTriggerConditions({ condition: null }, payload)).toBe(true)
    expect(evaluateTriggerConditions(undefined, payload)).toBe(true)
  })

  it('validates enrollList steps (the email-audience step)', () => {
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'enrollList', listId: '' }],
      }),
    ).toMatch(/Step 1/)
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'enrollList', listId: 'list-1' }],
      }),
    ).toBeNull()
  })
})

describe('condition chaining (AGL-565)', () => {
  const payload = {
    event: 'formSubmission',
    subscribe: 'Yes',
    topics: 'Products, Pricing',
    plan: 'Pro',
    comments: '  ',
  }
  const subscribed = {
    field: 'subscribe',
    op: 'notEmpty',
  } as const
  const proPlan = {
    field: 'plan',
    op: 'equals',
    value: 'pro',
  } as const
  const wantsSupport = {
    field: 'topics',
    op: 'contains',
    value: 'Support',
  } as const

  describe('normalizeTriggerConditions', () => {
    it('returns the legacy single condition as a one-element list', () => {
      expect(normalizeTriggerConditions({ condition: subscribed })).toEqual([
        subscribed,
      ])
    })

    it('prefers the conditions array over the legacy condition', () => {
      expect(
        normalizeTriggerConditions({
          condition: subscribed,
          conditions: [proPlan, wantsSupport],
        }),
      ).toEqual([proPlan, wantsSupport])
    })

    it('returns an empty list for absent or cleared clauses', () => {
      expect(normalizeTriggerConditions(undefined)).toEqual([])
      expect(normalizeTriggerConditions(null)).toEqual([])
      expect(normalizeTriggerConditions({})).toEqual([])
      expect(
        normalizeTriggerConditions({ condition: null, conditions: null }),
      ).toEqual([])
    })

    it('a null conditions key falls back to the legacy condition', () => {
      // Merge-set clears write null (AGL-557 pattern) — never an array.
      expect(
        normalizeTriggerConditions({
          condition: subscribed,
          conditions: null,
        }),
      ).toEqual([subscribed])
    })
  })

  describe('evaluateTriggerConditions', () => {
    it('AND (the default) requires every condition', () => {
      expect(
        evaluateTriggerConditions(
          { conditions: [subscribed, proPlan] },
          payload,
        ),
      ).toBe(true)
      expect(
        evaluateTriggerConditions(
          { conditions: [subscribed, proPlan], combinator: 'and' },
          payload,
        ),
      ).toBe(true)
      expect(
        evaluateTriggerConditions(
          { conditions: [subscribed, wantsSupport], combinator: 'and' },
          payload,
        ),
      ).toBe(false)
      expect(
        evaluateTriggerConditions(
          { conditions: [subscribed, proPlan, wantsSupport] },
          payload,
        ),
      ).toBe(false)
    })

    it('OR requires any condition', () => {
      expect(
        evaluateTriggerConditions(
          { conditions: [wantsSupport, proPlan], combinator: 'or' },
          payload,
        ),
      ).toBe(true)
      expect(
        evaluateTriggerConditions(
          {
            conditions: [
              wantsSupport,
              { field: 'comments', op: 'notEmpty' },
            ],
            combinator: 'or',
          },
          payload,
        ),
      ).toBe(false)
    })

    it('an empty list always passes, whatever the combinator', () => {
      expect(
        evaluateTriggerConditions({ conditions: [] }, payload),
      ).toBe(true)
      expect(
        evaluateTriggerConditions(
          { conditions: [], combinator: 'or' },
          payload,
        ),
      ).toBe(true)
    })

    it('keeps AGL-557 per-condition semantics inside the chain', () => {
      // Trim + case-insensitive equals, checkbox-join contains.
      expect(
        evaluateTriggerConditions(
          {
            conditions: [
              { field: 'subscribe', op: 'equals', value: ' YES ' },
              { field: 'topics', op: 'contains', value: 'pricing' },
            ],
          },
          payload,
        ),
      ).toBe(true)
    })
  })

  describe('validateHostAction with chained conditions', () => {
    const withTrigger = (extra: Record<string, unknown>) =>
      validateHostAction({
        ...base,
        trigger: { ...base.trigger, ...extra },
      } as HostAction)

    it('accepts a well-formed chain with either combinator', () => {
      expect(
        withTrigger({ conditions: [subscribed, proPlan], combinator: 'and' }),
      ).toBeNull()
      expect(
        withTrigger({ conditions: [subscribed, proPlan], combinator: 'or' }),
      ).toBeNull()
    })

    it('rejects unknown combinators', () => {
      expect(withTrigger({ combinator: 'xor' })).toMatch(/AND or OR/)
    })

    it('points at the broken row of a multi-condition chain', () => {
      expect(
        withTrigger({
          conditions: [subscribed, { field: '', op: 'notEmpty' }],
        }),
      ).toMatch(/condition 2/)
      expect(
        withTrigger({
          conditions: [
            subscribed,
            { field: 'plan', op: 'equals', value: ' ' },
          ],
        }),
      ).toMatch(/condition 2/)
    })

    it('keeps the AGL-557 single-condition messages unchanged', () => {
      expect(withTrigger({ conditions: [{ field: '', op: 'notEmpty' }] }))
        .toBe('Name the field the condition checks')
    })

    it('caps the chain length', () => {
      expect(
        withTrigger({
          conditions: Array.from({ length: ACTION_MAX_CONDITIONS + 1 }, () => ({
            ...subscribed,
          })),
        }),
      ).toMatch(/capped/)
    })

    it('null conditions/combinator clear cleanly (merge-set semantics)', () => {
      expect(
        withTrigger({ condition: null, conditions: null, combinator: null }),
      ).toBeNull()
    })
  })
})

describe('isCustomEventName', () => {
  it('excludes built-ins and junk', () => {
    expect(isCustomEventName('cart-updated')).toBe(true)
    expect(isCustomEventName('formSubmission')).toBe(false)
    expect(isCustomEventName('x')).toBe(false)
  })
})

describe('WEBHOOK_URL_PATTERN', () => {
  it('allows public https and blocks local/private targets (AGL-149)', () => {
    expect(WEBHOOK_URL_PATTERN.test('https://hooks.example.com/x')).toBe(true)
    expect(WEBHOOK_URL_PATTERN.test('http://example.com')).toBe(false)
    expect(WEBHOOK_URL_PATTERN.test('https://localhost/x')).toBe(false)
    expect(WEBHOOK_URL_PATTERN.test('https://192.168.1.5/x')).toBe(false)
    expect(WEBHOOK_URL_PATTERN.test('https://10.0.0.1/x')).toBe(false)
  })

  it('validates webhookPost steps', () => {
    expect(
      validateHostAction({
        name: 'Notify',
        trigger: { event: 'lead' },
        steps: [{ type: 'webhookPost', webhookName: '' }],
      }),
    ).toMatch(/Step 1/)
  })

  it('validates class steps incl. toggleClass (AGL-314)', () => {
    const base = {
      name: 'Class toggler',
      trigger: { event: 'click' as any },
    }
    expect(
      validateHostAction({
        ...base,
        steps: [
          {
            type: 'toggleClass',
            selector: '[data-node-id="hero"]',
            className: 'is-open',
          },
        ],
      } as any),
    ).toBeNull()
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'toggleClass', selector: '', className: 'x' }],
      } as any),
    ).not.toBeNull()
    const { isClientActionStep } = jest.requireActual('./actions')
    expect(
      isClientActionStep({
        type: 'toggleClass',
        selector: 'x',
        className: 'y',
      }),
    ).toBe(true)
  })
})

describe('basic-interaction tiering (AGL-577)', () => {
  const step = (type: string): HostActionStep => ({ type } as HostActionStep)
  const ALL_PLANS = { actionsEntitled: false, allowJs: false }
  const PRO = { actionsEntitled: true, allowJs: false }
  const BUSINESS = { actionsEntitled: true, allowJs: true }

  it('classifies presentational steps as basic', () => {
    for (const type of [
      'openMenu',
      'closeMenu',
      'toggleMenu',
      'openDrawer',
      'closeDrawer',
      'toggleDrawer',
      'showElement',
      'hideElement',
      'toggleElement',
      'addClass',
      'removeClass',
      'toggleClass',
      'stickyNav',
      'redirect',
      'siteAlert',
    ]) {
      expect(isBasicClientActionStep(step(type))).toBe(true)
    }
  })

  it('does not classify powerful client steps as basic', () => {
    for (const type of ['showOverlay', 'showHtml', 'runJs', 'trackGaEvent']) {
      expect(isBasicClientActionStep(step(type))).toBe(false)
    }
  })

  it('every basic step is a client step', () => {
    for (const type of BASIC_CLIENT_ACTION_STEP_TYPES) {
      expect(CLIENT_ACTION_STEP_TYPES.has(type)).toBe(true)
    }
  })

  it('basic steps are entitled on every plan (no actions/webhooks)', () => {
    expect(isClientStepEntitled(step('openMenu'), ALL_PLANS)).toBe(true)
    expect(isClientStepEntitled(step('toggleDrawer'), ALL_PLANS)).toBe(true)
    expect(isClientStepEntitled(step('redirect'), ALL_PLANS)).toBe(true)
  })

  it('advanced client steps need the actions entitlement', () => {
    expect(isClientStepEntitled(step('showOverlay'), ALL_PLANS)).toBe(false)
    expect(isClientStepEntitled(step('trackGaEvent'), ALL_PLANS)).toBe(false)
    expect(isClientStepEntitled(step('showHtml'), ALL_PLANS)).toBe(false)
    expect(isClientStepEntitled(step('showOverlay'), PRO)).toBe(true)
    expect(isClientStepEntitled(step('trackGaEvent'), PRO)).toBe(true)
  })

  it('runJs needs the webhooks (Business) tier, not just actions', () => {
    expect(isClientStepEntitled(step('runJs'), ALL_PLANS)).toBe(false)
    expect(isClientStepEntitled(step('runJs'), PRO)).toBe(false)
    expect(isClientStepEntitled(step('runJs'), BUSINESS)).toBe(true)
  })

  it('server steps are never client-entitled (re-checked server-side)', () => {
    for (const type of ['sendEmail', 'notifyAdmins', 'enrollList', 'assignCampaign']) {
      expect(isClientStepEntitled(step(type), BUSINESS)).toBe(false)
    }
  })
})