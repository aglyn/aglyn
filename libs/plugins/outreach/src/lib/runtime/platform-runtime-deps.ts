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

import { EMAIL_TOPIC_SALES } from '@aglyn/aglyn/app-utils/email-topics'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { pluginRecordTimelineWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import { suppressEmail } from '@aglyn/tenant-data-admin/server/email-suppression'
import { recordTopicOptOut } from '@aglyn/tenant-data-admin/server/email-topic-confirmation'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import { sendOrgMemberNotice } from '@aglyn/tenant-data-admin/server/org-member-notice'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { stampRecordEmailState } from '@aglyn/tenant-data-admin/server/record-email-state'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import { OUTREACH_PLUGIN_ID } from '../constants/bundle-common'
import { composeOutreachMailboxNotice } from '../engine/mailbox-notice'
import { openOutreachMailboxClient } from '../mailboxes/mailbox-transport'
import { canonicalConsoleOrigin } from '../mailboxes/oauth-redirect'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import type { PluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { outreachClickUrl } from './click-link'
import { createOutreachClickRoute } from './click-route'
import { createOutreachPersonEraser } from './person-erasure'
import type { OutreachRuntimeDeps } from './runtime-deps'
import { outreachUnsubscribeUrl } from './unsubscribe-link'
import { createOutreachUnsubscribeRoute } from './unsubscribe-route'

/**
 * The platform's own reach for the sending runtime (AGL-2981). Loaded only
 * when a job runs or the unsubscribe route answers — never at boot — so the
 * console pays for these modules when Outreach does work.
 */
export function platformOutreachRuntimeDeps(): OutreachRuntimeDeps {
  const firestore = () => firebaseAdmin.app().firestore()
  return {
    firestore,
    now: Date.now,
    random: Math.random,
    openMailbox: (mailboxId) => openOutreachMailboxClient(firestore(), { mailboxId }),
    async orgRefusal(orgId, org) {
      if (!isPluginEnabled(org as { enabledPlugins?: string[] }, OUTREACH_PLUGIN_ID)) return 'plugin-disabled'
      if (!checkEntitlement(org, 'outreach')) return 'not-entitled'
      const released = await filterEnabledPluginsByReleaseFlags([OUTREACH_PLUGIN_ID], { orgId })
      return released.length ? null : 'not-released'
    },
    async sendRefusal({ org, uid }) {
      const locked = await getLockdownVerdict({ org, uid, intent: 'write' })
      return locked ? `locked:${locked.scope}` : null
    },
    timeline: () => pluginRecordTimelineWriter()?.writer ?? null,
    logOrgActivity: (orgId, actor, action, target) => logOrgActivity(orgId, actor, action, target),
    async optOutOfSalesTopic({ hostId, email }) {
      await recordTopicOptOut(hostId, email, EMAIL_TOPIC_SALES, { firestore: firestore() })
    },
    async suppressBouncedEmail({ email, hostId }) {
      await suppressEmail({ email, reason: 'bounce', context: 'outreach', hostId, firestore: firestore() })
    },
    async stampRecordEmailState(stamp) {
      await stampRecordEmailState({ ...stamp, firestore: firestore() })
    },
    async notifyMailboxOwner(notice) {
      // The Mailboxes page, by the organization's slug — the page Resume and
      // Reconnect live on (AGL-3244). Without a slug or a console origin the
      // notice still goes, and says where the page is instead.
      const org = await firestore().collection('orgs').doc(notice.orgId).get()
      const slug = typeof org.get('slug') === 'string' ? String(org.get('slug')) : ''
      const origin = canonicalConsoleOrigin()
      const mailboxesUrl = slug && origin ? `${origin}/${encodeURIComponent(slug)}/outreach/mailboxes` : null
      const email = composeOutreachMailboxNotice(notice, { mailboxesUrl })
      const result = await sendOrgMemberNotice({
        orgId: notice.orgId,
        uids: [notice.connectedByUid],
        includeAdmins: true,
        subject: email.subject,
        text: email.text,
        context: 'outreach-mailbox-notice',
      })
      if (!result.sent) console.warn(`[outreach] the mailbox owner was not emailed: ${result.reason}`)
    },
    unsubscribeUrl: (target) => outreachUnsubscribeUrl({ origin: canonicalConsoleOrigin(), target }),
    clickUrl: (target) => outreachClickUrl({ origin: canonicalConsoleOrigin(), target }),
  }
}

/** The unsubscribe route on the platform's own reach. */
export function platformOutreachUnsubscribeRoute(): PluginWebApiHandler {
  return createOutreachUnsubscribeRoute(platformOutreachRuntimeDeps())
}

/** The click-tracking redirect on the platform's own reach (AGL-3239). */
export function platformOutreachClickRoute(): PluginWebApiHandler {
  return createOutreachClickRoute(platformOutreachRuntimeDeps())
}

/** The person eraser on the platform's own Firestore. */
export function platformOutreachPersonEraser(): PluginPersonEraser {
  return createOutreachPersonEraser({ firestore: () => firebaseAdmin.app().firestore() })
}
