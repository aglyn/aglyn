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
  CORE_OPERATOR_ALERTS,
  effectiveOperatorAlertSetting,
  OPERATOR_ALERT_NOTIFICATION_TYPES,
  renderOperatorAlertTemplate,
  type OperatorAlertDefinition,
} from '../app-utils/operator-alerts'
import { NOTIFICATION_TYPE_LABELS } from '../app-utils/notifications'
import {
  getOperatorAlert,
  listOperatorAlerts,
  operatorAlertForNotificationType,
  registerOperatorAlerts,
  resetOperatorAlertsForTests,
} from './operator-alerts'

const pluginAlert = (type: string): OperatorAlertDefinition => ({
  type,
  label: 'l',
  description: 'd',
  tier: 'should',
  category: 'payments',
  title: 't',
  body: 'b',
  delivery: 'immediate',
  dedupeWindowMinutes: 0,
  defaultEnabled: true,
})

afterEach(() => resetOperatorAlertsForTests())

describe('the operator alert catalog (AGL-3377)', () => {
  it('names each type once', () => {
    const types = CORE_OPERATOR_ALERTS.map((entry) => entry.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('writes every alert under a notification type that exists', () => {
    for (const entry of CORE_OPERATOR_ALERTS) {
      const type = entry.notificationType ?? 'system.operatorAlert'
      expect(NOTIFICATION_TYPE_LABELS[type]).toBeTruthy()
    }
  })

  it('every must is on and immediate by default', () => {
    for (const entry of CORE_OPERATOR_ALERTS.filter((alert) => alert.tier === 'must')) {
      expect({ type: entry.type, on: entry.defaultEnabled, delivery: entry.delivery }).toEqual({
        type: entry.type,
        on: true,
        delivery: 'immediate',
      })
    }
  })

  it('names no plugin: every core type is outside a plugin namespace', () => {
    for (const entry of CORE_OPERATOR_ALERTS) expect(entry.pluginId).toBeUndefined()
  })

  it('derives the AGL-3375 set from the catalog', () => {
    for (const type of [
      'system.abuseReportUrgent',
      'system.disputeUnattributed',
      'system.dmcaCounterNotice',
      'system.billingWebhookHalfApplied',
    ]) {
      expect(OPERATOR_ALERT_NOTIFICATION_TYPES.has(type)).toBe(true)
    }
    // A console-only staff notification is not an alert.
    for (const type of ['staff.userSignedUp', 'staff.orgCreated', 'staff.subscriptionStarted', 'staff.planChanged']) {
      expect(OPERATOR_ALERT_NOTIFICATION_TYPES.has(type)).toBe(false)
      expect(operatorAlertForNotificationType(type)).toBeUndefined()
    }
  })
})

describe('plugin contributions', () => {
  it('lists a plugin’s alerts after core’s', () => {
    registerOperatorAlerts([pluginAlert('commerce.b'), pluginAlert('commerce.a')], { pluginId: 'commerce' })
    const types = listOperatorAlerts().map((entry) => entry.type)
    expect(types.slice(-2)).toEqual(['commerce.a', 'commerce.b'])
    expect(getOperatorAlert('commerce.a')?.pluginId).toBe('commerce')
  })

  it('refuses a type outside the plugin’s namespace, or one core owns', () => {
    expect(() => registerOperatorAlerts([pluginAlert('marketing.x')], { pluginId: 'commerce' })).toThrow()
    expect(() => registerOperatorAlerts([pluginAlert('commerce.')], { pluginId: 'commerce' })).toThrow()
    expect(() => registerOperatorAlerts([pluginAlert('commerce.x')], { pluginId: '' })).toThrow()
  })

  it('registering twice replaces in place', () => {
    registerOperatorAlerts([pluginAlert('ai.x')], { pluginId: 'ai' })
    registerOperatorAlerts([{ ...pluginAlert('ai.x'), label: 'second' }], { pluginId: 'ai' })
    expect(listOperatorAlerts().filter((entry) => entry.type === 'ai.x')).toHaveLength(1)
    expect(getOperatorAlert('ai.x')?.label).toBe('second')
  })
})

describe('renderOperatorAlertTemplate', () => {
  it('fills tokens and closes the gap a missing one leaves', () => {
    expect(renderOperatorAlertTemplate('Workspace {{orgName}} ({{orgId}}) failed.', { orgId: 'o1' })).toBe(
      'Workspace (o1) failed.',
    )
    expect(renderOperatorAlertTemplate('{{a}} ({{b}}).', { a: 'x' })).toBe('x.')
  })
})

describe('effectiveOperatorAlertSetting', () => {
  it('staff answers win over the coded default, one field at a time', () => {
    const definition = { type: 't', delivery: 'immediate' as const, defaultEnabled: true }
    expect(effectiveOperatorAlertSetting(definition, null)).toEqual({ enabled: true, delivery: 'immediate' })
    expect(effectiveOperatorAlertSetting(definition, { types: { t: { delivery: 'digest' } } })).toEqual({
      enabled: true,
      delivery: 'digest',
    })
    expect(effectiveOperatorAlertSetting(definition, { types: { t: { enabled: false } } })).toEqual({
      enabled: false,
      delivery: 'immediate',
    })
  })
})
