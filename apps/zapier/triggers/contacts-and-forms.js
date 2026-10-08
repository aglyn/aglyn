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

const { apiUrl, rowsOf, seg, throwAglynError } = require('../lib/api')
const { hookTrigger } = require('../lib/hook-trigger')

/**
 * The contact and form triggers (AGL-3643), on the host events Aglyn relays
 * to Zapier.
 *
 * A new contact arrives as its id and the few fields the capture knew, so
 * the row is read back whole (`GET /v1/contacts/{id}`) — the same contact a
 * Find Contact step or the sample returns — and falls back to what arrived
 * when the contact was already deleted. A submission arrives whole, in the
 * REST API's shape.
 */

const CONTACT_SAMPLE = {
  id: 'k7d2b9f104',
  object: 'contact',
  email: 'robin@example.com',
  name: 'Robin Wholesale',
  tags: ['b2b'],
  notes: null,
  marketingConsent: true,
  consentSites: ['host_demo'],
  sources: ['form'],
  phone: '+15125550123',
  lifecycleStage: 'lead',
  created: '2026-10-07T18:22:10.000Z',
  updated: '2026-10-07T18:22:10.000Z',
  event: 'contact.created',
  eventId: 'evt_sample',
}

const newContact = hookTrigger({
  key: 'new_contact',
  noun: 'Contact',
  label: 'New Contact',
  description: 'Triggers when a new person is added to your contacts on a site: from a form, a booking, a purchase or the API.',
  important: true,
  events: ['contact.created'],
  toRecords: async (z, bundle, body) => {
    const arrived = body.data.contact || {}
    const extra = { event: body.type, eventId: body.id }
    if (!arrived.id) return []
    const response = await z.request({ url: apiUrl(`/v1/contacts/${seg(arrived.id)}`), skipThrowForStatus: true })
    if (response.status === 200 && response.data && response.data.id) return [{ ...response.data, ...extra }]
    // A key that can no longer read contacts is the Zap's problem to show;
    // a contact deleted since it was made is only a thinner row.
    if (response.status === 401 || response.status === 403 || response.status === 429) throwAglynError(response, z)
    return [{ object: 'contact', ...arrived, ...extra }]
  },
  list: async (z) => {
    const response = await z.request({ url: apiUrl('/v1/contacts'), params: { limit: 3 } })
    return rowsOf(response).map((contact) => ({ ...contact, event: 'contact.created', eventId: null }))
  },
  sample: CONTACT_SAMPLE,
  outputFields: [
    { key: 'id', label: 'Contact ID' },
    { key: 'email', label: 'Email' },
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'lifecycleStage', label: 'Lifecycle Stage' },
    { key: 'marketingConsent', label: 'Marketing Consent', type: 'boolean' },
  ],
})

const FORM_FIELD = {
  key: 'formId',
  label: 'Form ID',
  required: false,
  helpText: 'Only submissions to this form, by its id. Leave empty for every form on the site.',
}

const newFormSubmission = hookTrigger({
  key: 'new_form_submission',
  noun: 'Form Submission',
  label: 'New Form Submission',
  description: 'Triggers when someone submits a form on the site.',
  important: true,
  events: ['form.submitted'],
  inputFields: [FORM_FIELD],
  toRecords: async (z, bundle, body) => {
    const submission = body.data.submission || {}
    const formId = String(bundle.inputData.formId || '').trim()
    if (formId && submission.form_id !== formId) return []
    return [{ ...submission, id: submission.id || body.id, event: body.type, eventId: body.id }]
  },
  list: async (z, bundle) => {
    const formId = String(bundle.inputData.formId || '').trim()
    const response = await z.request({
      url: apiUrl(`/v1/sites/${seg(bundle.inputData.siteId)}/form-submissions`),
      params: { limit: 3, ...(formId ? { formId } : {}) },
    })
    return rowsOf(response).map((submission) => ({ ...submission, event: 'form.submitted', eventId: null }))
  },
  sample: {
    id: 'sub_1',
    object: 'form_submission',
    form_id: 'frm_7QK2',
    form: 'Contact',
    path: '/contact',
    fields: { email: 'hi@example.com', message: 'Hello!' },
    read: false,
    event: 'form.submitted',
    eventId: 'evt_sample',
  },
  outputFields: [
    { key: 'id', label: 'Submission ID' },
    { key: 'form_id', label: 'Form ID' },
    { key: 'form', label: 'Form Name' },
    { key: 'path', label: 'Page' },
  ],
})

module.exports = { newContact, newFormSubmission }
