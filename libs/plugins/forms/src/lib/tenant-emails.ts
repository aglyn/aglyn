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

/** The catalog key a form's confirmation is sent and designed under (AGL-4098). */
export const FORM_CONFIRMATION_EMAIL_KEY = 'form-confirmation'

/**
 * The emails a site sends through Forms (AGL-4098).
 *
 * Declared here, by the plugin that sends them, and compiled into the
 * platform's tenant email catalog (`TENANT_EMAILS` in
 * `@aglyn/shared-util-email`) by `tools/scripts/generate-plugin-manifests.mjs`:
 * the catalog's readers include the send path, which loads no plugin code.
 * Regenerate after changing an entry; `--check` refuses a stale catalog.
 */
export function formsTenantEmails(): readonly TenantEmailEntry[] {
  return [
    {
      // The person who sent a form, told it arrived: what they sent, what
      // happens next and how to reach the business. Sent only for a form set
      // to "Email the person a confirmation" (on by default for a request).
      // It starts the email conversation the business's answer — a quote
      // started from the request — later replies into. Every token is
      // composed per send by `utils/form-confirmation-content.ts`.
      key: FORM_CONFIRMATION_EMAIL_KEY,
      name: 'Form confirmation',
      description:
        'Sent to the person who filled in a form, when the form is set to email ' +
        'them a confirmation: what they sent, the files they attached, what ' +
        'happens next and how to reach you. Your reply, such as a quote, ' +
        'arrives in the same conversation.',
      pluginId: 'forms',
      plugin: 'Forms',
      control: 'besigner',
      defaultSubject: '{{form.subject}}',
      mergeTokens: [
        {
          name: 'form.subject',
          description:
            'The subject, which the conversation keeps: “Your quote request with” the business for a request, ' +
            'else “We got your message”',
          sample: 'Your quote request with Northwind Signs',
        },
        {
          name: 'form.name',
          description: 'What they sent, as they would call it: “Quote request”, else “Your message”',
          sample: 'Quote request',
        },
        {
          name: 'form.heading',
          description: '“We got your request” for a request, else “Thanks, we got your message”',
          sample: 'We got your request',
        },
        {
          name: 'form.intro',
          description: 'One sentence on what this email is',
          sample: 'Thanks for asking Northwind Signs for a quote. Here is a copy of what you sent.',
        },
        {
          name: 'form.answers',
          description: 'Their answers, one per line, under the form’s own labels',
          sample: 'Name: Jane Doe\nProduct: Vinyl banner — 3 × 6 ft / Matte\nDetails: Two banners for the spring fair.',
        },
        {
          name: 'form.files',
          description: 'The files they attached, by name; empty when there were none',
          sample: 'Files you sent: logo.ai, banner-sketch.pdf',
        },
        {
          name: 'form.nextStep',
          description: 'What happens next',
          sample: 'Northwind Signs will look over your request and email you a quote. Reply to this email if anything changes.',
        },
        {
          name: 'business.contact',
          description: 'How to reach the business beyond a reply: its contact email, and its phone when it lists one',
          sample: 'You can also reach Northwind Signs at hello@northwind.example or 555-0100.',
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · {{form.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{form.heading}}', variant: 'heading' },
        { block: 'text', text: '{{form.intro}}', variant: 'body' },
        { block: 'text', text: '{{form.answers}}', variant: 'details' },
        { block: 'text', text: '{{form.files}}', variant: 'caption' },
        { block: 'text', text: '{{form.nextStep}}', variant: 'body' },
        { block: 'text', text: '{{business.contact}}', variant: 'caption' },
      ],
      footerReason: 'You’re receiving this because you sent a form on the {{host.businessName}} website.',
    },
  ]
}
