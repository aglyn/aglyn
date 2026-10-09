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
 *
 * ## Same design as every other system email
 *
 * Each is a catalog entry like `welcome` or `email-verification`, so it
 * renders through `renderSystemEmail`: the staff design when one is published
 * under Staff → Emails, else these blocks, inside the same header, footer,
 * palette and button. Like the rest, an email carries ONE button; anything
 * else it points at is a caption line with a bare link, the house shape of
 * the opt-out caption `notification` and the digests carry.
 *
 * ## Docs links
 *
 * Each email points at the docs page that walks through its one task. The
 * paths live in {@link RETENTION_DOCS_PATHS}, the merge values are built from
 * the deployment's docs origin by {@link retentionDocsMergeValues} at send
 * time, so the copy names a token and never a host, and a spec holds every
 * path to a real page under `apps/docs`.
 */

import type {
  SystemEmailDefaultBlock,
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

export const RETENTION_VERIFY_REMINDER_EMAIL = 'retention-verify-reminder'
export const RETENTION_BUILD_SITE_EMAIL = 'retention-build-site'
export const RETENTION_PUBLISH_REMINDER_EMAIL = 'retention-publish-reminder'
export const RETENTION_IDLE_EMAIL = 'retention-idle'
export const RETENTION_NEXT_STEPS_EMAIL = 'retention-next-steps'

/**
 * The docs pages the getting-started emails link to, by merge token: a path
 * on the docs site, with a heading anchor where the page covers more than
 * the one task. Each is a page under `apps/docs/docs` (the docs site serves
 * it at its root), which `retention-emails.spec.ts` checks.
 */
export const RETENTION_DOCS_PATHS = {
  'docs.verifyEmailUrl':
    '/workspace-and-billing/signing-in-and-sessions#verifying-your-email',
  'docs.generateSiteUrl': '/ai/generate-a-site',
  'docs.publishUrl': '/getting-started/publish-your-first-screen',
  'docs.connectDomainUrl': '/building-sites/custom-domains/connect-a-domain',
  'docs.formsUrl': '/content-and-data/forms/overview',
  'docs.generateSectionUrl': '/ai/generate-section',
  'docs.copyAssistUrl': '/ai/copy-assist',
} as const

export type RetentionDocsToken = keyof typeof RETENTION_DOCS_PATHS

/**
 * Every docs link as a merge value, on the given docs origin. The console
 * passes its own docs origin (`DOCS_BASE_URL`), so a self-hosted deployment
 * links its own docs build.
 */
export function retentionDocsMergeValues(
  docsOrigin: string,
): Record<RetentionDocsToken, string> {
  const origin = docsOrigin.trim().replace(/\/+$/, '')
  return Object.fromEntries(
    Object.entries(RETENTION_DOCS_PATHS).map(([token, path]) => [
      token,
      `${origin}${path}`,
    ]),
  ) as Record<RetentionDocsToken, string>
}

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

/**
 * The getting-started entries, built on the catalog's sample console origin.
 *
 * A function rather than a constant so that origin is the catalog's own
 * `SAMPLE_CONSOLE_ORIGIN`, one reading of `NEXT_PUBLIC_CONSOLE_URL` for every
 * preview sample, rather than a second spelled-out default here.
 */
export function retentionSystemEmailTemplates(
  SAMPLE_CONSOLE_ORIGIN: string,
  SAMPLE_DOCS_ORIGIN: string,
): readonly SystemEmailTemplateDefinition[] {
  const docsSamples = retentionDocsMergeValues(SAMPLE_DOCS_ORIGIN)
  const DOCS_TOKEN = (
    name: RetentionDocsToken,
    description: string,
  ): SystemEmailMergeToken => ({ name, description, sample: docsSamples[name] })

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

  // The house opt-out line, as `notification` and the digests word it.
  const PREFERENCES_CAPTION: SystemEmailDefaultBlock = {
    block: 'text',
    text: 'Change what you are emailed about: {{preferencesUrl}}',
    variant: 'caption',
  }

  return [
    {
      key: RETENTION_VERIFY_REMINDER_EMAIL,
      name: 'Getting started: confirm your email',
      description:
        'Sent about an hour, and again a day, after sign-up to an account ' +
        'that has not confirmed its email address. Carries a fresh link.',
      deliveredBy: 'resend',
      defaultSubject:
        'Confirm your email to open your {{brand.productName}} workspace',
      mergeTokens: [
        NAME_TOKEN,
        {
          name: 'verifyUrl',
          description: 'One-time link that confirms the address',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/verify-email?oobCode=…`,
        },
        DOCS_TOKEN(
          'docs.verifyEmailUrl',
          'Docs: verifying your email, under Signing in & sessions',
        ),
      ],
      defaultBody: [
        {
          block: 'text',
          text: 'Confirm your email to finish signing up',
          variant: 'heading',
        },
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
        {
          block: 'text',
          text: 'Link expired or not arriving? See verifying your email: {{docs.verifyEmailUrl}}',
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
      mergeTokens: [
        NAME_TOKEN,
        CTA_TOKEN,
        DOCS_TOKEN('docs.generateSiteUrl', 'Docs: generate a website from a prompt'),
        PREFERENCES_TOKEN,
      ],
      defaultBody: [
        {
          block: 'text',
          text: 'Build your website with {{brand.productName}} AI',
          variant: 'heading',
        },
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
        {
          block: 'text',
          text: 'How a site is built from your description, step by step: {{docs.generateSiteUrl}}',
          variant: 'caption',
        },
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
      mergeTokens: [
        NAME_TOKEN,
        SITE_NAME_TOKEN,
        CTA_TOKEN,
        DOCS_TOKEN('docs.publishUrl', 'Docs: publish your first page'),
        PREFERENCES_TOKEN,
      ],
      defaultBody: [
        {
          block: 'text',
          text: 'Your edits are saved, not published',
          variant: 'heading',
        },
        {
          block: 'text',
          text:
            'Hi {{name}}, you edited pages on {{site.name}}, and those ' +
            'changes are saved. Visitors will not see them until you ' +
            'publish.',
          variant: 'body',
        },
        { block: 'button', label: 'Review and publish', href: '{{ctaUrl}}' },
        {
          block: 'text',
          text: 'How previewing and publishing a page works: {{docs.publishUrl}}',
          variant: 'caption',
        },
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
      mergeTokens: [
        NAME_TOKEN,
        SITE_NAME_TOKEN,
        CTA_TOKEN,
        DOCS_TOKEN('docs.generateSectionUrl', 'Docs: generate a section on the canvas'),
        DOCS_TOKEN('docs.copyAssistUrl', 'Docs: rewrite and write copy with AI'),
        PREFERENCES_TOKEN,
      ],
      defaultBody: [
        {
          block: 'text',
          text: 'Pick up where you left off on {{site.name}}',
          variant: 'heading',
        },
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
            'Short on time? {{brand.productName}} AI can build a new section ' +
            'or rewrite the words on a page from one sentence.',
          variant: 'body',
        },
        { block: 'button', label: 'Open my site', href: '{{ctaUrl}}' },
        {
          block: 'text',
          text:
            'Build a section with AI: {{docs.generateSectionUrl}}\n' +
            'Rewrite your copy with AI: {{docs.copyAssistUrl}}',
          variant: 'caption',
        },
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
          sample: 'https://www.example.com',
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
        DOCS_TOKEN('docs.connectDomainUrl', 'Docs: connect a domain'),
        DOCS_TOKEN('docs.formsUrl', 'Docs: forms and lead capture'),
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
            '2. Add a contact form, so visitors can reach you from any ' +
            'page: {{formsUrl}}\n' +
            '3. Share the link where your customers already are.',
          variant: 'body',
        },
        { block: 'button', label: 'Connect a domain', href: '{{domainUrl}}' },
        {
          block: 'text',
          text:
            'Connect a domain, step by step: {{docs.connectDomainUrl}}\n' +
            'Add a form and read its submissions: {{docs.formsUrl}}',
          variant: 'caption',
        },
        PREFERENCES_CAPTION,
      ],
      footerReason:
        'You’re receiving this because you published a site on ' +
        '{{brand.productName}}.',
      source: 'apps/console/app/api/admin/retention-emails/route.ts',
    },
  ]
}
