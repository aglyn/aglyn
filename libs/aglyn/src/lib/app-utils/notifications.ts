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

import type { ITimestamp } from '@aglyn/shared-util-timestamp'

/**
 * In-app notifications (AGL-259): per-user docs at
 * `users/{uid}/notifications/{id}`, written by the Admin SDK (emitters in
 * the API routes + the `notifyAdmins` automation step) and read/marked by
 * their owner. Types follow the common SaaS taxonomy so the console can
 * icon/group them without a registry.
 */
export type AglynNotificationType =
  | 'billing.invoice'
  | 'billing.paymentFailed'
  // Stripe gave up on a failed renewal and CANCELLED the subscription
  // (AGL-1877). Distinct from `paymentFailed`, which announces one failed
  // attempt inside a retry window the customer can still recover from; this
  // one is the window having closed. Measured on the test account with a
  // test clock: five attempts over 21.08 days, then
  // `cancellation_details.reason: 'payment_failed'` — and until this existed
  // the org went silently to Free at that moment, with the `past_due` banner
  // disappearing at exactly the instant the consequence arrived.
  | 'billing.subscriptionCanceled'
  | 'billing.usage'
  | 'team.invite'
  | 'team.roleChanged'
  | 'team.hostAccessGranted'
  | 'content.formSubmission'
  | 'content.booking'
  | 'content.order'
  | 'content.lowStock'
  // A CRM task was assigned to the recipient by somebody else (AGL-2599).
  // `content.` because it is the same kind of message as a form submission
  // or a booking: a thing on the site that now needs this person's hands,
  // not a change to their standing (`team.`) and not a platform notice
  // (`system.`). Someone who has muted the operational stream has said they
  // do not want to be told about work as it arrives, and a task is work.
  | 'content.taskAssigned'
  // A CRM task's reminder came due (AGL-2659): the hourly runner telling
  // the assignee, at the task's own time, that the task is due. `content.`
  // beside `taskAssigned` for the same reason it gives — work on the site,
  // not standing — and so the one mute that stops "work arriving" stops
  // "work falling due" with it. The mute governs the whole reminder, mail
  // included, unlike the digest's: a reminder is one message about one
  // task, and there is no schedule to keep separately from it.
  | 'content.taskReminder'
  // A contact, or a lead, became the recipient's to work (AGL-2618): a
  // capture the assignment rules or the site's default owner routed to
  // them, a lead somebody converted and handed to them, or an automation's
  // "assign an owner" step — every server path that writes `ownerUid`
  // except the recipient assigning themselves. Two types rather than one
  // because the record the person opens differs: a lead is the site's own
  // working record and a contact is the org's, and the link goes to the
  // one they will actually work. `content.`, beside `taskAssigned`, for the
  // same reason: work arriving, not standing changing.
  | 'content.contactAssigned'
  | 'content.leadAssigned'
  // The morning's CRM digest (AGL-2619): what the recipient owes today —
  // overdue and due-today tasks, and the leads nobody has worked. `content.`
  // for the reason `taskAssigned` is: it is about work on the site, and the
  // person who muted the operational stream has asked not to be told about
  // work. The digest EMAIL is governed separately, by
  // `crmDailyDigestEnabled`: the mute is a fact about the console feed and
  // the digest switch is a fact about the digest.
  | 'content.crmDailyDigest'
  // The weekly insights (AGL-2915): what a site's figures showed that week,
  // for a person who asked for them. `content.` beside the CRM digest, for the
  // reason that one gives: it is about the site's work, and the operational
  // mute governs the console notification while the person's own switch for
  // the digest governs the digest.
  | 'content.insightsDigest'
  // Marketplace review verdicts (AGL-432/653).
  | 'marketplace.review'
  // Support desk, staff audience (AGL-850): a subscriber opened or replied to
  // a ticket. Fanned out to staff-claim holders, not org members.
  | 'support.ticketOpened'
  | 'support.ticketReply'
  | 'system.announcement'
  // A live plugin version stopped passing the static verifier (AGL-1086).
  // Staff audience: bytes we told workspaces were checked now fail checks
  // that did not exist when they were approved.
  //
  // Deliberately NOT under `marketplace.` (AGL-1088). Category is the prefix,
  // categories are mutable per user, and Marketplace is the category a staff
  // member mutes to stop routine listing-review chatter — which would drop
  // this alert as collateral. `system` is the bucket nobody mutes to reduce
  // noise. The adminAudit record survives a mute either way; the timeliness
  // does not, and timeliness is the whole point of the alert.
  | 'system.pluginVerifierRegression'
  // A sign-in method was removed from the user's own account because their
  // organization turned on SSO enforcement (AGL-1129). `system.`, not
  // `team.`, for the AGL-1088 reason above: `team` is the category someone
  // mutes to stop routine roster chatter, and "the way you sign in just
  // changed" is not chatter — the next sign-in fails without it.
  | 'system.signInMethodRemoved'
  // Documents in a scoped collection carrying no `visibleTo` (AGL-1478).
  // Staff audience: the weekly dry run found resources that are invisible
  // to every site-scoped read, which always means a creation path forgot
  // the field. `system.` for the AGL-1088 reason above, and because the
  // collection it names may be `marketplace`-adjacent or not.
  | 'system.scopeDrift'
  // An SSO domain that WAS DNS-proven has stopped answering with our
  // challenge record, for three consecutive weekly sweeps (AGL-1210).
  // Nothing has been turned off — sign-in for that domain still routes
  // exactly as it did — and that is precisely why this has to be said out
  // loud rather than left in a log.
  //
  // `system.`, not `team.`, for the AGL-1088 reason above and one of its
  // own: the audience is the org's own admins, the subject is whether their
  // people can still sign in, and it must reach them BEFORE anybody decides
  // to revoke the routing. A category somebody mutes to quieten roster
  // chatter is the wrong place for the one warning that precedes a lockout.
  | 'system.ssoDomainUnverified'
  // A site hit the per-month form-submission abuse ceiling and further
  // submissions are being refused (AGL-1655). `system.`, not `content.`, for
  // the AGL-1088 reason above and more sharply than any of them: `content` is
  // literally the category a site owner mutes to stop routine form-submission
  // chatter, and this is the one form notification that says the form has
  // STOPPED accepting. Filing it under the muted bucket would guarantee it
  // reaches nobody on exactly the sites busy enough to trip it.
  | 'system.formSubmissionsPaused'
  // A site reached the flat platform ceiling on member accounts or on lead
  // records, so further ones are being refused (AGL-1529). `system.` for the
  // same reason as `formSubmissionsPaused` directly above, and with the same
  // sharpness: `content.` is the bucket an owner mutes to stop routine
  // sign-up and lead chatter, and this is the one notification saying the
  // sign-ups have STOPPED — muted exactly on the sites busy enough to trip it.
  | 'system.visitorRecordsPaused'
  // An outsider reported one of our sites for phishing, malware or CSAM
  // (AGL-1964). `system` for the AGL-1088 reason and, again, more sharply
  // than most: this notification goes to STAFF, not to a customer, and its
  // subject is somebody else's site. There is no bucket a recipient could
  // mute it into that would be honest — nobody has opted into being told a
  // stranger is being phished through our platform, and nobody should be able
  // to opt out of it either.
  //
  // Only the urgent categories raise one, and only on a first report. See the
  // fan-out in apps/tenant/app/api/report-abuse/route.ts for why: a flood of
  // alerts IS the flood, and the alert it would cost us is the phishing one.
  | 'system.abuseReportUrgent'
  // The §512(g) counter-notice (AGL-1983), and the one place the "only urgent
  // categories raise a notification" restraint above is deliberately not
  // applied. Every counter-notice carries a statutory deadline that is
  // ALREADY RUNNING when it arrives — the clock counts from the subscriber's
  // submission, not from our attention — so there is no low-value tail of
  // these to drown out the important ones, and the one that goes unread is a
  // customer locked out of their own work plus an unmet obligation under
  // §512(g)(2)(A). Raised on first submission only, like the one above, so a
  // resubmitting customer cannot re-alert.
  | 'system.dmcaCounterNotice'
  // A site crossed the per-month bandwidth abuse ceiling (AGL-2155). Two
  // audiences share one type: staff, because an uncompensated free site
  // serving six figures of page views is an incident; and the site's own
  // managers, because on free the site is now serving a capped notice and
  // nobody should learn that from a visitor.
  //
  // `system.`, not `billing.`, for the AGL-1088 reason and one specific to
  // this meter: on the free plan there is no bill, so `billing` would be the
  // one category where the message is literally never about money — and it is
  // exactly the free-tier trip that changes what visitors see.
  | 'system.bandwidthCeilingTripped'
  // A free site crossed its PLAN's included bandwidth and is now serving the
  // capped notice (AGL-2413). Distinct from the ceiling above on purpose: that
  // one is an incident at 10x the band and goes to staff first; this one is an
  // ordinary quota at 1x, concerns only the site's own managers, and its
  // remedy is an upgrade rather than an investigation. Sending both under one
  // type would tell an owner their traffic was being treated as suspected
  // abuse when it is simply a successful free site.
  | 'system.bandwidthCapEngaged'
  // A Stripe billing webhook threw AFTER its handlers had begun (AGL-2157),
  // so its side effects may be half applied and its idempotency claim is
  // being HELD — Stripe will not retry it. Staff audience: this is the one
  // failure on that route no automatic retry can make safe, because the
  // handlers behind it are not all idempotent, and a human has to reconcile.
  | 'system.billingWebhookHalfApplied'
  // A card dispute arrived that NOTHING in the platform claimed (AGL-2429):
  // no `platformRevenue` row, no storefront order, no marketplace purchase.
  // Staff audience, and the reason it needs a type of its own is that its
  // absence was the bug — the routine case (a storefront or marketplace
  // chargeback, which the plugins own) and the fault case were the same
  // silence from the route's side, so a dispute nobody handled looked
  // exactly like one somebody did.
  //
  // `system.`, not `billing.`, for the AGL-1088 reason and one specific to
  // this alert: `billing` is the category a recipient is most likely to have
  // muted as routine invoice traffic, and this is the one message on that
  // route where muting it means money moves with nobody looking.
  | 'system.disputeUnattributed'
  // Somebody created an account, and somebody created a workspace
  // (AGL-3225). Staff audience, and the only two types in the taxonomy whose
  // subject is the platform's own growth rather than anybody's work.
  //
  // `staff.`, and NOT `system.`, and the AGL-1088 note above is the reason
  // rather than an exception to it: `system` is the bucket nobody mutes to
  // reduce noise, which is exactly what makes it the wrong home for the two
  // routine, high-volume events in the product. A staff member must be able
  // to stop hearing about every sign-up without also dropping the verifier
  // regression and the unattributed dispute that share that bucket — and
  // before this category existed, there was nowhere to put them where that
  // was true.
  //
  // The category also tells the settings page who a row is for: `staff` is
  // rendered only to claim holders, so no customer is shown a switch for
  // notifications they could never receive.
  | 'staff.userSignedUp'
  | 'staff.orgCreated'
  // And when money moves (AGL-3267). The category was two signup types, so
  // the one thing a platform feed exists to report — revenue starting,
  // changing and stopping — was the one thing it did not.
  //
  // `staff.paymentFailed` is deliberately NOT the customer's
  // `billing.paymentFailed`: different audience, different action. The
  // customer is told to fix their card; staff are told a paying workspace is
  // about to stop paying.
  | 'staff.subscriptionStarted'
  | 'staff.subscriptionCanceled'
  | 'staff.planChanged'
  | 'staff.paymentFailed'

export interface AglynNotification {
  $id?: string
  type: AglynNotificationType
  title: string
  body?: string
  /** Console path the notification opens (e.g. a host inbox). */
  link?: string
  orgId?: string
  hostId?: string
  createdAt?: ITimestamp
  /** Set by the owner when read; unread while absent. */
  readAt?: ITimestamp | null
}

export const NOTIFICATION_TYPE_LABELS: Record<AglynNotificationType, string> = {
  'billing.invoice': 'Invoice available',
  'billing.paymentFailed': 'Payment failed',
  'billing.subscriptionCanceled': 'Subscription canceled',
  'billing.usage': 'Usage threshold',
  'team.invite': 'Team invite',
  'team.roleChanged': 'Role changed',
  'team.hostAccessGranted': 'Site access granted',
  'content.formSubmission': 'Form submission',
  'content.booking': 'New booking',
  'content.order': 'New order',
  'content.lowStock': 'Low stock',
  'content.taskAssigned': 'Task assigned to you',
  'content.taskReminder': 'Task reminder',
  'content.contactAssigned': 'Contact assigned to you',
  'content.leadAssigned': 'Lead assigned to you',
  'content.crmDailyDigest': 'Daily CRM digest',
  'content.insightsDigest': 'Weekly insights',
  'marketplace.review': 'Listing review',

  'support.ticketOpened': 'New support ticket',
  'support.ticketReply': 'Support ticket reply',
  'system.announcement': 'Announcement',
  'system.pluginVerifierRegression': 'Plugin verifier regression',
  'system.signInMethodRemoved': 'Sign-in method removed',
  'system.scopeDrift': 'Resources missing a sharing scope',
  'system.ssoDomainUnverified': 'SSO domain no longer proves ownership',
  'system.formSubmissionsPaused': 'Form submissions paused',
  'system.visitorRecordsPaused': 'Sign-ups or leads paused',
  'system.abuseReportUrgent': 'Urgent abuse report',
  'system.dmcaCounterNotice': 'DMCA counter-notice',
  'system.bandwidthCeilingTripped': 'Bandwidth ceiling reached',
  'system.bandwidthCapEngaged': 'Monthly traffic limit reached',
  'system.billingWebhookHalfApplied': 'Billing webhook half applied',
  'system.disputeUnattributed': 'Card dispute with no owner',
  'staff.userSignedUp': 'New account',
  'staff.orgCreated': 'New workspace',
  'staff.subscriptionStarted': 'New subscription',
  'staff.subscriptionCanceled': 'Subscription canceled',
  'staff.planChanged': 'Plan changed',
  'staff.paymentFailed': 'Payment failed (workspace)',
}

/** Preference buckets (AGL-267): the prefix before the dot. */
export type NotificationCategory =
  | 'billing'
  | 'team'
  | 'content'
  | 'marketplace'
  | 'support'
  | 'system'
  // Staff-only, and shown only to staff (AGL-3225) — see
  // {@link STAFF_NOTIFICATION_CATEGORIES}.
  | 'staff'

export const NOTIFICATION_CATEGORY_LABELS: Record<
  NotificationCategory,
  string
> = {
  billing: 'Billing',
  team: 'Team & access',
  content: 'Forms & bookings',
  marketplace: 'Marketplace',
  support: 'Support',
  system: 'Product & system',
  staff: 'Platform growth',
}

/**
 * The categories only staff can receive (AGL-3225).
 *
 * The settings page hides these rows from everybody else, because a switch
 * for mail that can never arrive is a promise the product does not keep. It
 * is presentation only: `notifyStaff` is what decides the audience, and it
 * enumerates the `staff` claim rather than reading this.
 */
export const STAFF_NOTIFICATION_CATEGORIES: ReadonlySet<NotificationCategory> =
  new Set<NotificationCategory>(['staff'])

/**
 * What each category actually covers, in the reader's words (AGL-3251).
 *
 * The settings page listed seven bare labels and two switches, so deciding
 * whether to silence `Product & system` meant guessing what was in it. The
 * type labels beneath each row now name the contents exactly; this is the
 * one-line answer for somebody who does not want to expand anything.
 *
 * Written as what ARRIVES rather than as what the bucket is called: "someone
 * joins, a role changes" is checkable against your own feed in a way that
 * "team and access events" is not. Exhaustive `Record`, like the channel
 * defaults below — a new category cannot ship without somebody saying in
 * plain words what lands in it.
 */
export const NOTIFICATION_CATEGORY_DESCRIPTIONS: Record<
  NotificationCategory,
  string
> = {
  billing:
    'Invoices, failed payments, cancellations, and usage that crosses a plan limit.',
  team: 'Somebody joins or leaves, a role changes, or a site is shared with you.',
  content:
    'Work arriving on your sites: form submissions, bookings, orders, low stock, and the tasks and leads assigned to you.',
  marketplace: 'Decisions on plugin listings you submitted for review.',
  support: 'New support tickets and replies on tickets you are following.',
  system:
    'Announcements, and the faults the platform finds in your account: sign-in methods removed, traffic limits reached, billing or sharing left in a broken state.',
  staff:
    'New accounts, new workspaces, and money moving — subscriptions starting, changing, failing and ending — across the whole platform. Only staff receive these.',
}

export function notificationCategory(
  type: AglynNotificationType | string,
): NotificationCategory {
  const prefix = String(type).split('.')[0]
  return (
    [
      'billing',
      'team',
      'content',
      'marketplace',
      'support',
      'system',
      'staff',
    ].includes(prefix)
      ? prefix
      : 'system'
  ) as NotificationCategory
}

/**
 * Per-user mute map stored at `users/{uid}.notificationPrefs`
 * (`{ [category]: false }` mutes); absent categories stay on.
 */
export function notificationMuted(
  prefs: Record<string, boolean> | null | undefined,
  type: AglynNotificationType | string,
): boolean {
  return prefs?.[notificationCategory(type)] === false
}

/**
 * The field on `users/{uid}` that holds a person's digest switches
 * (AGL-2619): `{ crmDaily: false }` turns the daily CRM digest off, and an
 * absent key leaves it on. Its own map rather than a key in
 * `notificationPrefs`, because that map is keyed by CATEGORY and read by
 * {@link notificationMuted} — a digest is a schedule a person keeps or
 * drops, not a bucket of types, and one switch governs both the console
 * notification and the email it travels with.
 */
export const DIGEST_PREFS_FIELD = 'digestPrefs'

/**
 * The key the daily CRM digest keeps inside {@link DIGEST_PREFS_FIELD}.
 *
 * Exported so the console writes the switch through a name rather than a
 * second copy of the string (AGL-3230). The reader below and the page that
 * flips it were spelling the same literal in two files, which is how a
 * preference comes to be written under one key and read under another — and
 * it kept the plugin's vocabulary in a console page, where
 * `check:plugin-domain-in-core` rightly refuses it.
 */
export const CRM_DAILY_DIGEST_KEY = 'crmDaily'

export function crmDailyDigestEnabled(
  prefs: Record<string, boolean> | null | undefined,
): boolean {
  return prefs?.[CRM_DAILY_DIGEST_KEY] !== false
}

/**
 * The field on `users/{uid}` naming the workspaces whose weekly insights a
 * person asked for (AGL-2915): `{ [orgId]: true }`. OPT-IN, unlike the CRM
 * digest — an absent key is off — because a weekly insight is generated, and a
 * generation spends the workspace's credits. The person turns it on beside the
 * answers themselves, where the plan, the release and their permission have
 * already been checked, and off again there or in Notifications; the weekly
 * sweep checks all three again before it spends anything.
 */
export const INSIGHT_DIGESTS_FIELD = 'insightDigests'

/** Whether a person asked for a workspace's weekly insights. */
export function insightDigestSubscribed(
  value: Record<string, boolean> | null | undefined,
  orgId: string,
): boolean {
  return Boolean(orgId) && value?.[orgId] === true
}

/**
 * The channels a notification can travel on (AGL-3223).
 *
 * `console` is the feed at `/manage/notifications` and the app-bar dropdown
 * that reads it — the only channel that existed. `email` is the message the
 * fan-out sends beside that doc when the recipient asked for one.
 */
export type NotificationChannel = 'console' | 'email'

/**
 * One scope's answer for one category. **Tri-state on purpose**: `true` and
 * `false` decide, and an ABSENT key inherits from the scope above.
 *
 * Inheritance is the whole reason this is a partial rather than a pair of
 * booleans. A person who wants form submissions from one busy site and not
 * from the other five has to be able to say that about the one site without
 * restating their answer for every other category at every other scope — and
 * a two-valued leaf cannot express "I have not said", so every override would
 * have to be written out in full and would then stop tracking the account
 * default it was never meant to detach from.
 */
export interface NotificationChannelPrefs {
  console?: boolean
  email?: boolean
}

export type NotificationCategoryPrefs = Partial<
  Record<NotificationCategory, NotificationChannelPrefs>
>

/**
 * One scope's answer for a single notification TYPE (AGL-3251), tri-state on
 * the same terms as {@link NotificationChannelPrefs}: an absent key falls
 * through to the category.
 *
 * Its own map rather than extra keys in {@link NotificationCategoryPrefs},
 * because that one is an exhaustive record keyed by category and a type key
 * inside it would type-check only by widening the thing that makes a missing
 * category a compile error.
 */
export type NotificationTypePrefs = Partial<
  Record<AglynNotificationType, NotificationChannelPrefs>
>

/**
 * Per-scope, per-channel notification preferences (AGL-3223), stored at
 * `users/{uid}.notificationSettings`.
 *
 * Three layers, narrowest first when resolving: the SITE a notification
 * concerns, then the WORKSPACE, then the account. Anything none of them
 * answers falls to {@link NOTIFICATION_CHANNEL_DEFAULTS}.
 *
 * ON THE USER DOCUMENT, not on `orgs/{orgId}/members/{uid}`, and that is a
 * cost decision rather than a modelling preference. `notifyUsers` already
 * does exactly one `getAll` over the recipients' user docs to read their
 * category mutes, so every layer living here means per-site preferences are
 * read for free on the fan-out's hot path. The member row would add a read
 * per recipient per notification to answer a question the document already in
 * hand could have answered.
 */
export interface NotificationSettings {
  account?: NotificationCategoryPrefs
  /**
   * Per-TYPE answers at the account scope (AGL-3251), consulted before
   * {@link NotificationSettings.account}'s category answer and never above a
   * narrower scope — see {@link notificationChannelEnabled}.
   *
   * ACCOUNT ONLY, deliberately. The per-workspace and per-site card is
   * already seven categories by three states by two channels, and a type row
   * for each of the ~thirty types, per workspace AND per site, is a page
   * nobody can read — which is the complaint this whole issue started as.
   * The account scope is where "stop telling me about THIS" belongs anyway:
   * it is a statement about the kind of thing, and kinds do not vary by site.
   */
  accountTypes?: NotificationTypePrefs
  /** Keyed by org id. */
  orgs?: Record<string, NotificationCategoryPrefs>
  /** Keyed by host id — a site's own answer, narrower than its workspace's. */
  hosts?: Record<string, NotificationCategoryPrefs>
  /**
   * Per-TYPE answers at the workspace and site scopes (AGL-3267), beside the
   * category maps above rather than nested inside them.
   *
   * Parallel maps because the category maps are already stored under `orgs`
   * and `hosts` on live user documents: folding both into one
   * `{ categories, types }` object per scope would be a migration of every
   * preference anybody has set, to express something two more keys express
   * without touching a byte of what exists.
   *
   * This supersedes the account-only limit AGL-3251 shipped under. That was
   * the right call for a card nobody had used yet and the wrong one once it
   * existed: "quiet this one type down on this one busy site" is the question
   * the scope card is FOR, and answering it only for whole categories made
   * the fine grain stop exactly where the noise is worst.
   */
  orgTypes?: Record<string, NotificationTypePrefs>
  hostTypes?: Record<string, NotificationTypePrefs>
}

export const NOTIFICATION_SETTINGS_FIELD = 'notificationSettings'

/**
 * What a category does when nobody has said otherwise.
 *
 * Console on, email OFF, everywhere. Email defaults off because the inbox is
 * not ours to fill: the product already sends transactional mail nobody opted
 * into — welcome, verification, invites, dunning, usage alerts — and every one
 * of those leaves on the same domain a customer's password reset depends on.
 * Turning a busy site's form submissions into mail by default would put that
 * domain's reputation behind traffic the recipient never asked for.
 *
 * Exhaustive `Record` deliberately: a new {@link NotificationCategory} is a
 * compile error here until somebody decides what it does by default, which is
 * the one question a new category must not be able to ship without answering.
 */
export const NOTIFICATION_CHANNEL_DEFAULTS: Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
> = {
  billing: { console: true, email: false },
  team: { console: true, email: false },
  content: { console: true, email: false },
  marketplace: { console: true, email: false },
  support: { console: true, email: false },
  system: { console: true, email: false },
  // Console ON, because the complaint this answers is that staff never heard
  // about a sign-up at all; email off, like everything else, because that is
  // what the channel defaults to and a sign-up is not urgent enough to be the
  // exception that starts filling inboxes by default.
  staff: { console: true, email: false },
}

/**
 * The types that send their OWN email and must never be mailed again by the
 * generic channel (AGL-3224).
 *
 * Both digests compose a message the fan-out could not reproduce — a day's
 * owed tasks, a week's figures — and send it from their own route under their
 * own switch (`digestPrefs.crmDaily`, `insightDigests.{orgId}`). A recipient
 * who switches the `content` email channel on would otherwise receive the
 * digest twice: once as the digest, once as a one-line "Daily CRM digest"
 * notification saying that the digest happened.
 */
export const NOTIFICATION_SELF_SENT_EMAIL_TYPES: ReadonlySet<string> =
  new Set<AglynNotificationType>([
    'content.crmDailyDigest',
    'content.insightsDigest',
  ])

/**
 * Whether a channel is on for one notification, at its own scope.
 *
 * Resolution order, first answer wins: the notification's SITE, its
 * WORKSPACE, the account, then {@link NOTIFICATION_CHANNEL_DEFAULTS}. A scope
 * that holds no entry for the category, or an entry with the channel key
 * absent, does not answer — see {@link NotificationChannelPrefs}.
 *
 * `legacyPrefs` is the flat `notificationPrefs` mute map this replaces
 * (AGL-267), and it sits BELOW the account layer rather than beside it.
 * Nothing migrates it: a person who never opens the new settings page keeps
 * being governed by the mutes they set years ago, and the first thing they do
 * set on the account layer overrides the old map for that category without
 * disturbing the rest of it. It answers for `console` only, because the map
 * predates there being a second channel and reading a console mute as an
 * email preference would be inventing an answer its author never gave.
 */
export function notificationChannelEnabled(
  settings: NotificationSettings | null | undefined,
  channel: NotificationChannel,
  type: AglynNotificationType | string,
  scope?: { orgId?: string | null; hostId?: string | null },
  legacyPrefs?: Record<string, boolean> | null,
): boolean {
  const category = notificationCategory(type)
  /*
   * ⛔ A STAFF NOTIFICATION HAS NO SCOPE TO BE NARROWED BY (AGL-3267).
   *
   * It is about the platform, and the workspace one MENTIONS is its subject,
   * not its audience: the staff member reading "Acme Co subscribed" is
   * almost never a member of Acme Co, and if they happen to be, their
   * preferences for their own membership have nothing to do with it.
   *
   * This was already true by accident — no staff emitter passes `orgId` or
   * `hostId`, so the scope layers never matched — which made every
   * "Platform growth" row in the per-workspace card a control that could be
   * set and could never do anything. Stating it here rather than only hiding
   * those rows is the difference between the model being right and the UI
   * covering for a model that is wrong: a `staff.*` type that ever does
   * start carrying an `orgId`, for its link or its subject line, must not
   * silently become mutable per workspace.
   */
  const staffWide = STAFF_NOTIFICATION_CATEGORIES.has(category)
  /*
   * Narrowest scope first, and within each scope the TYPE before its
   * CATEGORY (AGL-3251, widened to every scope by AGL-3267).
   *
   * Both halves matter and they answer different questions. Scope order is
   * "where is this from" — a site's answer beats its workspace's, which beats
   * the account's, because quietening one busy site is the thing the scope
   * card exists for. Type-before-category is "what kind of thing is this" —
   * somebody who switched `Payment failed` off said something about that
   * type, and it must beat their own broader `Billing` answer at the SAME
   * scope without leaking upward past a narrower one.
   */
  const layers: Array<NotificationChannelPrefs | undefined> = staffWide
    ? [
        settings?.accountTypes?.[type as AglynNotificationType],
        settings?.account?.[category],
      ]
    : [
        scope?.hostId
          ? settings?.hostTypes?.[scope.hostId]?.[type as AglynNotificationType]
          : undefined,
        scope?.hostId ? settings?.hosts?.[scope.hostId]?.[category] : undefined,
        scope?.orgId
          ? settings?.orgTypes?.[scope.orgId]?.[type as AglynNotificationType]
          : undefined,
        scope?.orgId ? settings?.orgs?.[scope.orgId]?.[category] : undefined,
        settings?.accountTypes?.[type as AglynNotificationType],
        settings?.account?.[category],
      ]
  for (const layer of layers) {
    const answer = layer?.[channel]
    if (typeof answer === 'boolean') return answer
  }
  if (channel === 'console' && notificationMuted(legacyPrefs, type))
    return false
  return NOTIFICATION_CHANNEL_DEFAULTS[category][channel]
}

/**
 * What one scope says, with no inheritance applied — what the settings page
 * renders as Inherit / On / Off, and `undefined` is Inherit.
 *
 * `scope` names the layer directly rather than being derived from a
 * notification, because the page edits a layer whether or not anything has
 * ever arrived from it.
 */
/**
 * What the account scope says about one TYPE, with no inheritance applied
 * (AGL-3251) — `undefined` means the row follows its category.
 *
 * The page needs the unresolved answer to draw the difference between "on
 * because Billing is on" and "on because you said so": only the second can be
 * reset, and a switch that cannot show which one it is leaves a person unable
 * to get back to following the category.
 */
export function notificationAccountTypePref(
  settings: NotificationSettings | null | undefined,
  type: AglynNotificationType | string,
  channel: NotificationChannel,
): boolean | undefined {
  return settings?.accountTypes?.[type as AglynNotificationType]?.[channel]
}

/**
 * Every type in a category, in the order the labels declare them
 * (AGL-3251) — what the settings page expands a category row into.
 *
 * Derived from {@link NOTIFICATION_TYPE_LABELS} rather than held as a second
 * map, so a type added there appears under its category without anybody
 * remembering to list it twice.
 */
export function notificationTypesInCategory(
  category: NotificationCategory,
): AglynNotificationType[] {
  return (
    Object.keys(NOTIFICATION_TYPE_LABELS) as AglynNotificationType[]
  ).filter((type) => notificationCategory(type) === category)
}

/**
 * What ONE scope says about ONE type, with no inheritance applied
 * (AGL-3267) — `undefined` means the row follows its category at that scope.
 *
 * The scope-aware sibling of {@link notificationAccountTypePref}, which stays
 * as the account-only shorthand its callers already use.
 */
export function notificationScopeTypePref(
  settings: NotificationSettings | null | undefined,
  scope: { kind: 'account' } | { kind: 'org' | 'host'; id: string },
  type: AglynNotificationType | string,
  channel: NotificationChannel,
): boolean | undefined {
  const layer =
    scope.kind === 'account'
      ? settings?.accountTypes
      : scope.kind === 'org'
        ? settings?.orgTypes?.[scope.id]
        : settings?.hostTypes?.[scope.id]
  return layer?.[type as AglynNotificationType]?.[channel]
}

export function notificationScopePref(
  settings: NotificationSettings | null | undefined,
  scope: { kind: 'account' } | { kind: 'org' | 'host'; id: string },
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean | undefined {
  const layer =
    scope.kind === 'account'
      ? settings?.account
      : scope.kind === 'org'
        ? settings?.orgs?.[scope.id]
        : settings?.hosts?.[scope.id]
  return layer?.[category]?.[channel]
}

/**
 * The scopes this person has said something different about — what the
 * settings page lists so an override is never somewhere you have to go
 * looking for.
 *
 * Returns ids, not names: the page holds the org and host rosters and this
 * module holds no lookups. An id with no name is still worth listing, because
 * a preference about a workspace somebody left is exactly the kind of
 * leftover that is invisible until it is listed.
 */
export function notificationOverriddenScopes(
  settings: NotificationSettings | null | undefined,
): { orgIds: string[]; hostIds: string[] } {
  /*
   * BOTH maps for a scope, categories and types (AGL-3267).
   *
   * Reading only the category map would make a scope whose ONLY answer is a
   * per-type one invisible here — and this list is the single place a person
   * can find an override they set months ago. Silencing one type on one busy
   * site and then being unable to find where you did it is precisely the
   * failure this function exists to prevent.
   */
  const answered = (prefs: Record<string, NotificationChannelPrefs> | undefined) =>
    Object.values(prefs ?? {}).some((channels) =>
      Object.values(channels ?? {}).some((value) => typeof value === 'boolean'),
    )
  const named = (
    categories: Record<string, NotificationCategoryPrefs> | undefined,
    types: Record<string, NotificationTypePrefs> | undefined,
  ) =>
    [
      ...new Set([
        ...Object.keys(categories ?? {}),
        ...Object.keys(types ?? {}),
      ]),
    ]
      .filter(
        (id) =>
          answered(categories?.[id] as Record<string, NotificationChannelPrefs>) ||
          answered(types?.[id] as Record<string, NotificationChannelPrefs>),
      )
      .sort()
  return {
    orgIds: named(settings?.orgs, settings?.orgTypes),
    hostIds: named(settings?.hosts, settings?.hostTypes),
  }
}
