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

const { apiUrl, seg, throwAglynError } = require('./api')

/**
 * An Aglyn instant trigger (AGL-3643): a REST hook on one site.
 *
 * Turning the Zap on subscribes the URL Zapier minted for it
 * (`POST /v1/sites/{siteId}/hooks`) to the trigger's events; turning it off
 * removes it (`DELETE …/hooks/{id}`). Aglyn posts each event as
 * `{ id, type, createdAt, siteId, data }` and `toRecords` turns it into the
 * rows the Zap sees — the same shape `performList` reads from the REST API
 * for the sample, so a field mapped while testing is there when it runs.
 */

/** The site a trigger or action works on: a dropdown of the key's sites. */
const SITE_FIELD = {
  key: 'siteId',
  label: 'Site',
  required: true,
  dynamic: 'site.id.name',
  helpText: 'The site to watch. Your API key needs the `sites:read` scope to list your sites here.',
}

/**
 * A trigger that takes several events can let the Zap choose: `choices` maps
 * each event to its words, and every one is taken when none is chosen.
 */
function eventsField(choices) {
  return {
    key: 'events',
    label: 'Changes',
    list: true,
    required: false,
    choices,
    helpText: 'Which changes start the Zap. Leave empty for all of them.',
  }
}

function chosenEvents(bundle, events, choices) {
  if (!choices) return events
  const picked = [].concat(bundle.inputData.events || []).filter((event) => events.includes(event))
  return picked.length ? picked : events
}

/**
 * @param {object} spec
 * @param {string} spec.key
 * @param {string} spec.noun
 * @param {string} spec.label
 * @param {string} spec.description
 * @param {string[]} spec.events - the Aglyn events the hook takes
 * @param {Record<string, string>} [spec.choices] - event → words, to let the Zap choose
 * @param {object[]} [spec.inputFields] - more fields, after the site
 * @param {(z: object, bundle: object, body: object) => Promise<object[]>} spec.toRecords
 * @param {(z: object, bundle: object) => Promise<object[]>} spec.list
 * @param {object} spec.sample
 * @param {object[]} [spec.outputFields]
 * @param {boolean} [spec.important]
 */
function hookTrigger(spec) {
  return {
    key: spec.key,
    noun: spec.noun,
    display: {
      label: spec.label,
      description: spec.description,
      ...(spec.important ? { important: true } : {}),
    },
    operation: {
      type: 'hook',
      inputFields: [SITE_FIELD, ...(spec.choices ? [eventsField(spec.choices)] : []), ...(spec.inputFields || [])],
      performSubscribe: async (z, bundle) => {
        const response = await z.request({
          url: apiUrl(`/v1/sites/${seg(bundle.inputData.siteId)}/hooks`),
          method: 'POST',
          body: { targetUrl: bundle.targetUrl, events: chosenEvents(bundle, spec.events, spec.choices) },
        })
        return response.data
      },
      performUnsubscribe: async (z, bundle) => {
        const subscription = bundle.subscribeData || {}
        const siteId = subscription.siteId || bundle.inputData.siteId
        const response = await z.request({
          url: apiUrl(`/v1/sites/${seg(siteId)}/hooks/${seg(subscription.id)}`),
          method: 'DELETE',
          skipThrowForStatus: true,
        })
        // Already gone — removed from the console, or by a revoked key — is
        // what turning the Zap off wanted.
        if (response.status === 404) return { id: subscription.id, deleted: true }
        if (response.status >= 400) throwAglynError(response, z)
        return response.data
      },
      perform: async (z, bundle) => {
        const body = bundle.cleanedRequest || {}
        if (!body.data || !spec.events.includes(body.type)) return []
        return spec.toRecords(z, bundle, body)
      },
      performList: async (z, bundle) => spec.list(z, bundle),
      sample: spec.sample,
      ...(spec.outputFields ? { outputFields: spec.outputFields } : {}),
    },
  }
}

module.exports = { SITE_FIELD, chosenEvents, hookTrigger }
