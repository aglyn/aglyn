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

/*==========================================
 * SITE CARE, AS SYSTEM EMAILS (AGL-3959).
 *
 * A Site Care owner hears about their requests by email, because they do not
 * use the console: that it arrived, that it is done (with what changed and
 * the time it took), that a bigger job needs a quote, that they approved
 * extra time, that a charge was corrected or reversed, and the month's
 * statement on demand. Each is its own key so staff can redesign one
 * without the rest. The merge tokens are what
 * `@aglyn/tenant-data-admin/server/site-care-emails` fills.
 *
 * None answers a sender the intake does not recognize. Site Care mail
 * arrives at the support address (AGL-3997), so such a message is ordinary
 * support mail and the support inbox answers it.
 *=========================================*/

import type {
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

export const SITE_CARE_REQUEST_RECEIVED_EMAIL_KEY = 'site-care-request-received'
export const SITE_CARE_REQUEST_DONE_EMAIL_KEY = 'site-care-request-done'
export const SITE_CARE_REQUEST_CORRECTED_EMAIL_KEY = 'site-care-request-corrected'
export const SITE_CARE_APPROVAL_EMAIL_KEY = 'site-care-approval-confirmation'
export const SITE_CARE_CHARGE_REVERSED_EMAIL_KEY = 'site-care-charge-reversed'
export const SITE_CARE_STATEMENT_EMAIL_KEY = 'site-care-statement'
export const SITE_CARE_QUOTE_EMAIL_KEY = 'site-care-quote'

const SOURCE = 'libs/tenant/data/admin/src/lib/server/site-care-emails.ts'

const ORG_NAME: SystemEmailMergeToken = {
  name: 'org.name',
  description: 'The workspace the request is for',
  sample: 'Test Org',
}
const REQUEST_TITLE: SystemEmailMergeToken = {
  name: 'request.title',
  description: 'The request, as the owner titled it',
  sample: 'Update our holiday hours',
}

const FOOTER =
  'You’re receiving this because {{org.name}} has Site Care on {{brand.productName}}.'

export const SITE_CARE_SYSTEM_EMAIL_TEMPLATES: readonly SystemEmailTemplateDefinition[] = [
  {
    key: SITE_CARE_REQUEST_RECEIVED_EMAIL_KEY,
    name: 'Site Care: request received',
    description:
      'Sent to the person who asked when a Site Care request arrives, by email or from the console.',
    deliveredBy: 'resend',
    defaultSubject: 'We have your request: {{request.title}}',
    mergeTokens: [
      ORG_NAME,
      REQUEST_TITLE,
      {
        name: 'request.message',
        description: 'What they asked for',
        sample: 'Please change Saturday to 9 to 2 for December.',
      },
      {
        name: 'request.due',
        description: 'When it will be done at the latest',
        sample: 'Wednesday, October 21',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Site Care · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: 'We have your request', variant: 'heading' },
      {
        block: 'text',
        text: 'Thanks. We received “{{request.title}}” and will have it done by {{request.due}}. Reply to this email to add anything, and it joins the same request.',
        variant: 'body',
      },
      { block: 'text', text: 'Request: {{request.title}}\nDone by: {{request.due}}', variant: 'details' },
      { block: 'text', text: '{{request.message}}', variant: 'body' },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_REQUEST_DONE_EMAIL_KEY,
    name: 'Site Care: request done',
    description:
      'Sent to the workspace owner when staff close a Site Care request: what changed, the time it took, the time left this month, or the extra time billed.',
    deliveredBy: 'resend',
    defaultSubject: 'Done: {{request.title}}',
    mergeTokens: [
      ORG_NAME,
      REQUEST_TITLE,
      {
        name: 'request.changes',
        description: 'What changed, from the request and the publish that shipped it',
        sample: 'Published “Home” on Oct 19, 2026, 3:04 PM CDT',
      },
      { name: 'request.minutes', description: 'The time it took', sample: '35 min' },
      {
        name: 'month.minutesLeft',
        description: 'Included time left this month',
        sample: '25 min of this month’s included hour',
      },
      {
        name: 'request.billing',
        description: 'Whether anything bills, in one sentence',
        sample: 'No extra charge: this fit in your included hour.',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Site Care · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: 'Done: {{request.title}}', variant: 'heading' },
      { block: 'text', text: 'We finished your request. {{request.billing}}', variant: 'body' },
      {
        block: 'text',
        text: 'What changed: {{request.changes}}\nTime: {{request.minutes}}\nLeft this month: {{month.minutesLeft}}',
        variant: 'details',
      },
      {
        block: 'text',
        text: 'Something not right? Reply to this email and we will fix it.',
        variant: 'caption',
      },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_REQUEST_CORRECTED_EMAIL_KEY,
    name: 'Site Care: time corrected',
    description:
      'Sent to the workspace owner when staff correct the minutes on a finished request, with the before and after.',
    deliveredBy: 'resend',
    defaultSubject: 'Corrected: the time on {{request.title}}',
    mergeTokens: [
      ORG_NAME,
      REQUEST_TITLE,
      { name: 'correction.before', description: 'The time before', sample: '75 min' },
      { name: 'correction.after', description: 'The time now', sample: '45 min' },
      {
        name: 'correction.reason',
        description: 'Why it changed',
        sample: 'The timer ran while we waited for your photos.',
      },
      {
        name: 'request.billing',
        description: 'What bills now, in one sentence',
        sample: 'No extra charge: this now fits in your included hour.',
      },
      {
        name: 'month.minutesLeft',
        description: 'Included time left this month',
        sample: '15 min of this month’s included hour',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Site Care · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: 'We corrected the time on “{{request.title}}”', variant: 'heading' },
      { block: 'text', text: '{{correction.reason}} {{request.billing}}', variant: 'body' },
      {
        block: 'text',
        text: 'Before: {{correction.before}}\nNow: {{correction.after}}\nLeft this month: {{month.minutesLeft}}',
        variant: 'details',
      },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_APPROVAL_EMAIL_KEY,
    name: 'Site Care: extra time approved',
    description:
      'Sent to the workspace owner the moment staff record their yes to extra time, and again, marked corrected, when the record is corrected. It is the written record of the approval.',
    deliveredBy: 'resend',
    defaultSubject: '{{approval.heading}}: extra time for {{request.title}}',
    mergeTokens: [
      ORG_NAME,
      REQUEST_TITLE,
      {
        name: 'approval.heading',
        description: '“You approved extra time”, or “Corrected” on a correction',
        sample: 'You approved extra time',
      },
      {
        name: 'approval.sentence',
        description: 'What was approved, how and when',
        sample:
          'You approved up to 2 hours of extra time at $79 an hour for “Update our holiday hours”, by phone on Oct 19, 2026, 2:10 PM CDT.',
      },
      {
        name: 'approval.correction',
        description: 'What was corrected and why, on a correction; blank otherwise',
        sample: 'Corrected from 1 hour to 2 hours: the owner asked for the gallery too.',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Site Care · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: '{{approval.heading}}', variant: 'heading' },
      { block: 'text', text: '{{approval.sentence}} {{approval.correction}}', variant: 'body' },
      {
        block: 'text',
        text: 'Extra time is billed in whole hours, rounded up, on your next invoice, and never more than you approved without asking you again. If this is not what you agreed to, reply to this email before we start.',
        variant: 'caption',
      },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_CHARGE_REVERSED_EMAIL_KEY,
    name: 'Site Care: charge removed, credited or refunded',
    description:
      'Sent to the workspace owner when staff void, credit or refund an extra-time charge from the request.',
    deliveredBy: 'resend',
    defaultSubject: '{{charge.heading}}: {{request.title}}',
    mergeTokens: [
      ORG_NAME,
      REQUEST_TITLE,
      {
        name: 'charge.heading',
        description: '“Charge removed”, “Charge credited” or “Charge refunded”',
        sample: 'Charge removed',
      },
      {
        name: 'charge.sentence',
        description: 'What happened to the money',
        sample: 'The $79 for 1 hour of extra time will not be on your next invoice.',
      },
      {
        name: 'charge.reason',
        description: 'Why',
        sample: 'We took longer than we should have on this one.',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Site Care · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: '{{charge.heading}}', variant: 'heading' },
      { block: 'text', text: '{{charge.sentence}}', variant: 'body' },
      { block: 'text', text: 'Request: {{request.title}}\nWhy: {{charge.reason}}', variant: 'details' },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_STATEMENT_EMAIL_KEY,
    name: 'Site Care: monthly statement',
    description:
      'Sent to the workspace owner when staff press Send statement: every request of the month, the minutes, the extra time billed and every correction.',
    deliveredBy: 'resend',
    defaultSubject: 'Your Site Care statement for {{month.label}}',
    mergeTokens: [
      ORG_NAME,
      { name: 'month.label', description: 'The month', sample: 'October 2026' },
      {
        name: 'statement.summary',
        description: 'The month in one sentence',
        sample: 'October 2026: 3 requests, 1 h 35 min of work, 60 of 60 included minutes used, 1 hour of extra time billed.',
      },
      {
        name: 'statement.lines',
        description: 'One line per request',
        sample:
          'Update our holiday hours: 35 min, included\nNew staff photo: 1 h, 1 hour billed ($79), on your next invoice',
      },
      {
        name: 'statement.history',
        description: 'Everything recorded this month, one dated line each',
        sample: 'Oct 19, 2026, 3:04 PM CDT: Finished “Update our holiday hours”: 35 min.',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Site Care · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: 'Your statement for {{month.label}}', variant: 'heading' },
      { block: 'text', text: '{{statement.summary}}', variant: 'body' },
      { block: 'text', text: '{{statement.lines}}', variant: 'details' },
      { block: 'text', text: 'Everything we recorded', variant: 'subheading' },
      { block: 'text', text: '{{statement.history}}', variant: 'body' },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_QUOTE_EMAIL_KEY,
    name: 'Site Care: bigger than Site Care covers',
    description:
      'Sent from a Site Care request by staff when the work adds something new (a page, a form, a design, a campaign): Site Care covers changes to what exists, so this is a flat quote.',
    deliveredBy: 'resend',
    defaultSubject: 'A quote for {{request.title}}',
    mergeTokens: [
      ORG_NAME,
      REQUEST_TITLE,
      { name: 'quote.amount', description: 'The flat price', sample: '$249' },
      {
        name: 'quote.scope',
        description: 'What the price covers',
        sample: 'A new landing page for the holiday sale, with a sign-up form.',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Site Care · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: 'This one is bigger than Site Care covers', variant: 'heading' },
      {
        block: 'text',
        text: 'Site Care covers changes to what your site already has. “{{request.title}}” adds something new, so it is a project with one flat price, fixed once given.',
        variant: 'body',
      },
      { block: 'text', text: 'Price: {{quote.amount}}\nWhat it covers: {{quote.scope}}', variant: 'details' },
      {
        block: 'text',
        text: 'Reply to say yes and we will send the invoice to pay from your phone. Nothing is charged until you do.',
        variant: 'caption',
      },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
]
