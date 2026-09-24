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

import type { EmailState } from '@aglyn/aglyn/app-utils/email-state'
import type { PluginRecordTimelineWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import type { OutreachMailboxNotice } from '../engine/mailbox-notice'
import type { OpenedOutreachMailbox } from '../mailboxes/mailbox-transport'
import type { OutreachResolveMx } from '../storage/domain-intel-store'
import type { OutreachUnsubscribeTarget } from './unsubscribe-link'

/**
 * EVERYTHING THE SENDING RUNTIME REACHES OUTSIDE ITS OWN DOCUMENTS (AGL-2981).
 *
 * The send and sync jobs and the unsubscribe route read and write Outreach's
 * collections through the Firestore they are handed, and reach everything
 * else through these: the mailbox's Gmail, the record system, the platform's
 * suppression and topic lists, the activity feed and the gates that decide
 * whether Outreach may act for a workspace at all. The platform's own are
 * `platform-runtime-deps.ts`; the emulator specs hand in a fake Gmail and
 * recorders, so no test reaches Google or sends mail.
 */

/** A target an org activity line written by the runtime points at. */
export interface OutreachRuntimeActivityTarget {
  type: `${string}:${string}`
  id: string
  name: string
}

/**
 * What the runtime tells a mailbox's owner (AGL-3244): the notice the
 * engine composes the email from, and who it is for — the member who
 * connected the mailbox, and the organization's owners and admins beside
 * them, since a paused mailbox is the organization's problem too.
 */
export interface OutreachMailboxNoticeRequest extends OutreachMailboxNotice {
  orgId: string
  mailboxId: string
  /** The member whose mailbox it is. */
  connectedByUid: string
}

/**
 * The verdict on an address, for the record the person is (AGL-3245): what
 * the runtime wrote on a list, said on the lead and the contact that carry
 * the address. The platform finds the records; the runtime names none.
 */
export interface OutreachRecordEmailStamp {
  orgId: string
  email: string
  state: EmailState
}

/**
 * What a sequence produced, credited to the campaigns it is in (AGL-3254).
 *
 * Three doors into the platform's campaign attribution, all on the
 * platform's own join and none on the marketing plugin, which Outreach may
 * not import. Each is called once per enrollment per outcome, from the
 * state change that happens once; none throws, because the send, the reply
 * and the click have already happened and a lost credit understates a
 * campaign while a thrown one loses a step.
 */
export interface OutreachCampaignCredit {
  /**
   * Adds one to an outcome under every campaign named, in the campaign's
   * sequences report. `enrolled`, `sent`, `replied` and `converted` are the
   * runtime's to credit; `meetings` is credited by the booking door from
   * the touch {@link OutreachCampaignCredit.recordTouch} stamps.
   */
  credit(input: {
    hostId: string
    /**
     * The org whose campaigns these are, when the caller holds it — an
     * enrollment is an org record, so its routes do. The platform resolves
     * it from the site otherwise.
     */
    orgId?: string | null
    campaignIds: readonly string[]
    outcome: 'enrolled' | 'sent' | 'replied' | 'converted'
    atMs: number
  }): Promise<void>
  /**
   * Writes the conversion record the person's own page reads as "where
   * this came from": the sequence's campaign as the touch, on the lead or
   * the contact the enrollment names. Once per record, and never over a
   * record that already carries a web or email touch — the join's own
   * `create()` decides that.
   */
  attributeRecord(input: {
    hostId: string
    kind: 'lead' | 'contact'
    /** The lead's person key, or the contact's id. */
    refId: string
    campaignId: string
    sequenceId: string
    enrollmentId: string
    atMs: number
  }): Promise<void>
  /**
   * Stamps a click on a sequence email as the person's last campaign touch
   * on the site, so a booking or a form they go on to submit is credited to
   * the sequence's campaign by the door that credits every other one.
   */
  recordTouch(input: {
    hostId: string
    email: string
    campaignId: string
    sequenceId: string
    enrollmentId: string
    atMs: number
  }): Promise<void>
}

export interface OutreachRuntimeDeps {
  firestore(): FirebaseFirestore.Firestore
  now(): number
  /** A source of numbers in `[0, 1)` — the scheduler's jitter. */
  random(): number
  /** Opens a mailbox's Gmail client from its sealed grant. */
  openMailbox(mailboxId: string): Promise<OpenedOutreachMailbox>
  /**
   * The MX resolver a domain's mail gateway is classified with (AGL-3326)
   * — Node's `dns.promises.resolveMx` on the platform, a table in a spec.
   */
  resolveMx: OutreachResolveMx
  /**
   * Why Outreach may not act for this workspace now, or `null` when it may:
   * the plugin switched on and entitled, and its release flag on for the
   * organization.
   */
  orgRefusal(orgId: string, org: Record<string, unknown>): Promise<string | null>
  /**
   * Why nothing may be sent as this member now — a lockdown of the platform,
   * the workspace or the member — or `null`.
   */
  sendRefusal(input: { orgId: string; org: Record<string, unknown>; uid: string }): Promise<string | null>
  /** The workspace's record system on the timeline seam, when a plugin keeps one. */
  timeline(): PluginRecordTimelineWriter | null
  /** The platform's campaign attribution, for what a sequence produced (AGL-3254). */
  campaignCredit: OutreachCampaignCredit
  logOrgActivity(
    orgId: string,
    actor: { uid: string | null; email?: string | null },
    action: string,
    target: OutreachRuntimeActivityTarget,
  ): Promise<void>
  /** Takes an address off one site's `sales` email topic. */
  optOutOfSalesTopic(input: { hostId: string; email: string }): Promise<void>
  /** Files a hard bounce on the platform's suppression list. */
  suppressBouncedEmail(input: { email: string; hostId: string | null }): Promise<void>
  /**
   * Stamps the verdict on the lead and the contact that carry the address
   * (AGL-3245), beside every write the runtime makes to a list. Never
   * throws: the list is the control, the stamp is what a person reads.
   */
  stampRecordEmailState(stamp: OutreachRecordEmailStamp): Promise<void>
  /**
   * Emails the mailbox's owner, and the organization's admins, that the
   * mailbox paused itself or needs reconnecting (AGL-3244), through the
   * platform's transactional sender. Called once per pause and once per
   * reconnect, by the code path that wrote it; a failure to send is the
   * platform's to log and never the runtime's to retry.
   */
  notifyMailboxOwner(notice: OutreachMailboxNoticeRequest): Promise<void>
  /** The signed one-click link for an enrollment, or `null` when none can be minted. */
  unsubscribeUrl(target: OutreachUnsubscribeTarget): string | null
  /**
   * The short tracking link for a stored link's id (AGL-3239, AGL-3297) —
   * on `trackingOrigin` when one is given (AGL-3306) — or `null` when none
   * can be made: no HTTPS origin. The sending
   * runtime writes the `outreachLinks` document the id names before the
   * email leaves.
   *
   * A `null` is not an error: the link goes out as the step wrote it, and
   * that click is not counted. An email whose links do not work is worse
   * than an email we cannot measure.
   */
  clickLinkUrl(linkId: string, trackingOrigin?: string | null): string | null
  /**
   * The click-tracking origin for mail sent as `senderAddress` —
   * `https://links.<its domain>` once the organization has verified that
   * host (AGL-3306) — or `null` for the console's own address. Asked once
   * per mailbox per run; a failure reads as `null`, never as a held send.
   * Absent means no deployment-level hosts at all.
   */
  clickLinkOrigin?(input: { orgId: string; senderAddress: string }): Promise<string | null>
}
