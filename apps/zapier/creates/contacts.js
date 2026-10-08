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

const { apiUrl, seg } = require('../lib/api')

/**
 * Contact actions (AGL-3643), on `POST /v1/contacts` and
 * `PATCH /v1/contacts/{id}` — the writes the REST API already makes under
 * `contacts:write`, with their rules: the email is who a contact is and is
 * never changed, and the phone number and lifecycle stage belong to a
 * site's profile of the person, so they need a site.
 */

const LIFECYCLE_STAGES = {
  subscriber: 'Subscriber',
  lead: 'Lead',
  'marketing-qualified': 'Marketing qualified',
  'sales-qualified': 'Sales qualified',
  opportunity: 'Opportunity',
  customer: 'Customer',
  evangelist: 'Evangelist',
  other: 'Other',
}

const PROFILE_SITE_FIELD = {
  key: 'siteId',
  label: 'Site',
  required: false,
  dynamic: 'site.id.name',
  helpText:
    'The site this is for. Needed to set the phone number or lifecycle stage, which each site keeps for itself, and to opt the person in to the site’s marketing.',
}

const text = (value) => {
  const out = value === undefined || value === null ? '' : String(value).trim()
  return out ? out : undefined
}

const tagsOf = (value) => {
  const tags = [].concat(value === undefined || value === null ? [] : value).map(text).filter(Boolean)
  return tags.length ? tags : undefined
}

/** The body fields a create and an update share; only what was filled in. */
function contactBody(z, input, { create }) {
  const body = {}
  const name = text(input.name)
  if (name) body.name = name
  const tags = tagsOf(input.tags)
  if (tags) body.tags = tags
  const notes = text(input.notes)
  if (notes) body.notes = notes
  const phone = text(input.phone)
  if (phone) body.phone = phone
  const lifecycleStage = text(input.lifecycleStage)
  if (lifecycleStage) body.lifecycleStage = lifecycleStage
  const siteId = text(input.siteId)
  const consent = create && (input.marketingConsent === true || input.marketingConsent === 'true')
  if (consent) body.marketingConsent = true
  if ((phone || lifecycleStage || consent) && !siteId) {
    throw new z.errors.Error(
      'Choose a site to set a phone number or lifecycle stage, or to opt the person in to marketing.',
      'validation_failed',
      400,
    )
  }
  if (siteId && (phone || lifecycleStage || consent)) body.consentSiteId = siteId
  return body
}

const CONTACT_FIELDS = [
  { key: 'name', label: 'Name', required: false },
  { key: 'tags', label: 'Tags', list: true, required: false },
  { key: 'notes', label: 'Notes', type: 'text', required: false },
  PROFILE_SITE_FIELD,
  { key: 'phone', label: 'Phone', required: false, helpText: 'In international form, e.g. +15125550123. Needs a site.' },
  { key: 'lifecycleStage', label: 'Lifecycle Stage', required: false, choices: LIFECYCLE_STAGES, helpText: 'Needs a site.' },
]

const CONTACT_SAMPLE = {
  id: 'k7d2b9f104',
  object: 'contact',
  email: 'robin@example.com',
  name: 'Robin Wholesale',
  tags: ['b2b'],
  notes: null,
  marketingConsent: false,
  sources: ['api'],
  lifecycleStage: 'lead',
  created: '2026-10-07T18:22:10.000Z',
  updated: '2026-10-07T18:22:10.000Z',
}

const createContact = {
  key: 'create_contact',
  noun: 'Contact',
  display: {
    label: 'Create Contact',
    description: 'Adds a person to your contacts. An address already in your contacts is refused: use Find Contact with “create if not found”.',
    important: true,
  },
  operation: {
    inputFields: [
      { key: 'email', label: 'Email', required: true },
      ...CONTACT_FIELDS,
      {
        key: 'marketingConsent',
        label: 'Opted In to Marketing',
        type: 'boolean',
        required: false,
        helpText: 'Only when the person agreed to receive the site’s marketing. Needs a site.',
      },
    ],
    perform: async (z, bundle) => {
      const email = text(bundle.inputData.email)
      if (!email) throw new z.errors.Error('Enter the contact’s email address.', 'validation_failed', 400)
      const response = await z.request({
        url: apiUrl('/v1/contacts'),
        method: 'POST',
        body: { email, ...contactBody(z, bundle.inputData, { create: true }) },
      })
      return response.data
    },
    sample: CONTACT_SAMPLE,
  },
}

const updateContact = {
  key: 'update_contact',
  noun: 'Contact',
  display: {
    label: 'Update Contact',
    description: 'Changes a contact’s name, tags, notes, phone number or lifecycle stage. Tags you enter replace its tags.',
  },
  operation: {
    inputFields: [
      {
        key: 'contactId',
        label: 'Contact ID',
        required: true,
        search: 'find_contact.id',
        helpText: 'The contact to change. Use Find Contact to look one up by email.',
      },
      ...CONTACT_FIELDS,
    ],
    perform: async (z, bundle) => {
      const body = contactBody(z, bundle.inputData, { create: false })
      if (Object.keys(body).length === 0) {
        throw new z.errors.Error('Fill in at least one field to change.', 'validation_failed', 400)
      }
      const response = await z.request({
        url: apiUrl(`/v1/contacts/${seg(bundle.inputData.contactId)}`),
        method: 'PATCH',
        body,
      })
      return response.data
    },
    sample: CONTACT_SAMPLE,
  },
}

module.exports = { createContact, updateContact, contactBody, LIFECYCLE_STAGES }
