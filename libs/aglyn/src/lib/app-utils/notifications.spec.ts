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
  NOTIFICATION_TYPE_LABELS,
  notificationCategory,
  notificationMuted,
  type AglynNotificationType,
} from './notifications'

describe('notification categories (AGL-267)', () => {
  it('buckets a type by its prefix and falls back to system', () => {
    expect(notificationCategory('billing.invoice')).toBe('billing')
    expect(notificationCategory('community.review')).toBe('community')
    expect(notificationCategory('nonsense.thing')).toBe('system')
  })

  it('labels every type — an unlabelled one renders as a raw key', () => {
    const labels = NOTIFICATION_TYPE_LABELS as Record<string, string>
    for (const type of Object.keys(labels)) {
      expect(labels[type]).toBeTruthy()
    }
  })
})

describe('the verifier-regression alert is not mutable as marketplace noise (AGL-1088)', () => {
  const REGRESSION: AglynNotificationType = 'system.pluginVerifierRegression'

  it('does not live in the Marketplace category', () => {
    // The category IS the prefix, and a staff member mutes Marketplace to
    // stop routine listing-review chatter. Filing this alert there would let
    // an unrelated preference drop "a live plugin now fails the verifier".
    expect(notificationCategory(REGRESSION)).toBe('system')
    expect(notificationCategory(REGRESSION)).not.toBe('community')
  })

  it('survives a staff member who muted marketplace notifications', () => {
    const prefs = { community: false }
    expect(notificationMuted(prefs, 'community.review')).toBe(true)
    expect(notificationMuted(prefs, REGRESSION)).toBe(false)
  })

  it('is still mutable by someone who mutes product and system', () => {
    // Not a loophole worth closing here: the adminAudit record is the
    // durable one, and a category nothing can mute would be a new concept.
    expect(notificationMuted({ system: false }, REGRESSION)).toBe(true)
  })
})
