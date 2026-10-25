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
 * The email a signer receives (AGL-4042): their signed copy, as a PDF
 * attached, with what it covers and for how long. Declared here, by the
 * plugin that sends it, and compiled into the platform's tenant email
 * catalog by `tools/scripts/generate-plugin-manifests.mjs`, so the send path
 * finds the site's designed version without loading this plugin. Designed in
 * the Besigner in the site's own theme, like the store's receipts.
 */
export function waiversTenantEmails(): readonly TenantEmailEntry[] {
  return [
    {
      key: 'waiver-signed',
      name: 'Signed waiver copy',
      description: 'Sends a signer their signed waiver as a PDF, with who it covers and for how long.',
      pluginId: 'waivers',
      plugin: 'Waivers',
      control: 'besigner',
      defaultSubject: 'Your signed waiver for {{host.businessName}}',
      mergeTokens: [
        { name: 'name', description: 'The signer’s name', sample: 'Alex Rivera' },
        { name: 'waiver.title', description: 'The waiver’s title', sample: 'Rider release and waiver' },
        { name: 'waiver.signedAt', description: 'When it was signed, in the site’s time zone', sample: 'Oct 24, 2026, 9:14 AM' },
        { name: 'waiver.people', description: 'Everyone it covers: the signer and any minors', sample: 'Alex Rivera, Sam Rivera' },
        { name: 'waiver.validity', description: 'The days it covers', sample: 'Good for Oct 24, 2026' },
      ],
      defaultBody: [
        { block: 'text', text: '{{host.businessName}} · Waiver', variant: 'eyebrow' },
        { block: 'text', text: 'Your signed waiver', variant: 'heading' },
        {
          block: 'text',
          text: 'Thanks, {{name}}. You signed {{waiver.title}} for {{host.businessName}}. Your signed copy is attached to this email as a PDF.',
          variant: 'body',
        },
        {
          block: 'text',
          text: 'Signed: {{waiver.signedAt}}\nCovers: {{waiver.people}}\n{{waiver.validity}}',
          variant: 'details',
        },
        {
          block: 'text',
          text: 'You don’t need to print it: staff can find your waiver by name when you arrive. If anything on it is wrong, contact {{host.businessName}}.',
          variant: 'body',
        },
        { block: 'button', label: 'Visit {{host.businessName}}', href: '{{host.url}}' },
      ],
      footerReason: 'You’re receiving this because you signed a waiver for {{host.businessName}}.',
    },
  ]
}
