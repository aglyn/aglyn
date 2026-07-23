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
 * The transactional emails a SITE sends to its own end-users (AGL-769).
 *
 * Distinct from the platform system emails (`@aglyn/shared-util-email`'s
 * catalog), which are mail Aglyn sends on its own behalf and staff design.
 * These are tenant-owned: a customer's site sends them to its customers, and
 * the copy is either fixed inside the plugin or authored in that plugin's own
 * UI (a marketing campaign, a workflow's email step). This is a read-only
 * reference so a site owner can see what their site sends and where each is
 * controlled — it does not send anything itself.
 *
 * Code-defined and grouped by the plugin that owns the send, mirroring the
 * `sendEmail` call sites. A group only applies to a site that has the plugin
 * enabled; the reference says so rather than filtering, because it is a map of
 * the whole surface, not a live per-site inventory.
 */
export interface TenantEmailEntry {
  name: string
  /** What it is and when it fires. */
  description: string
  /** Where the copy is controlled, when it is not fixed in the plugin. */
  authoredIn?: string
}

export interface TenantEmailGroup {
  /** Plugin id owning these sends (matches org.enabledPlugins). */
  pluginId: string
  plugin: string
  emails: readonly TenantEmailEntry[]
}

export const TENANT_EMAIL_GROUPS: readonly TenantEmailGroup[] = [
  {
    pluginId: 'commerce',
    plugin: 'Commerce',
    emails: [
      {
        name: 'Order receipt',
        description:
          'Sent to the buyer after a successful order or checkout.',
      },
      {
        name: 'New sale',
        description: 'Notifies the seller when an order is placed.',
      },
      {
        name: 'Reservation confirmed',
        description: 'Confirms a paid reservation to the customer.',
      },
      {
        name: 'Gift card delivery',
        description: 'Delivers a purchased gift card to its recipient.',
      },
      {
        name: 'Supplier fulfillment',
        description:
          'Tells a dropship supplier there is a new order to fulfill.',
      },
      {
        name: 'Back in stock',
        description:
          'Tells a customer a product they watched is available again.',
      },
      {
        name: 'Abandoned cart',
        description: 'Reminds a shopper of items left in their cart.',
      },
      {
        name: 'New member post',
        description:
          'Notifies members when new members-only content is posted.',
      },
      {
        name: 'Member password reset',
        description:
          "Resets a site member's password — a store-member account, " +
          'separate from an Aglyn login.',
      },
    ],
  },
  {
    pluginId: 'bookings',
    plugin: 'Bookings',
    emails: [
      {
        name: 'Booking confirmed',
        description:
          'Confirms a booking to the customer, for paid and free services.',
      },
      {
        name: 'Booking reminder',
        description: 'Reminds the customer of an upcoming booking.',
      },
    ],
  },
  {
    pluginId: 'marketing',
    plugin: 'Marketing',
    emails: [
      {
        name: 'Campaign broadcast',
        description:
          "A campaign sent to the site's subscriber list.",
        authoredIn: 'Marketing → Campaigns',
      },
    ],
  },
  {
    pluginId: 'workflows',
    plugin: 'Workflows',
    emails: [
      {
        name: 'Workflow email step',
        description:
          "An email sent by a workflow's send-email action when its trigger " +
          'fires.',
        authoredIn: 'the workflow that sends it',
      },
    ],
  },
]

export default TENANT_EMAIL_GROUPS
