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

import { EMAIL_NODE_ROOT_ID } from './email-render'

/**
 * Who actually puts the message on the wire.
 *
 * `resend` — Aglyn composes and sends it, so a besigner template can change
 * what the recipient sees.
 *
 * `firebase` — Firebase Auth sends it from its own templates, configured in
 * the Firebase console. **A besigner template cannot affect these at all**
 * until the send is taken over (AGL-751).
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
export type SystemEmailDeliveredBy = 'resend' | 'firebase' | 'stripe'

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
      variant?: 'heading' | 'subheading' | 'body' | 'caption'
    }
  | { block: 'button'; label: string; href: string }

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
export const SYSTEM_EMAIL_TEMPLATES: readonly SystemEmailTemplateDefinition[] =
  [
    {
      key: 'org-invite',
      name: 'Organization invite',
      description:
        'Sent when an admin invites someone to an organization from the ' +
        'Team page.',
      deliveredBy: 'resend',
      defaultSubject: "You've been invited to {{org.name}} on Aglyn",
      mergeTokens: [
        {
          name: 'org.name',
          description: 'Name of the inviting organization',
          sample: 'Test Org',
        },
        {
          name: 'invite.role',
          description: 'Role the person is invited as',
          sample: 'editor',
        },
        {
          name: 'signInUrl',
          description: 'Console URL to sign in and accept',
          sample: 'https://app.aglyn.com',
        },
      ],
      // Mirrors the fallbackText in invites/route.ts.
      defaultBody: [
        {
          block: 'text',
          text: "You've been invited to join {{org.name}} as {{invite.role}}.",
          variant: 'body',
        },
        {
          block: 'text',
          text:
            'Sign in with this email address and accept the invite from ' +
            'your dashboard.',
          variant: 'body',
        },
        { block: 'button', label: 'Sign in', href: '{{signInUrl}}' },
      ],
      source: 'apps/console/app/api/orgs/invites/route.ts',
    },
    {
      key: 'usage-summary',
      name: 'Monthly usage summary',
      description:
        'Monthly per-organization usage and metered-cost summary, sent by ' +
        'the scheduled job.',
      deliveredBy: 'resend',
      defaultSubject: 'Your Aglyn usage summary for {{month}}',
      mergeTokens: [
        {
          name: 'month',
          description: 'Billing month as YYYY-MM',
          sample: '2026-06',
        },
        {
          name: 'org.name',
          description: 'Organization the summary is for',
          sample: 'Test Org',
        },
        {
          name: 'usage.summary',
          description: 'Pre-formatted usage lines',
          sample: 'Page views: 12,400',
        },
      ],
      // Mirrors the summary lines assembled in usage-email/route.ts.
      defaultBody: [
        { block: 'text', text: 'Usage summary for {{org.name}}', variant: 'heading' },
        {
          block: 'text',
          text: 'Here is your Aglyn usage summary for {{month}}.',
          variant: 'body',
        },
        { block: 'text', text: '{{usage.summary}}', variant: 'body' },
      ],
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
          sample: '- Test Org (org_123), requested 2026-07-01',
        },
      ],
      // Mirrors the staff-alert text in audit-archive/route.ts.
      defaultBody: [
        {
          block: 'text',
          text:
            'These organizations are past their GDPR erasure hold. Run ' +
            'tools/scripts/erase-tenant.mjs to export and hard-delete:',
          variant: 'body',
        },
        { block: 'text', text: '{{orgs.list}}', variant: 'body' },
      ],
      source: 'apps/console/app/api/admin/audit-archive/route.ts',
    },
    {
      key: 'welcome',
      name: 'Welcome',
      description:
        'Sent to a new owner the first time they create an organization ' +
        '(not on every organization they later create).',
      deliveredBy: 'resend',
      defaultSubject: 'Welcome to Aglyn',
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
          sample: 'https://app.aglyn.com',
        },
      ],
      // Mirrors the fallbackText in orgs/create/route.ts.
      defaultBody: [
        { block: 'text', text: 'Welcome to Aglyn', variant: 'heading' },
        {
          block: 'text',
          text:
            'Hi {{name}}, thanks for creating {{org.name}}. Your workspace ' +
            'is ready.',
          variant: 'body',
        },
        {
          block: 'text',
          text:
            'From your dashboard you can add a site, invite your team, and ' +
            'start building.',
          variant: 'body',
        },
        { block: 'button', label: 'Open your dashboard', href: '{{consoleUrl}}' },
      ],
      source: 'apps/console/app/api/orgs/create/route.ts',
    },
    {
      key: 'member-added',
      name: 'Added to an organization',
      description:
        'Sent when an existing Aglyn account is added directly to an ' +
        'organization. People who do not have an account yet get the ' +
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
          sample: 'editor',
        },
        {
          name: 'signInUrl',
          description: 'Console URL to open the organization',
          sample: 'https://app.aglyn.com',
        },
      ],
      // Mirrors the fallbackText in orgs/members/route.ts.
      defaultBody: [
        {
          block: 'text',
          text: 'You were added to {{org.name}} as {{member.role}}.',
          variant: 'body',
        },
        {
          block: 'text',
          text: 'Sign in to switch to it from your dashboard.',
          variant: 'body',
        },
        { block: 'button', label: 'Open Aglyn', href: '{{signInUrl}}' },
      ],
      source: 'apps/console/app/api/orgs/members/route.ts',
    },
    {
      key: 'erasure-confirmation',
      name: 'Erasure completed',
      description:
        'Sent to an organization owner once its data has been permanently ' +
        'erased under a GDPR request.',
      deliveredBy: 'resend',
      defaultSubject: 'Your Aglyn data has been erased',
      mergeTokens: [
        {
          name: 'org.name',
          description: 'The organization that was erased',
          sample: 'Test Org',
        },
      ],
      // Mirrors the fallbackText in admin/run-erasures/route.ts.
      defaultBody: [
        { block: 'text', text: 'Your data has been erased', variant: 'heading' },
        {
          block: 'text',
          text:
            '{{org.name}} and all of its data have been permanently erased ' +
            'from Aglyn, as requested.',
          variant: 'body',
        },
        {
          block: 'text',
          text: 'This is complete and cannot be undone.',
          variant: 'body',
        },
      ],
      source: 'apps/console/app/api/admin/run-erasures/route.ts',
    },
    {
      key: 'password-reset',
      name: 'Forgot password',
      description:
        'Password reset link. Sent by Firebase Auth from its own template ' +
        '— editing it here has no effect until AGL-751.',
      deliveredBy: 'firebase',
      defaultSubject: 'Reset your password',
      mergeTokens: [],
      source: 'apps/console/app/(auth)/account-recovery/page.tsx',
    },
    {
      key: 'email-verification',
      name: 'Confirm email',
      description:
        'Address verification link. Sent by Firebase Auth from its own ' +
        'template — editing it here has no effect until AGL-751.',
      deliveredBy: 'firebase',
      defaultSubject: 'Verify your email address',
      mergeTokens: [],
      source: 'apps/console/app/(auth)/verify-email/page.tsx',
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
      defaultSubject: 'Your receipt from Aglyn',
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
      defaultSubject: 'Your Aglyn payment could not be processed',
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
      defaultSubject: 'Your Aglyn refund',
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
      defaultSubject: 'Your Aglyn invoice',
      mergeTokens: [],
      source: 'Stripe Dashboard → Settings → Customer emails',
    },
  ]

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
  definition: SystemEmailTemplateDefinition,
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
