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

import type { AglynNotificationType, NotificationLevel } from './notifications'

/**
 * OPERATOR ALERTS (AGL-3377): the events whoever runs an install must hear
 * about, as one typed catalog.
 *
 * Every alert is an entry here (or a plugin's entry in the same shape,
 * registered through `@aglyn/aglyn/plugin-manager/operator-alerts`) and is
 * raised through ONE server entry point, `raiseOperatorAlert` in
 * `@aglyn/tenant-data-admin/server/operator-alerts`. That entry point writes
 * the staff console notification, dedupes a flapping condition, honours the
 * per-type switches staff set on Staff → Operator alerts, and delivers by
 * email (the `operator-alert` system email) and the optional out-of-band
 * webhook. No call site composes or sends its own mail.
 *
 * The catalog holds nothing install-specific: no address, no domain, no
 * host. Recipients come from `resolveStaffAlertRecipients()` and the webhook
 * from `OPERATOR_ALERT_WEBHOOK_URL`, so an entry reads the same on aglyn.com,
 * on a self-hosted install and in an OSS consumer's deployment.
 *
 * Copy is written against merge tokens (`{{orgId}}`), filled from the
 * `context` the call site passes. A token the call site did not supply is
 * blanked, so every sentence must still read when its optional tokens are
 * empty. Never put a data subject's address or other personal data into a
 * context: the alert travels to an inbox and a webhook, not only the console.
 */

/**
 * How much an alert matters.
 *
 * - `must` — money moving with nobody looking, a legal duty unmet, data not
 *   protected or not erased. On and immediate unless staff change it.
 * - `should` — a fault an operator wants to know about today.
 * - `low` — routine review work; on, and batched into the daily digest.
 */
export type OperatorAlertTier = 'must' | 'should' | 'low'

export type OperatorAlertCategory =
  | 'billing'
  | 'payments'
  | 'legal'
  | 'data'
  | 'ops'
  | 'deliverability'
  | 'security'
  | 'support'

/** `digest` batches the alert into the once-a-day operator digest. */
export type OperatorAlertDelivery = 'immediate' | 'digest'

export interface OperatorAlertDefinition {
  /**
   * Stable id, also the key of its settings row. Never rename: staff
   * switches are stored under it. A plugin's types start with its plugin id
   * and a dot (`commerce.taxNotReversed`).
   */
  type: string
  /** The settings row's name. */
  label: string
  /** What it means and the first thing to do, for the settings page. */
  description: string
  tier: OperatorAlertTier
  category: OperatorAlertCategory
  /** The notification title and email subject, with `{{tokens}}`. */
  title: string
  /** What happened and what to do, with `{{tokens}}`. */
  body: string
  /** Console path the alert opens, with `{{tokens}}`; the call may override. */
  link?: string
  /** The coded default; staff may change it. */
  delivery: OperatorAlertDelivery
  /**
   * How long one `dedupeKey` stays quiet after it fired, in minutes. A
   * condition that flaps inside the window is told once. `0` never dedupes.
   * A call without a `dedupeKey` is never deduped.
   */
  dedupeWindowMinutes: number
  /**
   * Fire only once the same `dedupeKey` has been raised this many times
   * inside the window — for an endpoint any stranger can hit, where one
   * refused request is noise and several are a broken secret. Default 1.
   */
  minOccurrences?: number
  /** The coded default; staff may change it. */
  defaultEnabled: boolean
  /**
   * The console notification's type. Absent is the generic
   * `system.operatorAlert`; a type that already had its own notification
   * keeps it, so its icon, label and everyone's mutes are unchanged.
   */
  notificationType?: AglynNotificationType
  /**
   * How loud its console notification is drawn (AGL-3437). Absent, the
   * tier answers — see {@link operatorAlertLevel}. Set where the tone and
   * the importance part ways: a recovery is worth hearing about and is good
   * news, and a degraded check is a must-know that is not yet an outage.
   */
  level?: NotificationLevel
  /** The plugin that contributed it; absent for core's own. */
  pluginId?: string
}

/** Values a call site passes for an alert's `{{tokens}}`. */
export type OperatorAlertContext = Readonly<
  Record<string, string | number | boolean | null | undefined>
>

/** The notification type an alert without its own writes under. */
export const OPERATOR_ALERT_DEFAULT_NOTIFICATION_TYPE: AglynNotificationType =
  'system.operatorAlert'

export const OPERATOR_ALERT_TIER_LABELS: Record<OperatorAlertTier, string> = {
  must: 'Must know',
  should: 'Should know',
  low: 'Routine',
}

/**
 * The level an alert's notification is drawn at when its entry names none:
 * a must-know is red, a should-know amber, routine review work informational.
 */
export const OPERATOR_ALERT_TIER_LEVELS: Record<
  OperatorAlertTier,
  NotificationLevel
> = {
  must: 'critical',
  should: 'warning',
  low: 'info',
}

/** The level an alert's console notification carries (AGL-3437). */
export function operatorAlertLevel(
  definition: Pick<OperatorAlertDefinition, 'tier' | 'level'>,
): NotificationLevel {
  return definition.level ?? OPERATOR_ALERT_TIER_LEVELS[definition.tier]
}

export const OPERATOR_ALERT_CATEGORY_LABELS: Record<
  OperatorAlertCategory,
  string
> = {
  billing: 'Billing',
  payments: 'Payments & payouts',
  legal: 'Legal',
  data: 'Data protection',
  ops: 'Operations',
  deliverability: 'Email deliverability',
  security: 'Security',
  support: 'Support',
}

const DAY = 24 * 60

/**
 * Core's alerts. Plugins contribute theirs through the plugin-manager
 * registry; nothing plugin-specific belongs in this list.
 */
export const CORE_OPERATOR_ALERTS: readonly OperatorAlertDefinition[] = [
  // ── Fraud, risk and legal duties already alerting before AGL-3377 ──────
  {
    type: 'system.abuseReportUrgent',
    label: 'Urgent abuse, fraud or risk alert',
    description:
      'Phishing, malware or CSAM reported on a site, card testing, a flagged or disputed payment, a held phishing email, a seller under review. Review it on Staff → Abuse reports.',
    tier: 'must',
    category: 'security',
    title: '{{title}}',
    body: '{{body}}',
    link: '/admin/abuse-reports',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'system.abuseReportUrgent',
  },
  {
    // The one lock no person placed (AGL-3450): staff confirm it before the
    // customer's appeal arrives, and re-place it as `abuse` or lift it.
    type: 'security.pageSecurityHold',
    label: 'Automatic security hold on a new workspace',
    description:
      'The page screen held a phishing page from a workspace in its first two weeks and locked the workspace, the site and the publishing account as security. Confirm it on Staff → Abuse reports, then re-place it as abuse on Staff → Lockdown, or lift it there if it is a false positive.',
    tier: 'must',
    category: 'security',
    title: 'Security hold placed on {{orgName}}',
    body:
      '{{page}} on {{siteName}} ({{hostId}}) was held for review: {{signal}} Locked as security, pending your review: {{locks}}. The abuse row is {{reference}}. Lift the hold, or re-place it as abuse, on Staff → Lockdown (/admin/lockdown).',
    link: '/admin/abuse-reports?report={{reviewId}}',
    delivery: 'immediate',
    // One hold per workspace; a repeat inside the day is the same event.
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
    notificationType: 'system.abuseReportUrgent',
  },
  {
    type: 'system.disputeUnattributed',
    label: 'Card dispute with no owner',
    description:
      'A chargeback arrived that no subscription, order or marketplace purchase claimed, so nothing is answering it. Find the charge in Stripe and respond before the evidence deadline.',
    tier: 'must',
    category: 'billing',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'system.disputeUnattributed',
  },
  {
    type: 'system.dmcaCounterNotice',
    label: 'DMCA counter-notice',
    description:
      'A customer contested a takedown. The statutory clock is already running; forward it to the complainant and restore on time unless they file suit.',
    tier: 'must',
    category: 'legal',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'system.dmcaCounterNotice',
  },
  {
    type: 'system.billingWebhookHalfApplied',
    label: 'Billing webhook half applied',
    description:
      'A Stripe event threw after its handlers began, so its effects may be partly applied and Stripe will not retry it. Reconcile the event by hand.',
    tier: 'must',
    category: 'billing',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'system.billingWebhookHalfApplied',
  },

  // ── MUST: billing ───────────────────────────────────────────────────────
  {
    type: 'billing.platformDisputeLost',
    label: 'Subscription dispute lost',
    description:
      'A card dispute on a workspace subscription closed as lost: the money has been taken back. Decide whether the workspace keeps its plan.',
    tier: 'must',
    category: 'billing',
    title: 'Subscription dispute lost on workspace {{orgId}}',
    body:
      'The card dispute {{disputeId}} on invoice {{invoiceId}} for workspace {{orgName}} ({{orgId}}) closed as lost ({{reason}}), and {{amount}} was taken back. The workspace keeps its plan until somebody decides otherwise.',
    link: '/admin/orgs/{{orgId}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 30 * DAY,
    defaultEnabled: true,
  },
  {
    type: 'billing.orphanedSubscription',
    label: 'Stripe is billing a workspace that does not exist',
    description:
      'A subscription names a workspace that was deleted or erased, so the customer keeps being charged for nothing. Cancel or refund it in Stripe.',
    tier: 'must',
    category: 'billing',
    title: 'Subscription bills a missing workspace',
    body:
      'Stripe subscription {{subscriptionId}} (customer {{customerId}}, plan {{plan}}) names workspace {{orgId}}, which {{reason}}. The {{eventType}} event changed nothing. Cancel or refund it in Stripe.',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'billing.usageNotReported',
    label: 'Metered usage not reported to Stripe',
    description:
      'A closed month measured billable usage and it reached no invoice. Report it to Stripe by hand or the revenue is lost.',
    tier: 'must',
    category: 'billing',
    title: 'Usage for {{month}} not billed on {{orgId}}',
    body:
      'The closed month {{month}} measured {{amount}} of billable usage on workspace {{orgName}} ({{orgId}}), and it was not reported to Stripe ({{reason}}). Nothing will invoice it until somebody does.',
    link: '/admin/orgs/{{orgId}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 7 * DAY,
    defaultEnabled: true,
  },
  {
    type: 'billing.webhookSignatureRejected',
    label: 'Billing webhook failing its signature check',
    description:
      'Repeated deliveries to the billing webhook were refused because their signature did not match. Usually a rolled signing secret: until it is fixed, Stripe cannot tell the install about money.',
    tier: 'must',
    category: 'billing',
    title: 'Billing webhook is refusing deliveries',
    body:
      'The billing webhook refused several signed deliveries within six hours because their Stripe signature matched none of the configured secrets. If Stripe is the sender, its signing secret no longer matches this install’s, and no billing event is being applied.',
    link: '/admin/health',
    delivery: 'immediate',
    dedupeWindowMinutes: 6 * 60,
    minOccurrences: 3,
    defaultEnabled: true,
  },
  {
    type: 'billing.webhookInert',
    label: 'Billing webhook delivery moved nothing',
    description:
      'Stripe delivered an event this install subscribed to, and no handler did anything with it. Usually a handler that stopped being registered.',
    tier: 'must',
    category: 'billing',
    title: 'A {{eventType}} delivery changed nothing',
    body:
      'Stripe event {{eventId}} ({{eventType}}) was accepted and no handler acted on it. Check which handler stopped being registered, then replay the event.',
    link: '/admin/health',
    delivery: 'immediate',
    dedupeWindowMinutes: 6 * 60,
    defaultEnabled: true,
  },

  // ── MUST: data protection and records ───────────────────────────────────
  {
    type: 'data.personErasureFailed',
    label: 'Personal data erasure failed',
    description:
      'A data subject’s erasure request failed. It will be retried, but the legal deadline keeps running: read the error and fix the cause.',
    tier: 'must',
    category: 'data',
    title: 'Erasure request {{requestId}} failed',
    body:
      'The erasure request {{requestId}} on workspace {{orgName}} ({{orgId}}) failed (attempt {{attempt}}): {{error}}. The statutory deadline keeps running while it retries.',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'data.orgErasureFailed',
    label: 'Workspace erasure failed',
    description:
      'A workspace scheduled for erasure could not be erased. Its data is still held after the date it was promised gone.',
    tier: 'must',
    category: 'data',
    title: 'Workspace {{orgId}} could not be erased',
    body:
      'The scheduled erasure of workspace {{orgName}} ({{orgId}}) did not complete: {{reason}}. It will be retried on the next run; its data is held until it succeeds.',
    link: '/admin/orgs/{{orgId}}',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'data.backupExportFailed',
    label: 'Database export failed',
    description:
      'The scheduled database export did not start. A stale export means the worst day has nothing to restore from.',
    tier: 'must',
    category: 'data',
    title: 'Database export failed',
    body:
      'The scheduled database export did not start ({{reason}}). The last good export is getting older; check the service account’s export permission and the bucket.',
    link: '/admin/health',
    delivery: 'immediate',
    dedupeWindowMinutes: 12 * 60,
    defaultEnabled: true,
  },

  // ── MUST: legal ─────────────────────────────────────────────────────────
  {
    type: 'legal.abuseReportHigh',
    label: 'Takedown, impersonation or illegal-content report',
    description:
      'A DMCA takedown, impersonation or illegal-content report. Each carries a response duty; review it on Staff → Abuse reports.',
    tier: 'must',
    category: 'legal',
    title: '{{category}} report on {{site}}',
    body:
      '{{site}} was reported for {{category}}. Reference {{reference}}. Review it and respond within the policy’s window.',
    link: '/admin/abuse-reports',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
  },

  // ── MUST/SHOULD: health ─────────────────────────────────────────────────
  {
    type: 'system.healthDegraded',
    label: 'Health check degraded',
    description:
      'A health check went from healthy to degraded: scheduled jobs silent, backups stale, billing deliveries failing, sign-ups refused, server errors, a site not rendering. Told once per incident.',
    tier: 'must',
    category: 'ops',
    title: '{{check}} is degraded',
    body: '{{check}} went from healthy to degraded. {{detail}}',
    link: '/admin/health',
    delivery: 'immediate',
    // Must-know, and still amber rather than red: degraded is not down.
    level: 'warning',
    // A check flapping across the line is told once an hour, not on
    // every swing.
    dedupeWindowMinutes: 60,
    defaultEnabled: true,
  },
  {
    // The post-deploy production canary (AGL-3567), raised from GitHub
    // Actions through `/api/admin/operator-alerts/canary`. Red because a
    // deploy that stops rendering pages is every published site down.
    type: 'ops.productionCanaryRed',
    label: 'Production canary failed after a deploy',
    description:
      'Right after a tenant or console production deploy, uncached pages stopped rendering. The canary rolls the deploy back by itself when the failure holds across sites; after any rollback the next release must be promoted by hand.',
    tier: 'must',
    category: 'ops',
    title: '{{project}} production canary: {{outcome}}',
    body: '{{detail}}',
    link: '/admin/health',
    delivery: 'immediate',
    level: 'critical',
    // The caller dedupes per deployment and verdict; this only stops a
    // re-run of the same red run from telling it twice.
    dedupeWindowMinutes: 30,
    defaultEnabled: true,
  },
  {
    type: 'system.healthRecovered',
    label: 'Health check recovered',
    description: 'A degraded health check is healthy again.',
    tier: 'should',
    category: 'ops',
    title: '{{check}} recovered',
    body: '{{check}} is healthy again after {{duration}}.',
    link: '/admin/health',
    delivery: 'immediate',
    level: 'success',
    // A check flapping across the line is told once an hour, not on
    // every swing.
    dedupeWindowMinutes: 60,
    defaultEnabled: true,
  },
  {
    // The render monitor (AGL-3568): a published site fetched over HTTP, on
    // pages no cache can answer, failed several runs in a row. Red, not the
    // amber of a degraded check: every visitor without a cached copy is
    // getting an error page or a timeout right now.
    type: 'system.siteRenderFailing',
    label: 'Published site not rendering pages',
    description:
      'The render monitor asked a published site for pages no cache can answer, several runs in a row, and got no complete page back. Visitors to cached pages may still see them, so the site can look up while every other page fails. Check the latest site runtime deployment first and roll it back if it just shipped.',
    tier: 'must',
    category: 'ops',
    title: 'Pages are not rendering on {{site}}',
    body:
      '{{site}} failed {{failures}} render checks in a row, over {{since}}. {{detail}} Cached pages may still load, so the site can look up while new renders fail.',
    link: '/admin/health',
    delivery: 'immediate',
    // Told once per outage: the monitor raises it on the edge, and the
    // window only covers a site flapping across the line.
    dedupeWindowMinutes: 30,
    defaultEnabled: true,
  },
  {
    type: 'system.siteRenderRecovered',
    label: 'Published site rendering again',
    description:
      'A published site the render monitor had reported as not rendering serves fresh pages again.',
    tier: 'should',
    category: 'ops',
    title: '{{site}} is rendering pages again',
    body: 'Fresh page renders on {{site}} pass again after {{duration}}.',
    link: '/admin/health',
    delivery: 'immediate',
    level: 'success',
    dedupeWindowMinutes: 30,
    defaultEnabled: true,
  },

  // ── SHOULD: billing ─────────────────────────────────────────────────────
  {
    type: 'billing.autoLocked',
    label: 'Workspace billing locked automatically',
    description:
      'A workspace crossed its spend guard and the platform locked its billable activity. Check it is not a false positive before the customer notices.',
    tier: 'should',
    category: 'billing',
    title: 'Billing locked on {{orgName}}',
    body:
      'Workspace {{orgName}} ({{orgId}}) was locked automatically: {{reason}}.',
    link: '/admin/orgs/{{orgId}}',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'billing.platformInvoiceUncollectible',
    label: 'Subscription invoice voided or uncollectible',
    description:
      'A workspace invoice was voided or marked uncollectible: revenue the books expected is not coming.',
    tier: 'should',
    category: 'billing',
    title: 'Invoice {{status}} on {{orgId}}',
    body:
      'Invoice {{invoiceId}} for {{amount}} on workspace {{orgName}} ({{orgId}}) was marked {{status}}, so Stripe has stopped collecting it.',
    link: '/admin/orgs/{{orgId}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 30 * DAY,
    defaultEnabled: true,
  },
  {
    type: 'billing.connectPayoutFailed',
    label: 'Connected account payout or transfer failed',
    description:
      'Money due to a merchant or seller did not arrive. Stripe retries on its own schedule; a human decides what happens next.',
    tier: 'should',
    category: 'billing',
    title: 'A {{kind}} to {{account}} failed',
    body:
      'A {{amount}} Stripe {{kind}} ({{stripeId}}) to connected account {{account}} ({{merchant}}) failed: {{reason}}. The merchant’s funds are not where the ledger says.',
    delivery: 'immediate',
    dedupeWindowMinutes: 30 * DAY,
    defaultEnabled: true,
  },
  {
    type: 'staff.paymentFailed',
    label: 'Workspace payment failed',
    description:
      'A paying workspace’s renewal failed. Stripe is retrying; the customer has been told.',
    tier: 'should',
    category: 'billing',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'staff.paymentFailed',
  },

  // ── SHOULD: security ────────────────────────────────────────────────────
  {
    type: 'security.staffGranted',
    label: 'Staff access granted or raised',
    description:
      'Somebody was made staff, or a staff role was raised. If nobody on the team did it, revoke it and rotate credentials.',
    tier: 'should',
    category: 'security',
    title: '{{target}} is now {{role}} staff',
    body: '{{actor}} granted {{target}} the {{role}} staff role (was {{previous}}).',
    link: '/admin/users',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
  },

  // ── SHOULD: support ─────────────────────────────────────────────────────
  {
    type: 'support.slaBreached',
    label: 'Support ticket past its response time',
    description:
      'A support ticket passed its promised response time without a staff reply.',
    tier: 'should',
    category: 'support',
    title: 'Ticket past its response time: {{subject}}',
    body:
      'The {{tier}} ticket “{{subject}}” from workspace {{orgName}} ({{orgId}}) was due a first response {{overdue}} ago and has none.',
    // The ticket itself: the support page opens `?ticketId=` on load.
    link: '/admin/support?ticketId={{ticketId}}',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'support.ticketOpened',
    label: 'New support ticket',
    description: 'A subscriber opened a support ticket.',
    tier: 'should',
    category: 'support',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'digest',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'support.ticketOpened',
    // A customer asking for help, not a fault.
    level: 'info',
  },
  {
    type: 'support.ticketReply',
    label: 'Support ticket reply',
    description: 'A subscriber replied on a support ticket.',
    tier: 'should',
    category: 'support',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'digest',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'support.ticketReply',
    level: 'info',
  },

  // ── SHOULD: deliverability ──────────────────────────────────────────────
  {
    type: 'deliverability.sendRateSaturated',
    label: 'Email send-rate governor saturated',
    description:
      'The platform’s email send-rate budget is exhausted, so sends are being deferred. Raise the budget or find the sender filling it.',
    tier: 'should',
    category: 'deliverability',
    title: 'Email sending is being throttled',
    body:
      'The {{scope}} send-rate budget is full ({{detail}}), so sends are being deferred.',
    link: '/admin/emails',
    delivery: 'immediate',
    dedupeWindowMinutes: 6 * 60,
    defaultEnabled: true,
  },
  {
    type: 'deliverability.sendRateUnavailable',
    label: 'Email send-rate governor unavailable',
    description:
      'The send-rate governor could not read its counters, so mail is going out unmetered: nothing is holding the shared domains under their hourly ceiling.',
    tier: 'should',
    category: 'deliverability',
    title: 'Email send-rate governor unavailable',
    body:
      'The send-rate governor could not read its counters ({{error}}), so sends are being allowed unmetered until it can.',
    link: '/admin/emails',
    delivery: 'immediate',
    dedupeWindowMinutes: 6 * 60,
    defaultEnabled: true,
  },
  {
    type: 'deliverability.gatewayBlocking',
    label: 'A recipient gateway is blocking the shared domain',
    description:
      'A mail gateway is refusing mail from the shared sending domain, so everyone behind that gateway stops receiving it.',
    tier: 'should',
    category: 'deliverability',
    title: '{{gateway}} is blocking {{domain}}',
    body:
      'Mail from {{domain}} is being refused by {{gateway}} ({{detail}}). Recipients behind that gateway are not receiving it.',
    link: '/admin/emails',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'deliverability.providerCredentialsRejected',
    label: 'Email provider rejected the credentials',
    description:
      'The email provider refused the API key, or a sending pool is unhealthy: invites, password resets and receipts are not leaving. The webhook channel is the one that still reaches you.',
    tier: 'should',
    category: 'deliverability',
    title: 'Email delivery is failing: {{problem}}',
    body: '{{detail}}',
    link: '/admin/emails',
    delivery: 'immediate',
    dedupeWindowMinutes: 6 * 60,
    defaultEnabled: true,
  },
  {
    // A purchasing ceiling, not a job failure: the provisioning sweep ran
    // and every site keeps sending, so the copy must not read as an outage.
    type: 'deliverability.sendingDomainCapacityFull',
    label: 'Sending-domain allowance full',
    description:
      'Every dedicated sending domain the provider allowance covers is in use, so new sites that ask for one stay on the shared pool. No mail is lost; raise the allowance or move merchants onto domains they own.',
    tier: 'should',
    category: 'deliverability',
    title: 'Sending-domain allowance full ({{held}}/{{capacity}})',
    body:
      'The sending-domain allowance is full ({{held}} of {{capacity}} in use), so sites that asked for a dedicated domain keep sending on the shared pool. No mail is lost: what they go without is the isolation a domain of their own buys, and their campaigns are held to the pool’s stricter reputation limits. Raise AGLYN_SENDING_DOMAIN_CAPACITY once the provider allowance covers it, or move merchants onto domains they own.',
    link: '/admin/emails',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },

  // ── SHOULD: operations ──────────────────────────────────────────────────
  {
    type: 'ops.reaperStuck',
    label: 'A reaper is stuck or failing',
    description:
      'A cleanup job (sending domains, unverified workspaces) could not finish, so what it removes keeps accumulating.',
    tier: 'should',
    category: 'ops',
    title: '{{job}} is stuck',
    body: '{{job}} could not finish: {{detail}}',
    delivery: 'immediate',
    dedupeWindowMinutes: DAY,
    defaultEnabled: true,
  },
  {
    type: 'ops.pluginJobFailed',
    label: 'A plugin job failed',
    description:
      'A plugin’s scheduled job threw: consent-group changes, the publish outbox, sending-domain provisioning, a plugin cron.',
    tier: 'should',
    category: 'ops',
    // `job` is a noun phrase that reads as a subject on its own ("The
    // publish outbox drain", "The scheduled job acme-mail-send"), so the
    // title and the body open with the same words.
    title: '{{job}} failed',
    body: '{{job}} failed: {{error}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 6 * 60,
    defaultEnabled: true,
  },
  {
    type: 'system.pluginVerifierRegression',
    label: 'Plugin verifier regression',
    description:
      'A live plugin version stopped passing the static verifier.',
    tier: 'should',
    category: 'security',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'system.pluginVerifierRegression',
  },
  {
    type: 'system.bandwidthCeilingTripped',
    label: 'Bandwidth ceiling reached',
    description:
      'A site crossed the per-month bandwidth abuse ceiling.',
    tier: 'should',
    category: 'ops',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'system.bandwidthCeilingTripped',
  },

  // ── LOW ─────────────────────────────────────────────────────────────────
  {
    type: 'marketplace.review',
    label: 'Plugin listing waiting for review',
    description: 'A plugin listing or version was submitted for review.',
    tier: 'low',
    category: 'security',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'digest',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'marketplace.review',
  },
  {
    type: 'system.scopeDrift',
    label: 'Resources missing a sharing scope',
    description:
      'The weekly sweep found documents invisible to every site-scoped read: a creation path forgot the field.',
    tier: 'low',
    category: 'data',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'digest',
    dedupeWindowMinutes: 0,
    defaultEnabled: true,
    notificationType: 'system.scopeDrift',
  },
]

/** An amount in minor units, as an alert prints it: `$12.40`. */
export function formatOperatorAlertAmount(
  cents: number,
  currency = 'usd',
): string {
  const value = Number(cents) / 100
  if (!Number.isFinite(value)) return ''
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'usd').toUpperCase(),
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${String(currency).toUpperCase()}`
  }
}

/** Replaces each `{{token}}` with its context value, or nothing. */
export function renderOperatorAlertTemplate(
  template: string,
  context: OperatorAlertContext | undefined,
): string {
  return String(template ?? '')
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => {
      const value = context?.[name]
      return value === null || value === undefined ? '' : String(value)
    })
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,;:])/g, '$1')
    .trim()
}

/** A staff member's answer for one type; an absent key keeps the default. */
export interface OperatorAlertTypeSetting {
  enabled?: boolean
  delivery?: OperatorAlertDelivery
}

/** `platformSettings/operatorAlerts`, keyed by alert type. */
export interface OperatorAlertSettings {
  types?: Record<string, OperatorAlertTypeSetting>
}

/** Whether a type is on, and how it is delivered, after staff's answers. */
export function effectiveOperatorAlertSetting(
  definition: Pick<OperatorAlertDefinition, 'type' | 'delivery' | 'defaultEnabled'>,
  settings: OperatorAlertSettings | null | undefined,
): { enabled: boolean; delivery: OperatorAlertDelivery } {
  const answer = settings?.types?.[definition.type]
  return {
    enabled:
      typeof answer?.enabled === 'boolean'
        ? answer.enabled
        : definition.defaultEnabled,
    delivery:
      answer?.delivery === 'immediate' || answer?.delivery === 'digest'
        ? answer.delivery
        : definition.delivery,
  }
}

/**
 * Staff notification types whose alert emails the operator on a coded
 * default of immediate (AGL-3375), derived from the catalog so there is one
 * list.
 */
export const OPERATOR_ALERT_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(
  CORE_OPERATOR_ALERTS.flatMap((definition) =>
    definition.notificationType ? [definition.notificationType] : [],
  ),
)
