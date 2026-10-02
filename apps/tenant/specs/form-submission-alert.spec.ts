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
 * A form submission's alert opens THAT submission and names the form, the
 * page and the campaign (AGL-3461).
 *
 * The link is the claim that can drift silently: the site writes it and the
 * console's Inbox publishes the address it answers to. An app spec may not
 * import the plugin, so both ends pin the SAME address: this file, through
 * the rewrite the console and the email apply when the alert is followed,
 * and the Inbox's `inbox-record-routes.spec.ts`, for the record route it
 * registers.
 */

import { normalizeNotificationLink } from '@aglyn/aglyn/app-utils/notifications'
import {
  formSubmissionAlertBody,
  formSubmissionAlertLink,
} from '../utils/form-submission-alert'

describe('where the alert opens', () => {
  it('is the Inbox’s own address for that one submission, once rewritten', () => {
    const stored = formSubmissionAlertLink('host-doc-1', 'sub-1')

    const followed = normalizeNotificationLink(stored, {
      orgSlug: 'acme',
      hostId: 'host-doc-1',
      hostSubdomain: 'shop',
    })

    // The address `inbox-record-routes.spec.ts` pins for the same submission.
    expect(followed).toBe('/acme/hosts/shop/inbox/submissions?submission=sub-1')
  })

  it('is stored in the host-link shape, so a reader of another workspace is rewritten too', () => {
    expect(formSubmissionAlertLink('host-doc-1', 'sub-1')).toBe(
      '/host-doc-1/inbox/submissions?submission=sub-1',
    )
  })
})

describe('what the alert says', () => {
  it('names the form, the site and the page with nothing to credit', () => {
    expect(formSubmissionAlertBody({ formName: 'Contact', path: '/contact' })).toBe(
      'Someone submitted “Contact” on {site} (page /contact).',
    )
    expect(formSubmissionAlertBody({ formName: 'Contact' })).toBe(
      'Someone submitted “Contact” on {site}.',
    )
  })

  it('names the campaign it is CREDITED to, and how the visitor reached it', () => {
    const body = formSubmissionAlertBody({
      formName: 'AI website draft',
      path: '/ai-website-draft',
      description: {
        credited: {
          label: 'One job — AI',
          how: 'viewed /ai-website-draft, a page filed under it',
          containerId: 'camp-ai',
        },
        filedUnder: [],
      },
    })

    expect(body).toBe(
      'Someone submitted “AI website draft” on {site} (page /ai-website-draft). ' +
        'Credited to “One job — AI”: the visitor viewed /ai-website-draft, a page filed under it.',
    )
  })

  it('says what the form and page are FILED under in a sentence of its own', () => {
    const body = formSubmissionAlertBody({
      formName: 'Contact',
      path: '/contact',
      description: {
        filedUnder: [
          { id: 'a', label: 'Spring' },
          { id: 'b', label: 'Retargeting' },
        ],
      },
    })

    // Filed under and credited to are different facts; with no credit the
    // body says only the first, and never words it as a credit.
    expect(body).toBe(
      'Someone submitted “Contact” on {site} (page /contact). ' +
        'The form and page are filed under “Spring” and “Retargeting”.',
    )
    expect(body).not.toContain('Credited')
  })

  it('summarizes a long list rather than printing every campaign', () => {
    const body = formSubmissionAlertBody({
      formName: 'Contact',
      description: {
        filedUnder: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ id: label, label })),
      },
    })

    expect(body).toContain('filed under “A”, “B” and 3 more.')
  })
})
