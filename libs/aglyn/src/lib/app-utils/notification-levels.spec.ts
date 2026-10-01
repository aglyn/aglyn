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
  isNotificationLevel,
  loudestNotificationLevel,
  NOTIFICATION_LEVELS,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPE_LEVELS,
  notificationLevel,
  usageNotificationLevel,
} from './notifications'
import {
  CORE_OPERATOR_ALERTS,
  OPERATOR_ALERT_TIER_LEVELS,
  operatorAlertLevel,
} from './operator-alerts'

describe('notification levels (AGL-3437)', () => {
  it('gives every core type a level', () => {
    for (const type of Object.keys(NOTIFICATION_TYPE_LABELS)) {
      expect(isNotificationLevel((NOTIFICATION_TYPE_LEVELS as Record<string, unknown>)[type])).toBe(true)
    }
  })

  it('reads what the emitter stamped before the type default', () => {
    expect(notificationLevel({ type: 'system.operatorAlert', level: 'success' })).toBe('success')
    expect(notificationLevel({ type: 'billing.usage', level: 'info' })).toBe('info')
  })

  it('falls back to the type default for the backlog and for a level it does not know', () => {
    expect(notificationLevel({ type: 'system.abuseReportUrgent' })).toBe('critical')
    expect(notificationLevel({ type: 'staff.userSignedUp' })).toBe('success')
    expect(notificationLevel({ type: 'system.abuseReportUrgent', level: 'apocalyptic' })).toBe('critical')
  })

  it('reads an unknown type, or nothing at all, as neutral', () => {
    expect(notificationLevel({ type: 'someplugin.somethingHappened' })).toBe('neutral')
    expect(notificationLevel(null)).toBe('neutral')
    expect(notificationLevel(undefined)).toBe('neutral')
  })

  it('ranks the loudest of several levels', () => {
    expect(loudestNotificationLevel(['info', 'critical', 'success'])).toBe('critical')
    expect(loudestNotificationLevel(['neutral', 'warning', 'info'])).toBe('warning')
    expect(loudestNotificationLevel([])).toBe('neutral')
    expect(NOTIFICATION_LEVELS[0]).toBe('critical')
  })

  it('draws a usage step as info and a reached limit as a warning', () => {
    expect(usageNotificationLevel(75)).toBe('info')
    expect(usageNotificationLevel(90)).toBe('info')
    expect(usageNotificationLevel(100)).toBe('warning')
  })
})

describe('operator alert levels (AGL-3437)', () => {
  it('derives a level from the tier when the entry names none', () => {
    expect(operatorAlertLevel({ tier: 'must' })).toBe('critical')
    expect(operatorAlertLevel({ tier: 'should' })).toBe('warning')
    expect(operatorAlertLevel({ tier: 'low' })).toBe('info')
    expect(operatorAlertLevel({ tier: 'must', level: 'warning' })).toBe('warning')
  })

  it('draws a degraded check amber and a recovery green', () => {
    const level = (type: string) => {
      const definition = CORE_OPERATOR_ALERTS.find((alert) => alert.type === type)
      if (!definition) throw new Error(`${type} is not in the registry`)
      return operatorAlertLevel(definition)
    }
    expect(level('system.healthDegraded')).toBe('warning')
    expect(level('system.healthRecovered')).toBe('success')
    expect(level('system.abuseReportUrgent')).toBe('critical')
  })

  /*
   * An alert raised under a notification type of its own writes the
   * registry's level; a notification of that type written before `level`
   * existed reads the type's default. The two must agree, or the same alert
   * is drawn one color in last week's rows and another in today's.
   */
  it('agrees with the type default of every type an alert writes under', () => {
    for (const alert of CORE_OPERATOR_ALERTS) {
      if (!alert.notificationType) continue
      expect({ type: alert.type, level: operatorAlertLevel(alert) }).toEqual({
        type: alert.type,
        level: NOTIFICATION_TYPE_LEVELS[alert.notificationType],
      })
    }
  })

  it('maps every tier', () => {
    for (const level of Object.values(OPERATOR_ALERT_TIER_LEVELS)) {
      expect(isNotificationLevel(level)).toBe(true)
    }
  })
})
