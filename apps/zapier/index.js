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

'use strict'

/**
 * Aglyn on Zapier (AGL-3643): the Zapier platform app definition.
 *
 * Every trigger, action and search is a call to Aglyn's public REST API
 * with the merchant's own API key; the instant triggers are REST hooks on
 * `/v1/sites/{siteId}/hooks`, which the `zapier` plugin in
 * `libs/plugins/zapier` serves and delivers. Nothing here is imported by the
 * Aglyn apps, and nothing of theirs is imported here.
 *
 * Published by the operator from Zapier's developer platform —
 * `npm install`, then `zapier register` once and `zapier push` per version.
 * Until it is published, the console's Zapier card and the user docs stay
 * hidden behind the console's `ZAPIER_APP_URL`.
 */

const packageJson = require('./package.json')
const authentication = require('./authentication')
const { handleErrors, includeApiKey } = require('./lib/api')
const site = require('./triggers/site')
const { newPaidOrder, updatedOrder } = require('./triggers/orders')
const { newBooking, updatedBooking } = require('./triggers/bookings')
const { newContact, newFormSubmission } = require('./triggers/contacts-and-forms')
const { createContact, updateContact } = require('./creates/contacts')
const fulfillOrder = require('./creates/fulfill-order')
const { findContact, findOrder } = require('./searches')

const byKey = (...entries) => Object.fromEntries(entries.map((entry) => [entry.key, entry]))

module.exports = {
  version: packageJson.version,
  platformVersion: packageJson.dependencies['zapier-platform-core'],
  authentication,
  beforeRequest: [includeApiKey],
  afterResponse: [handleErrors],
  triggers: byKey(site, newPaidOrder, updatedOrder, newBooking, updatedBooking, newContact, newFormSubmission),
  creates: byKey(createContact, updateContact, fulfillOrder),
  searches: byKey(findContact, findOrder),
  searchOrCreates: {
    find_contact: {
      key: 'find_contact',
      display: {
        label: 'Find or Create Contact',
        description: 'Finds a contact by email address, and adds one when there is none.',
      },
      search: 'find_contact',
      create: 'create_contact',
    },
  },
}
