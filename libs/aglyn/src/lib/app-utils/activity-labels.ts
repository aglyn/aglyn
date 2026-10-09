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
 * ONE LABEL MAP FOR EVERY ACTIVITY AND AUDIT LIST (AGL-3660).
 *
 * Two logs feed the console's lists. The activity logs
 * (`orgs/{id}/activity`, `hosts/{id}/activity`) store a prose sentence or a
 * plugin's code plus a `{ type, id, name }` target. The staff audit trail
 * (`adminAudit`) stores a dotted code (`ai.job.output`, `org.override`) and
 * a Firestore PATH as its target (`orgs/abc/aiJobs/xyz`). The staff tables
 * printed both raw, so a reader saw `ai.job.output` next to
 * `orgs/9fK…/aiJobs/Qe2…` and had to know the schema to read their own
 * audit trail.
 *
 * Every list now draws its words from here: an action as a sentence
 * (`Created page Home with Aglyn AI`), a target as the site and the item,
 * and — for an audit row — why, the credits it spent and what came of it.
 * The raw code and path are kept on the description, for a tooltip and for
 * the staff details dialog, and never as the visible text.
 */

import {
  activityActionLabel,
  activityPrimaryText,
  activityTypeLabel,
  type ActivityEntryLike,
  type ActivityTargetLike,
} from './activity-presenter'
import { orgOverrideReasonSummary } from './org-override-reason'
import { PLATFORM_BRAND_NAME } from './platform-brand'
import {
  pluginActivityActionSentence,
  pluginActivityTargetLabel,
  pluginStaffAuditActionLabel,
} from '../plugin-manager/plugin-activity-actions'

/** What a list row and the details dialog show for one entry. */
export interface ActivityDescription {
  /** The act, as a sentence. Never a code. */
  action: string
  /** What it was done to, in words: the site and the item. Never a path. */
  target: string
  /** Why it was done, when the writer recorded a reason. */
  why: string | null
  /** AI credits it spent, when it spent any. */
  credits: number | null
  /** What came of it, when the writer recorded an outcome. */
  result: string | null
  /** The stored code, when the action was one — for a tooltip and staff. */
  code: string | null
  /** The stored target path (audit) or `type/id` (activity) — staff only. */
  path: string | null
  /** The organization the entry concerns, when it names one. */
  orgId: string | null
  /** The site the entry concerns, when it names one. */
  hostId: string | null
  /** The AI job behind the entry, when there is one. */
  jobId: string | null
  /** The account the entry concerns, when it names one. */
  uid: string | null
}

/** Names a route resolved for the ids an entry carries. */
export interface ActivityNames {
  /** Organization name by org id. */
  orgs?: Readonly<Record<string, string | null | undefined>>
  /** Site name by host id. */
  hosts?: Readonly<Record<string, string | null | undefined>>
  /** An account's address (or name) by uid. */
  users?: Readonly<Record<string, string | null | undefined>>
}

/** How the platform's AI is named in a sentence. */
export const PLATFORM_AI_NAME = `${PLATFORM_BRAND_NAME} AI`

/** `screen` → `page`, `Home` → `page Home`: the noun a sentence uses. */
export function activityTargetPhrase(target: ActivityTargetLike | null | undefined): string {
  const noun = activityTypeLabel(target?.type)
  const lower = noun === 'Item' ? 'item' : noun.charAt(0).toLowerCase() + noun.slice(1)
  const name = target?.name?.trim()
  return name ? `${lower} ${name}` : lower
}

/**
 * An activity row's action as a sentence about its target. A plugin code
 * with a declared sentence fills it (`Created {target} with Aglyn AI`); any
 * other code reads as its label, and a prose action as itself.
 */
export function activityActionSentence(
  action: string | undefined,
  target?: ActivityTargetLike | null,
): string {
  const stored = action?.trim() ?? ''
  const sentence = pluginActivityActionSentence(stored)
  if (sentence) return sentence.replace('{target}', activityTargetPhrase(target))
  return activityActionLabel(stored)
}

/**
 * A one-column feed's line: the sentence when the code declares one, else
 * the action with its target's name (`Saved the screen — Home`).
 */
export function activityRowText(entry: ActivityEntryLike): string {
  const stored = entry.action?.trim() ?? ''
  return pluginActivityActionSentence(stored)
    ? activityActionSentence(stored, entry.target)
    : activityPrimaryText(entry)
}

/** Whether a stored action is a dotted code rather than a sentence. */
export function isActivityCode(action: unknown): action is string {
  return typeof action === 'string' && /^[a-z][\w-]*(\.[\w-]+)+$/i.test(action.trim())
}

/*==========================================
 * THE STAFF AUDIT TRAIL'S WORDS.
 *
 * Every code core's doors write. A plugin's doors declare their own through
 * `staffAuditLabels` (the AI plugin's `ai.job.*`), and a code neither knows
 * is humanized from its segments rather than shown raw, so a new writer
 * reads as `Billing: invoice paid` until somebody names it properly.
 *==========================================*/
export const STAFF_AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'account.closed.self': 'Closed their own account',
  'account.exported.self': 'Exported their own account data',
  'ai-usage.exported': 'Exported AI usage',
  'billing.assistOverage.setCap': 'Set the AI overage ceiling',
  'billing.assistOverage.setHardCap': 'Set the AI stop-at-band switch',
  'billing.autoLocked': 'Locked automatically for billing',
  'billing.collaboratorAllocation': 'Changed collaborator seats',
  'billing.dispute.opened': 'Payment dispute opened',
  'billing.disputeClosed': 'Payment dispute closed',
  'billing.disputeOpened': 'Payment dispute opened',
  'billing.disputeUnattributed': 'Unattributed payment dispute',
  'billing.invoice': 'Invoice event',
  'billing.invoice.closed': 'Invoice closed',
  'billing.invoice.failed': 'Invoice payment failed',
  'billing.invoice.paid': 'Invoice paid',
  'billing.manage': 'Opened billing management',
  'billing.orphanedSubscription': 'Found a subscription with no workspace',
  'billing.paymentFailed': 'Payment failed',
  'billing.paymentMethod.changed': 'Changed the payment method',
  'billing.platformDisputeLost': 'Lost a payment dispute',
  'billing.platformInvoiceUncollectible': 'Invoice marked uncollectible',
  'billing.registerAllocation': 'Changed register allocation',
  'billing.storageOverage.setCap': 'Set the storage overage ceiling',
  'billing.subscriptionCanceled': 'Subscription canceled',
  'billing.usage': 'Recorded usage',
  'billing.usageBudget.set': 'Set the usage budget',
  'billing.view': 'Viewed billing',
  'billing.webhookInert': 'Ignored a billing webhook',
  'billing.webhookSignatureRejected': 'Rejected a billing webhook signature',
  'broadcast.send': 'Sent a broadcast',
  'contact.phone.erased': 'Erased a phone number',
  'contact.suppression.recorded': 'Added a contact suppression',
  'contact.suppression.released': 'Released a contact suppression',
  'coupon.create': 'Created a coupon',
  'coupon.promotion_code.update': 'Updated a promotion code',
  'data.transfer.export': 'Exported data',
  'data.transfer.plan': 'Planned a data transfer',
  'email.history-imported': 'Imported email history',
  'email.message-viewed': 'Viewed an email message',
  'email.sending-domains.reap': 'Removed unused sending domains',
  'email.suppression.release': 'Released an email suppression',
  'emailSendRate.update': 'Changed the email send rate',
  'erasure.runBatch': 'Ran an erasure batch',
  'erasures.replayed': 'Replayed erasures',
  'firestore.export': 'Exported the database',
  'firstPartyHosts.update': 'Changed first-party sites',
  'flags.update': 'Changed feature flags',
  'freeWorkspaceCap.update': 'Changed the free workspace cap',
  'host.deleted': 'Deleted a site',
  'host.domain.released': 'Released a domain',
  'host.reattach-domain': 'Reattached a domain',
  'host.set-subdomain': 'Changed a site address',
  'host.transfer': 'Transferred a site',
  'lockdown.lock': 'Locked the workspace down',
  'lockdown.payouts-pause': 'Paused payouts',
  'lockdown.payouts-restore': 'Restored payouts',
  'lockdown.renewals-pause': 'Paused renewals',
  'lockdown.renewals-resume': 'Resumed renewals',
  'lockdown.resend-notice': 'Resent the lockdown notice',
  'maintenance.auditArchive.run': 'Archived the audit log',
  'maintenance.reapArtifacts.run': 'Removed stale build artifacts',
  'maintenance.reverifyPlugins.run': 'Re-verified plugins',
  'operatorAlerts.test': 'Sent a test operator alert',
  'operatorAlerts.update': 'Changed operator alerts',
  'org.acquisition-viewed': 'Viewed where the organization came from',
  'org.auditLog': 'Viewed the organization audit log',
  'org.discount.apply': 'Applied a discount',
  'org.discount.remove': 'Removed a discount',
  'org.enterprise.provision': 'Provisioned enterprise billing',
  'org.erase-failed': 'Organization erasure failed',
  'org.erased': 'Erased the organization',
  'org.erasureCanceled': 'Canceled the organization erasure',
  'org.erasureRequested': 'Requested organization erasure',
  'org.exported': 'Exported the organization',
  'org.name': 'Renamed the organization',
  'org.note': 'Added a staff note',
  'org.override': 'Overrode the plan',
  'org.refund': 'Issued a refund',
  'org.seatAddons.changed': 'Changed seat add-ons',
  'org.sso.enforceSignInMethods': 'Changed enforced sign-in methods',
  'org.sso.jit': 'Changed single sign-on provisioning',
  'org.subscription-cancel': 'Canceled the subscription',
  'org.subscriptionStarted.settle': 'Settled a new subscription',
  'org.successManagerCleared': 'Removed the success manager',
  'org.successManagerSet': 'Assigned a success manager',
  'org.upgradeProposal.propose': 'Proposed an upgrade',
  'org.upgradeProposal.withdraw': 'Withdrew an upgrade proposal',
  'orgs.unverified.reap': 'Removed unverified organizations',
  'person.erased': 'Erased a person',
  'person.erasure-requested': 'Requested erasure of a person',
  'plan.name': 'Renamed a plan',
  'plugins.artifacts.reap': 'Removed stale plugin builds',
  'plugins.remoteServer.load': 'Loaded a remote plugin server',
  'plugins.verification.decline': 'Declined a plugin verification',
  'plugins.verifier.regression': 'Plugin verifier regression',
  'security.pageSecurityHold': 'Put a page on security hold',
  'security.staffGranted': 'Granted staff access',
  'site.package.apply': 'Applied a site package',
  'site.package.undo': 'Undid a site package',
  'sso.domain.driftDetected': 'Single sign-on domain drift detected',
  'staff.evidence': 'Recorded evidence',
  'staff.paymentFailed': 'Payment failed (staff notice)',
  'staff.planChanged': 'Plan changed (staff notice)',
  'staff.subscriptionCanceled': 'Subscription canceled (staff notice)',
  'staff.subscriptionStarted': 'Subscription started (staff notice)',
  'systemEmail.staffSend': 'Sent a system email',
  'systemEmail.test': 'Sent a test system email',
  'taxFilingConfig.clear': 'Cleared the tax filing settings',
  'taxFilingConfig.update': 'Changed the tax filing settings',
  'taxablePurchases.clear': 'Cleared taxable purchases',
  'taxablePurchases.update': 'Changed taxable purchases',
  'user.acquisition-viewed': 'Viewed where the account came from',
  'user.erased': 'Erased the account',
  'user.impersonate': 'Signed in as the account',
  'user.sendPasswordReset': 'Sent a password reset',
  'user.setPassword': 'Set the password',
  'user.signOutDevice': 'Signed a device out',
  'user.updateProfile': 'Updated the profile',
}

/** Leading namespaces as a reader names them. */
const NAMESPACE_LABELS: Readonly<Record<string, string>> = {
  org: 'Organization',
  orgs: 'Organizations',
  user: 'Account',
  host: 'Site',
  ai: PLATFORM_AI_NAME,
}

/** `paymentMethod` → `payment method`, `reattach-domain` → `reattach domain`. */
function words(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim()
}

/** A code nobody named, as words: `billing.invoice.paid` → `Billing: invoice paid`. */
export function humanizeActivityCode(code: string): string {
  const [head = '', ...rest] = code.trim().split('.').filter(Boolean)
  const lead = NAMESPACE_LABELS[head] ?? words(head).replace(/^./, (c) => c.toUpperCase())
  if (!rest.length) return lead
  return `${lead}: ${rest.map(words).join(' ')}`
}

/** What a staff audit code reads as, everywhere it is shown. */
export function staffAuditActionLabel(action: string | null | undefined): string {
  const code = action?.trim() ?? ''
  if (!code) return '—'
  return (
    STAFF_AUDIT_ACTION_LABELS[code] ??
    pluginStaffAuditActionLabel(code) ??
    (isActivityCode(code) ? humanizeActivityCode(code) : code)
  )
}

/** The collections an audit path walks, named for a reader. */
const COLLECTION_NOUNS: Readonly<Record<string, string>> = {
  orgs: 'Organization',
  hosts: 'Site',
  users: 'Account',
  aiJobs: `${PLATFORM_AI_NAME} job`,
  members: 'Member',
  invites: 'Invitation',
  screens: 'Page',
  layouts: 'Layout',
  components: 'Component',
  templates: 'Template',
  media: 'Media',
  emailDeliveries: 'Email',
  coupons: 'Coupon',
  flags: 'Feature flag',
  plugins: 'Plugin',
  subscriptions: 'Subscription',
}

/** `orgs/a/aiJobs/b` → `{ orgs: 'a', aiJobs: 'b' }`, in walk order. */
function pathPairs(path: string): Array<[string, string]> {
  const segments = path.split('/').filter(Boolean)
  const pairs: Array<[string, string]> = []
  for (let at = 0; at < segments.length; at += 2) {
    pairs.push([segments[at] ?? '', segments[at + 1] ?? ''])
  }
  return pairs
}

/** The stored audit row, read defensively. */
export interface StaffAuditEntryLike {
  action?: string | null
  target?: string | null
  subjectUid?: string | null
  reason?: string | null
  note?: string | null
  /** The state the act left; AI rows carry `{ label, hostId, credits }`. */
  after?: Record<string, unknown> | null
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** An AI job's audit `after.resource`, as the noun a sentence uses. */
const AI_RESOURCE_NOUNS: Readonly<Record<string, string>> = {
  screen: 'page',
  reusableComponent: 'component',
  emailScreen: 'email',
  orgAutomation: 'automation',
  workflow: 'automation',
  entry: 'post',
  text: 'copy',
  seo: 'search fixes',
  crm: 'CRM answer',
}

/** What an audit act did, in words, and the words it was about. */
export function describeStaffAudit(
  entry: StaffAuditEntryLike,
  names: ActivityNames = {},
): ActivityDescription {
  const code = str(entry.action)
  const path = str(entry.target)
  const after = entry.after ?? {}
  const pairs = path && path.includes('/') ? pathPairs(path) : []
  const idOf = (collection: string) => pairs.find(([name]) => name === collection)?.[1] || null
  const orgId = idOf('orgs')
  const jobId = idOf('aiJobs')
  const hostId = str(after['hostId']) ?? idOf('hosts')
  const uid = idOf('users') ?? str(entry.subjectUid)
  const label = str(after['label'])
  const resource = str(after['resource'])

  let action = staffAuditActionLabel(code)
  // A job's output names what it made: `Created page Home with Aglyn AI`.
  if (code === 'ai.job.output') {
    const noun = (resource && (AI_RESOURCE_NOUNS[resource] ?? words(resource))) || 'draft'
    action = `Created ${noun}${label ? ` ${label}` : ''} with ${PLATFORM_AI_NAME}`
  }

  const site = hostId ? (names.hosts?.[hostId] ?? null) : null
  const org = orgId ? (names.orgs?.[orgId] ?? null) : null
  const person = uid ? (names.users?.[uid] ?? null) : null
  const last = pairs[pairs.length - 1]
  const parts: string[] = []
  if (site) parts.push(site)
  else if (org) parts.push(org)
  if (jobId) parts.push(label ?? `${PLATFORM_AI_NAME} job`)
  else if (last && last[0] === 'users') parts.push(person ?? 'Account')
  else if (last && last[0] !== 'orgs' && last[0] !== 'hosts') {
    parts.push(COLLECTION_NOUNS[last[0]] ?? activityTypeLabel(last[0]))
  }
  if (!parts.length) {
    if (last) parts.push(COLLECTION_NOUNS[last[0]] ?? 'Item')
    else if (path) parts.push(isActivityCode(path) || /^[\w-]{16,}$/.test(path) ? 'Platform' : path)
    else parts.push('—')
  }

  const result =
    str(after['result']) ??
    str(after['status']) ??
    (code === 'ai.job.output' ? 'Draft created' : null)

  return {
    action,
    target: parts.join(' · '),
    why: orgOverrideReasonSummary(entry.reason ?? null, entry.note ?? null) ?? str(entry.note),
    credits: num(after['credits']),
    result,
    code,
    path,
    orgId,
    hostId,
    jobId,
    uid,
  }
}

/** A stored activity row, read defensively, with where it was read from. */
export interface ActivityRowLike {
  action?: string | null
  target?: (ActivityTargetLike & { jobId?: string; credits?: number }) | null
  /** `host` or `org`: which log the row came from. */
  scopeType?: string
  scopeId?: string
}

/**
 * An activity row as the lists show it. Where is the site when the row came
 * from a site's log, else the organization.
 */
export function describeActivity(
  entry: ActivityRowLike,
  names: ActivityNames = {},
): ActivityDescription {
  const stored = str(entry.action)
  const code = isActivityCode(stored) ? stored : null
  const target = entry.target ?? null
  const hostId = entry.scopeType === 'host' ? (entry.scopeId ?? null) : null
  const orgId = entry.scopeType === 'org' ? (entry.scopeId ?? null) : null
  const site = hostId ? (names.hosts?.[hostId] ?? null) : null
  const type = str(target?.type)
  const jobId = type === 'aiJob' ? str(target?.id) : str(target?.jobId)
  const noun = type ? (pluginActivityTargetLabel(type) ?? activityTypeLabel(type)) : null
  const item = str(target?.name) ?? noun
  const parts = [site, item].filter((part): part is string => Boolean(part))
  return {
    action: activityActionSentence(stored ?? undefined, target) || '—',
    target: parts.join(' · ') || '—',
    why: null,
    credits: num(target?.credits),
    result: null,
    code,
    path: type ? `${type}${target?.id ? `/${target.id}` : ''}` : null,
    orgId,
    hostId,
    jobId,
    uid: type === 'member' ? str(target?.id) : null,
  }
}
