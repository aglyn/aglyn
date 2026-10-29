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
 * Origins used as merge-token SAMPLE values in the staff email designer
 * (AGL-2202).
 *
 * These are never sent — they render in the template preview so an author can
 * see what `{{console.url}}` will become. That still made them wrong on a
 * self-host install: the preview showed Aglyn's console as the example for a
 * link that will resolve to the operator's, which is exactly the sort of
 * quiet mis-teaching that ends up copied into a hand-written template.
 *
 * Read from the environment rather than through `@aglyn/aglyn`'s
 * `platform-brand` / `constants`: `shared-util-email` is tagged `scope:shared`
 * and `@nx/enforce-module-boundaries` refuses the edge. Same defaults, so a
 * deployment that configures nothing sees exactly what it saw before.
 */
const SAMPLE_CONSOLE_ORIGIN: string =
  (process.env.NEXT_PUBLIC_CONSOLE_URL || '').trim().replace(/\/+$/, '') ||
  'https://app.aglyn.com'

/**
 * The docs origin the getting-started emails' docs-link samples build on
 * (AGL-3692), read the way the console's `DOCS_BASE_URL` reads it. Only a
 * preview and test-send sample: the real send fills those links from the
 * console's own docs origin.
 */
const SAMPLE_DOCS_ORIGIN: string =
  (
    process.env.NEXT_PUBLIC_DOCS_ORIGIN ||
    process.env.NEXT_PUBLIC_AGLYN_DOCS_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '') || 'https://docs.aglyn.com'

/**
 * Mirrors `PLATFORM_SUPPORT_URL`'s precedence, including the step that makes
 * the operator identity sufficient on its own: a configured support URL, else
 * the operator's support mailbox as a `mailto:`, else the console's own
 * support page.
 *
 * The last step is built from `SAMPLE_CONSOLE_ORIGIN` rather than written out
 * (AGL-3262). The support entry point is a CONSOLE route — `/support`
 * resolves the workspace from the session (AGL-3265) — so the origin it hangs
 * off is the one directly above, and an operator who set
 * `NEXT_PUBLIC_CONSOLE_URL` gets their own console in the sample instead of
 * ours. The literal it replaces was `aglyn.com/support`, which answers 404 and
 * never existed.
 */
const SAMPLE_SUPPORT_URL: string =
  (process.env.NEXT_PUBLIC_PLATFORM_SUPPORT_URL || '').trim() ||
  ((process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL || '').trim()
    ? `mailto:${(process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL || '').trim()}`
    : `${SAMPLE_CONSOLE_ORIGIN}/support`)

// Deep import, NOT the barrel (AGL-1151): `@aglyn/shared-data-enums` re-exports
// `firebase-auth`, whose `AuthErrorCodes` is a VALUE import of `firebase/auth`.
// This module is reachable from the email plugin's site half, which a PUBLISHED
// tenant page loads, so the barrel put the Firebase auth client into that
// page's chunks for one brand constant.
import { BRAND } from '@aglyn/shared-data-enums/aglyn'
import { EMAIL_NODE_ROOT_ID } from './email-render'
import { domainSystemEmailTemplates } from './domain-emails'
import { posHardwareSystemEmailTemplates } from './pos-hardware-emails'
import { posCellularSystemEmailTemplates } from './pos-cellular-emails'
import { RISK_NOTICE_SYSTEM_EMAIL_TEMPLATES } from './risk-notice-emails'
import { retentionSystemEmailTemplates } from './retention-emails'
import { SITE_CARE_SYSTEM_EMAIL_TEMPLATES } from './site-care-emails'
import { SITE_CARE_PROJECT_SYSTEM_EMAIL_TEMPLATES } from './site-care-project-emails'
import { welcomeEmailMergeValues } from './welcome-email'

/** The welcome email's next steps, as a new workspace's owner gets them. */
const WELCOME_SAMPLES = welcomeEmailMergeValues({
  orgName: 'Test Org',
  slug: 'test-org',
  consoleOrigin: SAMPLE_CONSOLE_ORIGIN,
  docsOrigin: SAMPLE_DOCS_ORIGIN,
})

/**
 * Who actually puts the message on the wire.
 *
 * `resend` — Aglyn composes and sends it, so a besigner template can change
 * what the recipient sees.
 *
 * `firebase` — Firebase Auth sends it from its own templates, configured in
 * the Firebase console. **A besigner template cannot affect these at all**
 * because the sender owns the copy (AGL-767).
 *
 * `stripe` — Stripe sends it on Aglyn's behalf from the Dashboard's
 * Customer-emails settings (billing receipts, dunning, refunds, expiring-card
 * notices). Aglyn never composes these, so like `firebase` they cannot be
 * designed here (AGL-767).
 *
 * The non-`resend` entries are listed so staff can see the full set of mail
 * the product sends and where each one is controlled; the UI must present
 * them as non-editable rather than offering an editor that silently does
 * nothing.
 */
/**
 * Who actually puts the message on the wire.
 *
 * `'firebase'` was removed by AGL-1112, once nothing was left that Firebase
 * Auth composed. Deliberately not kept "just in case": with the variant gone,
 * reintroducing a Firebase-sent email is a compile error rather than a row in
 * a table that quietly stops being editable. The staff editor is wired to
 * `'resend'`, so any other value silently produces a template that renders
 * nothing — which is exactly how the `[aglyn.io]` subject survived so long.
 */
export type SystemEmailDeliveredBy = 'resend' | 'stripe'

export interface SystemEmailMergeToken {
  /** Token as written in the template, without braces. */
  name: string
  description: string
  /** Stand-in used by the staff preview. */
  sample: string
}

/**
 * One block of a template's starting content (AGL-764). Declarative on
 * purpose: the catalog stays a dependency-free data module, and the console
 * turns these into email-plugin nodes (`emailSection` → `emailText`/
 * `emailButton`) when it seeds the first version. Mirror the copy the send
 * site uses today, with the same `{{tokens}}`, so a staffer who opens the
 * editor starts from what recipients actually get rather than a blank canvas.
 */
export type SystemEmailDefaultBlock =
  | {
      block: 'text'
      text: string
      /**
       * `eyebrow` is a small muted line above a heading; `details` draws each
       * "Label: value" line as a row of a panel (AGL-3897).
       */
      variant?: 'heading' | 'subheading' | 'body' | 'caption' | 'eyebrow' | 'details' | 'links'
    }
  | { block: 'button'; label: string; href: string }
  /**
   * Markup composed per send, carried in whole by one token (AGL-3867): a
   * layout that text blocks cannot draw, such as the weekly summary's tiles.
   * Rendered as an `emailHtml` block, so it passes the same sanitizer as any
   * author's HTML, and its colors are the email theme's, resolved by the
   * sender.
   */
  | { block: 'html'; html: string }

export interface SystemEmailTemplateDefinition {
  /** Stable storage key — the Firestore document id. Never rename. */
  key: string
  name: string
  description: string
  deliveredBy: SystemEmailDeliveredBy
  /** Subject used when no template has been published. */
  defaultSubject: string
  mergeTokens: SystemEmailMergeToken[]
  /**
   * Starting content for the first version staff design (AGL-764). Every
   * `resend` template should carry one; a `firebase` template has no editor
   * so it needs none. Absent → the editor seeds a minimal placeholder.
   */
  defaultBody?: readonly SystemEmailDefaultBlock[]
  /**
   * The footer's "why am I getting this" line (AGL-3322), drawn under the
   * built-in copy, and under any design sent without the platform's own
   * email blocks.
   *
   * Written against the merge tokens, never a product name: on a white-label
   * send `{{brand.productName}}` is the agency's, and on a renamed deployment
   * it is the operator's, so one sentence is right for every sender. Like the
   * body, it may only use tokens the email declares — a token the send does
   * not supply is blanked, and leaves a hole in the sentence. Every `resend`
   * template carries one; the others are never rendered here.
   */
  footerReason?: string
  /**
   * Where the fallback copy lives, for staff wondering what recipients get
   * today. Informational — nothing reads it at runtime.
   */
  source: string
}

/**
 * Every system email Aglyn sends.
 *
 * Deliberately **code-defined and fixed**: staff edit the system emails that
 * exist, they do not create or delete them. Adding one is a code change,
 * which is what keeps this list from drifting into advertising an email the
 * product never actually sends — the failure mode a Firestore-backed list
 * would have.
 *
 * The staff page renders from this registry, not from Firestore, so an email
 * with no template designed yet still appears (as "Using default").
 */
/**
 * Brand tokens EVERY system email resolves (AGL-2139).
 *
 * White-label used to invert precisely when staff published a template: the
 * designed template wins over each sender's branded fallback, and the copy
 * here hard-coded "Aglyn". Nor was there anything to design against — the
 * merge maps carried `org.name`, `invite.role`, `signInUrl` and friends and
 * nothing about the brand, while `blankUnresolvedTokens` DELETES any token
 * the caller did not supply, so a designer who typed `{{brand.productName}}`
 * would have shipped an email with a hole in the sentence.
 *
 * Declared once and appended to every template's own list rather than copied
 * into each: 13 hand-maintained copies is how the token list falls behind the
 * copy, and the editor renders this list as the palette a designer picks
 * from — a token missing here is a token nobody knows exists.
 *
 * The samples are the DEPLOYMENT's own values (`BRAND.ORG_NAME`, AGL-2319),
 * because that is what an unbranded org genuinely renders — on a self-host
 * install a hardcoded "Aglyn" would preview a brand that appears nowhere in
 * the mail the designer is editing.
 */
export const BRAND_MERGE_TOKENS: readonly SystemEmailMergeToken[] = [
  {
    name: 'brand.productName',
    description: "The sender's product name — the org's own on white-label",
    sample: BRAND.ORG_NAME,
  },
  {
    name: 'brand.fromName',
    description: 'Sender display name the mail is delivered under',
    sample: BRAND.ORG_NAME,
  },
  {
    name: 'brand.supportUrl',
    description: 'Where the recipient should go for help',
    sample: SAMPLE_SUPPORT_URL,
  },
]

// NOT declared: a `brand.logoUrl` token. The logo is STRUCTURAL — the
// renderer emits it as a header row above the designed body, or emits
// nothing — so a designer never places it, and a palette entry for it would
// need a sample URL that a staff test-send would render as a broken image.
// The three tokens above are the ones that belong in copy.

const BASE_SYSTEM_EMAIL_TEMPLATES: readonly SystemEmailTemplateDefinition[] =
  [
    {
      key: 'org-invite',
      name: 'Organization invite',
      description:
        'Sent when an admin invites someone to an organization from the ' +
        'Team page.',
      deliveredBy: 'resend',
      defaultSubject: "You've been invited to {{org.name}} on {{brand.productName}}",
      mergeTokens: [
        {
          name: 'org.name',
          description: 'Name of the inviting organization',
          sample: 'Test Org',
        },
        {
          name: 'invite.role',
          description: 'Role the person is invited as',
          sample: 'Editor',
        },
        {
          name: 'signInUrl',
          description: 'Console URL to sign in and join',
          sample: SAMPLE_CONSOLE_ORIGIN,
        },
      ],
      // Mirrors the fallbackText in invites/route.ts.
      defaultBody: [
        { block: 'text', text: 'Invitation · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Join {{org.name}} on {{brand.productName}}', variant: 'heading' },
        { block: 'text', text: 'You\'ve been invited to join {{org.name}} as {{invite.role}}. Sign in or create your account with this email address and you join it right away.', variant: 'body' },
        { block: 'text', text: 'Workspace: {{org.name}}\nYour role: {{invite.role}}', variant: 'details' },
        { block: 'button', label: 'Open {{org.name}}', href: '{{signInUrl}}' },
        { block: 'text', text: 'Not expecting this? You can ignore it. Nothing happens unless you sign in with this address.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because someone invited you to join ' +
        '{{org.name}} on {{brand.productName}}.',
      source: 'apps/console/app/api/orgs/invites/route.ts',
    },
    {
      key: 'org-owner-handoff',
      name: 'Workspace handoff',
      description:
        'Sent when the owner of a workspace, or the platform team, invites ' +
        'someone to take the workspace over as its new owner.',
      deliveredBy: 'resend',
      defaultSubject: '{{org.name}} is being handed to you on {{brand.productName}}',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'Name of the workspace being handed over',
          sample: 'Test Org',
        },
        {
          name: 'handoff.previousOwner',
          description:
            'What happens to the current owner once the handoff takes effect',
          sample: 'The current owner stays on as an admin.',
        },
        {
          name: 'signInUrl',
          description: 'Console URL to sign in and join',
          sample: SAMPLE_CONSOLE_ORIGIN,
        },
      ],
      // Mirrors the fallback text in invites/route.ts.
      defaultBody: [
        { block: 'text', text: 'Ownership transfer · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{org.name}} is being handed to you', variant: 'heading' },
        { block: 'text', text: 'You\'ve been invited to take over {{org.name}} as its owner. The owner holds the workspace, every site in it, and its billing. {{handoff.previousOwner}}', variant: 'body' },
        { block: 'text', text: 'Workspace: {{org.name}}\nYour role: Owner', variant: 'details' },
        { block: 'button', label: 'Open {{org.name}}', href: '{{signInUrl}}' },
        { block: 'text', text: 'Sign in or create your account with this email address and the workspace is yours. Nothing changes until you do.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because someone invited you to take over ' +
        '{{org.name}} on {{brand.productName}}.',
      source: 'apps/console/app/api/orgs/invites/route.ts',
    },
    {
      key: 'org-owner-handoff-proposal',
      name: 'Workspace handoff with a plan',
      description:
        'Sent when the platform team hands a workspace to a new owner and ' +
        'proposes its plan in the same step: the invitation, with a link to ' +
        'Billing where the plan, add-ons, cadence and coupon are already chosen.',
      deliveredBy: 'resend',
      defaultSubject: '{{org.name}} is ready for you on {{brand.productName}}',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'Name of the workspace being handed over',
          sample: 'Test Org',
        },
        {
          name: 'handoff.previousOwner',
          description:
            'What happens to the current owner once the handoff takes effect',
          sample: 'The current owner stays on as an admin.',
        },
        {
          name: 'plan.name',
          description: 'The proposed plan',
          sample: 'Starter',
        },
        {
          name: 'proposal.summary',
          description: 'The plan with the add-ons, cadence and coupon proposed with it',
          sample: 'Starter with Site Care, billed yearly, code BOOTH25',
        },
        {
          name: 'proposal.note',
          description: 'A line from the team, or nothing when none was written',
          sample: 'Great meeting you at the booth.',
        },
        {
          name: 'billingUrl',
          description:
            'Billing page with the bundle preselected; signing in with this ' +
            'address joins the workspace first',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/billing?plan=starter&interval=year&addons=siteCare`,
        },
      ],
      // Mirrors the fallback text in invites/route.ts.
      defaultBody: [
        { block: 'text', text: 'Your new website · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{org.name}} is ready for you', variant: 'heading' },
        { block: 'text', text: 'You\'ve been invited to take over {{org.name}} as its owner. The owner holds the workspace, every site in it, and its billing. {{handoff.previousOwner}}', variant: 'body' },
        { block: 'text', text: '{{proposal.note}}', variant: 'body' },
        { block: 'text', text: 'Your plan: {{proposal.summary}}', variant: 'details' },
        { block: 'button', label: 'Start the {{plan.name}} plan', href: '{{billingUrl}}' },
        { block: 'text', text: 'Sign in or create your account with this email address, and Billing opens with everything already chosen. Nothing is charged until you confirm.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because the {{brand.productName}} team invited ' +
        'you to take over {{org.name}}.',
      source: 'apps/console/app/api/orgs/invites/route.ts',
    },
    {
      key: 'org-owner-handoff-new-owner',
      name: 'Workspace handoff: you own it now',
      description:
        'Sent to the new owner the moment a workspace handoff takes effect ' +
        '(AGL-4023): the workspace is theirs, what that covers, what happened ' +
        'to the previous owner, and the next step, which is the proposed plan ' +
        'on Billing when one was proposed with the handoff.',
      deliveredBy: 'resend',
      defaultSubject: '{{org.name}} is yours on {{brand.productName}}',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'The workspace that was handed over',
          sample: 'Test Org',
        },
        {
          name: 'handoff.previousOwner',
          description: 'What happened to the previous owner, as one sentence',
          sample: 'Pat Lee stays on as an admin.',
        },
        {
          name: 'nextStep',
          description:
            'What to do now: the proposed plan when one stands, else a look ' +
            'around the workspace',
          sample:
            'Your plan is ready to start: Starter with Site Care, billed ' +
            'yearly. Billing opens with it already chosen, and nothing is ' +
            'charged until you confirm.',
        },
        {
          name: 'cta.label',
          description: 'The button, naming what it opens',
          sample: 'Start the Starter plan',
        },
        {
          name: 'cta.url',
          description: 'Billing with the plan chosen, or the workspace',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/billing?plan=starter&interval=year&addons=siteCare`,
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Workspace handoff · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{org.name}} is yours', variant: 'heading' },
        { block: 'text', text: 'You now own {{org.name}} on {{brand.productName}}: the workspace, every site in it, and its billing. {{handoff.previousOwner}}', variant: 'body' },
        { block: 'text', text: 'Workspace: {{org.name}}\nYour role: Owner', variant: 'details' },
        { block: 'text', text: '{{nextStep}}', variant: 'body' },
        { block: 'button', label: '{{cta.label}}', href: '{{cta.url}}' },
        { block: 'text', text: 'Sign in with the address this email was sent to. Questions? Contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because {{org.name}} was handed to you on ' +
        '{{brand.productName}}.',
      source: 'libs/tenant/data/admin/src/lib/server/owner-handoff-emails.ts',
    },
    {
      key: 'org-owner-handoff-previous-owner',
      name: 'Workspace handoff: done',
      description:
        'Sent to the previous owner the moment a workspace handoff takes ' +
        'effect (AGL-4023): who owns the workspace now, and whether they ' +
        'stayed on as an admin or left.',
      deliveredBy: 'resend',
      defaultSubject: '{{newOwner.name}} now owns {{org.name}}',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'The workspace that was handed over',
          sample: 'Test Org',
        },
        {
          name: 'newOwner.name',
          description: 'The new owner, by name when the account has one, else their address',
          sample: 'Jordan Lee',
        },
        {
          name: 'newOwner.email',
          description: 'The new owner’s address',
          sample: 'jordan@example.com',
        },
        {
          name: 'previousOwner.role',
          description: 'Where that leaves the previous owner',
          sample: 'Admin',
        },
        {
          name: 'previousOwner.outcome',
          description: 'What that means for them, as one sentence',
          sample:
            'You stay on as an admin, so you can keep helping with the ' +
            'workspace and its sites.',
        },
        {
          name: 'cta.label',
          description: 'The button, naming what it opens',
          sample: 'Open the team',
        },
        {
          name: 'cta.url',
          description: 'The workspace’s Team page, or the console home if they left',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/team`,
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Workspace handoff · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{org.name}} has a new owner', variant: 'heading' },
        { block: 'text', text: '{{newOwner.name}} took over {{org.name}}. They now hold the workspace, every site in it, and its billing.', variant: 'body' },
        { block: 'text', text: 'Workspace: {{org.name}}\nNew owner: {{newOwner.email}}\nYour role: {{previousOwner.role}}', variant: 'details' },
        { block: 'text', text: '{{previousOwner.outcome}}', variant: 'body' },
        { block: 'button', label: '{{cta.label}}', href: '{{cta.url}}' },
        { block: 'text', text: 'Didn’t expect this? Contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you handed {{org.name}} over on ' +
        '{{brand.productName}}.',
      source: 'libs/tenant/data/admin/src/lib/server/owner-handoff-emails.ts',
    },
    {
      key: 'org-upgrade-proposal',
      name: 'Upgrade proposal',
      description:
        "Sent to a workspace's owner when the platform team proposes a paid " +
        'plan for it, after the workspace has been evaluated.',
      deliveredBy: 'resend',
      defaultSubject: 'Your {{brand.productName}} team proposed the {{plan.name}} plan for {{org.name}}',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'Name of the workspace the plan is proposed for',
          sample: 'Test Org',
        },
        {
          name: 'plan.name',
          description: 'The proposed plan',
          sample: 'Starter',
        },
        {
          name: 'proposal.note',
          description: 'A line from the team, or nothing when none was written',
          sample: 'As we discussed on Tuesday.',
        },
        {
          name: 'proposal.summary',
          description:
            'The plan with the add-ons, cadence and coupon proposed with it, ' +
            'or nothing when only a plan was proposed',
          sample: 'Starter with Site Care, billed yearly, code BOOTH25',
        },
        {
          name: 'billingUrl',
          description: 'Billing page with the proposed plan, add-ons, cadence and coupon preselected',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/billing?plan=starter&interval=year&addons=siteCare`,
        },
      ],
      // Mirrors the fallback text in /api/admin/org-upgrade-proposal.
      defaultBody: [
        { block: 'text', text: '{{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'The {{plan.name}} plan, proposed for {{org.name}}', variant: 'heading' },
        { block: 'text', text: 'Your {{brand.productName}} team proposed moving {{org.name}} to the {{plan.name}} plan.', variant: 'body' },
        { block: 'text', text: '{{proposal.summary}}', variant: 'details' },
        { block: 'text', text: '{{proposal.note}}', variant: 'body' },
        { block: 'text', text: 'When you are ready, start the subscription from Billing. The plan is already selected there, beside the others so you can compare them first.', variant: 'body' },
        { block: 'button', label: 'Review the {{plan.name}} plan', href: '{{billingUrl}}' },
        { block: 'text', text: 'Nothing changes until you start the subscription.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you own {{org.name}} on ' +
        '{{brand.productName}} and its team proposed a plan for it.',
      source: 'apps/console/app/api/admin/org-upgrade-proposal/route.ts',
    },
    {
      key: 'client-build-preview',
      name: 'Client build preview',
      description:
        'Sent to a business owner when the platform team has built their ' +
        'website with them, at an event or on their doorstep, with the link ' +
        'to look at it and the address it will live at.',
      deliveredBy: 'resend',
      defaultSubject: 'Your new website for {{business.name}} is ready to look at',
      mergeTokens: [
        {
          name: 'business.name',
          description: 'Name of the business the website was built for',
          sample: 'Harbor Plumbing',
        },
        {
          name: 'preview.url',
          description: 'Where the website can be seen now',
          sample: 'https://harbor-plumbing.example.com',
        },
        {
          name: 'site.address',
          description: 'The address the website will live at: the domain the owner chose, or its free address',
          sample: 'www.example.com',
        },
      ],
      // Mirrors the fallback text in libs/tenant/data/admin/src/lib/server/client-build.ts.
      defaultBody: [
        { block: 'text', text: '{{business.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your new website is ready to look at', variant: 'heading' },
        { block: 'text', text: 'We built the website for {{business.name}} with you today. Open it on your phone and look around: every page, picture and word can still be changed.', variant: 'body' },
        { block: 'text', text: 'Website: {{preview.url}}\nAddress: {{site.address}}', variant: 'details' },
        { block: 'button', label: 'See your website', href: '{{preview.url}}' },
        { block: 'text', text: 'Nothing is charged until you choose a plan.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because the {{brand.productName}} team built a ' +
        'website for {{business.name}} with you and you gave us this address.',
      source: 'apps/console/app/api/admin/client-build/route.ts',
    },
    {
      key: 'usage-summary',
      name: 'Monthly usage summary',
      description:
        'Monthly per-organization usage and metered-cost summary, sent by ' +
        'the scheduled job.',
      deliveredBy: 'resend',
      defaultSubject: 'Your {{brand.productName}} usage summary for {{month.label}}',
      mergeTokens: [
        {
          name: 'month',
          description: 'Billing month as YYYY-MM',
          sample: '2026-06',
        },
        {
          name: 'month.label',
          description: 'Billing month as a reader writes it',
          sample: 'June 2026',
        },
        {
          name: 'org.name',
          description: 'Organization the summary is for',
          sample: 'Test Org',
        },
        {
          name: 'usage.summary',
          description: 'Pre-formatted usage lines',
          sample:
            'Plan: Starter\nPage views: 12,400\n' +
            'Metered usage beyond your plan: none, so nothing extra is billed for it.',
        },
        { name: 'billingUrl', description: 'The workspace Billing page', sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/billing` },
      ],
      // Mirrors the summary lines assembled in usage-email/route.ts.
      defaultBody: [
        { block: 'text', text: '{{month.label}} · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your usage for {{month.label}}', variant: 'heading' },
        { block: 'text', text: 'Here is how {{org.name}} used {{brand.productName}} in {{month.label}}: your plan, storage, page views and anything metered beyond the plan.', variant: 'body' },
        { block: 'text', text: '{{usage.summary}}', variant: 'details' },
        { block: 'text', text: 'Billing shows the full meters beside each plan limit, and the invoices for every month.', variant: 'body' },
        { block: 'button', label: 'Open billing', href: '{{billingUrl}}' },
        { block: 'text', text: 'Usage that goes over your plan is billed with the next invoice. A larger plan includes more, and you can compare them from Billing.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this monthly summary because you manage ' +
        '{{org.name}} on {{brand.productName}}.',
      source: 'apps/console/app/api/billing/usage-email/route.ts',
    },
    {
      key: 'erasure-hold-alert',
      name: 'Erasure hold staff alert',
      description:
        'Internal alert to STAFF_ALERT_EMAIL when GDPR erasure requests ' +
        'pass their 7-day hold.',
      deliveredBy: 'resend',
      defaultSubject: '{{count}} erasure request(s) past the 7-day hold',
      mergeTokens: [
        {
          name: 'count',
          description: 'How many organizations are past the hold',
          sample: '3',
        },
        {
          name: 'orgs.list',
          description: 'The organizations, one per line',
          sample: 'Test Org (org_123) — requested 2026-07-01\nNorth Bakery (org_456) — requested 2026-07-02',
        },
        { name: 'healthUrl', description: 'Staff → Health, where pending erasures can be run', sample: `${SAMPLE_CONSOLE_ORIGIN}/admin/health` },
      ],
      // Mirrors the staff-alert text in audit-archive/route.ts. It reports
      // and asks for nothing: `run-erasures` erases these orgs at 04:00 UTC,
      // an hour after this sends, and a failure raises its own alert.
      defaultBody: [
        { block: 'text', text: 'Staff · data erasure', variant: 'eyebrow' },
        { block: 'text', text: '{{count}} erasure request(s) past the hold', variant: 'heading' },
        { block: 'text', text: 'These workspaces are past their 7-day erasure hold. The nightly erasure job erases them at 04:00 UTC, five a run and oldest first, and keeps no copy, so nothing is needed from you.', variant: 'body' },
        { block: 'text', text: '{{orgs.list}}', variant: 'details' },
        { block: 'text', text: 'A workspace still listed tomorrow either failed to erase, which raises its own "could not be erased" alert, or is waiting behind a longer queue. Pending erasures on Staff → Health can run the due ones sooner.', variant: 'body' },
        { block: 'button', label: 'Open Staff → Health', href: '{{healthUrl}}' },
      ],
      footerReason:
        'You’re receiving this because this address gets ' +
        '{{brand.productName}}’s staff alerts.',
      source: 'apps/console/app/api/admin/audit-archive/route.ts',
    },
    {
      key: 'welcome',
      name: 'Welcome',
      description:
        'Sent to a new owner the first time they create an organization ' +
        '(not on every organization they later create).',
      deliveredBy: 'resend',
      defaultSubject: 'Welcome to {{brand.productName}}',
      mergeTokens: [
        {
          name: 'name',
          description: "The new owner's display name",
          sample: 'Alex',
        },
        {
          name: 'org.name',
          description: 'The organization they just created',
          sample: 'Test Org',
        },
        {
          name: 'consoleUrl',
          description: 'Console dashboard URL',
          sample: SAMPLE_CONSOLE_ORIGIN,
        },
        { name: 'welcome.intro', description: 'What is ready, and what to do first, for how the workspace started', sample: WELCOME_SAMPLES['welcome.intro'] },
        { name: 'welcome.steps', description: 'The next steps, one per line, each "Step — link"', sample: WELCOME_SAMPLES['welcome.steps'] },
      ],
      // Mirrors the fallbackText in orgs/create/route.ts.
      defaultBody: [
        { block: 'text', text: '{{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Welcome to {{brand.productName}}, {{name}}', variant: 'heading' },
        { block: 'text', text: '{{welcome.intro}}', variant: 'body' },
        { block: 'text', text: '{{welcome.steps}}', variant: 'links' },
        { block: 'button', label: 'Open {{org.name}}', href: '{{consoleUrl}}' },
        { block: 'text', text: 'Questions as you build? The guides answer most of them, and support is a click away: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you created an organization on ' +
        '{{brand.productName}}.',
      source: 'apps/console/app/api/orgs/create/route.ts',
    },
    {
      key: 'member-added',
      name: 'Added to an organization',
      description:
        `Sent when an existing ${BRAND.ORG_NAME} account is added directly ` +
        'to an organization. People who do not have an account yet get the ' +
        'organization invite email instead.',
      deliveredBy: 'resend',
      defaultSubject: "You've been added to {{org.name}}",
      mergeTokens: [
        {
          name: 'org.name',
          description: 'The organization they were added to',
          sample: 'Test Org',
        },
        {
          name: 'member.role',
          description: 'Role they were given',
          sample: 'Editor',
        },
        {
          name: 'signInUrl',
          description: 'Console URL to open the organization',
          sample: SAMPLE_CONSOLE_ORIGIN,
        },
      ],
      // Mirrors the fallbackText in orgs/members/route.ts.
      defaultBody: [
        { block: 'text', text: '{{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'You’re in {{org.name}}', variant: 'heading' },
        { block: 'text', text: 'You were added to {{org.name}} as {{member.role}}. Sign in and pick it from the workspace menu to see its sites.', variant: 'body' },
        { block: 'text', text: 'Workspace: {{org.name}}\nYour role: {{member.role}}', variant: 'details' },
        { block: 'button', label: 'Open {{org.name}}', href: '{{signInUrl}}' },
        { block: 'text', text: 'Not expecting this? Ask whoever runs {{org.name}}, or contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you were added to {{org.name}} ' +
        'on {{brand.productName}}.',
      source: 'apps/console/app/api/orgs/members/route.ts',
    },
    {
      key: 'erasure-confirmation',
      name: 'Erasure completed',
      description:
        'Sent to an organization owner once its data has been permanently ' +
        'erased under a GDPR request.',
      deliveredBy: 'resend',
      defaultSubject: 'Your {{brand.productName}} data has been erased',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'The organization that was erased',
          sample: 'Test Org',
        },
      ],
      // Mirrors the fallbackText in admin/run-erasures/route.ts.
      defaultBody: [
        { block: 'text', text: 'Data erasure · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your data has been erased', variant: 'heading' },
        { block: 'text', text: '{{org.name}} and all of its data have been permanently erased from {{brand.productName}}, as you asked. This is complete and cannot be undone.', variant: 'body' },
        { block: 'text', text: 'Workspace: {{org.name}}\nStatus: Erased', variant: 'details' },
        { block: 'text', text: 'Nothing more is needed from you. Your sign-in stays, so you can start a new workspace any time.', variant: 'body' },
        { block: 'text', text: 'Questions about the erasure? Contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you asked {{brand.productName}} ' +
        'to erase {{org.name}}’s data.',
      source: 'apps/console/app/api/admin/run-erasures/route.ts',
    },
    {
      key: 'erasure-requested',
      name: 'Erasure requested',
      description:
        'Confirms to an organization owner that a GDPR erasure request was ' +
        'recorded, and that deletion follows after a 7-day hold.',
      deliveredBy: 'resend',
      defaultSubject: 'We received your erasure request',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'The organization to be erased',
          sample: 'Test Org',
        },
        { name: 'erasure.date', description: 'The day the 7-day hold ends and erasure runs', sample: 'July 8, 2026' },
      ],
      // Mirrors the fallbackText in admin/erasure-request/route.ts.
      defaultBody: [
        { block: 'text', text: 'Data erasure · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your erasure request is recorded', variant: 'heading' },
        { block: 'text', text: 'We have recorded a request to erase {{org.name}} and all of its data from {{brand.productName}}: every site, form submission, order, file and member.', variant: 'body' },
        { block: 'text', text: 'Workspace: {{org.name}}\nErased on: {{erasure.date}}', variant: 'details' },
        { block: 'text', text: 'Erasure is permanent. It waits out a 7-day hold first, so if this was not intended, contact support before {{erasure.date}} and we will cancel it.', variant: 'body' },
        { block: 'button', label: 'Contact support', href: '{{brand.supportUrl}}' },
        { block: 'text', text: 'Want a copy of anything first? Export it from the workspace before the hold ends.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you own {{org.name}} on ' +
        '{{brand.productName}}.',
      source: 'apps/console/app/api/admin/erasure-request/route.ts',
    },
    // Admin-initiated password mail (AGL-910). Unlike the self-serve
    // `password-reset` below, Aglyn composes and sends these itself — the
    // reset LINK still comes from Firebase (generatePasswordResetLink), but
    // the message around it is ours, so both are designable.
    {
      key: 'admin-password-reset',
      name: 'Password reset (sent by an admin)',
      description:
        'Password reset link sent on someone else\'s behalf from the ' +
        'console — by staff from a user\'s detail page, or by an ' +
        'organization admin from a team member\'s page.',
      deliveredBy: 'resend',
      defaultSubject: 'Reset your {{brand.productName}} password',
      mergeTokens: [
        {
          name: 'resetUrl',
          description: 'One-time link that opens the reset form',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/reset-password?oobCode=…`,
        },
        {
          name: 'actor.name',
          description: 'Who asked for the reset',
          sample: '{{brand.productName}} support',
        },
      ],
      // Mirrors the fallbackText in _lib/password-admin.ts.
      defaultBody: [
        { block: 'text', text: 'Account security', variant: 'eyebrow' },
        { block: 'text', text: 'Reset your password', variant: 'heading' },
        { block: 'text', text: '{{actor.name}} started a password reset for your {{brand.productName}} account. Choose a new password with the button below.', variant: 'body' },
        { block: 'button', label: 'Set a new password', href: '{{resetUrl}}' },
        { block: 'text', text: 'The link works once and expires shortly. If you were not expecting this, ignore this email and your password stays as it is.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because an administrator started a ' +
        'password reset for your {{brand.productName}} account.',
      source: 'apps/console/app/api/_lib/password-admin.ts',
    },
    {
      key: 'password-changed-by-admin',
      name: 'Password changed by an admin',
      description:
        'Notice sent to the account holder after an admin sets their ' +
        'password directly. Always sent — it is how someone finds out an ' +
        'administrator changed their credentials.',
      deliveredBy: 'resend',
      defaultSubject: 'Your {{brand.productName}} password was changed',
      mergeTokens: [
        {
          name: 'actor.name',
          description: 'Who changed the password',
          sample: '{{brand.productName}} support',
        },
        {
          name: 'signInUrl',
          description: 'Where to sign in with the new password',
          sample: SAMPLE_CONSOLE_ORIGIN,
        },
      ],
      // Mirrors the fallbackText in _lib/password-admin.ts.
      defaultBody: [
        { block: 'text', text: 'Account security', variant: 'eyebrow' },
        { block: 'text', text: 'Your password was changed', variant: 'heading' },
        { block: 'text', text: '{{actor.name}} set a new password on your {{brand.productName}} account and signed you out everywhere. Sign back in with the new password.', variant: 'body' },
        { block: 'text', text: 'Changed by: {{actor.name}}', variant: 'details' },
        { block: 'button', label: 'Sign in', href: '{{signInUrl}}' },
        { block: 'text', text: 'If you did not expect this, contact whoever administers your account straight away, or support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because an administrator changed the ' +
        'password on your {{brand.productName}} account.',
      source: 'apps/console/app/api/_lib/password-admin.ts',
    },
    // Security alerts (AGL-665). Factual and actionable: what happened, from
    // where, and one button to the account-security surface. These must be
    // believed, so the send path only fires them on genuinely new devices —
    // never on every sign-in.
    {
      key: 'security-new-device',
      name: 'New device sign-in',
      description:
        'Security alert sent when an account signs in from a device it has ' +
        'not used before. Not sent on routine sign-ins from known devices.',
      deliveredBy: 'resend',
      defaultSubject: 'New sign-in to your {{brand.productName}} account',
      mergeTokens: [
        {
          name: 'device.name',
          description: 'Browser and operating system that signed in',
          sample: 'Chrome on macOS',
        },
        {
          name: 'device.location',
          description: 'Approximate location, from the request IP',
          sample: 'Denver, CO, US',
        },
        {
          name: 'device.ip',
          description: 'IP address the sign-in came from',
          sample: '203.0.113.7',
        },
        {
          name: 'device.time',
          description: 'When the sign-in happened (UTC)',
          sample: '2026-08-08 14:03 UTC',
        },
        {
          name: 'accountSecurityUrl',
          description:
            'Manage-account Security section — Recent sign-ins, where the ' +
            'device can be signed out, plus password and passkeys',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/user/security`,
        },
      ],
      // Mirrors the fallbackText in _lib/security-alerts.ts.
      defaultBody: [
        { block: 'text', text: 'Security alert', variant: 'eyebrow' },
        { block: 'text', text: 'New device sign-in', variant: 'heading' },
        { block: 'text', text: 'Your {{brand.productName}} account was just signed in to from a device it has not used before.', variant: 'body' },
        { block: 'text', text: 'Device: {{device.name}}\nLocation: {{device.location}}\nIP address: {{device.ip}}\nWhen: {{device.time}}', variant: 'details' },
        { block: 'text', text: 'If this was you, there is nothing to do. If it was not, sign this device out from Recent sign-ins and change your password right away.', variant: 'body' },
        { block: 'button', label: 'Review your devices', href: '{{accountSecurityUrl}}' },
      ],
      footerReason:
        'You’re receiving this because your {{brand.productName}} ' +
        'account signed in from a new device.',
      source: 'apps/console/app/api/_lib/security-alerts.ts',
    },
    {
      key: 'security-passkey-added',
      name: 'New passkey added',
      description:
        'Security alert sent when a passkey is registered on an account. ' +
        'The trigger ships with passkey support (AGL-662); until then no ' +
        'call site sends this.',
      deliveredBy: 'resend',
      defaultSubject: 'A passkey was added to your {{brand.productName}} account',
      mergeTokens: [
        {
          name: 'passkey.label',
          description: 'Name the passkey was saved under',
          sample: 'MacBook Touch ID',
        },
        {
          name: 'device.time',
          description: 'When the passkey was added (UTC)',
          sample: '2026-08-08 14:03 UTC',
        },
        {
          name: 'accountSecurityUrl',
          description: 'Manage-account page where credentials are reviewed',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/user`,
        },
      ],
      // Mirrors the fallbackText in _lib/security-alerts.ts.
      defaultBody: [
        { block: 'text', text: 'Security alert', variant: 'eyebrow' },
        { block: 'text', text: 'New passkey added', variant: 'heading' },
        { block: 'text', text: 'A passkey was just added to your {{brand.productName}} account. It can sign you in without your password.', variant: 'body' },
        { block: 'text', text: 'Passkey: {{passkey.label}}\nWhen: {{device.time}}', variant: 'details' },
        { block: 'text', text: 'If you added it, there is nothing to do. If you did not, remove it and change your password right away.', variant: 'body' },
        { block: 'button', label: 'Review account security', href: '{{accountSecurityUrl}}' },
      ],
      footerReason:
        'You’re receiving this because a passkey was added to your ' +
        '{{brand.productName}} account.',
      source: 'apps/console/app/api/_lib/security-alerts.ts',
    },
    // Aglyn composes and sends both of these now (AGL-1112). They were
    // Firebase's, from a template nobody could edit — the subject still
    // carried `[aglyn.io]`, a domain the company no longer uses, and the link
    // landed on `aglyn-main.firebaseapp.com`. Neither could be fixed: every
    // write under `notification.sendEmail` is refused with
    // `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`.
    //
    // Firebase still MINTS the one-time code, which is the part that has to
    // be its. Only the message around it, and the host the link points at,
    // became ours. So editing these here now does what it says.
    {
      key: 'password-reset',
      name: 'Forgot password',
      description:
        'Password reset link, sent when someone asks for one from Account ' +
        'recovery.',
      deliveredBy: 'resend',
      defaultSubject: 'Reset your {{brand.productName}} password',
      mergeTokens: [
        {
          name: 'resetUrl',
          description: 'One-time link that opens the choose-a-new-password page',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/reset-password?oobCode=\u2026`,
        },
      ],
      // Mirrors the fallbackText in the route, so the designed and undesigned
      // versions say the same thing.
      defaultBody: [
        { block: 'text', text: 'Account security', variant: 'eyebrow' },
        { block: 'text', text: 'Reset your password', variant: 'heading' },
        { block: 'text', text: 'Someone asked to reset the password for your {{brand.productName}} account. If it was you, choose a new one with the button below.', variant: 'body' },
        { block: 'button', label: 'Choose a new password', href: '{{resetUrl}}' },
        { block: 'text', text: 'The link works once and expires shortly. If this was not you, ignore this email and your password stays as it is.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because someone asked to reset the ' +
        'password on your {{brand.productName}} account.',
      source: 'apps/console/app/api/auth/send-password-reset/route.ts',
    },
    {
      key: 'email-verification',
      name: 'Confirm email',
      description:
        'Address verification link, sent after sign-up and whenever someone ' +
        'asks for another from the verify page.',
      deliveredBy: 'resend',
      defaultSubject: 'Confirm your email address',
      mergeTokens: [
        {
          name: 'verifyUrl',
          description: 'One-time link that confirms the address',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/verify-email?oobCode=\u2026`,
        },
      ],
      defaultBody: [
        { block: 'text', text: 'One last step', variant: 'eyebrow' },
        { block: 'text', text: 'Confirm your email', variant: 'heading' },
        { block: 'text', text: 'Confirm this address to finish setting up your {{brand.productName}} account. It keeps your account secure, and it is where we tell you about your sites: new form submissions, orders and bookings.', variant: 'body' },
        { block: 'button', label: 'Confirm my email', href: '{{verifyUrl}}' },
        { block: 'text', text: 'If you did not sign up for {{brand.productName}}, you can ignore this email.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because this address was used to sign ' +
        'up for {{brand.productName}}.',
      source: 'apps/console/app/api/auth/send-verification/route.ts',
    },
    // Its own entry rather than a second use of the one above, because every
    // line of that one is about signing up: "finish setting up your account",
    // "if you did not create an account", a footer saying the address was
    // used to sign up. This mail goes to an address someone is ADDING to an
    // account that already exists, and the one thing its reader needs to hear
    // is that ignoring it changes nothing.
    {
      key: 'email-address-confirmation',
      name: 'Confirm added email',
      description:
        'Confirmation link, sent when someone adds another email address to ' +
        'their account under Manage Account → Email addresses.',
      deliveredBy: 'resend',
      defaultSubject: 'Confirm your email address',
      mergeTokens: [
        {
          name: 'confirmUrl',
          description: 'One-time link that adds the address to the account',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/user?confirmEmail=…`,
        },
      ],
      // Mirrors the fallbackText in the route.
      defaultBody: [
        { block: 'text', text: 'Account security', variant: 'eyebrow' },
        { block: 'text', text: 'Confirm this email address', variant: 'heading' },
        { block: 'text', text: 'Confirm this address to add it to your {{brand.productName}} account. Once it is confirmed you can sign in with it and choose it for your email.', variant: 'body' },
        { block: 'button', label: 'Confirm email address', href: '{{confirmUrl}}' },
        { block: 'text', text: 'If you did not ask to add this address, ignore this email. Nothing has changed, and the address has not been added to any account.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because someone asked to add this address ' +
        'to a {{brand.productName}} account.',
      source: 'apps/console/app/api/account/emails/route.ts',
    },
    // AGL-3691. A message a staffer writes to one account from its staff
    // page, sent in the platform's design. The subject heads the body, so the
    // email states its topic even to a reader who skipped the subject line
    // (AGL-3432). It leaves from the platform sender with Reply-To set to the
    // staffer, so an answer reaches a person rather than `noreply@`.
    {
      key: 'staff-follow-up',
      name: 'Follow-up from the team',
      description:
        'A message a staff member writes to one account from its page in ' +
        'the staff console, sent in the platform design. Replies go to the ' +
        'staff member who sent it.',
      deliveredBy: 'resend',
      defaultSubject: '{{message.subject}}',
      mergeTokens: [
        {
          name: 'name',
          description: "The account holder's first name, or nothing",
          sample: 'Alex',
        },
        {
          name: 'message.subject',
          description: 'What the message is about, in one line',
          sample: 'Your site is ready to publish',
        },
        {
          name: 'message.body',
          description: 'The message itself, as the staff member wrote it',
          sample:
            'I saw you started a site yesterday. Reply here if anything ' +
            'got in the way and I will sort it out.',
        },
        {
          name: 'sender.name',
          description: 'The staff member who wrote it',
          sample: 'Zach',
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{message.subject}}', variant: 'heading' },
        { block: 'text', text: 'Hi {{name}},', variant: 'body' },
        { block: 'text', text: '{{message.body}}', variant: 'body' },
        { block: 'text', text: '{{sender.name}}\n{{brand.productName}}', variant: 'body' },
        { block: 'text', text: 'Reply to this email to reach {{sender.name}} directly.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you have a {{brand.productName}} ' +
        'account and our team wrote to you about it.',
      source: 'apps/console/app/api/admin/users/system-email/route.ts',
    },
    // AGL-3367. The platform's other senders, each of which composed its
    // own plain text and so went out with no header or footer. A sender whose
    // message is assembled per send (a digest's list, an alert's figures)
    // hands its composed text in as one body token: the built-in copy is that
    // text in the brand's chrome, and a design can wrap it in anything else.
    {
      key: 'notification',
      name: 'Notification',
      description:
        'The email copy of a console notification, sent to people who ' +
        'turned email on for that kind of notification: staff alerts, ' +
        'workspace-admin and site-manager notices.',
      deliveredBy: 'resend',
      defaultSubject: '{{notification.title}}',
      mergeTokens: [
        {
          name: 'notification.title',
          description: 'The notification, in one line',
          sample: 'Subscription canceled',
        },
        {
          name: 'notification.body',
          description: 'The detail under it, when it has any',
          sample: 'Test Org canceled, leaving the Advanced plan.',
        },
        {
          name: 'notification.details',
          description:
            'What the email alone carries, one line each, when there is any: ' +
            'a form submission’s answers',
          sample: 'Name: Jane Doe\nEmail: jane@example.com\nMessage: Do you deliver on Saturdays?',
        },
        {
          name: 'notification.context',
          description:
            'The site and workspace it is about, when it is about one, after what it is ' +
            'when its sender names that ("Proof approved")',
          sample: 'Copper Kettle Catering · Test Org',
        },
        {
          name: 'notification.action',
          description:
            'What the button opens: "View submission", "View order", what its sender names ' +
            '("View quote"), or "Open in" the product',
          sample: 'View submission',
        },
        {
          name: 'notification.replyNote',
          description: 'Who a reply reaches, when it reaches the person who wrote in',
          sample: 'Reply to this email to answer maria.delgado@example.com.',
        },
        {
          name: 'notification.url',
          description: 'Where the notification opens in the console',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/notifications`,
        },
        {
          name: 'settingsUrl',
          description: 'Notification settings, where email can be turned off',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/notifications/settings`,
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{notification.context}}', variant: 'eyebrow' },
        { block: 'text', text: '{{notification.title}}', variant: 'heading' },
        { block: 'text', text: '{{notification.body}}', variant: 'body' },
        { block: 'text', text: '{{notification.details}}', variant: 'details' },
        { block: 'button', label: '{{notification.action}}', href: '{{notification.url}}' },
        { block: 'text', text: '{{notification.replyNote}}', variant: 'caption' },
        {
          block: 'text',
          text: 'Change what you are emailed about: {{settingsUrl}}',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this because email is on for these ' +
        'notifications in your {{brand.productName}} settings.',
      source: 'libs/tenant/data/admin/src/lib/server/notifications.ts',
    },
    {
      key: 'staff-alert',
      name: 'Staff alert',
      description:
        'Operational alerts to STAFF_ALERT_EMAIL: free-tier AI spend, usage ' +
        'margins, SSO re-verification and the like.',
      deliveredBy: 'resend',
      defaultSubject: '{{alert.subject}}',
      mergeTokens: [
        {
          name: 'alert.subject',
          description: 'The alert, in one line',
          sample: 'Free AI spend at 80% of today’s ceiling',
        },
        {
          name: 'alert.body',
          description: 'The alert as its sender wrote it',
          sample: 'Free-tier AI spend for 2026-09-28 (UTC) is at $40.00 of the $50.00 ceiling.',
        },
        { name: 'alert.url', description: 'Where the alert is handled; the staff console when the sender names nowhere', sample: `${SAMPLE_CONSOLE_ORIGIN}/admin/lockdown` },
        { name: 'alert.urlLabel', description: 'The button’s words for that page', sample: 'Open Staff → Lockdown' },
      ],
      // The subject heads the body (AGL-3432): a reader who skips the
      // subject line still sees what the alert is about.
      defaultBody: [
        { block: 'text', text: 'Staff alert', variant: 'eyebrow' },
        { block: 'text', text: '{{alert.subject}}', variant: 'heading' },
        { block: 'text', text: '{{alert.body}}', variant: 'body' },
        { block: 'button', label: '{{alert.urlLabel}}', href: '{{alert.url}}' },
        { block: 'text', text: 'Sent to the staff alert inbox. Every alert is also on Staff → Overview.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because this address gets ' +
        '{{brand.productName}}’s staff alerts.',
      source: 'libs/tenant/data/admin/src/lib/server/staff-alert-email.ts',
    },
    {
      key: 'operator-alert',
      name: 'Operator alert',
      description:
        'Emailed to the operator for every operator alert delivered right ' +
        'away: fraud and risk, a lost dispute, a failed erasure, a degraded ' +
        'health check, a webhook failing its signature, and every other type ' +
        'listed on Staff → Operator alerts. Goes to STAFF_ALERT_EMAIL, else ' +
        'the operator support address, else every staff account.',
      deliveredBy: 'resend',
      defaultSubject: '{{alert.title}}',
      mergeTokens: [
        {
          name: 'alert.title',
          description: 'The alert, in one line',
          sample: 'Card testing on northwind.test',
        },
        {
          name: 'alert.body',
          description: 'What happened, as staff are told it',
          sample:
            '38 declined card attempts in 10 minutes on the checkout of ' +
            'northwind.test. Checkout is rate limited while this is reviewed.',
        },
        {
          name: 'alert.url',
          description: 'The item in the staff console',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/admin/abuse-reports`,
        },
        { name: 'alert.eyebrow', description: 'The alert’s level and area', sample: 'Must know · Payments & payouts' },
        { name: 'alert.details', description: 'Which alert, which workspace or site, and when, as "Label: value" lines', sample: 'Alert: Card testing\nLevel: Must know\nSite id: host_123\nRaised: 2026-09-28 14:03 UTC' },
        { name: 'settingsUrl', description: 'Staff → Operator alerts', sample: `${SAMPLE_CONSOLE_ORIGIN}/admin/operator-alerts` },
      ],
      defaultBody: [
        { block: 'text', text: '{{alert.eyebrow}}', variant: 'eyebrow' },
        { block: 'text', text: '{{alert.title}}', variant: 'heading' },
        { block: 'text', text: '{{alert.body}}', variant: 'body' },
        { block: 'text', text: '{{alert.details}}', variant: 'details' },
        { block: 'button', label: 'Review it', href: '{{alert.url}}' },
        { block: 'text', text: 'Choose which alerts email you, and which wait for the daily digest, on Staff → Operator alerts: {{settingsUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because this address gets ' +
        '{{brand.productName}}’s operator alerts.',
      source: 'libs/tenant/data/admin/src/lib/server/operator-alerts.ts',
    },
    {
      key: 'operator-alert-digest',
      name: 'Operator alert digest',
      description:
        'Once a day, every operator alert set to the digest on Staff → ' +
        'Operator alerts — new support tickets and replies, listings waiting ' +
        'for review, and any type staff moved there — in one email. Goes to ' +
        'the same inbox as the operator alert.',
      deliveredBy: 'resend',
      defaultSubject: '{{digest.title}}',
      mergeTokens: [
        {
          name: 'digest.title',
          description: 'The count and the day, in one line, “alert” or “alerts” as the count needs',
          sample: '3 operator alerts on 2026-09-28',
        },
        {
          name: 'digest.date',
          description: 'The day the digest covers, UTC',
          sample: '2026-09-28',
        },
        {
          name: 'digest.count',
          description: 'How many alerts it holds',
          sample: '3',
        },
        {
          name: 'digest.body',
          description: 'The alerts, one paragraph each',
          sample:
            '• New support ticket: Checkout button missing\n' +
            'northwind opened a ticket.\n\n' +
            '• Plugin listing waiting for review\n' +
            'Acme Forms 2.1.0 was submitted for review.',
        },
        {
          name: 'digest.url',
          description: 'The staff console',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/admin/operator-alerts`,
        },
      ],
      defaultBody: [
        { block: 'text', text: 'Daily digest · {{digest.date}}', variant: 'eyebrow' },
        { block: 'text', text: '{{digest.title}}', variant: 'heading' },
        { block: 'text', text: 'The routine alerts from the last day, batched so they arrive together. None of them needed you right away.', variant: 'body' },
        { block: 'text', text: '{{digest.body}}', variant: 'body' },
        { block: 'button', label: 'Open operator alerts', href: '{{digest.url}}' },
        { block: 'text', text: 'Choose which alerts wait for this digest on Staff → Operator alerts.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because this address gets ' +
        '{{brand.productName}}’s operator alerts.',
      source: 'libs/tenant/data/admin/src/lib/server/operator-alerts.ts',
    },
    {
      key: 'support-ticket-alert',
      name: 'Support ticket to success manager',
      description:
        'Copies an organization’s named success manager on a support ticket ' +
        'it opened or replied to.',
      deliveredBy: 'resend',
      defaultSubject: '{{ticket.heading}} — {{org.name}}: {{ticket.subject}}',
      mergeTokens: [
        {
          name: 'ticket.heading',
          description: '“New ticket” or “Ticket reply”',
          sample: 'New ticket',
        },
        {
          name: 'ticket.subject',
          description: 'The ticket’s subject',
          sample: 'Domain will not verify',
        },
        {
          name: 'ticket.body',
          description: 'Who wrote, and what they wrote',
          sample: 'Test Org opened a support ticket.\nFrom: owner@example.com',
        },
        {
          name: 'ticket.url',
          description: 'The ticket in the staff console',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/admin/support`,
        },
        {
          name: 'manager.name',
          description: 'The success manager’s name',
          sample: 'Sam',
        },
        {
          name: 'org.name',
          description: 'The organization the ticket is from',
          sample: 'Test Org',
        },
        { name: 'ticket.opening', description: 'Who opened or replied, as one sentence', sample: 'Test Org opened a support ticket.' },
        { name: 'ticket.message', description: 'What the customer wrote', sample: 'We added the TXT record yesterday and the domain still says pending.' },
        { name: 'ticket.details', description: 'The workspace, sender, subject and ticket id as "Label: value" lines', sample: 'Workspace: Test Org\nFrom: owner@example.com\nSubject: Domain will not verify\nTicket id: tkt_123' },
      ],
      defaultBody: [
        { block: 'text', text: '{{ticket.heading}} · {{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{ticket.subject}}', variant: 'heading' },
        { block: 'text', text: '{{manager.name}}, {{ticket.opening}} You are its success manager, so it is copied to you.', variant: 'body' },
        { block: 'text', text: '{{ticket.details}}', variant: 'details' },
        { block: 'text', text: '{{ticket.message}}', variant: 'body' },
        { block: 'button', label: 'Open the ticket', href: '{{ticket.url}}' },
        { block: 'text', text: 'Answer from Staff → Support so the reply is threaded on the ticket and the customer sees it in their console.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you are the success manager for ' +
        '{{org.name}} on {{brand.productName}}.',
      source: 'apps/console/app/api/_lib/success-manager.ts',
    },
    {
      key: 'workspace-notice',
      name: 'Workspace notice',
      description:
        'Operational notices to a workspace’s people: usage alerts and SSO ' +
        'domain lapses to its owners and admins, and a stopped outreach ' +
        'mailbox to the member who connected it.',
      deliveredBy: 'resend',
      defaultSubject: '{{notice.subject}}',
      mergeTokens: [
        {
          name: 'notice.subject',
          description: 'The notice, in one line',
          sample: 'Sequences paused your mailbox avery@example.com',
        },
        {
          name: 'notice.body',
          description: 'The notice as its sender wrote it',
          sample: 'Sequences paused the mailbox Avery Quinn <avery@example.com>.\n\nSequences paused it after 3 bounces in a row.',
        },
        {
          name: 'org.name',
          description: 'The workspace the notice is about',
          sample: 'Test Org',
        },
        { name: 'notice.lead', description: 'What happened and what to do, without the link', sample: 'Sequences paused avery@example.com after 3 bounces in a row. 4 enrollments are active on it and waiting. Re-check the addresses, then open Mailboxes and select Resume.' },
        { name: 'notice.details', description: 'The facts, as "Label: value" lines', sample: 'Mailbox: avery@example.com\nStatus: Paused by Sequences\nEnrollments waiting: 4' },
        { name: 'notice.url', description: 'Where the reader acts on it', sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/outreach/mailboxes` },
        { name: 'notice.action', description: 'The button’s words', sample: 'Open Mailboxes to resume' },
        { name: 'notice.reason', description: 'Why this reader is getting it', sample: 'You are getting this because the mailbox is yours, or you manage the organization it belongs to.' },
      ],
      // The subject heads the body (AGL-3432): a reader who skips the
      // subject line still sees what the notice is about.
      defaultBody: [
        { block: 'text', text: '{{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: '{{notice.subject}}', variant: 'heading' },
        { block: 'text', text: '{{notice.lead}}', variant: 'body' },
        { block: 'text', text: '{{notice.details}}', variant: 'details' },
        { block: 'button', label: '{{notice.action}}', href: '{{notice.url}}' },
        { block: 'text', text: '{{notice.reason}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you’re a member of {{org.name}} on ' +
        '{{brand.productName}}.',
      source: 'libs/tenant/data/admin/src/lib/server/org-member-notice.ts',
    },
    {
      key: 'member-email-alias-confirmation',
      name: 'Member email address confirmation',
      description:
        'Sent to an address a workspace member asked to add as one of their ' +
        'own, so mail from it is filed under the people it was written to.',
      deliveredBy: 'resend',
      defaultSubject: 'Confirm your address for {{org.name}}',
      mergeTokens: [
        {
          name: 'member.name',
          description: 'The member who asked',
          sample: 'Alex',
        },
        {
          name: 'address',
          description: 'The address being confirmed',
          sample: 'alex@example.com',
        },
        {
          name: 'org.name',
          description: 'The workspace',
          sample: 'Test Org',
        },
        {
          name: 'confirmUrl',
          description: 'The one-time confirmation link',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/account`,
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{org.name}}', variant: 'eyebrow' },
        { block: 'text', text: 'Confirm this address', variant: 'heading' },
        { block: 'text', text: '{{member.name}} asked to add {{address}} as one of their own email addresses in {{org.name}}. Open the link while signed in as that member to confirm it.', variant: 'body' },
        { block: 'text', text: 'Address: {{address}}\nWorkspace: {{org.name}}\nFor: {{member.name}}', variant: 'details' },
        { block: 'button', label: 'Confirm the address', href: '{{confirmUrl}}' },
        { block: 'text', text: 'Once confirmed, email sent from {{address}} with the workspace’s capture address in BCC is filed under the person it was written to. The link works for 24 hours. If you did not expect this, ignore it.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because a member of {{org.name}} on ' +
        '{{brand.productName}} asked to add this address to their account.',
      source: 'libs/tenant/data/admin/src/lib/server/member-email-aliases.ts',
    },
    {
      key: 'domain-ownership-code',
      name: 'Website ownership code',
      description:
        'Sent to an address at a website’s own domain when a workspace ' +
        'proves it owns that website before bringing it into the product. ' +
        'Carries a six-digit code that works for 15 minutes.',
      deliveredBy: 'resend',
      defaultSubject: 'Your code to verify {{domain}}',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'The workspace that asked',
          sample: 'Test Org',
        },
        {
          name: 'domain',
          description: 'The website’s domain',
          sample: 'example.com',
        },
        {
          name: 'code',
          description: 'The one-time code',
          sample: '123456',
        },
        {
          name: 'expiresInMinutes',
          description: 'How many minutes the code works',
          sample: '15',
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{domain}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your verification code', variant: 'heading' },
        { block: 'text', text: '{{org.name}} asked to confirm that {{domain}} belongs to them, so they can bring the site into {{brand.productName}}. Type this code where you asked for it.', variant: 'body' },
        { block: 'text', text: 'Code: {{code}}\nWebsite: {{domain}}\nWorks for: {{expiresInMinutes}} minutes', variant: 'details' },
        { block: 'text', text: 'If you did not ask for this, ignore this email. Nothing is copied from your site without the code.', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because someone in {{org.name}} on ' +
        '{{brand.productName}} asked to verify a website at this address’s domain.',
      source: 'libs/tenant/data/admin/src/lib/server/domain-ownership.ts',
    },
    {
      key: 'crm-daily-digest',
      name: 'Daily CRM digest',
      description:
        'Each morning, a member’s overdue and due-today tasks and unworked ' +
        'leads, for members who turned the digest on.',
      deliveredBy: 'resend',
      defaultSubject: '{{digest.subject}}',
      mergeTokens: [
        {
          name: 'digest.subject',
          description: 'The summary line',
          sample: '2 tasks overdue, 3 new leads',
        },
        {
          name: 'digest.body',
          description: 'The tasks and leads, one per line, with their links',
          sample: 'Overdue (2)\n- Call back Jordan · Sep 27, 9:00 AM',
        },
        {
          name: 'settingsUrl',
          description: 'Notification settings, where the digest is turned off',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/notifications/settings`,
        },
        { name: 'digest.eyebrow', description: 'The workspace and the day', sample: 'Test Org · Friday, September 28' },
        { name: 'digest.summary', description: 'What is owed today, in one line', sample: '1 task due today, 2 overdue, 3 unworked leads.' },
        { name: 'digest.overdueHeading', description: 'The overdue list’s heading, empty when there is none', sample: 'Overdue (2)' },
        { name: 'digest.overdue', description: 'Overdue tasks, one "Title — when" per line', sample: 'Call back Jordan — Main site · Thu, Sep 27, 9:00 AM CDT\nSend the proposal — Fri, Sep 28, 8:00 AM CDT' },
        { name: 'digest.todayHeading', description: 'The due-today list’s heading', sample: 'Due today (1)' },
        { name: 'digest.today', description: 'Tasks due today, one per line', sample: 'Follow up with Priya — Main site · Fri, Sep 28, 3:00 PM CDT' },
        { name: 'digest.leadsHeading', description: 'The unworked leads list’s heading', sample: 'Unworked leads (3)' },
        { name: 'digest.leads', description: 'Unworked leads, one "Name — site · first seen" per line', sample: 'Jane Doe — Main site · first seen Sep 26\nsam@example.com — Main site · first seen Sep 27' },
        { name: 'digest.nurturing', description: 'The leads in sequences or campaigns, or empty', sample: '2 leads are in sequences or campaigns.' },
        { name: 'digest.url', description: 'Where the reader starts: the Tasks section, else the leads', sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/crm/tasks` },
        { name: 'digest.action', description: 'The button’s words', sample: 'Open your tasks' },
        { name: 'digest.links', description: 'Each site’s leads, one "Leads on Site — URL" per line', sample: `Leads on Main site — ${SAMPLE_CONSOLE_ORIGIN}/test-org/crm/leads` },
      ],
      defaultBody: [
        { block: 'text', text: '{{digest.eyebrow}}', variant: 'eyebrow' },
        { block: 'text', text: 'Your day in the CRM', variant: 'heading' },
        { block: 'text', text: '{{digest.summary}}', variant: 'body' },
        { block: 'text', text: '{{digest.overdueHeading}}', variant: 'subheading' },
        { block: 'text', text: '{{digest.overdue}}', variant: 'details' },
        { block: 'text', text: '{{digest.todayHeading}}', variant: 'subheading' },
        { block: 'text', text: '{{digest.today}}', variant: 'details' },
        { block: 'text', text: '{{digest.leadsHeading}}', variant: 'subheading' },
        { block: 'text', text: '{{digest.leads}}', variant: 'details' },
        { block: 'text', text: '{{digest.nurturing}}', variant: 'caption' },
        { block: 'button', label: '{{digest.action}}', href: '{{digest.url}}' },
        { block: 'text', text: '{{digest.links}}', variant: 'links' },
        { block: 'text', text: 'Turn the digest off, or change what you are emailed about: {{settingsUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this each morning because the Daily CRM digest is ' +
        'on in your {{brand.productName}} notification settings.',
      source: 'libs/plugins/crm/src/lib/server/daily-digest-route.ts',
    },
    {
      key: 'crm-task-reminder',
      name: 'CRM task reminder',
      description: 'A reminder for CRM tasks that have come due.',
      deliveredBy: 'resend',
      defaultSubject: '{{reminder.subject}}',
      mergeTokens: [
        {
          name: 'reminder.subject',
          description: 'The task, or how many are due',
          sample: 'Reminder: Call back Jordan',
        },
        {
          name: 'reminder.body',
          description: 'The tasks, each with its link',
          sample: '- Call back Jordan · due today at 9:00 AM',
        },
        {
          name: 'settingsUrl',
          description: 'Notification settings, where reminders are turned off',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/notifications/settings`,
        },
        { name: 'reminder.eyebrow', description: 'The workspace the task is in', sample: 'Test Org' },
        { name: 'reminder.intro', description: 'What this is, in one sentence', sample: 'A reminder about your task. Open it to see the contact or deal it is for.' },
        { name: 'reminder.details', description: 'Each task as "Title — due …"', sample: 'Call back Jordan — due today at 9:00 AM CDT' },
        { name: 'reminder.url', description: 'The task, or the first one when there are several', sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/crm/tasks#t-1` },
        { name: 'reminder.action', description: 'The button’s words', sample: 'Open the task' },
        { name: 'reminder.links', description: 'For several tasks, each one’s link as "Title — URL"; empty for one', sample: `Call back Jordan — ${SAMPLE_CONSOLE_ORIGIN}/test-org/crm/tasks#t-1\nSend the proposal — ${SAMPLE_CONSOLE_ORIGIN}/test-org/crm/tasks#t-2` },
      ],
      defaultBody: [
        { block: 'text', text: '{{reminder.eyebrow}}', variant: 'eyebrow' },
        { block: 'text', text: '{{reminder.subject}}', variant: 'heading' },
        { block: 'text', text: '{{reminder.intro}}', variant: 'body' },
        { block: 'text', text: '{{reminder.details}}', variant: 'details' },
        { block: 'button', label: '{{reminder.action}}', href: '{{reminder.url}}' },
        { block: 'text', text: '{{reminder.links}}', variant: 'links' },
        { block: 'text', text: 'Change what you are emailed about: {{settingsUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because task reminders are on in your ' +
        '{{brand.productName}} notification settings.',
      source: 'libs/plugins/crm/src/lib/server/task-reminders-route.ts',
    },
    {
      key: 'ai-insights-digest',
      name: 'Weekly insights digest',
      description:
        'The week’s AI insights for a site, for members who turned the ' +
        'digest on for that workspace.',
      deliveredBy: 'resend',
      defaultSubject: 'Your weekly insights for {{site.name}}',
      mergeTokens: [
        {
          name: 'site.name',
          description: 'The site the insights are about',
          sample: 'Test Site',
        },
        {
          name: 'digest.body',
          description: 'The insights, numbered, with their links',
          sample: '1. Visits from search rose 18% on last week.',
        },
        { name: 'digest.eyebrow', description: 'The workspace and the week', sample: 'Test Org · Oct 5 – Oct 11' },
        { name: 'digest.intro', description: 'What the insights are, in one sentence', sample: 'What Test Site\'s figures showed last week. Each one is traced to the figures it cites, so you can check it on the Analytics page.' },
        { name: 'digest.insights', description: 'The insights, numbered', sample: '1. Visits from search rose 18% on last week.\n\n2. The pricing page was the most viewed page, with 312 views.' },
        { name: 'digest.analyticsUrl', description: 'The site’s Analytics page', sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/hosts/test-site/analytics` },
        { name: 'digest.why', description: 'Why it came, what it cost and how to turn it off', sample: `You asked for weekly insights for Test Org. Writing these used 21 of Test Org’s AI credits. Turn them off in Notifications: ${SAMPLE_CONSOLE_ORIGIN}/manage/notifications` },
      ],
      defaultBody: [
        { block: 'text', text: '{{digest.eyebrow}}', variant: 'eyebrow' },
        { block: 'text', text: 'Weekly insights for {{site.name}}', variant: 'heading' },
        { block: 'text', text: '{{digest.intro}}', variant: 'body' },
        { block: 'text', text: '{{digest.insights}}', variant: 'body' },
        { block: 'button', label: 'Open {{site.name}} analytics', href: '{{digest.analyticsUrl}}' },
        { block: 'text', text: '{{digest.why}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you turned on weekly insights in ' +
        '{{brand.productName}}.',
      source: 'libs/plugins/ai/src/lib/insights/ai-insight-digest.ts',
    },
    {
      key: 'weekly-summary',
      name: 'Weekly summary · workspace',
      description:
        'Each Monday, how a workspace did the week before: its totals across ' +
        'sites, a line for each site, and its deals. For its owners and ' +
        'admins. Free: nothing is generated.',
      deliveredBy: 'resend',
      defaultSubject: '{{summary.subject}}',
      mergeTokens: [
        {
          name: 'summary.subject',
          description: 'The subject line, leading with the week’s figures',
          sample: 'Your week at Test Org: 1,204 visitors, 9 new leads, 6 bookings',
        },
        {
          name: 'summary.title',
          description: 'The heading',
          sample: 'Test Org last week',
        },
        {
          name: 'summary.period',
          description: 'The week the figures cover',
          sample: 'Oct 5 – Oct 11, compared with the week before',
        },
        {
          name: 'summary.html',
          description: 'The figures, drawn as tiles and ranked lists in the email’s theme',
          sample: '<div style="padding:16px 0 8px;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Traffic</div></div>',
        },
        {
          name: 'summary.buttonLabel',
          description: 'The button’s words',
          sample: 'Open Test Org',
        },
        {
          name: 'summary.url',
          description: 'Where the button goes',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org`,
        },
        {
          name: 'org.name',
          description: 'The workspace the summary is for',
          sample: 'Test Org',
        },
        {
          name: 'settingsUrl',
          description: 'Notification settings, where the summary is turned off',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/notifications/settings`,
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{summary.title}}', variant: 'heading' },
        { block: 'text', text: '{{summary.period}}', variant: 'caption' },
        { block: 'html', html: '{{summary.html}}' },
        { block: 'button', label: '{{summary.buttonLabel}}', href: '{{summary.url}}' },
        {
          block: 'text',
          text: 'Change what you are emailed about: {{settingsUrl}}',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this each Monday because you manage {{org.name}} and ' +
        'the Weekly summary is on in your {{brand.productName}} notification settings.',
      source: 'libs/tenant/data/admin/src/lib/server/weekly-summary.ts',
    },
    {
      key: 'weekly-summary-site',
      name: 'Weekly summary · site',
      description:
        'Each Monday, how one site did the week before — visitors, top pages, ' +
        'sources, forms, new leads, bookings, sales, campaigns and more — for ' +
        'the workspace’s owners and admins and the site’s own admins. Free: ' +
        'nothing is generated.',
      deliveredBy: 'resend',
      defaultSubject: '{{summary.subject}}',
      mergeTokens: [
        {
          name: 'summary.subject',
          description: 'The subject line, leading with the week’s figures',
          sample: 'Test Site last week: 1,204 visitors, 9 new leads',
        },
        {
          name: 'summary.title',
          description: 'The heading',
          sample: 'Test Site last week',
        },
        {
          name: 'summary.period',
          description: 'The week the figures cover',
          sample: 'Oct 5 – Oct 11, compared with the week before',
        },
        {
          name: 'summary.html',
          description: 'The figures, drawn as tiles and ranked lists in the email’s theme',
          sample: '<div style="padding:16px 0 8px;"><div style="font-family:Helvetica, Arial, sans-serif;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Traffic</div></div>',
        },
        {
          name: 'summary.buttonLabel',
          description: 'The button’s words',
          sample: 'Open Test Site',
        },
        {
          name: 'summary.url',
          description: 'Where the button goes',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/hosts/test-site`,
        },
        {
          name: 'org.name',
          description: 'The workspace the summary is for',
          sample: 'Test Org',
        },
        {
          name: 'settingsUrl',
          description: 'Notification settings, where the summary is turned off',
          sample: `${SAMPLE_CONSOLE_ORIGIN}/manage/notifications/settings`,
        },
      ],
      defaultBody: [
        { block: 'text', text: '{{summary.title}}', variant: 'heading' },
        { block: 'text', text: '{{summary.period}}', variant: 'caption' },
        { block: 'html', html: '{{summary.html}}' },
        { block: 'button', label: '{{summary.buttonLabel}}', href: '{{summary.url}}' },
        {
          block: 'text',
          text: 'Change what you are emailed about: {{settingsUrl}}',
          variant: 'caption',
        },
      ],
      footerReason:
        'You’re receiving this each Monday because you manage {{org.name}} and ' +
        'the Weekly summary is on in your {{brand.productName}} notification settings.',
      source: 'libs/tenant/data/admin/src/lib/server/weekly-summary.ts',
    },
    {
      key: 'legal-intake-receipt',
      name: 'Report and notice receipt',
      description:
        'The receipt for an abuse report, a copyright notice or a ' +
        'counter-notice, carrying its reference.',
      deliveredBy: 'resend',
      defaultSubject: '{{receipt.subject}}',
      mergeTokens: [
        {
          name: 'receipt.subject',
          description: 'What was received, and its reference',
          sample: 'Report received — AR-3F9K2',
        },
        {
          name: 'receipt.body',
          description: 'The receipt as the intake wrote it',
          sample: 'We have received your report about https://example.com.\n\nYour reference is AR-3F9K2.',
        },
        { name: 'receipt.eyebrow', description: 'The reference', sample: 'Receipt · AR-3F9K2' },
        { name: 'receipt.heading', description: 'What was received', sample: 'We received your report' },
        { name: 'receipt.intro', description: 'What it was about', sample: 'We have received your report about https://example.com.' },
        { name: 'receipt.details', description: 'Reference, address and time, as "Label: value" lines', sample: 'Reference: AR-3F9K2\nAbout: https://example.com\nReceived: 2026-09-28 14:03 UTC' },
        { name: 'receipt.next', description: 'What happens next', sample: 'We do not publish what we decide about individual sites, and we will not share your details with the site\'s owner unless the law requires it.' },
        { name: 'receipt.keep', description: 'Keep this email, and the sign-off', sample: 'Keep this email. It is your record that we received the message above, and the reference is how we will find it if you write to us about it.' },
      ],
      defaultBody: [
        { block: 'text', text: '{{receipt.eyebrow}}', variant: 'eyebrow' },
        { block: 'text', text: '{{receipt.heading}}', variant: 'heading' },
        { block: 'text', text: '{{receipt.intro}}', variant: 'body' },
        { block: 'text', text: '{{receipt.details}}', variant: 'details' },
        { block: 'text', text: 'What happens next', variant: 'subheading' },
        { block: 'text', text: '{{receipt.next}}', variant: 'body' },
        { block: 'text', text: '{{receipt.keep}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because this address was given on a report ' +
        'or notice sent to {{brand.productName}}.',
      source: 'apps/tenant/app/api/_legal-intake/acknowledge.ts',
    },
    {
      key: 'plugin-review-update',
      name: 'Plugin review update',
      description:
        'Tells a marketplace publisher’s owners and admins what review ' +
        'decided about their submission.',
      deliveredBy: 'resend',
      defaultSubject: '{{review.subject}}',
      mergeTokens: [
        {
          name: 'review.subject',
          description: 'The decision, in one line',
          sample: 'Your plugin was approved',
        },
        {
          name: 'review.body',
          description: 'The decision as review wrote it',
          sample: 'Test Plugin 1.2.0 passed review and is live in the marketplace.',
        },
        { name: 'review.details', description: 'Plugin, version and outcome as "Label: value" lines', sample: 'Plugin: Test Plugin\nVersion: 1.2.0\nOutcome: Approved' },
        { name: 'review.url', description: 'The publisher’s Marketplace page', sample: `${SAMPLE_CONSOLE_ORIGIN}/test-org/marketplace` },
      ],
      defaultBody: [
        { block: 'text', text: 'Marketplace review', variant: 'eyebrow' },
        { block: 'text', text: '{{review.subject}}', variant: 'heading' },
        { block: 'text', text: '{{review.body}}', variant: 'body' },
        { block: 'text', text: '{{review.details}}', variant: 'details' },
        { block: 'button', label: 'Open your marketplace listings', href: '{{review.url}}' },
        { block: 'text', text: 'Questions about a review? Contact support: {{brand.supportUrl}}', variant: 'caption' },
      ],
      footerReason:
        'You’re receiving this because you manage a plugin published on ' +
        '{{brand.productName}}.',
      source: 'libs/plugins/marketplace/src/lib/server/publisher-review-email.ts',
    },
    // Stripe-delivered billing email (AGL-767). Aglyn never composes these —
    // Stripe sends them from the Dashboard's Customer-emails and Subscription
    // settings, so they are listed for visibility only and are not designable.
    // Whether each actually sends is a Dashboard toggle the code cannot read;
    // the descriptions say "if enabled" rather than asserting it is on.
    {
      key: 'stripe-receipt',
      name: 'Payment receipt',
      description:
        'Receipt for a successful subscription or invoice payment. Sent by ' +
        'Stripe if "Successful payments" is enabled under Customer emails.',
      deliveredBy: 'stripe',
      defaultSubject: `Your receipt from ${BRAND.ORG_NAME}`,
      mergeTokens: [],
      source: 'Stripe Dashboard → Settings → Customer emails',
    },
    {
      key: 'stripe-payment-failed',
      name: 'Payment failed',
      description:
        'Dunning notice when a subscription charge fails and Stripe retries ' +
        'it. Sent by Stripe if failed-payment emails are enabled under ' +
        'Subscriptions and emails.',
      deliveredBy: 'stripe',
      defaultSubject: `Your ${BRAND.ORG_NAME} payment could not be processed`,
      mergeTokens: [],
      source: 'Stripe Dashboard → Settings → Subscriptions and emails',
    },
    {
      key: 'stripe-refund',
      name: 'Refund confirmation',
      description:
        'Confirms a refund back to the customer. Sent by Stripe if ' +
        '"Refunds" is enabled under Customer emails.',
      deliveredBy: 'stripe',
      defaultSubject: `Your ${BRAND.ORG_NAME} refund`,
      mergeTokens: [],
      source: 'Stripe Dashboard → Settings → Customer emails',
    },
    {
      key: 'stripe-card-expiring',
      name: 'Card expiring soon',
      description:
        'Reminder that the card on file is about to expire. Sent by Stripe ' +
        'if expiring-card reminders are enabled under Subscriptions and ' +
        'emails.',
      deliveredBy: 'stripe',
      defaultSubject: 'Your card on file is expiring soon',
      mergeTokens: [],
      source: 'Stripe Dashboard → Settings → Subscriptions and emails',
    },
    {
      key: 'stripe-invoice',
      name: 'Invoice',
      description:
        'A finalized invoice emailed to the organization. Sent by Stripe ' +
        'when invoice emails are enabled for the billing configuration.',
      deliveredBy: 'stripe',
      defaultSubject: `Your ${BRAND.ORG_NAME} invoice`,
      mergeTokens: [],
      source: 'Stripe Dashboard → Settings → Customer emails',
    },
  ]

/**
 * Every system email Aglyn sends, each with the universal brand tokens
 * appended to its own (AGL-2139).
 *
 * The template's own tokens come FIRST so the editor's palette still leads
 * with what is specific to that email; the brand block reads as the shared
 * footer it is.
 */
export const SYSTEM_EMAIL_TEMPLATES: readonly SystemEmailTemplateDefinition[] =
  // The risk notices (AGL-3368) are generated from their own catalog, one key
  // per kind, so they live in `risk-notice-emails.ts` beside it.
  // The getting-started emails (AGL-3692) likewise live beside their own
  // notes on which preference governs them, in `retention-emails.ts`.
  [
    ...BASE_SYSTEM_EMAIL_TEMPLATES,
    ...RISK_NOTICE_SYSTEM_EMAIL_TEMPLATES,
    ...retentionSystemEmailTemplates(SAMPLE_CONSOLE_ORIGIN, SAMPLE_DOCS_ORIGIN),
    // Site Care requests (AGL-3959), beside their own sender's notes.
    ...SITE_CARE_SYSTEM_EMAIL_TEMPLATES,
    // Site Care projects (AGL-3970): the flat quote's acceptance, invoices,
    // payments and reversals.
    ...SITE_CARE_PROJECT_SYSTEM_EMAIL_TEMPLATES,
    // A domain bought through the domains plugin (AGL-3962), whose keys and
    // copy live in `domain-emails.ts`.
    ...domainSystemEmailTemplates(SAMPLE_CONSOLE_ORIGIN),
    // Card readers bought from the commerce plugin's POS hardware shop
    // (AGL-4038), whose keys and copy live in `pos-hardware-emails.ts`.
    ...posHardwareSystemEmailTemplates(SAMPLE_CONSOLE_ORIGIN),
    // 4G for a workspace's card readers turned off for an unpaid month
    // (AGL-4038), whose key and copy live in `pos-cellular-emails.ts`.
    ...posCellularSystemEmailTemplates(SAMPLE_CONSOLE_ORIGIN),
  ].map((entry) => ({
    ...entry,
    mergeTokens: [...entry.mergeTokens, ...BRAND_MERGE_TOKENS],
  }))

/** Firestore collection holding the designed templates. */
export const SYSTEM_EMAIL_COLLECTION = 'systemEmailTemplates'

export function getSystemEmailTemplate(
  key: string,
): SystemEmailTemplateDefinition | undefined {
  return SYSTEM_EMAIL_TEMPLATES.find((entry) => entry.key === key)
}

/** True when a besigner template can actually change what is delivered. */
export function isSystemEmailEditable(
  definition: SystemEmailTemplateDefinition,
): boolean {
  return definition.deliveredBy === 'resend'
}

/** The stored template document, when staff have designed one. */
export interface SystemEmailTemplateDoc {
  subject?: string
  preheader?: string
  versionId?: string
  updatedAt?: unknown
  updatedByEmail?: string
}

/** A besigner node in the flat, denormalized map a version stores. */
export interface SystemEmailNode {
  $id: string
  componentId: string
  pluginId?: string
  parentId?: string
  props?: Record<string, unknown>
  nodes?: string[]
}

const PLACEHOLDER_DEFAULT_BODY: readonly SystemEmailDefaultBlock[] = [
  { block: 'text', text: 'Hello,', variant: 'body' },
]

/**
 * Turns a template's `defaultBody` into the besigner node map the editor
 * seeds and the send-time default renders (AGL-764/766).
 *
 * One place builds this so the two never diverge — the version a staffer
 * opens is byte-for-byte what a test/send renders when nothing is published.
 * Rooted at {@link EMAIL_NODE_ROOT_ID} so `renderEmailHtml` finds it (AGL-765),
 * with deterministic ids: a version doc only needs ids unique within itself,
 * and determinism keeps the map stable and diffable.
 */
export function buildDefaultEmailNodeMap(
  // Structural so the tenant catalog (AGL-770) can seed the same way — every
  // definition that carries a `defaultBody` builds an identical node map.
  definition: { defaultBody?: readonly SystemEmailDefaultBlock[] },
): Record<string, SystemEmailNode> {
  const blocks = definition.defaultBody?.length
    ? definition.defaultBody
    : PLACEHOLDER_DEFAULT_BODY
  const sectionId = 'default-section'
  const childIds: string[] = []
  const map: Record<string, SystemEmailNode> = {}

  blocks.forEach((block, index) => {
    const id = `default-${index}`
    childIds.push(id)
    map[id] =
      block.block === 'button'
        ? {
            $id: id,
            componentId: 'emailButton',
            pluginId: 'email',
            parentId: sectionId,
            props: { children: block.label, href: block.href },
          }
        : block.block === 'html'
          ? {
              $id: id,
              componentId: 'emailHtml',
              pluginId: 'email',
              parentId: sectionId,
              props: { html: block.html },
            }
          : {
            $id: id,
            componentId: 'emailText',
            pluginId: 'email',
            parentId: sectionId,
            props: { children: block.text, variant: block.variant ?? 'body' },
          }
  })

  map[EMAIL_NODE_ROOT_ID] = {
    $id: EMAIL_NODE_ROOT_ID,
    componentId: 'div',
    nodes: [sectionId],
  }
  map[sectionId] = {
    $id: sectionId,
    componentId: 'emailSection',
    pluginId: 'email',
    parentId: EMAIL_NODE_ROOT_ID,
    nodes: childIds,
  }
  return map
}
