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
 * A DOMAIN BOUGHT THROUGH THE PLATFORM, AS SYSTEM EMAILS (AGL-3962).
 *
 * The domains plugin writes every one of these: the purchase, the refund
 * when a registration fails, ICANN's registrant check, the renewal notice
 * and its outcome, the expiry, the transfer code, and a transfer in from
 * another registrar finishing or failing (AGL-4040). Each is a key of its
 * own so staff can redesign one without touching the others.
 *
 * They live here, beside the catalog, because system emails have no plugin
 * seam: the staff System emails page reads this registry before any plugin
 * loads. `source` names the plugin file that sends each one.
 *
 * Prices and dates arrive formatted (`$15.99`, `Oct 19, 2027`), because the
 * sender knows the currency and the reader's locale and a template does not.
 *=========================================*/

import type {
  SystemEmailMergeToken,
  SystemEmailTemplateDefinition,
} from './system-email-catalog'

export const DOMAIN_EMAIL_KEYS = {
  purchased: 'domain-purchased',
  refunded: 'domain-refunded',
  verifyRegistrant: 'domain-verify-registrant',
  renewalNotice: 'domain-renewal-notice',
  renewed: 'domain-renewed',
  renewalFailed: 'domain-renewal-failed',
  expiring: 'domain-expiring',
  expired: 'domain-expired',
  transferCode: 'domain-transfer-code',
  transferInCompleted: 'domain-transfer-in-completed',
  transferInFailed: 'domain-transfer-in-failed',
} as const

const SOURCE = 'libs/plugins/domains/src/lib/server/domain-emails.ts'

function tokens(origin: string): Record<string, SystemEmailMergeToken> {
  return {
    domain: { name: 'domain.name', description: 'The domain name', sample: 'testbakery.com' },
    site: { name: 'site.name', description: 'The site the domain belongs to', sample: 'Test Bakery' },
    org: { name: 'org.name', description: 'The workspace', sample: 'Test Org' },
    manageUrl: {
      name: 'domain.manageUrl',
      description:
        "Where the domain is managed: its site's Custom Domain page, or the workspace's Domains page for a domain no site uses",
      sample: `${origin}/test-org/hosts/test-bakery/admin/domain`,
    },
    billingUrl: {
      name: 'billingUrl',
      description: "The workspace's Billing page",
      sample: `${origin}/test-org/billing`,
    },
    firstYear: {
      name: 'domain.firstYear',
      description: 'What the first year cost',
      sample: '$15.99',
    },
    renewalPrice: { name: 'domain.renewalPrice', description: 'The yearly renewal price', sample: '$15.99' },
    renewsOn: { name: 'domain.renewsOn', description: 'The date the domain renews', sample: 'Oct 19, 2027' },
    chargeOn: {
      name: 'domain.chargeOn',
      description: 'About when the renewal is charged',
      sample: 'Sep 19, 2027',
    },
    expiresOn: { name: 'domain.expiresOn', description: 'The date the domain expires', sample: 'Oct 19, 2027' },
    registrant: {
      name: 'domain.registrant',
      description: 'Who the domain is registered to',
      sample: 'Alex Test',
    },
    registrantEmail: {
      name: 'domain.registrantEmail',
      description: "The registrant's email, which the registrar verifies",
      sample: 'alex@testbakery.com',
    },
    verifyBy: {
      name: 'domain.verifyBy',
      description: 'The date the registrant email must be confirmed by',
      sample: 'Nov 2, 2026',
    },
    amount: { name: 'domain.amount', description: 'An amount charged', sample: '$15.99' },
    refund: {
      name: 'domain.refund',
      description: 'What was refunded, or that nothing was charged, in a sentence',
      sample:
        'We refunded $15.99 to the card it was charged to. A refund usually reaches the card within 5 to 10 business days.',
    },
    failure: {
      name: 'domain.failure',
      description: 'Why it did not happen, in a sentence',
      sample: 'Someone else registered it a moment before your order reached the registrar.',
    },
    nextAttempt: {
      name: 'domain.nextAttempt',
      description: 'When the renewal charge will be tried again',
      sample: 'Sep 22, 2027',
    },
    expiryReason: {
      name: 'domain.expiryReason',
      description: 'Why the domain will not renew, in a sentence',
      sample: 'Auto-renew is turned off for it.',
    },
    whereLine: {
      name: 'domain.whereLine',
      description:
        'Where the new domain is going, in a sentence: being connected to its site, or into the workspace with no site yet',
      sample:
        'It is being connected to Test Bakery. It usually serves within a few minutes, with its security certificate set up for you. There are no DNS records to add.',
    },
    requestedBy: {
      name: 'domain.requestedBy',
      description: 'Who asked for the transfer code',
      sample: 'alex@testbakery.com',
    },
  }
}

export function domainSystemEmailTemplates(
  origin: string,
): SystemEmailTemplateDefinition[] {
  const t = tokens(origin)
  const footer =
    'You’re receiving this because you manage {{org.name}} on ' +
    '{{brand.productName}} and it bought {{domain.name}} through it.'
  return [
    {
      key: DOMAIN_EMAIL_KEYS.purchased,
      name: 'Domain purchased',
      description:
        "Sent to a workspace's owners and admins when a domain it bought, for " +
        'one of its sites or for the workspace, is registered.',
      deliveredBy: 'resend',
      defaultSubject: '{{domain.name}} is yours',
      mergeTokens: [
        t.domain, t.site, t.org, t.firstYear, t.renewalPrice, t.renewsOn,
        t.registrant, t.registrantEmail, t.whereLine, t.manageUrl,
      ],
      defaultBody: [
        { block: 'text', text: '{{site.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{domain.name}} is yours', variant: 'heading' },
        { block: 'text', text: '{{domain.name}} is registered to you. {{domain.whereLine}}', variant: 'body' },
        { block: 'text', text: 'Domain: {{domain.name}}\nFirst year: {{domain.firstYear}}\nRenews: {{domain.renewsOn}} for {{domain.renewalPrice}} a year\nRegistered to: {{domain.registrant}}', variant: 'details' },
        { block: 'text', text: 'One thing for you to do', variant: 'subheading' },
        { block: 'text', text: 'The registrar will email {{domain.registrantEmail}} asking you to confirm the address. ICANN, which oversees domain names, requires it, and a domain whose owner never confirms can be suspended. Open that email and confirm when it arrives.', variant: 'body' },
        { block: 'button', label: 'Manage your domain', href: '{{domain.manageUrl}}' },
        { block: 'text', text: 'Auto-renew is on. You can turn it off, or move the domain to another registrar, at any time from the site’s Custom Domain page.', variant: 'caption' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.refunded,
      name: 'Domain purchase refunded',
      description:
        'Sent when a domain could not be registered after it was paid for, ' +
        'and the charge was refunded.',
      deliveredBy: 'resend',
      defaultSubject: 'We couldn’t register {{domain.name}}',
      mergeTokens: [t.domain, t.site, t.org, t.failure, t.refund, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'We couldn’t register {{domain.name}}', variant: 'heading' },
        { block: 'text', text: '{{domain.failure}}', variant: 'body' },
        { block: 'text', text: '{{domain.refund}}', variant: 'body' },
        { block: 'text', text: 'Another name may well be free. The Custom Domain page searches as you type.', variant: 'body' },
        { block: 'button', label: 'Find another domain', href: '{{domain.manageUrl}}' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.verifyRegistrant,
      name: 'Confirm the domain’s registrant email',
      description:
        "Reminds a workspace's owners that ICANN's registrant email check for " +
        'a bought domain is still outstanding.',
      deliveredBy: 'resend',
      defaultSubject: 'Confirm your email to keep {{domain.name}}',
      mergeTokens: [t.domain, t.site, t.org, t.registrantEmail, t.verifyBy, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{domain.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Confirm your email to keep {{domain.name}}', variant: 'heading' },
        { block: 'text', text: 'The registrar sent a confirmation email to {{domain.registrantEmail}}, and it has not been confirmed yet. ICANN requires every domain owner to confirm this address, and a domain that is not confirmed by {{domain.verifyBy}} can be suspended, which takes the site offline at that address.', variant: 'body' },
        { block: 'text', text: 'Look for an email about verifying your domain contact information, including in your spam folder, and follow its link. If it never arrived, contact support: {{brand.supportUrl}}', variant: 'body' },
        { block: 'button', label: 'Open the Custom Domain page', href: '{{domain.manageUrl}}' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.renewalNotice,
      name: 'Domain renewal notice',
      description:
        'Sent about 45 days before a bought domain renews, naming the price ' +
        'and the date it will be charged.',
      deliveredBy: 'resend',
      defaultSubject: '{{domain.name}} renews on {{domain.renewsOn}}',
      mergeTokens: [t.domain, t.site, t.org, t.renewalPrice, t.renewsOn, t.chargeOn, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{domain.name}} renews on {{domain.renewsOn}}', variant: 'heading' },
        { block: 'text', text: 'Auto-renew is on for {{domain.name}}, so it will renew for another year and keep {{site.name}} at the same address.', variant: 'body' },
        { block: 'text', text: 'Renewal: {{domain.renewalPrice}} for one year\nCharged: around {{domain.chargeOn}}, to the card on file\nRenews: {{domain.renewsOn}}', variant: 'details' },
        { block: 'text', text: 'You will not be charged more than this for this renewal. If you no longer want the domain, turn auto-renew off before {{domain.chargeOn}} and it will expire on {{domain.renewsOn}}.', variant: 'body' },
        { block: 'button', label: 'Manage auto-renew', href: '{{domain.manageUrl}}' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.renewed,
      name: 'Domain renewed',
      description: 'Confirms a bought domain renewed for another year.',
      deliveredBy: 'resend',
      defaultSubject: '{{domain.name}} is renewed until {{domain.expiresOn}}',
      mergeTokens: [t.domain, t.site, t.org, t.amount, t.expiresOn, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{domain.name}} is renewed', variant: 'heading' },
        { block: 'text', text: '{{domain.name}} renewed for another year, so {{site.name}} keeps its address.', variant: 'body' },
        { block: 'text', text: 'Charged: {{domain.amount}}\nRegistered until: {{domain.expiresOn}}', variant: 'details' },
        { block: 'button', label: 'Manage your domain', href: '{{domain.manageUrl}}' },
        { block: 'text', text: 'The receipt is with your other invoices on the Billing page.', variant: 'caption' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.renewalFailed,
      name: 'Domain renewal payment failed',
      description:
        'Sent when the charge for a domain renewal fails, with the next try ' +
        'and the date the domain expires.',
      deliveredBy: 'resend',
      defaultSubject: 'We couldn’t renew {{domain.name}}',
      mergeTokens: [t.domain, t.site, t.org, t.renewalPrice, t.nextAttempt, t.expiresOn, t.billingUrl, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'We couldn’t renew {{domain.name}}', variant: 'heading' },
        { block: 'text', text: 'The {{domain.renewalPrice}} renewal for {{domain.name}} could not be charged to the card on file.', variant: 'body' },
        { block: 'text', text: 'Next try: {{domain.nextAttempt}}\nExpires if not renewed: {{domain.expiresOn}}', variant: 'details' },
        { block: 'text', text: 'Update the card on the Billing page and we will try again on {{domain.nextAttempt}}, or renew it right away from the Custom Domain page. If the domain expires, {{site.name}} goes back to its free address.', variant: 'body' },
        { block: 'button', label: 'Update payment method', href: '{{billingUrl}}' },
        { block: 'text', text: 'Renew now: {{domain.manageUrl}}', variant: 'caption' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.expiring,
      name: 'Domain expiring',
      description:
        'Sent before a bought domain expires because it will not renew: ' +
        'auto-renew is off, or its renewal could not be charged.',
      deliveredBy: 'resend',
      defaultSubject: '{{domain.name}} expires on {{domain.expiresOn}}',
      mergeTokens: [t.domain, t.site, t.org, t.expiresOn, t.expiryReason, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{domain.name}} expires on {{domain.expiresOn}}', variant: 'heading' },
        { block: 'text', text: '{{domain.expiryReason}} After {{domain.expiresOn}}, {{site.name}} goes back to its free address, and the domain may become available for anyone to register.', variant: 'body' },
        { block: 'text', text: 'To keep it, turn auto-renew on or renew it now from the Custom Domain page.', variant: 'body' },
        { block: 'button', label: 'Keep {{domain.name}}', href: '{{domain.manageUrl}}' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.expired,
      name: 'Domain expired',
      description: 'Sent when a bought domain has expired.',
      deliveredBy: 'resend',
      defaultSubject: '{{domain.name}} has expired',
      mergeTokens: [t.domain, t.site, t.org, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{site.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{domain.name}} has expired', variant: 'heading' },
        { block: 'text', text: '{{domain.name}} reached the end of its registration and was not renewed. {{site.name}} is back on its free address, so it is still online.', variant: 'body' },
        { block: 'text', text: 'For a short while after it expires, a domain can usually still be renewed by its owner. The Custom Domain page shows whether yours can.', variant: 'body' },
        { block: 'button', label: 'Open the Custom Domain page', href: '{{domain.manageUrl}}' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.transferCode,
      name: 'Domain transfer code requested',
      description:
        'Tells a workspace’s owners that someone asked for the code that moves ' +
        'a bought domain to another registrar.',
      deliveredBy: 'resend',
      defaultSubject: 'A transfer code was requested for {{domain.name}}',
      mergeTokens: [t.domain, t.site, t.org, t.requestedBy, t.manageUrl],
      defaultBody: [
        { block: 'text', text: 'Security · {{domain.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'A transfer code was requested for {{domain.name}}', variant: 'heading' },
        { block: 'text', text: '{{domain.requestedBy}} asked for the code that moves {{domain.name}} to another registrar. The code was shown to them in the console.', variant: 'body' },
        { block: 'text', text: 'If that was expected, there is nothing to do. If not, tell your workspace’s owner and contact support right away: {{brand.supportUrl}}', variant: 'body' },
        { block: 'button', label: 'Open the Custom Domain page', href: '{{domain.manageUrl}}' },
      ],
      footerReason: footer,
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.transferInCompleted,
      name: 'Domain transfer in completed',
      description:
        'Sent when a domain the workspace moved here from another registrar ' +
        'has arrived, with its new expiry date.',
      deliveredBy: 'resend',
      defaultSubject: '{{domain.name}} has moved here',
      mergeTokens: [t.domain, t.org, t.amount, t.expiresOn, t.renewalPrice, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{domain.name}} has moved here', variant: 'heading' },
        { block: 'text', text: 'The transfer of {{domain.name}} is complete, and a year was added to its registration. It is now in your workspace’s domains, where it renews with your other domains.', variant: 'body' },
        { block: 'text', text: 'Charged: {{domain.amount}}\nRegistered until: {{domain.expiresOn}}\nRenews for: {{domain.renewalPrice}} a year', variant: 'details' },
        { block: 'text', text: 'Its DNS stays where it was, so anything already using the domain keeps working. To use it for a site, connect it from the Domains page.', variant: 'body' },
        { block: 'button', label: 'Open the Domains page', href: '{{domain.manageUrl}}' },
      ],
      footerReason:
        'You’re receiving this because you manage {{org.name}} on ' +
        '{{brand.productName}} and it moved {{domain.name}} here.',
      source: SOURCE,
    },
    {
      key: DOMAIN_EMAIL_KEYS.transferInFailed,
      name: 'Domain transfer in failed',
      description:
        'Sent when a domain the workspace paid to move here could not be ' +
        'transferred, and the charge was refunded.',
      deliveredBy: 'resend',
      defaultSubject: '{{domain.name}} couldn’t be moved here',
      mergeTokens: [t.domain, t.org, t.failure, t.refund, t.manageUrl],
      defaultBody: [
        { block: 'text', text: '{{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{domain.name}} couldn’t be moved here', variant: 'heading' },
        { block: 'text', text: '{{domain.failure}}', variant: 'body' },
        { block: 'text', text: '{{domain.refund}}', variant: 'body' },
        { block: 'text', text: 'The domain is still yours at your current registrar, and its website and email keep working. To try again, unlock it there, get a new transfer code, and start the transfer from the Domains page.', variant: 'body' },
        { block: 'button', label: 'Open the Domains page', href: '{{domain.manageUrl}}' },
      ],
      footerReason:
        'You’re receiving this because you manage {{org.name}} on ' +
        '{{brand.productName}} and it asked to move {{domain.name}} here.',
      source: SOURCE,
    },
  ]
}
