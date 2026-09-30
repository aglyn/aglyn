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

import { normalizeEventTags, worstDeliveryStatus } from './email-delivery-events'

describe('normalizeEventTags', () => {
  it('accepts the array form the webhook sends', () => {
    expect(
      normalizeEventTags([
        { name: 'context', value: 'invite' },
        { name: 'hostId', value: 'host_1' },
      ]),
    ).toEqual({ context: 'invite', hostId: 'host_1' })
  })

  it('accepts a plain map, which is what the send API takes', () => {
    expect(normalizeEventTags({ context: 'invite' })).toEqual({
      context: 'invite',
    })
  })

  it('is an empty map for anything else', () => {
    expect(normalizeEventTags(undefined)).toEqual({})
    expect(normalizeEventTags('nonsense')).toEqual({})
  })
})

describe('worstDeliveryStatus', () => {
  /*
   * Events arrive out of order — an `opened` can beat its own `delivered`
   * through the queue. The status shown to a staffer must not depend on which
   * one landed last, and a bounce must never be overwritten by the `sent` that
   * preceded it.
   */
  it('takes the first status when there is nothing to compare against', () => {
    expect(worstDeliveryStatus(null, 'sent')).toBe('sent')
  })

  it('advances along the lifecycle', () => {
    expect(worstDeliveryStatus('sent', 'delivered')).toBe('delivered')
    expect(worstDeliveryStatus('delivered', 'opened')).toBe('opened')
  })

  it('does not walk backwards when an earlier event arrives late', () => {
    expect(worstDeliveryStatus('clicked', 'sent')).toBe('clicked')
    expect(worstDeliveryStatus('delivered', 'sent')).toBe('delivered')
  })

  it('keeps a failure once it has one', () => {
    expect(worstDeliveryStatus('bounced', 'delivered')).toBe('bounced')
    expect(worstDeliveryStatus('opened', 'complained')).toBe('complained')
  })
})
