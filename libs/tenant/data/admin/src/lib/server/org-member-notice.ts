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

import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { findUserByUidAcrossPools } from './auth-pools'
import { filterSuppressedEmails } from './email-suppression'
import { listOrgMembers } from './organizations'

/**
 * A NOTICE TO NAMED MEMBERS OF AN ORGANIZATION, BY EMAIL (AGL-3244).
 *
 * The console notification (`notifications.ts`) is the record, and its email
 * channel is a preference that defaults off. Some things cannot wait on a
 * preference: a sequence mailbox that paused itself holds every enrollment
 * on it until its owner acts, and the owner is not watching the page. This
 * sends the email regardless, to the members named and — when asked — to
 * the organization's owners and admins beside them, one send per address
 * so nobody is shown anyone else's.
 *
 * Addresses come from the roster (`orgs/{orgId}/members/{uid}.email`), and
 * for a member whose row carries none, from the directory. Suppressed
 * addresses are skipped, the send is metered to the organization, and
 * nothing here throws: the notice is a courtesy beside a state the caller
 * already wrote.
 */

export interface OrgMemberNoticeInput {
  orgId: string
  /** The members to write to, by uid. */
  uids: readonly string[]
  /** Also the organization's owners and admins. */
  includeAdmins?: boolean
  subject: string
  text: string
  /** Resend tag / log label. */
  context: string
}

export interface OrgMemberNoticeResult {
  /** Addresses the notice went to. */
  sent: number
  /** Why nothing could be sent at all, when nothing could. */
  reason?: 'unconfigured' | 'no-recipients' | 'failed'
}

/** At most this many directory lookups, and this many sends, per notice. */
const MAX_LOOKUPS = 10
const MAX_SENDS = 25

/** Sends one notice to each member — see the module note. */
export async function sendOrgMemberNotice(input: OrgMemberNoticeInput): Promise<OrgMemberNoticeResult> {
  if (!isEmailConfigured()) return { sent: 0, reason: 'unconfigured' }
  try {
    const members = await listOrgMembers(input.orgId)
    const rosterEmail = new Map<string, string>()
    for (const member of members) {
      const address = String(member.email ?? '')
        .trim()
        .toLowerCase()
      if (address.includes('@')) rosterEmail.set(member.$id, address)
    }
    const uids = new Set(input.uids.filter(Boolean))
    if (input.includeAdmins) {
      for (const member of members) {
        if (member.role === 'owner' || member.role === 'admin') uids.add(member.$id)
      }
    }
    const addresses = new Set<string>()
    let lookups = 0
    for (const uid of uids) {
      let address = rosterEmail.get(uid) ?? ''
      if (!address && lookups < MAX_LOOKUPS) {
        lookups += 1
        const pooled = await findUserByUidAcrossPools(uid).catch(() => null)
        address = String(pooled?.record?.email ?? '')
          .trim()
          .toLowerCase()
      }
      if (address.includes('@')) addresses.add(address)
    }
    const recipients = await filterSuppressedEmails([...addresses])
    if (!recipients.length) return { sent: 0, reason: 'no-recipients' }
    let sent = 0
    for (const to of recipients.slice(0, MAX_SENDS)) {
      const result = await sendEmail({ to, subject: input.subject, text: input.text, context: input.context })
      if (!result.sent) continue
      sent += 1
      const { meterOrgEmail } = await import('./email-metering')
      await meterOrgEmail(input.orgId).catch(() => undefined)
    }
    return sent ? { sent } : { sent: 0, reason: 'failed' }
  } catch (error) {
    console.error('[org-member-notice] send failed', error)
    return { sent: 0, reason: 'failed' }
  }
}
