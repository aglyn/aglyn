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
 * SITE CARE PROJECTS, AS SYSTEM EMAILS (AGL-3970).
 *
 * A flat-quoted project is billed from the staff "Charge for work", and the
 * owner hears about every step of it by email: the confirmation of the
 * quote they accepted (the written record of their yes), each invoice with
 * its pay link, each payment received, and any invoice voided, credited or
 * refunded. Each is its own key so staff can redesign one without the rest.
 * The merge tokens are what
 * `@aglyn/tenant-data-admin/server/site-care-projects` fills.
 *=========================================*/

import type {
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

export const SITE_CARE_PROJECT_ACCEPTANCE_EMAIL_KEY = 'site-care-project-acceptance'
export const SITE_CARE_PROJECT_INVOICE_EMAIL_KEY = 'site-care-project-invoice'
export const SITE_CARE_PROJECT_PAID_EMAIL_KEY = 'site-care-project-paid'
export const SITE_CARE_PROJECT_REVERSED_EMAIL_KEY = 'site-care-project-reversed'

const SOURCE = 'libs/tenant/data/admin/src/lib/server/site-care-projects.ts'

const ORG_NAME: SystemEmailMergeToken = {
  name: 'org.name',
  description: 'The workspace the project is for',
  sample: 'Test Org',
}
const PROJECT_TITLE: SystemEmailMergeToken = {
  name: 'project.title',
  description: 'The project, as staff named it',
  sample: 'Holiday sale landing page',
}
const PROJECT_SCOPE: SystemEmailMergeToken = {
  name: 'project.scope',
  description: 'What the price covers, one deliverable per line',
  sample: '- A landing page for the holiday sale\n- A sign-up form for the sale list',
}

const FOOTER = 'You’re receiving this because {{org.name}} has a project with {{brand.productName}}.'

export const SITE_CARE_PROJECT_SYSTEM_EMAIL_TEMPLATES: readonly SystemEmailTemplateDefinition[] = [
  {
    key: SITE_CARE_PROJECT_ACCEPTANCE_EMAIL_KEY,
    name: 'Site Care project: quote accepted',
    description:
      'Sent to the workspace owner the moment staff record their yes to a flat project quote, and again, marked corrected, when the record is corrected. It is the written record of the scope and price they accepted, sent before anything is invoiced.',
    deliveredBy: 'resend',
    defaultSubject: '{{acceptance.heading}}: {{project.title}}',
    mergeTokens: [
      ORG_NAME,
      PROJECT_TITLE,
      PROJECT_SCOPE,
      {
        name: 'acceptance.heading',
        description: '“You accepted our quote”, or “Corrected” on a correction',
        sample: 'You accepted our quote',
      },
      {
        name: 'acceptance.sentence',
        description: 'The price, how it is billed, and how and when the owner said yes',
        sample:
          'You accepted our quote for “Holiday sale landing page”: $249, paid in full before work starts. You said yes in person on Oct 19, 2026, 2:10 PM CDT.',
      },
      {
        name: 'acceptance.correction',
        description: 'What was corrected and why, on a correction; blank otherwise',
        sample: 'This corrects the earlier record: the owner said yes by phone, not in person.',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Project · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: '{{acceptance.heading}}', variant: 'heading' },
      { block: 'text', text: '{{acceptance.sentence}} {{acceptance.correction}}', variant: 'body' },
      { block: 'text', text: 'Project: {{project.title}}\n{{project.scope}}', variant: 'details' },
      {
        block: 'text',
        text: 'The price is fixed now that you have it: if the work takes us longer, that is ours. We send the invoice next, to pay from your phone. If this is not what you agreed to, reply to this email before you pay.',
        variant: 'caption',
      },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_PROJECT_INVOICE_EMAIL_KEY,
    name: 'Site Care project: invoice to pay',
    description:
      'Sent to the workspace owner with each project invoice — the deposit, the balance at launch, or the whole price — and its secure pay link.',
    deliveredBy: 'resend',
    defaultSubject: '{{invoice.heading}}: {{project.title}}',
    mergeTokens: [
      ORG_NAME,
      PROJECT_TITLE,
      PROJECT_SCOPE,
      {
        name: 'invoice.heading',
        description: '“Your deposit invoice”, “Your balance invoice” or “Your invoice”',
        sample: 'Your invoice',
      },
      {
        name: 'invoice.sentence',
        description: 'What this invoice is for and what is left after it',
        sample: 'This is the $249 for “Holiday sale landing page”, in full. Tax is added at checkout.',
      },
      { name: 'invoice.amount', description: 'The invoice total, tax included', sample: '$269.54' },
      { name: 'invoice.number', description: 'The invoice number', sample: 'A1B2C3D4-0001' },
      { name: 'invoice.due', description: 'When it is due', sample: 'Nov 2, 2026' },
      {
        name: 'invoice.payUrl',
        description: 'The secure page the invoice is paid on',
        sample: 'https://invoice.stripe.com/i/acct_test/test',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Project · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: '{{invoice.heading}}', variant: 'heading' },
      { block: 'text', text: '{{invoice.sentence}}', variant: 'body' },
      {
        block: 'text',
        text: 'Amount: {{invoice.amount}}\nInvoice: {{invoice.number}}\nDue: {{invoice.due}}',
        variant: 'details',
      },
      { block: 'button', label: 'Pay the invoice', href: '{{invoice.payUrl}}' },
      {
        block: 'text',
        text: 'You can pay by card on your phone or computer. Questions about it? Reply to this email.',
        variant: 'caption',
      },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_PROJECT_PAID_EMAIL_KEY,
    name: 'Site Care project: payment received',
    description:
      'Sent to the workspace owner when a project invoice is paid: what was paid, and what happens next.',
    deliveredBy: 'resend',
    defaultSubject: 'Payment received: {{project.title}}',
    mergeTokens: [
      ORG_NAME,
      PROJECT_TITLE,
      { name: 'payment.amount', description: 'What was paid, tax included', sample: '$269.54' },
      {
        name: 'payment.sentence',
        description: 'What the payment was for',
        sample: 'Thank you. We received your payment of $269.54 for “Holiday sale landing page”.',
      },
      {
        name: 'payment.next',
        description: 'What happens next',
        sample: 'The project is paid in full. We will let you know when it is live.',
      },
    ],
    defaultBody: [
      { block: 'text', text: 'Project · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: 'Payment received', variant: 'heading' },
      { block: 'text', text: '{{payment.sentence}} {{payment.next}}', variant: 'body' },
      { block: 'text', text: 'Project: {{project.title}}\nPaid: {{payment.amount}}', variant: 'details' },
      {
        block: 'text',
        text: 'Your receipt and the invoice are on Billing in your workspace.',
        variant: 'caption',
      },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
  {
    key: SITE_CARE_PROJECT_REVERSED_EMAIL_KEY,
    name: 'Site Care project: invoice voided, credited or refunded',
    description:
      'Sent to the workspace owner when staff void, credit or refund a project invoice from the project record.',
    deliveredBy: 'resend',
    defaultSubject: '{{reversal.heading}}: {{project.title}}',
    mergeTokens: [
      ORG_NAME,
      PROJECT_TITLE,
      {
        name: 'reversal.heading',
        description: '“Invoice canceled”, “Invoice credited” or “Payment refunded”',
        sample: 'Invoice canceled',
      },
      {
        name: 'reversal.sentence',
        description: 'What happened to the money',
        sample: 'We canceled the $124.50 deposit invoice for “Holiday sale landing page”. You do not owe it.',
      },
      { name: 'reversal.reason', description: 'Why', sample: 'The invoice went out with the wrong scope.' },
    ],
    defaultBody: [
      { block: 'text', text: 'Project · {{org.name}}', variant: 'eyebrow' },
      { block: 'text', text: '{{reversal.heading}}', variant: 'heading' },
      { block: 'text', text: '{{reversal.sentence}}', variant: 'body' },
      { block: 'text', text: 'Project: {{project.title}}\nWhy: {{reversal.reason}}', variant: 'details' },
    ],
    footerReason: FOOTER,
    source: SOURCE,
  },
]
