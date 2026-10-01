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

import type { TenantEmailEntry } from '@aglyn/shared-util-email'

/**
 * The emails a site sends its own customers through Bookings (AGL-769/770).
 *
 * Declared here, by the plugin that sends them, and compiled into the
 * platform's tenant email catalog (`TENANT_EMAILS` in
 * `@aglyn/shared-util-email`) by `tools/scripts/generate-plugin-manifests.mjs`
 * (AGL-3080): the catalog's readers include the send path, which loads no
 * plugin code, so a runtime registry it had not filled would quietly send
 * the text card in place of the site's designed email. Regenerate after
 * changing an entry; `--check` refuses a stale catalog.
 */
export function bookingsTenantEmails(): readonly TenantEmailEntry[] {
  return [
    {
      key: 'booking-confirmed',
      name: 'Booking confirmed',
      description: 'Confirms a booking to the customer, for paid and free services.',
      pluginId: 'bookings',
      plugin: 'Bookings',
      control: 'besigner',
      defaultSubject: 'Booking confirmed: {{service.name}}',
      mergeTokens: [
        { name: 'name', description: "The customer's name", sample: 'Alex' },
        {
          name: 'service.name',
          description: 'The booked service',
          sample: 'Consultation',
        },
        {
          name: 'when',
          description: 'Formatted date and time of the booking',
          sample: 'Monday, June 1, 2026 at 9:00 AM',
        },
        {
          name: 'timezone',
          description: 'Timezone the time is shown in',
          sample: 'America/Chicago',
        },
        {
          name: 'booking.payment',
          description:
            'What a paid booking charged, as a sentence; empty for a free booking',
          sample: 'You paid $95.00.',
        },
        {
          name: 'booking.ref',
          description: 'Booking reference id',
          sample: 'bk_123',
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Booking confirmed', variant: 'heading' },
        {
          block: 'text',
          text:
            'Hi {{name}}, your booking with {{host.businessName}} is ' +
            'confirmed: "{{service.name}}" on {{when}} ({{timezone}}).',
          variant: 'body',
        },
        { block: 'text', text: '{{booking.payment}}', variant: 'body' },
        { block: 'text', text: 'Reference: {{booking.ref}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you booked with {{host.businessName}}.',
    },
    {
      key: 'booking-reminder',
      name: 'Booking reminder',
      description: 'Reminds the customer of an upcoming booking.',
      pluginId: 'bookings',
      plugin: 'Bookings',
      control: 'besigner',
      defaultSubject: 'Reminder: {{service.name}} is coming up',
      mergeTokens: [
        { name: 'name', description: "The customer's name", sample: 'Alex' },
        {
          name: 'service.name',
          description: 'The booked service',
          sample: 'Consultation',
        },
        {
          name: 'when',
          description: 'Formatted date and time of the booking',
          sample: 'Tuesday, June 2, 2026 at 9:00 AM',
        },
        {
          name: 'timezone',
          description: 'Timezone the time is shown in',
          sample: 'America/Chicago',
        },
      ],
      defaultBody: [
        {
          block: 'text',
          text:
            'Hi {{name}}, this is a reminder of your booking with ' +
            '{{host.businessName}}: "{{service.name}}" on {{when}} ' +
            '({{timezone}}).',
          variant: 'body',
        },
      ],
      footerReason:
        'You’re receiving this because you have a booking with {{host.businessName}}.',
    },
  ]
}
