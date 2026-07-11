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
  type HostAction,
  isCustomEventName,
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