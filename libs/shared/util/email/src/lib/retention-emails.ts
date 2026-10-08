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
 * THE GETTING-STARTED EMAILS (AGL-3692).
 *
 * Until these, the platform said one thing to a new account, the welcome
 * email, and then nothing, whether the person built a site, stalled on
 * verification or stopped coming back. Each email here is sent once per
 * crossing of an activation stage by the hourly retention sweep, and is in
 * the system-email catalog so staff can also send it by hand from an
 * account's staff page (AGL-3691).
 *
 * ## Which preference governs them
 *
 * The verification reminder is ACCOUNT mail: it finishes something the
 * person started, so it follows only the suppression list, like the
 * verification email itself.
 *
 * Every other email here is a product tip and belongs to the account's
 * PRODUCT EMAIL answer (`marketingConsent` on `users/{uid}`, the switch under
 * Manage account → Emails). A person who said No there, or left the product
 * updates list from a marketing email (mirrored onto the same answer,
 * AGL-3305), is never sent one. Each carries a link to that switch in its
 * body and in `List-Unsubscribe`.
 *
 * ## Copy rules
 *
 * The heading states the topic, so a reader who skipped the subject still
 * knows what the email is about (AGL-3432). Customer copy says "pages",
 * never "screens". No prices. The product is named by token, so a renamed
 * deployment reads as itself.
 */

import type {
  SystemEmailDefaultBlock,
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

const SAMPLE_CONSOLE_ORIGIN: string =
  (process.env.NEXT_PUBLIC_CONSOLE_URL || '').trim().replace(/\/+$/, '') ||
  'https://app.aglyn.com'

export const RETENTION_VERIFY_REMINDER_EMAIL = 'retention-verify-reminder'
export const RETENTION_BUILD_SITE_EMAIL = 'retention-build-site'
export const RETENTION_PUBLISH_REMINDER_EMAIL = 'retention-publish-reminder'
export const RETENTION_IDLE_EMAIL = 'retention-idle'
export const RETENTION_NEXT_STEPS_EMAIL = 'retention-next-steps'

/**
 * The retention emails that are product tips, governed by the account's
 * product email answer. The verification reminder is not one of them.
 */
export const PRODUCT_TIP_RETENTION_EMAILS: ReadonlySet<string> = new Set([
  RETENTION_BUILD_SITE_EMAIL,
  RETENTION_PUBLISH_REMINDER_EMAIL,
  RETENTION_IDLE_EMAIL,
  RETENTION_NEXT_STEPS_EMAIL,
])

const NAME_TOKEN: SystemEmailMergeToken = {
  name: 'name',
  description: "The account holder's first name, or “there”",
  sample: 'Alex',
}

const SITE_NAME_TOKEN: SystemEmailMergeToken = {
  name: 'site.name',
  description: 'The name of their site',
  sample: 'Test Site',
}

const CTA_TOKEN: SystemEmailMergeToken = {
  name: 'ctaUrl',
  description: 'Where the button opens in the console',
  sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/hosts/test-site`,
}

const PREFERENCES_TOKEN: SystemEmailMergeToken = {
  name: 'preferencesUrl',
  description: 'The product email switch in account settings',
  sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/user/emails`,
}

const PREFERENCES_CAPTION: SystemEmailDefaultBlock = {
  block: 'text',
  text: 'Rather not get tips like this? Turn off product emails: {{preferencesUrl}}',
  variant: 'caption',
}

export const RETENTION_SYSTEM_EMAIL_TEMPLATES: readonly SystemEmailTemplateDefinition[] =
  [
    {
      key: RETENTION_VERIFY_REMINDER_EMAIL,
      name: 'Getting started: confirm your email',
      description:
        'Sent about an hour, and again a day, after sign-up to an account ' +
        'that has not confirmed its email address. Carries a fresh link.',
      deliveredBy: 'resend',
      defaultSubject: 'Confirm your email to open your {{brand.productName}} workspace',
      mergeTokens: [
        NAME_TOKEN,
        {
          name: 'verifyUrl',
          description: 'One-time link that confirms the address',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/verify-email?oobCode=…`,
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Confirm your email to finish signing up', variant: 'heading' },
        {
          block: 'text',
          text:
            'Hi {{name}}, you started a {{brand.productName}} account but your ' +
            'email address is not confirmed yet. Confirm it and your ' +
            'workspace opens, ready for your website.',
          variant: 'body',
        },
        { block: 'button', label: 'Confirm my email', href: '{{verifyUrl}}' },
        {
          block: 'text',
          text:
            'The link works once and expires soon. If you did not sign up, ' +
            'ignore this email and nothing happens.',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this because this address was used to sign up ' +
        'for {{brand.productName}} and has not been confirmed.',
      source: 'apps/console/app/api/admin/retention-emails/route.ts',
    },
    {
      key: RETENTION_BUILD_SITE_EMAIL,
      name: 'Getting started: build your site',
      description:
        'Sent a day, and again three days, after sign-up to a confirmed ' +
        'account with no page of its own yet: no workspace, no site, or ' +
        'only the starter pages.',
      deliveredBy: 'resend',
      defaultSubject: 'Your website is a few minutes away',
      mergeTokens: [NAME_TOKEN, CTA_TOKEN, PREFERENCES_TOKEN],
      defaultBody: [
        { block: 'text', text: 'Build your website with {{brand.productName}} AI', variant: 'heading' },
        {
          block: 'text',
          text:
            'Hi {{name}}, your account is ready, but your site has no pages ' +
            'of your own yet. Describe your business in a sentence and ' +
            '{{brand.productName}} AI builds a full website for you, with ' +
            'pages, photos and copy you can edit. Your first AI site is ' +
            'included on the Free plan, and you can start right now.',
          variant: 'body',
        },
        {
          block: 'text',
          text: 'Prefer to start by hand? Add a page from your dashboard and pick a layout.',
          variant: 'body',
        },
        { block: 'button', label: 'Build my site', href: '{{ctaUrl}}' },
        PREFERENCES_CAPTION,
      ],
      footerReason:
        'You’re receiving this because you signed up for ' +
        '{{brand.productName}} and have not added a page yet.',
      source: 'apps/console/app/api/admin/retention-emails/route.ts',
    },
    {
      key: RETENTION_PUBLISH_REMINDER_EMAIL,
      name: 'Getting started: publish your changes',
      description:
        'Sent once to an account that edited pages a day or more ago and ' +
        'has published none of its own work.',
      deliveredBy: 'resend',
      defaultSubject: 'Your changes on {{site.name}} are not live yet',
      mergeTokens: [NAME_TOKEN, SITE_NAME_TOKEN, CTA_TOKEN, PREFERENCES_TOKEN],
      defaultBody: [
        { block: 'text', text: 'Your edits are saved, not published', variant: 'heading' },
        {
          block: 'text',
          text:
            'Hi {{name}}, you edited pages on {{site.name}}, and those ' +
            'changes are saved. Visitors will not see them until you ' +
            'publish.',
          variant: 'body',
        },
        { block: 'button', label: 'Review and publish', href: '{{ctaUrl}}' },
        PREFERENCES_CAPTION,
      ],
      footerReason:
        'You’re receiving this because you have unpublished changes on a ' +
        '{{brand.productName}} site.',
      source: 'apps/console/app/api/admin/retention-emails/route.ts',
    },
    {
      key: RETENTION_IDLE_EMAIL,
      name: 'Getting started: pick up where you left off',
      description:
        'Sent 7 days, and again 14 days, after the last sign-in of an ' +
        'account that has worked on its site. Once per quiet spell; coming ' +
        'back resets it.',
      deliveredBy: 'resend',
      defaultSubject: 'Pick up where you left off on {{site.name}}',
      mergeTokens: [NAME_TOKEN, SITE_NAME_TOKEN, CTA_TOKEN, PREFERENCES_TOKEN],
      defaultBody: [
        { block: 'text', text: 'Pick up where you left off on {{site.name}}', variant: 'heading' },
        {
          block: 'text',
          text:
            'Hi {{name}}, it has been a little while since you worked on ' +
            '{{site.name}}. Your pages are where you left them. A new ' +
            'section, a fresh photo or an updated page keeps the site ' +
            'current for the people who find it.',
          variant: 'body',
        },
        {
          block: 'text',
          text:
            'Short on time? {{brand.productName}} AI can draft a new page or ' +
            'rewrite a section from one sentence.',
          variant: 'body',
        },
        { block: 'button', label: 'Open my site', href: '{{ctaUrl}}' },
        PREFERENCES_CAPTION,
      ],
      footerReason:
        'You’re receiving this because you have a site on ' +
        '{{brand.productName}} and have not signed in for a while.',
      source: 'apps/console/app/api/admin/retention-emails/route.ts',
    },
    {
      key: RETENTION_NEXT_STEPS_EMAIL,
      name: 'Getting started: your site is live',
      description:
        'Sent once, after an account first publishes pages of its own: ' +
        'what to do next, a custom domain and a contact form.',
      deliveredBy: 'resend',
      defaultSubject: '{{site.name}} is live: what to do next',
      mergeTokens: [
        NAME_TOKEN,
        SITE_NAME_TOKEN,
        {
          name: 'siteUrl',
          description: 'The published site',
          sample: 'https://test-site.aglyn.app',
        },
        {
          name: 'domainUrl',
          description: 'The site’s domain settings in the console',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/hosts/test-site/admin/domain`,
        },
        {
          name: 'formsUrl',
          description: 'The site’s forms in the console',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/hosts/test-site/forms`,
        },
        PREFERENCES_TOKEN,
      ],
      defaultBody: [
        { block: 'text', text: '{{site.name}} is live', variant: 'heading' },
        {
          block: 'text',
          text:
            'Hi {{name}}, your pages are published and anyone with the link ' +
            'can see them: {{siteUrl}}',
          variant: 'body',
        },
        {
          block: 'text',
          text:
            'Three things that help people find and reach you:\n' +
            '1. Connect your own domain, so the address is yours.\n' +
            '2. Add a contact form, so visitors can reach you from any page.\n' +
            '3. Share the link where your customers already are.',
          variant: 'body',
        },
        { block: 'button', label: 'Connect a domain', href: '{{domainUrl}}' },
        { block: 'button', label: 'Add a form', href: '{{formsUrl}}' },
        PREFERENCES_CAPTION,
      ],
      footerReason:
        'You’re receiving this because you published a site on ' +
        '{{brand.productName}}.',
      source: 'apps/console/app/api/admin/retention-emails/route.ts',
    },
  ]
