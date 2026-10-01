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
  buildDefaultEmailNodeMap,
  EMAIL_NODE_ROOT_ID,
  renderEmailHtml,
} from '@aglyn/shared-util-email'
import { bookingsTenantEmails } from './tenant-emails'

/**
 * What a guest reads when the site published no design of its own: the
 * built-in copy, rendered (AGL-3432). The business they booked with is named
 * in the sentence, and the time carries its zone.
 */
function render(key: string, merge: Record<string, string>): string {
  const entry = bookingsTenantEmails().find((email) => email.key === key)
  if (!entry) throw new Error(`no ${key} entry`)
  return renderEmailHtml({
    nodes: buildDefaultEmailNodeMap(entry) as never,
    rootId: EMAIL_NODE_ROOT_ID,
    merge: { 'host.businessName': 'Harbor Spa', ...merge },
    sanitize: (html) => html,
  }).text
}

const WHEN = {
  name: 'Rhea',
  'service.name': 'Deep tissue massage',
  when: 'Thursday, April 23, 2026 at 10:06 PM',
  timezone: 'America/Chicago',
}

describe('booking emails name the business and the zone (AGL-3432)', () => {
  it('a free booking’s confirmation: no payment line', () => {
    const text = render('booking-confirmed', {
      ...WHEN,
      'booking.payment': '',
      'booking.ref': 'bk_1',
    })
    expect(text).toContain(
      'Hi Rhea, your booking with Harbor Spa is confirmed: "Deep tissue ' +
        'massage" on Thursday, April 23, 2026 at 10:06 PM (America/Chicago).',
    )
    expect(text).not.toContain('You paid')
    expect(text).not.toMatch(/\n\s*\n\s*\n/)
  })

  it('a paid booking’s confirmation: states what was paid', () => {
    const text = render('booking-confirmed', {
      ...WHEN,
      'booking.payment': 'You paid $95.00.',
      'booking.ref': 'bk_1',
    })
    expect(text).toContain('You paid $95.00.')
  })

  it('the reminder names the business and the zone', () => {
    const text = render('booking-reminder', WHEN)
    expect(text).toContain(
      'Hi Rhea, this is a reminder of your booking with Harbor Spa: "Deep ' +
        'tissue massage" on Thursday, April 23, 2026 at 10:06 PM ' +
        '(America/Chicago).',
    )
  })
})
