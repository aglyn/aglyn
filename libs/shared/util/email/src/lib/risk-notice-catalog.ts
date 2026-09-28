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
 * THE RISK NOTICE CATALOG (AGL-3368).
 *
 * Every event where the platform holds, flags, locks or pauses something on
 * a workspace, and what each audience is told about it. One entry per kind,
 * read by three consumers that must never disagree:
 *
 * - `notifyRiskEvent` (`@aglyn/tenant-data-admin/server/risk-notice`), which
 *   renders the entry into the in-app notification, the owner email and the
 *   staff alert;
 * - the console: the workspace's Holds & reviews page renders an owner's
 *   notices from it, and the staff abuse queue renders a row's staff half;
 * - the customer help page and the System emails catalog, which list every
 *   kind.
 *
 * ## Two audiences, two vocabularies
 *
 * The OWNER half is read by the workspace's owners and admins — and a
 * fraud actor is a workspace owner too. So it describes the OUTCOME and the
 * way to a human (what was held, what that means, how to ask for a review),
 * never the detection: no rule, no threshold, no brand the screen matched,
 * no count of anything. `risk-notice-catalog.spec.ts` sweeps it for those.
 *
 * The STAFF half is read by staff only and names the evidence plainly.
 *
 * ## Owners can never release
 *
 * No owner action releases a hold or lifts a lock. An owner's "waive" is a
 * review request, which appends a note to the same abuse-queue row. The
 * spec pins that no owner action id is a staff decision.
 *
 * ## Text is written against merge tokens
 *
 * `{{item.label}}`, `{{workspace.name}}`, `{{brand.productName}}` and the rest
 * are filled at send time. The same strings seed the System emails catalog
 * entry each kind gets (`risk-notice-emails.ts`), so staff can edit the email
 * a kind sends on the System emails page.
 *
 * Pure and dependency-free: the console, the docs, the specs and the server
 * all import it.
 *=========================================*/

/** Every kind of risk event the platform tells people about. */
export const RISK_EVENT_KINDS = [
  // Outbound email held by the safety screen: a campaign, an automation
  // step, any site email at the send seam, an outreach message.
  'email-held',
  'email-released',
  'email-rejected',
  // A published page held before a visitor saw it.
  'page-held',
  'page-released',
  'page-rejected',
  // A custom site domain or sending domain flagged for a look.
  'domain-flagged',
  'domain-cleared',
  'domain-rejected',
  // A fraud signal on the workspace's own subscription payment.
  'billing-payment-flagged',
  // A fraud signal on a sale the workspace took from its own customer.
  'sale-fraud-warning',
  'sale-payment-review',
  'sale-dispute',
  // Several of a seller's sales drew fraud reports: staff are reviewing.
  'seller-review',
  // A review with no held item of its own (a payment, a seller review)
  // closed: cleared, or upheld.
  'review-cleared',
  'review-upheld',
  // Security locks, by scope, and their lifts.
  'workspace-locked',
  'workspace-unlocked',
  'site-locked',
  'site-unlocked',
  'domain-locked',
  'domain-unlocked',
  'account-locked',
  'account-unlocked',
  // One capability switched off for one workspace (AI, uploads, checkout…).
  'feature-locked',
  'feature-unlocked',
  // Money stopped or restarted by a lock or by staff.
  'subscription-canceled',
  'renewals-paused',
  'renewals-resumed',
  'payouts-paused',
  'payouts-resumed',
] as const

export type RiskEventKind = (typeof RISK_EVENT_KINDS)[number]

/** How loud a notice is. `urgent` kinds are emailed and alert staff at once. */
export type RiskNoticeSeverity = 'info' | 'warning' | 'urgent'

/** The actions an OWNER or ADMIN is offered. None of them releases anything. */
export const RISK_OWNER_ACTION_IDS = [
  'view-details',
  'edit-and-resubmit',
  'request-review',
  'refund-order',
  'keep-order',
  'answer-dispute',
  'update-payment-method',
  'view-billing',
  'view-holds',
  'contact-support',
] as const
export type RiskOwnerActionId = (typeof RISK_OWNER_ACTION_IDS)[number]

/** The actions STAFF are offered: the real controls, deep-linked. */
export const RISK_STAFF_ACTION_IDS = [
  'staff-open-row',
  'staff-release',
  'staff-reject',
  'staff-lock-workspace',
  'staff-lock-site',
  'staff-unlock',
  'staff-cancel-subscription',
  'staff-open-stripe',
  'staff-view-workspace',
] as const
export type RiskStaffActionId = (typeof RISK_STAFF_ACTION_IDS)[number]

/**
 * Where each action goes, as a console path TEMPLATE. `{name}` placeholders
 * are filled by {@link resolveRiskActionHref} from the event; an action whose
 * placeholder has no value is dropped rather than rendered dead.
 *
 * Owner paths are in the stored-notification shape the console's
 * `normalizeNotificationLink` rewrites when followed: `/org/…` becomes the
 * reader's `/{orgSlug}/…` and `/{hostId}/…` becomes `/{orgSlug}/hosts/{sub}/…`.
 * `{itemPath}` is the held item's own page, supplied by the signal source.
 *
 * `risk-notice-routes.spec.ts` (console) resolves every template to a page
 * that exists under `apps/console/app`.
 */
export interface RiskActionDefinition {
  label: string
  /** What happens when it is followed, for the help page and a tooltip. */
  hint: string
  href: string
}

export const RISK_OWNER_ACTIONS: Record<RiskOwnerActionId, RiskActionDefinition> = {
  'view-details': {
    label: 'View details',
    hint: 'Opens the item this notice is about.',
    href: '{itemPath}',
  },
  'edit-and-resubmit': {
    label: 'Edit and resubmit',
    hint: 'Opens the item so you can change it. A changed version is checked again on its own.',
    href: '{itemPath}',
  },
  'request-review': {
    label: 'Request a review',
    hint: 'Sends a note to our review team on the same case. It does not release anything by itself.',
    href: '/org/settings/holds?notice={noticeId}',
  },
  'refund-order': {
    label: 'Refund this order',
    hint: 'Opens the order, where Refund returns the payment to the card.',
    href: '{itemPath}',
  },
  'keep-order': {
    label: 'Keep the order',
    hint: 'Opens the order. Nothing needs doing to keep it; fulfill it only once you are sure.',
    href: '{itemPath}',
  },
  'answer-dispute': {
    label: 'Answer the dispute',
    hint: 'Opens the order with its dispute and the date your evidence is due.',
    href: '{itemPath}',
  },
  'update-payment-method': {
    label: 'Update payment method',
    hint: 'Opens billing settings, where the card your subscription is paid from lives.',
    href: '/org/billing/settings',
  },
  'view-billing': {
    label: 'View billing',
    hint: 'Opens your plan and subscription.',
    href: '/org/billing',
  },
  'view-holds': {
    label: 'View holds and reviews',
    hint: 'Lists everything on this workspace that is held or under review, with its status.',
    href: '/org/settings/holds',
  },
  'contact-support': {
    label: 'Contact support',
    hint: 'Opens a support ticket. If you cannot sign in, reply to this email instead.',
    href: '/org/support/tickets',
  },
}

export const RISK_STAFF_ACTIONS: Record<RiskStaffActionId, RiskActionDefinition> = {
  'staff-open-row': {
    label: 'Open in abuse queue',
    hint: 'The abuse-queue row with the evidence and any review requests.',
    href: '/admin/abuse-reports?report={reviewId}',
  },
  'staff-release': {
    label: 'Waive / release',
    hint: 'Dismiss the row. For a held email or page this releases exactly the held content.',
    href: '/admin/abuse-reports?report={reviewId}&decide=dismissed',
  },
  'staff-reject': {
    label: 'Reject',
    hint: 'Mark the row actioned. A held email or page stays unsent or unserved.',
    href: '/admin/abuse-reports?report={reviewId}&decide=actioned',
  },
  'staff-lock-workspace': {
    label: 'Lock workspace',
    hint: 'Opens Lockdown with this workspace filled in.',
    href: '/admin/lockdown?scope=org&targetId={orgId}',
  },
  'staff-lock-site': {
    label: 'Lock site',
    hint: 'Opens Lockdown with this site filled in.',
    href: '/admin/lockdown?scope=host&targetId={hostId}',
  },
  'staff-unlock': {
    label: 'Review the lock',
    hint: 'Opens Lockdown on the locked target, where it can be lifted.',
    href: '/admin/lockdown?scope={lockScope}&targetId={lockTargetId}',
  },
  'staff-cancel-subscription': {
    label: 'Cancel subscription',
    hint: "The workspace's Subscription card on its staff page.",
    href: '/admin/orgs/{orgId}#subscription',
  },
  'staff-open-stripe': {
    label: 'Open in Stripe',
    hint: 'The charge, review, dispute or connected account in the Stripe Dashboard.',
    href: '{stripeUrl}',
  },
  'staff-view-workspace': {
    label: 'View workspace',
    hint: "The workspace's staff page.",
    href: '/admin/orgs/{orgId}',
  },
}

/** One audience's half of a kind. */
export interface RiskNoticeCopy {
  /** Short and specific. Also the email subject. */
  title: string
  /** What we saw, on what, and when. */
  summary: string
  /** What it means for them. */
  meaning: string
  /** What to do next, in order. */
  steps: readonly string[]
}

export interface RiskNoticeDefinition {
  kind: RiskEventKind
  severity: RiskNoticeSeverity
  /**
   * Whether the owners and admins are emailed as well as notified in the
   * console. The email is transactional account mail from the platform's own
   * sender: it ignores notification preferences and marketing consent, and
   * it reaches a locked workspace.
   */
  emailOwners: boolean
  /** Whether staff are alerted. False for events staff themselves caused. */
  alertStaff: boolean
  /**
   * Whether the notice always goes out, even while the workspace is over its
   * burst allowance. Locks, lifts and cancellations are never folded into a
   * digest: each one changes what the owner can do.
   */
  neverDigest: boolean
  /**
   * An owner can ask for a review. Only kinds with an abuse-queue row to
   * append to are reviewable.
   */
  reviewable: boolean
  /** The kinds staff decisions on this kind's row close it with. */
  closesWith?: { released: RiskEventKind; rejected: RiskEventKind }
  /** Also tell the managers of the site the event is on, not just the workspace's. */
  includeSiteManagers: boolean
  /** The help page section that explains it. */
  helpAnchor: string
  owner: RiskNoticeCopy & { actions: readonly RiskOwnerActionId[] }
  staff: Pick<RiskNoticeCopy, 'title' | 'summary'> & {
    actions: readonly RiskStaffActionId[]
  }
}

/**
 * The customer help page every notice links to. A path on the docs site;
 * the server prefixes the docs origin.
 */
export const RISK_NOTICE_HELP_PATH = '/help/holds-and-reviews'

/**
 * Merge tokens a notice may use. The server fills each from the event; a
 * token the event does not carry renders as the fallback noted here, never
 * as a hole in a sentence.
 */
export const RISK_NOTICE_TOKENS = {
  'workspace.name': 'The workspace name, or "your workspace".',
  'item.label': 'What the notice is about, in the owner\'s words: the campaign "Spring sale", the page /pricing, order 1042.',
  'item.url': 'The absolute console link to the item.',
  occurredAt: 'When it happened, in UTC.',
  reference: 'The case reference staff know it by (HS-…, PF-…).',
  'holds.url': "The workspace's Holds & reviews page.",
  'help.url': 'The help page for holds and reviews.',
  'support.email': "The operator's support address.",
  'lock.message': 'The message staff wrote when they applied the lock.',
  'lock.affected': 'What the lock or pause covers: sites, sessions, billing.',
  amount: 'The payment amount, when there is one.',
  'evidence.dueBy': 'The date dispute evidence is due, when Stripe gave one.',
  'staff.evidence': 'Staff only: what the screen or Stripe reported.',
} as const

export type RiskNoticeToken = keyof typeof RISK_NOTICE_TOKENS

const ASK_FOR_REVIEW =
  'If you think this is a mistake, choose Request a review and tell us about it. A person reads every request.'

const REVIEW_TIME =
  'Reviews are usually answered within one business day. You will get a notice either way.'

const CANNOT_SIGN_IN =
  'If you cannot sign in, reply to this email or write to {{support.email}} with the reference {{reference}}.'

/*
 * The catalog. Exhaustive by type: a kind added to RISK_EVENT_KINDS is a
 * compile error here until somebody writes what each audience is told.
 */
export const RISK_NOTICE_CATALOG: Readonly<Record<RiskEventKind, RiskNoticeDefinition>> = {
  'email-held': {
    kind: 'email-held',
    severity: 'warning',
    emailOwners: true,
    alertStaff: true,
    neverDigest: false,
    reviewable: true,
    closesWith: { released: 'email-released', rejected: 'email-rejected' },
    includeSiteManagers: false,
    helpAnchor: 'email-held',
    owner: {
      title: 'An email is on hold for review',
      summary:
        'Our automated safety review held {{item.label}} from {{workspace.name}} on {{occurredAt}} before it was sent.',
      meaning:
        'This email was not sent. Nobody on your list received it, and nothing else on your account has changed.',
      steps: [
        'Open the email and check its links, its sender name and its wording.',
        'If you change it, it is checked again when it next sends.',
        ASK_FOR_REVIEW,
        REVIEW_TIME,
      ],
      actions: ['view-details', 'edit-and-resubmit', 'request-review', 'contact-support'],
    },
    staff: {
      title: 'Outbound email held for review — possible phishing',
      summary:
        '{{item.label}} from {{workspace.name}} was held on {{occurredAt}}. {{staff.evidence}} Reference {{reference}}.',
      actions: [
        'staff-open-row',
        'staff-release',
        'staff-reject',
        'staff-lock-workspace',
        'staff-view-workspace',
      ],
    },
  },
  'email-released': {
    kind: 'email-released',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'email-held',
    owner: {
      title: 'Your held email was released',
      summary: 'Our review team released {{item.label}} on {{occurredAt}}.',
      meaning:
        'A held campaign goes back on the schedule and sends shortly. An automated email sends the next time it runs.',
      steps: [
        'Nothing to do. If you edit the email before it sends, the edited version is checked on its own.',
      ],
      actions: ['view-details'],
    },
    staff: {
      title: 'Held email released',
      summary: '{{item.label}} from {{workspace.name}} was released. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-view-workspace'],
    },
  },
  'email-rejected': {
    kind: 'email-rejected',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: true,
    includeSiteManagers: false,
    helpAnchor: 'email-held',
    owner: {
      title: 'A held email will not be sent',
      summary: 'After review, {{item.label}} was not approved on {{occurredAt}}.',
      meaning:
        'This email will not be sent in its current form. A held campaign is canceled; an automated email step stays stopped.',
      steps: [
        'Read our acceptable use rules before you send similar mail again.',
        'If you think the decision is wrong, choose Request a review and explain what the email is for.',
      ],
      actions: ['view-details', 'request-review', 'contact-support'],
    },
    staff: {
      title: 'Held email rejected',
      summary: '{{item.label}} from {{workspace.name}} was rejected. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-lock-workspace', 'staff-view-workspace'],
    },
  },
  'page-held': {
    kind: 'page-held',
    severity: 'warning',
    emailOwners: true,
    alertStaff: true,
    neverDigest: false,
    reviewable: true,
    closesWith: { released: 'page-released', rejected: 'page-rejected' },
    includeSiteManagers: true,
    helpAnchor: 'page-held',
    owner: {
      title: 'A published page is on hold for review',
      summary:
        'Our automated safety review held the latest version of {{item.label}} on {{occurredAt}}.',
      meaning:
        'Visitors still see the previous version of this page. If it has never been published before, visitors see a not-found page until the review is done.',
      steps: [
        'Open the page and check its links, embeds and any fields that ask visitors for information.',
        'If you change and publish it again, the new version is checked on its own.',
        ASK_FOR_REVIEW,
        REVIEW_TIME,
      ],
      actions: ['view-details', 'edit-and-resubmit', 'request-review', 'contact-support'],
    },
    staff: {
      title: 'Published page held for review — possible phishing',
      summary:
        '{{item.label}} of {{workspace.name}} was held on {{occurredAt}}. {{staff.evidence}} Reference {{reference}}.',
      actions: [
        'staff-open-row',
        'staff-release',
        'staff-reject',
        'staff-lock-site',
        'staff-lock-workspace',
        'staff-view-workspace',
      ],
    },
  },
  'page-released': {
    kind: 'page-released',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'page-held',
    owner: {
      title: 'Your held page is live',
      summary: 'Our review team released {{item.label}} on {{occurredAt}}.',
      meaning: 'Visitors now see the version that was held.',
      steps: ['Nothing to do. Open the page to confirm it looks right.'],
      actions: ['view-details'],
    },
    staff: {
      title: 'Held page released',
      summary: '{{item.label}} of {{workspace.name}} was released. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-view-workspace'],
    },
  },
  'page-rejected': {
    kind: 'page-rejected',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: true,
    includeSiteManagers: true,
    helpAnchor: 'page-held',
    owner: {
      title: 'A held page will not be published',
      summary: 'After review, the held version of {{item.label}} was not approved on {{occurredAt}}.',
      meaning:
        'Visitors keep seeing the previous version, or a not-found page if there is none. Publishing the same content again is held again.',
      steps: [
        'Change the page and publish a new version, or restore an earlier version from its history.',
        'If you think the decision is wrong, choose Request a review and explain what the page is for.',
      ],
      actions: ['edit-and-resubmit', 'request-review', 'contact-support'],
    },
    staff: {
      title: 'Held page rejected',
      summary: '{{item.label}} of {{workspace.name}} was rejected. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-lock-site', 'staff-view-workspace'],
    },
  },
  'domain-flagged': {
    kind: 'domain-flagged',
    severity: 'warning',
    emailOwners: true,
    alertStaff: true,
    neverDigest: false,
    reviewable: true,
    closesWith: { released: 'domain-cleared', rejected: 'domain-rejected' },
    includeSiteManagers: false,
    helpAnchor: 'domain-flagged',
    owner: {
      title: 'A domain you added is being reviewed',
      summary: '{{item.label}} was added to {{workspace.name}} on {{occurredAt}} and is waiting on a routine review.',
      meaning:
        'The domain stays connected while we look. Email sent from it may wait for the review to finish.',
      steps: [
        'Nothing is needed if the domain and the name on it are yours.',
        'To speed it up, choose Request a review and tell us who owns the domain and what it is for.',
        REVIEW_TIME,
      ],
      actions: ['view-details', 'request-review', 'contact-support'],
    },
    staff: {
      title: 'Domain flagged — possible brand impersonation',
      summary:
        '{{item.label}} was added by {{workspace.name}} on {{occurredAt}}. {{staff.evidence}} Reference {{reference}}.',
      actions: [
        'staff-open-row',
        'staff-release',
        'staff-reject',
        'staff-lock-workspace',
        'staff-view-workspace',
      ],
    },
  },
  'domain-cleared': {
    kind: 'domain-cleared',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'domain-flagged',
    owner: {
      title: 'Your domain review is complete',
      summary: '{{item.label}} was reviewed and cleared on {{occurredAt}}.',
      meaning: 'The domain works as normal. Email that was waiting on it sends on its next attempt.',
      steps: ['Nothing to do.'],
      actions: ['view-details'],
    },
    staff: {
      title: 'Flagged domain cleared',
      summary: '{{item.label}} on {{workspace.name}} was cleared. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-view-workspace'],
    },
  },
  'domain-rejected': {
    kind: 'domain-rejected',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: true,
    includeSiteManagers: false,
    helpAnchor: 'domain-flagged',
    owner: {
      title: 'A domain on your workspace was not approved',
      summary: 'After review, {{item.label}} was not approved on {{occurredAt}}.',
      meaning:
        'Email from this domain will not be sent, and pages served on it may be restricted.',
      steps: [
        'Remove the domain from your workspace, or show us that it is yours.',
        'If you think the decision is wrong, choose Request a review with proof of ownership.',
      ],
      actions: ['view-details', 'request-review', 'contact-support'],
    },
    staff: {
      title: 'Flagged domain rejected',
      summary: '{{item.label}} on {{workspace.name}} was rejected. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-lock-workspace', 'staff-view-workspace'],
    },
  },
  'billing-payment-flagged': {
    kind: 'billing-payment-flagged',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: true,
    neverDigest: false,
    reviewable: true,
    closesWith: { released: 'review-cleared', rejected: 'review-upheld' },
    includeSiteManagers: false,
    helpAnchor: 'billing-payment-flagged',
    owner: {
      title: 'A payment on your subscription needs attention',
      summary:
        'On {{occurredAt}}, a subscription payment of {{amount}} for {{workspace.name}} was flagged for a fraud check.',
      meaning:
        'The payment may be reversed by the cardholder\'s bank. If it is, your subscription may need a new payment method, and your plan can change.',
      steps: [
        'If you made this payment, choose Request a review and confirm it, so we can answer the bank.',
        'Check that the card on your account is yours and current.',
        'If you did not make this payment, contact support now.',
      ],
      actions: ['request-review', 'update-payment-method', 'view-billing', 'contact-support'],
    },
    staff: {
      title: 'Platform billing fraud signal',
      summary:
        '{{staff.evidence}} Workspace {{workspace.name}}, {{amount}}, on {{occurredAt}}. Nothing has been refunded or canceled. Reference {{reference}}.',
      actions: [
        'staff-open-row',
        'staff-open-stripe',
        'staff-cancel-subscription',
        'staff-lock-workspace',
        'staff-release',
        'staff-reject',
      ],
    },
  },
  'sale-fraud-warning': {
    kind: 'sale-fraud-warning',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'sale-fraud-warning',
    owner: {
      title: 'A payment you received may be fraudulent',
      summary:
        'On {{occurredAt}}, the card issuer reported the payment for {{item.label}} ({{amount}}) as possibly not made by the cardholder.',
      meaning:
        'This payment may be reversed by the cardholder\'s bank. It is not a chargeback yet. Nothing has been refunded or canceled.',
      steps: [
        'Hold anything not yet shipped or delivered until you are sure the buyer is genuine.',
        'Refunding now usually prevents a chargeback and its fee.',
        'If you know the buyer and the sale is genuine, you can keep the order.',
      ],
      actions: ['refund-order', 'keep-order', 'view-details', 'contact-support'],
    },
    staff: {
      title: 'Early fraud warning on a site sale',
      summary: '{{item.label}} on {{workspace.name}}, {{amount}}. {{staff.evidence}}',
      actions: ['staff-open-stripe', 'staff-view-workspace', 'staff-lock-site'],
    },
  },
  'sale-payment-review': {
    kind: 'sale-payment-review',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'sale-payment-review',
    owner: {
      title: 'A payment you received is on hold for review',
      summary: 'On {{occurredAt}}, the payment for {{item.label}} ({{amount}}) was held for a fraud review.',
      meaning:
        'The payment has not reached your balance yet and may be refunded if it is not approved. Nothing has been refunded or canceled.',
      steps: [
        'Hold anything not yet shipped or delivered until the payment clears.',
        'If you know the buyer is not genuine, refund the order.',
        'If you know the buyer, keep the order; the review usually clears on its own.',
      ],
      actions: ['refund-order', 'keep-order', 'view-details', 'contact-support'],
    },
    staff: {
      title: 'Payment review on a site sale',
      summary: '{{item.label}} on {{workspace.name}}, {{amount}}. {{staff.evidence}}',
      actions: ['staff-open-stripe', 'staff-view-workspace'],
    },
  },
  'sale-dispute': {
    kind: 'sale-dispute',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'sale-dispute',
    owner: {
      title: 'A customer disputed a payment',
      summary:
        'On {{occurredAt}}, the cardholder disputed the payment for {{item.label}} ({{amount}}) with their bank.',
      meaning:
        'The payment may be reversed by the cardholder\'s bank. An unanswered dispute is decided for the cardholder. Your evidence is due by {{evidence.dueBy}}.',
      steps: [
        'Open the order and gather what shows the sale was genuine: receipts, delivery tracking, messages with the buyer.',
        'Send your evidence before {{evidence.dueBy}}. Contact support if you need help submitting it.',
        'If the buyer is right, accept the dispute instead of answering it.',
      ],
      actions: ['answer-dispute', 'view-details', 'contact-support'],
    },
    staff: {
      title: 'Dispute on a site sale',
      summary: '{{item.label}} on {{workspace.name}}, {{amount}}. Evidence due {{evidence.dueBy}}. {{staff.evidence}}',
      actions: ['staff-open-stripe', 'staff-view-workspace'],
    },
  },
  'seller-review': {
    kind: 'seller-review',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: true,
    neverDigest: false,
    reviewable: true,
    closesWith: { released: 'review-cleared', rejected: 'review-upheld' },
    includeSiteManagers: false,
    helpAnchor: 'seller-review',
    owner: {
      title: 'We are reviewing recent payments on your store',
      summary:
        'On {{occurredAt}}, our team opened a routine review of recent card payments taken by {{workspace.name}}.',
      meaning:
        'Your store keeps selling while we look. We may contact you for information about your recent orders.',
      steps: [
        'Check your recent orders and refund any you believe were not placed by the cardholder.',
        'Choose Request a review to tell us about your business and your customers; it helps the review finish sooner.',
        REVIEW_TIME,
      ],
      actions: ['request-review', 'view-holds', 'contact-support'],
    },
    staff: {
      title: 'Seller fraud pattern on one connected account',
      summary:
        '{{staff.evidence}} Workspace {{workspace.name}}. Nothing has been refunded, canceled or paused. Reference {{reference}}.',
      actions: [
        'staff-open-row',
        'staff-open-stripe',
        'staff-lock-workspace',
        'staff-view-workspace',
        'staff-release',
        'staff-reject',
      ],
    },
  },
  'review-cleared': {
    kind: 'review-cleared',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'requesting-a-review',
    owner: {
      title: 'Our review is complete',
      summary: 'On {{occurredAt}}, our team finished reviewing {{item.label}} and closed it with no action.',
      meaning: 'Nothing on your account changes because of it.',
      steps: ['Nothing to do.'],
      actions: ['view-holds'],
    },
    staff: {
      title: 'Review closed with no action',
      summary: '{{item.label}} on {{workspace.name}} was dismissed. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-view-workspace'],
    },
  },
  'review-upheld': {
    kind: 'review-upheld',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: false,
    reviewable: true,
    includeSiteManagers: false,
    helpAnchor: 'requesting-a-review',
    owner: {
      title: 'Our review found a problem',
      summary: 'On {{occurredAt}}, our team finished reviewing {{item.label}} and took action on it.',
      meaning:
        'You may receive a separate notice about what changed on your account, such as a lock or a canceled subscription.',
      steps: [
        'Read any other notices you received today; they say what changed.',
        'If you think the decision is wrong, choose Request a review or contact support with the reference {{reference}}.',
      ],
      actions: ['request-review', 'view-holds', 'contact-support'],
    },
    staff: {
      title: 'Review closed with action',
      summary: '{{item.label}} on {{workspace.name}} was actioned. Reference {{reference}}.',
      actions: ['staff-open-row', 'staff-view-workspace'],
    },
  },
  'workspace-locked': {
    kind: 'workspace-locked',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'locked',
    owner: {
      title: '{{workspace.name}} has been locked',
      summary: 'On {{occurredAt}}, our team locked {{workspace.name}}. The message from our team: {{lock.message}}',
      meaning: 'While it is locked: {{lock.affected}}',
      steps: [
        'Read the message above; it says what we need from you.',
        CANNOT_SIGN_IN,
        'Tell us who you are, what the workspace is for, and anything that explains what happened. A person reads every appeal.',
      ],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Workspace locked',
      summary: '{{workspace.name}} was locked on {{occurredAt}}. Affected: {{lock.affected}}',
      actions: ['staff-unlock', 'staff-view-workspace'],
    },
  },
  'workspace-unlocked': {
    kind: 'workspace-unlocked',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'locked',
    owner: {
      title: '{{workspace.name}} has been restored',
      summary: 'On {{occurredAt}}, our team lifted the lock on {{workspace.name}}.',
      meaning: 'What happens now: {{lock.affected}}',
      steps: [
        'Sign in again; sessions that were signed out stay signed out.',
        'Check your sites, scheduled sends and billing. Anything that was canceled stays canceled until you restart it.',
      ],
      actions: ['view-holds', 'view-billing', 'contact-support'],
    },
    staff: {
      title: 'Workspace lock lifted',
      summary: '{{workspace.name}} was unlocked on {{occurredAt}}.',
      actions: ['staff-view-workspace'],
    },
  },
  'site-locked': {
    kind: 'site-locked',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'locked',
    owner: {
      title: 'A site on {{workspace.name}} has been locked',
      summary: 'On {{occurredAt}}, our team locked {{item.label}}. The message from our team: {{lock.message}}',
      meaning: 'While it is locked: {{lock.affected}}',
      steps: [
        'Read the message above; it says what we need from you.',
        'Contact support to appeal, with the reference {{reference}}. A person reads every appeal.',
        CANNOT_SIGN_IN,
      ],
      actions: ['contact-support', 'view-holds'],
    },
    staff: {
      title: 'Site locked',
      summary: '{{item.label}} of {{workspace.name}} was locked on {{occurredAt}}. Affected: {{lock.affected}}',
      actions: ['staff-unlock', 'staff-view-workspace'],
    },
  },
  'site-unlocked': {
    kind: 'site-unlocked',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'locked',
    owner: {
      title: 'A site on {{workspace.name}} has been restored',
      summary: 'On {{occurredAt}}, our team lifted the lock on {{item.label}}.',
      meaning: 'What happens now: {{lock.affected}}',
      steps: ['Open the site and check that its pages, forms and checkout work as you expect.'],
      actions: ['view-details', 'contact-support'],
    },
    staff: {
      title: 'Site lock lifted',
      summary: '{{item.label}} of {{workspace.name}} was unlocked on {{occurredAt}}.',
      actions: ['staff-view-workspace'],
    },
  },
  'domain-locked': {
    kind: 'domain-locked',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'locked',
    owner: {
      title: 'A domain on {{workspace.name}} has been locked',
      summary: 'On {{occurredAt}}, our team locked {{item.label}}. The message from our team: {{lock.message}}',
      meaning: 'While it is locked: {{lock.affected}}',
      steps: [
        'Read the message above; it says what we need from you.',
        'Contact support to appeal, with the reference {{reference}}.',
      ],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Domain locked',
      summary: '{{item.label}} of {{workspace.name}} was locked on {{occurredAt}}.',
      actions: ['staff-unlock', 'staff-view-workspace'],
    },
  },
  'domain-unlocked': {
    kind: 'domain-unlocked',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'locked',
    owner: {
      title: 'A domain on {{workspace.name}} has been restored',
      summary: 'On {{occurredAt}}, our team lifted the lock on {{item.label}}.',
      meaning: 'What happens now: {{lock.affected}}',
      steps: ['Visit the domain to confirm it serves your site again.'],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Domain lock lifted',
      summary: '{{item.label}} of {{workspace.name}} was unlocked on {{occurredAt}}.',
      actions: ['staff-view-workspace'],
    },
  },
  'account-locked': {
    kind: 'account-locked',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'locked',
    owner: {
      title: 'Your account has been locked',
      summary: 'On {{occurredAt}}, our team locked your {{brand.productName}} account. The message from our team: {{lock.message}}',
      meaning: 'While it is locked: {{lock.affected}}',
      steps: [
        'Read the message above; it says what we need from you.',
        CANNOT_SIGN_IN,
      ],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Account locked',
      summary: 'An account was locked on {{occurredAt}}. Affected: {{lock.affected}}',
      actions: ['staff-unlock'],
    },
  },
  'account-unlocked': {
    kind: 'account-unlocked',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'locked',
    owner: {
      title: 'Your account has been restored',
      summary: 'On {{occurredAt}}, our team lifted the lock on your {{brand.productName}} account.',
      meaning: 'What happens now: {{lock.affected}}',
      steps: ['Sign in again. If anything still does not work, contact support.'],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Account lock lifted',
      summary: 'An account was unlocked on {{occurredAt}}.',
      actions: ['staff-unlock'],
    },
  },
  'feature-locked': {
    kind: 'feature-locked',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'locked',
    owner: {
      title: '{{item.label}} is paused on {{workspace.name}}',
      summary: 'On {{occurredAt}}, our team paused {{item.label}} for {{workspace.name}}. The message from our team: {{lock.message}}',
      meaning: 'Everything else on your workspace keeps working. {{lock.affected}}',
      steps: [
        'Read the message above; it says what we need from you.',
        'Contact support with the reference {{reference}} if you have questions.',
      ],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Workspace feature paused',
      summary: '{{item.label}} was paused for {{workspace.name}} on {{occurredAt}}.',
      actions: ['staff-unlock', 'staff-view-workspace'],
    },
  },
  'feature-unlocked': {
    kind: 'feature-unlocked',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'locked',
    owner: {
      title: '{{item.label}} is back on {{workspace.name}}',
      summary: 'On {{occurredAt}}, our team turned {{item.label}} back on for {{workspace.name}}.',
      meaning: 'What happens now: {{lock.affected}}',
      steps: ['Nothing to do.'],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Workspace feature restored',
      summary: '{{item.label}} was restored for {{workspace.name}} on {{occurredAt}}.',
      actions: ['staff-view-workspace'],
    },
  },
  'subscription-canceled': {
    kind: 'subscription-canceled',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: false,
    helpAnchor: 'subscription-canceled',
    owner: {
      title: 'The subscription for {{workspace.name}} was canceled',
      summary: 'On {{occurredAt}}, our team canceled the subscription for {{workspace.name}}. {{lock.message}}',
      meaning: 'What changes: {{lock.affected}}',
      steps: [
        'Export anything you need from your workspace.',
        'Contact support if you believe this was a mistake, with the reference {{reference}}.',
      ],
      actions: ['view-billing', 'contact-support'],
    },
    staff: {
      title: 'Subscription canceled by staff',
      summary: 'The subscription for {{workspace.name}} was canceled on {{occurredAt}}.',
      actions: ['staff-cancel-subscription', 'staff-view-workspace'],
    },
  },
  'renewals-paused': {
    kind: 'renewals-paused',
    severity: 'warning',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'renewals-and-payouts',
    owner: {
      title: 'Customer renewals are paused on {{item.label}}',
      summary: 'On {{occurredAt}}, our team paused the recurring charges your customers pay on {{item.label}}.',
      meaning: 'Your customers are not charged while this is paused: {{lock.affected}}',
      steps: [
        'Nothing you need to do for your customers yet; they keep what they already paid for.',
        'Contact support with the reference {{reference}} if you have questions.',
      ],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Site renewals paused',
      summary: '{{item.label}} of {{workspace.name}}: {{lock.affected}}',
      actions: ['staff-unlock', 'staff-view-workspace'],
    },
  },
  'renewals-resumed': {
    kind: 'renewals-resumed',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'renewals-and-payouts',
    owner: {
      title: 'Customer renewals have resumed on {{item.label}}',
      summary: 'On {{occurredAt}}, our team resumed the recurring charges on {{item.label}}.',
      meaning: 'What happens now: {{lock.affected}}',
      steps: ['Nothing to do. Renewals continue on their normal schedule.'],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Site renewals resumed',
      summary: '{{item.label}} of {{workspace.name}}: {{lock.affected}}',
      actions: ['staff-view-workspace'],
    },
  },
  'payouts-paused': {
    kind: 'payouts-paused',
    severity: 'urgent',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'renewals-and-payouts',
    owner: {
      title: 'Payouts are paused for {{item.label}}',
      summary: 'On {{occurredAt}}, our team paused payouts to your bank account for {{item.label}}.',
      meaning: 'Money from your sales is kept safe in your balance and is not paid out while this is paused: {{lock.affected}}',
      steps: [
        'Contact support with the reference {{reference}} to find out what we need from you.',
        'You will get a notice when payouts resume.',
      ],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Site payouts paused',
      summary: '{{item.label}} of {{workspace.name}}: {{lock.affected}}',
      actions: ['staff-unlock', 'staff-open-stripe', 'staff-view-workspace'],
    },
  },
  'payouts-resumed': {
    kind: 'payouts-resumed',
    severity: 'info',
    emailOwners: true,
    alertStaff: false,
    neverDigest: true,
    reviewable: false,
    includeSiteManagers: true,
    helpAnchor: 'renewals-and-payouts',
    owner: {
      title: 'Payouts have resumed for {{item.label}}',
      summary: 'On {{occurredAt}}, our team resumed payouts for {{item.label}}.',
      meaning: 'What happens now: {{lock.affected}}',
      steps: ['Nothing to do. Your balance pays out on your normal schedule.'],
      actions: ['contact-support'],
    },
    staff: {
      title: 'Site payouts resumed',
      summary: '{{item.label}} of {{workspace.name}}: {{lock.affected}}',
      actions: ['staff-view-workspace'],
    },
  },
}

/** The catalog entry for a kind. */
export function riskNoticeDefinition(kind: RiskEventKind): RiskNoticeDefinition {
  return RISK_NOTICE_CATALOG[kind]
}

export function isRiskEventKind(value: unknown): value is RiskEventKind {
  return typeof value === 'string' && (RISK_EVENT_KINDS as readonly string[]).includes(value)
}

/** The values a notice is rendered with. Every value is optional. */
export type RiskNoticeValues = Partial<Record<RiskNoticeToken | 'brand.productName', string | null | undefined>>

/**
 * What a token renders as when the event did not carry it: always words, so
 * a sentence never has a hole in it.
 */
const TOKEN_FALLBACKS: Partial<Record<RiskNoticeToken | 'brand.productName', string>> = {
  'workspace.name': 'your workspace',
  'item.label': 'an item on your workspace',
  occurredAt: 'a recent date',
  reference: 'shown on this notice',
  'support.email': 'our support team',
  'lock.message': 'None was given.',
  'lock.affected': 'see your account for details.',
  amount: 'an amount shown on the payment',
  'evidence.dueBy': 'the date shown on the order',
  'staff.evidence': '',
  'brand.productName': 'the platform',
}

/** Fill `{{token}}`s from `values`, falling back to words, never to a hole. */
export function renderRiskNoticeText(template: string, values: RiskNoticeValues): string {
  return template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => {
      const value = values[token as RiskNoticeToken]
      if (typeof value === 'string' && value.trim()) return value.trim()
      return TOKEN_FALLBACKS[token as RiskNoticeToken] ?? ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** The values an action href may use. */
export interface RiskActionParams {
  itemPath?: string | null
  noticeId?: string | null
  reviewId?: string | null
  orgId?: string | null
  hostId?: string | null
  stripeUrl?: string | null
  lockScope?: string | null
  lockTargetId?: string | null
}

/**
 * An action's href with its placeholders filled, or null when one of them
 * has no value — an action that would lead nowhere is not offered.
 */
export function resolveRiskActionHref(
  action: RiskActionDefinition,
  params: RiskActionParams,
): string | null {
  let missing = false
  const href = action.href.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name as keyof RiskActionParams]
    if (typeof value !== 'string' || !value) {
      missing = true
      return ''
    }
    // A whole-path placeholder is taken as written; a path segment or query
    // value is encoded.
    return name === 'itemPath' || name === 'stripeUrl' ? value : encodeURIComponent(value)
  })
  if (missing) return null
  if (href.startsWith('https://')) return href
  return href.startsWith('/') ? href : null
}

/** One action, ready to render. */
export interface ResolvedRiskAction {
  id: RiskOwnerActionId | RiskStaffActionId
  label: string
  hint: string
  href: string
}

/** A kind's owner actions that lead somewhere, in catalog order. */
export function resolveOwnerRiskActions(
  kind: RiskEventKind,
  params: RiskActionParams,
): ResolvedRiskAction[] {
  return RISK_NOTICE_CATALOG[kind].owner.actions.flatMap((id) => {
    const definition = RISK_OWNER_ACTIONS[id]
    const href = resolveRiskActionHref(definition, params)
    return href ? [{ id, label: definition.label, hint: definition.hint, href }] : []
  })
}

/** A kind's staff actions that lead somewhere, in catalog order. */
export function resolveStaffRiskActions(
  kind: RiskEventKind,
  params: RiskActionParams,
): ResolvedRiskAction[] {
  return RISK_NOTICE_CATALOG[kind].staff.actions.flatMap((id) => {
    const definition = RISK_STAFF_ACTIONS[id]
    const href = resolveRiskActionHref(definition, params)
    return href ? [{ id, label: definition.label, hint: definition.hint, href }] : []
  })
}

/** An owner notice as plain text: title, summary, meaning, numbered steps. */
export function renderOwnerRiskNotice(
  kind: RiskEventKind,
  values: RiskNoticeValues,
): { title: string; summary: string; meaning: string; steps: string[] } {
  const copy = RISK_NOTICE_CATALOG[kind].owner
  return {
    title: renderRiskNoticeText(copy.title, values),
    summary: renderRiskNoticeText(copy.summary, values),
    meaning: renderRiskNoticeText(copy.meaning, values),
    steps: copy.steps.map((step) => renderRiskNoticeText(step, values)),
  }
}

/** A staff alert as plain text. */
export function renderStaffRiskNotice(
  kind: RiskEventKind,
  values: RiskNoticeValues,
): { title: string; summary: string } {
  const copy = RISK_NOTICE_CATALOG[kind].staff
  return {
    title: renderRiskNoticeText(copy.title, values),
    summary: renderRiskNoticeText(copy.summary, values),
  }
}

/** The System emails catalog key a kind's owner email is designed under. */
export function riskNoticeEmailKey(kind: RiskEventKind): string {
  return `risk-${kind}`
}

/** The key the burst digest is designed under. */
export const RISK_NOTICE_DIGEST_EMAIL_KEY = 'risk-digest'

/**
 * The kind an abuse-queue row is about, so the staff queue renders the
 * catalog's text for EVERY row a risk source filed — including rows filed
 * before the row carried its notice. The stamp `notifyRiskEvent` writes
 * (`riskNotice.kind`) wins; otherwise the row's own shape says it. Null for
 * a row from the public report form, which is not a risk event.
 */
export function riskKindForAbuseRow(row: {
  source?: unknown
  heldSend?: { kind?: unknown } | null
  riskNotice?: { kind?: unknown } | null
}): RiskEventKind | null {
  const stamped = row.riskNotice?.kind
  if (isRiskEventKind(stamped)) return stamped
  switch (row.source) {
    case 'outbound-screen':
      if (row.heldSend?.kind === 'page') return 'page-held'
      return row.heldSend ? 'email-held' : 'domain-flagged'
    case 'stripe-fraud-signal':
      return 'billing-payment-flagged'
    case 'stripe-seller-fraud-pattern':
      return 'seller-review'
    default:
      return null
  }
}
