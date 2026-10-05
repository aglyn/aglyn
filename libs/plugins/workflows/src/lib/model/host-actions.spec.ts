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

import { CONTACT_TAG_MAX_LENGTH, CRM_TASK_MAX_DUE_DAYS } from '@aglyn/aglyn/app-utils/crm'
import {
  ACTION_MAX_CONDITIONS,
  BASIC_CLIENT_ACTION_STEP_TYPES,
  CLIENT_ACTION_STEP_TYPES,
  declaredInteractionStep,
  evaluateTriggerCondition,
  evaluateTriggerConditions,
  interactionStepHolds,
  isBasicClientActionStep,
  isClientStepEntitled,
  isInteractionAttributeAllowed,
  isSiteEventType,
  normalizeTriggerConditions,
  SCROLL_TO_MAX_OFFSET_PX,
  triggerFilterProblem,
} from '@aglyn/aglyn/app-utils/site-interactions'
import {
  FLOW_SUSPENDING_STEP_TYPES,
  FLOW_TIMED_OUT_FIELD,
  FLOW_WAIT_MAX_MINUTES,
  FLOW_WAIT_MIN_MINUTES,
  HOST_ACTION_STEP_LABELS,
  HOST_ACTION_STEP_TYPES,
  type HostAction,
  type HostActionStep,
  isCustomEventName,
  sendEmailIsTransactionalReply,
  sendEmailReplyIneligibility,
  SERVER_ACTION_STEP_TYPES,
  stepRunsAfterWait,
  validateHostAction,
} from './host-actions'

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

  it('refuses an analytics event name the runtime would have to drop (AGL-1587)', () => {
    // The runtime cannot tell the author anything — it is executing for a
    // visitor — so a name that would be refused there must be refused here,
    // where the person who can rename it is looking.
    for (const eventName of ['purchase', 'sign_up', 'Purchase', 'session_start', 'firebase_x']) {
      expect(
        validateHostAction({
          ...base,
          steps: [{ type: 'trackGaEvent', eventName }],
        }),
      ).toMatch(/reserved/)
    }
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'trackGaEvent', eventName: '123' }],
      }),
    ).toMatch(/start with a letter/)
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'trackGaEvent', eventName: ' ' }],
      }),
    ).toMatch(/name the analytics event/)
    // A normal authored name, and one that merely needs tidying, both pass —
    // the runtime normalizes the second rather than dropping it.
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'trackGaEvent', eventName: 'quote_requested' }],
      }),
    ).toBeNull()
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'trackGaEvent', eventName: 'CTA Click!' }],
      }),
    ).toBeNull()
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

  describe('scroll to element and play a video (AGL-2867)', () => {
    const TARGET = '[data-aglyn="leaf:film"]'
    const withStep = (step: Record<string, unknown>): HostAction => ({
      ...base,
      steps: [step as unknown as HostActionStep],
    })

    it('are client steps on every plan, with labels', () => {
      for (const type of ['scrollTo', 'playVideo'] as const) {
        expect(CLIENT_ACTION_STEP_TYPES.has(type)).toBe(true)
        expect(BASIC_CLIENT_ACTION_STEP_TYPES.has(type)).toBe(true)
        expect(
          isClientStepEntitled({ type, selector: TARGET }, {
            actionsEntitled: false,
            allowJs: false,
          }),
        ).toBe(true)
      }
      expect(HOST_ACTION_STEP_LABELS.scrollTo).toBe('Scroll to element')
      expect(HOST_ACTION_STEP_LABELS.playVideo).toBe('Play a video')
    })

    it('require a target', () => {
      expect(validateHostAction(withStep({ type: 'scrollTo', selector: ' ' }))).toBe(
        'Step 1: pick the element to scroll to',
      )
      expect(validateHostAction(withStep({ type: 'scrollTo' }))).toBe(
        'Step 1: pick the element to scroll to',
      )
      expect(validateHostAction(withStep({ type: 'playVideo', selector: '' }))).toBe(
        'Step 1: pick the video to play',
      )
      // The control: the same steps with a target pass, so the refusals
      // above are about the target and nothing else.
      expect(validateHostAction(withStep({ type: 'scrollTo', selector: TARGET }))).toBeNull()
      expect(validateHostAction(withStep({ type: 'playVideo', selector: TARGET }))).toBeNull()
    })

    it('scroll smoothly or instantly, and nothing else', () => {
      for (const behavior of ['smooth', 'instant']) {
        expect(
          validateHostAction(withStep({ type: 'scrollTo', selector: TARGET, behavior })),
        ).toBeNull()
      }
      // `auto` is the DOM's word, and it defers to the site's CSS — which is
      // how an instant scroll would come to animate.
      for (const behavior of ['auto', 'fast', '']) {
        expect(
          validateHostAction(withStep({ type: 'scrollTo', selector: TARGET, behavior })),
        ).toBe('Step 1: scroll smoothly or instantly')
      }
    })

    it('leave a whole-pixel offset inside the band', () => {
      for (const offsetPx of [0, 64, SCROLL_TO_MAX_OFFSET_PX]) {
        expect(
          validateHostAction(withStep({ type: 'scrollTo', selector: TARGET, offsetPx })),
        ).toBeNull()
      }
      for (const offsetPx of [-1, SCROLL_TO_MAX_OFFSET_PX + 1, 12.5, '64', Number.NaN]) {
        expect(
          validateHostAction(withStep({ type: 'scrollTo', selector: TARGET, offsetPx })),
        ).toBe(`Step 1: the offset must be 0–${SCROLL_TO_MAX_OFFSET_PX}px`)
      }
    })
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

describe('webhookPost steps', () => {
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
    const { isClientActionStep } = jest.requireActual('@aglyn/aglyn/app-utils/site-interactions')
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
      // Every plan (AGL-2546). A screen-reader user's access to a menu is
      // not a paid feature, so these must never join the entitlement-gated
      // set the way `showOverlay` and `runJs` did.
      'setAttribute',
      'removeAttribute',
    ]) {
      expect(isBasicClientActionStep(step(type))).toBe(true)
    }
  })

  describe('the attribute allowlist (AGL-2546)', () => {
    it('admits the names the accessibility case needs', () => {
      for (const name of [
        'aria-expanded',
        'aria-haspopup',
        'aria-controls',
        'aria-hidden',
        'data-state',
        'data-x1',
      ]) {
        expect(isInteractionAttributeAllowed(name)).toBe(true)
      }
    })

    it('REFUSES the names that make it an XSS vector', () => {
      // The whole reason the step is scoped rather than free-form: each of
      // these is script or navigation authored through the interactions UI,
      // and on a site with collaborators the author and the victim need not
      // be the same person.
      for (const name of [
        'href',
        'src',
        'onclick',
        'onerror',
        'formaction',
        'style',
        'srcdoc',
        'action',
      ]) {
        expect(isInteractionAttributeAllowed(name)).toBe(false)
      }
    })

    it('is not fooled by case, padding, or a lookalike prefix', () => {
      expect(isInteractionAttributeAllowed('  ARIA-Expanded ')).toBe(true)
      // `aria` and `data` must be the whole prefix, not a substring: an
      // attribute called `datafoo` or `ariah` is not in the safe set, and a
      // naive `startsWith('data')` would admit both.
      expect(isInteractionAttributeAllowed('datafoo')).toBe(false)
      expect(isInteractionAttributeAllowed('ariah')).toBe(false)
      expect(isInteractionAttributeAllowed('data-')).toBe(false)
      expect(isInteractionAttributeAllowed('aria-')).toBe(false)
      // Not a string at all — the runtime re-checks values that never came
      // through the console form.
      expect(isInteractionAttributeAllowed(undefined)).toBe(false)
      expect(isInteractionAttributeAllowed(42)).toBe(false)
    })
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

/**
 * The CRM steps (AGL-2605): server steps with a fixed vocabulary, refused
 * at the editor rather than stored, because the executor trusts the value
 * and writes it into a facet every stage report counts.
 */
describe('CRM steps', () => {
  const step = (type: string): HostActionStep => ({ type } as HostActionStep)
  const BUSINESS = { actionsEntitled: true, allowJs: true }
  const withStep = (crmStep: Record<string, unknown>): HostAction => ({
    ...base,
    steps: [crmStep as unknown as HostActionStep],
  })

  it('are server steps with labels', () => {
    for (const type of [
      'setContactStage',
      'addContactTag',
      'assignContactOwner',
      'createCrmTask',
      'logCrmActivity',
    ] as const) {
      expect(CLIENT_ACTION_STEP_TYPES.has(type)).toBe(false)
      expect(isClientStepEntitled(step(type), BUSINESS)).toBe(false)
      expect(HOST_ACTION_STEP_LABELS[type]).toBeTruthy()
    }
  })

  it('accepts a well-formed step of each kind', () => {
    expect(
      validateHostAction(
        withStep({ type: 'setContactStage', lifecycleStage: 'customer' }),
      ),
    ).toBeNull()
    expect(
      validateHostAction(withStep({ type: 'addContactTag', tag: 'vip' })),
    ).toBeNull()
    expect(
      validateHostAction(
        withStep({ type: 'assignContactOwner', ownerEmail: 'sam@example.com' }),
      ),
    ).toBeNull()
    expect(
      validateHostAction(
        withStep({ type: 'assignContactOwner', ownerUid: 'uid-1' }),
      ),
    ).toBeNull()
    expect(
      validateHostAction(
        withStep({
          type: 'createCrmTask',
          title: 'Call them back',
          kind: 'call',
          dueInDays: 2,
        }),
      ),
    ).toBeNull()
    expect(
      validateHostAction(
        withStep({ type: 'logCrmActivity', kind: 'note', body: 'Signed up' }),
      ),
    ).toBeNull()
  })

  it('refuses a stage outside the lifecycle vocabulary', () => {
    expect(
      validateHostAction(
        withStep({ type: 'setContactStage', lifecycleStage: 'Customer' }),
      ),
    ).toMatch(/pick a lifecycle stage/)
    expect(
      validateHostAction(withStep({ type: 'setContactStage' })),
    ).toMatch(/pick a lifecycle stage/)
  })

  it('refuses an empty or oversized tag', () => {
    expect(
      validateHostAction(withStep({ type: 'addContactTag', tag: '  ' })),
    ).toMatch(/enter the tag/)
    expect(
      validateHostAction(
        withStep({ type: 'addContactTag', tag: 'x'.repeat(CONTACT_TAG_MAX_LENGTH + 1) }),
      ),
    ).toMatch(/at most/)
  })

  it('refuses an owner named by neither uid nor address', () => {
    expect(
      validateHostAction(withStep({ type: 'assignContactOwner' })),
    ).toMatch(/owner’s email/)
    expect(
      validateHostAction(
        withStep({ type: 'assignContactOwner', ownerEmail: 'not-an-address' }),
      ),
    ).toMatch(/owner’s email/)
  })

  it('accepts a round-robin owner step naming nobody, and refuses one naming both (AGL-2618)', () => {
    expect(
      validateHostAction(withStep({ type: 'assignContactOwner', roundRobin: true })),
    ).toBeNull()
    expect(
      validateHostAction(
        withStep({ type: 'assignContactOwner', roundRobin: true, ownerEmail: 'sam@example.com' }),
      ),
    ).toMatch(/not both/)
    // `roundRobin: false` is not a mode; the step still has to name somebody.
    expect(
      validateHostAction(withStep({ type: 'assignContactOwner', roundRobin: false })),
    ).toMatch(/owner’s email/)
  })

  it('refuses a task with no title, an unknown kind, or a due date off the band', () => {
    expect(
      validateHostAction(
        withStep({ type: 'createCrmTask', title: '', kind: 'call', dueInDays: 1 }),
      ),
    ).toMatch(/title/)
    expect(
      validateHostAction(
        withStep({ type: 'createCrmTask', title: 'x', kind: 'note', dueInDays: 1 }),
      ),
    ).toMatch(/type of task/)
    expect(
      validateHostAction(
        withStep({ type: 'createCrmTask', title: 'x', kind: 'call', dueInDays: -1 }),
      ),
    ).toMatch(/due in 0–/)
    expect(
      validateHostAction(
        withStep({ type: 'createCrmTask', title: 'x', kind: 'call', dueInDays: 1.5 }),
      ),
    ).toMatch(/due in 0–/)
    expect(
      validateHostAction(
        withStep({
          type: 'createCrmTask',
          title: 'x',
          kind: 'call',
          dueInDays: CRM_TASK_MAX_DUE_DAYS + 1,
        }),
      ),
    ).toMatch(/due in 0–/)
  })

  it('takes a task’s priority and a call’s direction by meaning, and refuses the rest (AGL-3517)', () => {
    const task = { type: 'createCrmTask', title: 'x', kind: 'call', dueInDays: 1 }
    expect(validateHostAction(withStep({ ...task, priority: 'high' }))).toBeNull()
    expect(validateHostAction(withStep({ ...task, priority: 'urgent' }))).toMatch(/priority/)
    const log = { type: 'logCrmActivity', kind: 'call', body: 'Rang in' }
    expect(validateHostAction(withStep({ ...log, direction: 'internal' }))).toBeNull()
    expect(validateHostAction(withStep({ ...log, kind: 'email', direction: 'internal' }))).toMatch(
      /which way the email went/,
    )
    expect(validateHostAction(withStep({ ...log, kind: 'note', direction: 'inbound' }))).toMatch(
      /only a call or an email takes a direction/,
    )
  })

  it('refuses an assignee address that is not one, and needs none at all', () => {
    const task = { type: 'createCrmTask', title: 'x', kind: 'call', dueInDays: 1 }
    expect(
      validateHostAction(withStep({ ...task, assigneeEmail: 'sam' })),
    ).toMatch(/assignee’s email/)
    expect(
      validateHostAction(withStep({ ...task, assigneeEmail: 'sam@example.com' })),
    ).toBeNull()
    // Blank is "the contact's owner", not an error.
    expect(validateHostAction(withStep({ ...task, assigneeEmail: '  ' }))).toBeNull()
  })

  it('refuses an activity with an unknown kind or nothing to say', () => {
    expect(
      validateHostAction(
        withStep({ type: 'logCrmActivity', kind: 'todo', body: 'x' }),
      ),
    ).toMatch(/kind of activity/)
    expect(
      validateHostAction(
        withStep({ type: 'logCrmActivity', kind: 'note', body: ' ' }),
      ),
    ).toMatch(/what happened/)
  })
})
/**
 * showHtml tells the author what the render-time sanitizer will take out
 * (AGL-2486).
 *
 * The runtime executes for a VISITOR and can only drop refused markup in
 * silence — the step still "succeeds" and the page shows nothing. Every
 * caller of `validateHostAction` is an EDITOR surface (the workflows card,
 * the console interaction dialogs, the besigner presets), so this is the
 * only place the person who can fix the markup will ever read it.
 */
describe('showHtml sanitizer feedback (AGL-2486)', () => {
  const withHtml = (html: string): HostAction => ({
    ...base,
    steps: [{ type: 'showHtml', html }],
  })

  it('still accepts HTML that survives the sanitizer whole', () => {
    expect(
      validateHostAction(
        withHtml('<p style="color:#333">Thanks — <strong>see you soon</strong>.</p>'),
      ),
    ).toBeNull()
  })

  it('still demands some HTML', () => {
    expect(validateHostAction(withHtml('  '))).toMatch(/enter the HTML/)
  })

  it('names a dropped element rather than letting it fail on the live page', () => {
    const problem = validateHostAction(
      withHtml('<div>Widget</div><script src="https://vendor.test/w.js"></script>'),
    )
    expect(problem).toMatch(/script/)
  })

  it('names a refused inline style', () => {
    expect(
      validateHostAction(withHtml('<p style="width:expression(alert(1))">x</p>')),
    ).toMatch(/style attribute/)
  })

  it('names a url() that will not load', () => {
    expect(
      validateHostAction(withHtml('<p style="background:url(http://t.test/p.gif)">x</p>')),
    ).toMatch(/url\(\)/)
  })

  it('says so when nothing at all can be shown', () => {
    expect(validateHostAction(withHtml('<script>alert(1)</script>'))).toMatch(
      /none of this HTML can be shown/,
    )
  })

  it('counts the rest rather than listing them all', () => {
    const problem = validateHostAction(
      withHtml('<script>a</script><p onclick="b()" style="behavior:url(#x)">t</p>'),
    )
    expect(problem).toMatch(/\+2 more/)
  })
})

/**
 * AGL-3458 — a trigger filter the evaluator can never run is refused at save.
 *
 * The filter's evaluator is the functions' arithmetic, with no comparison, so
 * `source == "form"` throws on every event and an automation saved with it
 * never fires. The refusal points at the conditions, which do compare.
 */
describe('a trigger filter the evaluator cannot run (AGL-3458)', () => {
  it.each([
    'source == "form"',
    'path === "/pricing"',
    'total != 0',
    'total > 10',
    'a && b',
    'a || b',
    'source = "form"',
  ])('refuses %s and points to conditions', (filter) => {
    const problem = validateHostAction({ ...base, trigger: { event: 'formSubmission', filter } })
    expect(problem).toMatch(/can’t compare/)
    expect(problem).toMatch(/condition/)
  })

  it('refuses text the evaluator cannot read at all, with its reason', () => {
    expect(triggerFilterProblem('(total + 1')).toMatch(/Missing closing parenthesis/)
    expect(triggerFilterProblem('nope(1)')).toMatch(/Unknown function "nope"/)
    expect(triggerFilterProblem('total total')).toMatch(/trailing input/)
  })

  it('accepts what the evaluator can run — a field name, arithmetic, a built-in', () => {
    for (const filter of ['', '  ', 'subscribe', 'total - 100', 'max(a, b)', '"a == b"']) {
      expect(triggerFilterProblem(filter)).toBeNull()
    }
    expect(validateHostAction({ ...base, trigger: { event: 'formSubmission', filter: 'subscribe' } })).toBeNull()
  })

  it('points a workflow, which has no conditions, at an action that has them', () => {
    expect(triggerFilterProblem('path == "/x"', { remedy: 'action' })).toMatch(/from an action with a condition/)
  })
})

/**
 * AGL-3458 — a `sendEmail` step answering the person's own act is a
 * transactional reply: no unsubscribe header, no unsubscribe link.
 */
describe('a transactional reply', () => {
  const reply = { type: 'sendEmail' as const, subject: 'Thanks', body: 'Got it' }
  const now = { event: 'formSubmission', afterWait: false }

  it('is the default for an immediate step on the person’s own submission, booking, sign-up or new lead', () => {
    for (const event of ['formSubmission', 'booking', 'memberSignUp', 'lead']) {
      expect(sendEmailIsTransactionalReply(reply, { event, afterWait: false })).toBe(true)
    }
  })

  it('is not, on an event that is the business acting, after a wait, in a topic, or to somebody else', () => {
    expect(sendEmailReplyIneligibility(reply, { event: 'contactStageChanged', afterWait: false })).toBe('event')
    expect(sendEmailReplyIneligibility(reply, { event: 'my-custom-event', afterWait: false })).toBe('event')
    expect(sendEmailReplyIneligibility(reply, { event: 'formSubmission', afterWait: true })).toBe('wait')
    expect(sendEmailReplyIneligibility({ ...reply, topicId: 'promotions' }, now)).toBe('topic')
    expect(sendEmailReplyIneligibility({ ...reply, toField: 'managerEmail' }, now)).toBe('recipient')
    // The default field, named, is still the person who acted.
    expect(sendEmailReplyIneligibility({ ...reply, toField: 'email' }, now)).toBeNull()
  })

  it('can be switched back to a mailing', () => {
    expect(sendEmailIsTransactionalReply({ ...reply, transactional: false }, now)).toBe(false)
  })

  it('refuses a step SWITCHED on that cannot be one, and saves the default', () => {
    expect(
      validateHostAction({
        ...base,
        steps: [{ type: 'wait', delayMinutes: 60 }, { ...reply, transactional: true }],
      }),
    ).toMatch(/^Step 2: an email after a wait is a mailing/)
    expect(
      validateHostAction({
        ...base,
        trigger: { event: 'dealWon' },
        steps: [{ ...reply, transactional: true }],
      }),
    ).toMatch(/^Step 1: only a reply to the person’s own/)
    expect(validateHostAction({ ...base, steps: [{ ...reply, transactional: true }] })).toBeNull()
    // A wait after the email does not make the email late.
    expect(
      validateHostAction({
        ...base,
        steps: [{ ...reply, transactional: true }, { type: 'wait', delayMinutes: 60 }],
      }),
    ).toBeNull()
  })

  it('knows a step after a wait or a wait-for-event', () => {
    const steps = [
      reply,
      { type: 'waitForEvent' as const, eventName: 'booking', timeoutMinutes: 60 },
      reply,
    ]
    expect(stepRunsAfterWait(steps, 0)).toBe(false)
    expect(stepRunsAfterWait(steps, 2)).toBe(true)
  })
})

describe('the vocabulary the other plugins read without loading this one (AGL-3080)', () => {
  it('names every step as the editor’s picker always has, in the picker’s order', () => {
    // The labels are each step's declaration (or the platform's, for a client
    // step); this is the table the picker offered before they were.
    expect(Object.entries(HOST_ACTION_STEP_LABELS)).toEqual(
      Object.entries({
        runWorkflow: 'Run a workflow',
        siteAlert: 'Show a site alert',
        customEvent: 'Fire a custom event',
        datasetAppend: 'Write to a dataset',
        webhookPost: 'Send a webhook (Business)',
        showOverlay: 'Show a popup or bar',
        stickyNav: 'Make navigation sticky',
        addClass: 'Add a CSS class',
        toggleClass: 'Toggle a CSS class',
        removeClass: 'Remove a CSS class',
        showElement: 'Show an element',
        hideElement: 'Hide an element',
        toggleElement: 'Show/hide an element',
        openDrawer: 'Open a drawer',
        closeDrawer: 'Close a drawer',
        toggleDrawer: 'Open/close a drawer',
        openMenu: 'Open a menu',
        closeMenu: 'Close a menu',
        toggleMenu: 'Open/close a menu',
        setAttribute: 'Set an ARIA or data attribute',
        removeAttribute: 'Remove an ARIA or data attribute',
        scrollTo: 'Scroll to element',
        playVideo: 'Play a video',
        showHtml: 'Show custom HTML',
        runJs: 'Run custom JS (Business)',
        redirect: 'Redirect the visitor',
        trackGaEvent: 'Track an analytics event',
        sendEmail: 'Send an email',
        notifyAdmins: 'Notify site admins',
        enrollList: 'Enroll in a list',
        updateDataset: 'Update a dataset record',
        assignCampaign: 'Assign to a campaign',
        wait: 'Wait',
        waitForEvent: 'Wait for something to happen',
        exitFlow: 'End the flow here',
        setContactStage: 'Set the contact’s lifecycle stage',
        addContactTag: 'Tag the contact',
        assignContactOwner: 'Assign the contact an owner',
        createCrmTask: 'Create a CRM task',
        logCrmActivity: 'Log a CRM activity',
      }),
    )
  })

  it('declares every server step, and only the steps that suspend a run hold one', () => {
    for (const type of SERVER_ACTION_STEP_TYPES) {
      expect({ type, declared: declaredInteractionStep(type) !== null }).toEqual({ type, declared: true })
    }
    const holding = HOST_ACTION_STEP_TYPES.filter((type) => interactionStepHolds(type) !== null)
    expect(new Set(holding)).toEqual(FLOW_SUSPENDING_STEP_TYPES)
  })

  it('declares the wait band and the timed-out field the engine keeps', () => {
    for (const type of FLOW_SUSPENDING_STEP_TYPES) {
      expect(interactionStepHolds(type)).toMatchObject({
        minMinutes: FLOW_WAIT_MIN_MINUTES,
        maxMinutes: FLOW_WAIT_MAX_MINUTES,
      })
    }
    expect(interactionStepHolds('waitForEvent')?.timeoutField).toBe(FLOW_TIMED_OUT_FIELD)
  })

  it('accepts an automation holding placeholders: the value a person replaces in this editor (AGL-2919)', () => {
    expect(
      validateHostAction({
        name: 'Welcome newsletter sign-ups',
        trigger: {
          event: 'formSubmission',
          conditions: [{ field: 'formName', op: 'equals', value: '[newsletter sign-up form]' }],
          combinator: 'and',
        },
        steps: [
          { type: 'enrollList', listName: '[newsletter]' },
          { type: 'sendEmail', subject: 'Welcome aboard', body: 'Call us on [your phone number].' },
        ],
        enabled: false,
      }),
    ).toBeNull()
  })
})
