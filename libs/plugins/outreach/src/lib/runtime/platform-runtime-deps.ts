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

import { SALES_TOPIC_ID } from '../model/sales-topic'
import { platformMailDnsResolver } from '@aglyn/tenant-data-admin/server/email-deliverability'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { pluginRecordTimelineWriter } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import {
  creditConversion,
  creditConversionOutcome,
  recordConversionClick,
} from '@aglyn/aglyn/plugin-manager/plugin-conversion-credit'
import { suppressEmail } from '@aglyn/tenant-data-admin/server/email-suppression'
import { recordTopicOptOut } from '@aglyn/tenant-data-admin/server/topic-subscriptions'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import { sendOrgMemberNotice } from '@aglyn/tenant-data-admin/server/org-member-notice'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import { resolveTrackingLinkOrigin } from '@aglyn/tenant-data-admin/server/tracking-hosts'
import { sendingWorkspaceFor } from '@aglyn/tenant-data-admin/server/outbound-send-review'
import { screenTenantMessage } from '@aglyn/shared-util-email/outbound-screen-gate'
import { stampRecordEmailState } from '@aglyn/aglyn/plugin-manager/plugin-record-email-state'
import { OUTREACH_PLUGIN_ID } from '../constants/bundle-common'
import { composeOutreachMailboxNotice } from '../engine/mailbox-notice'
import { openOutreachMailboxClient } from '../mailboxes/mailbox-transport'
import { canonicalConsoleOrigin } from '../mailboxes/oauth-redirect'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import type { PluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { outreachShortLinkUrl } from './click-link'
import { createOutreachClickRoute, createOutreachShortLinkRoute } from './click-route'
import { createOutreachPersonEraser } from './person-erasure'
import type { OutreachCampaignCredit, OutreachRuntimeDeps } from './runtime-deps'
import { outreachUnsubscribeUrl } from './unsubscribe-link'
import { createOutreachUnsubscribeRoute } from './unsubscribe-route'

/**
 * What a sequence produced (AGL-3254), handed to whichever plugin credits
 * outcomes (`plugin-conversion-credit`): the same contract every form,
 * booking and campaign email is credited through, so a sequence's numbers
 * and a campaign send's are two readings of one rule. A workspace whose
 * plugins credit nothing credits nothing here either; the seam never throws.
 *
 * The campaign a sequence is filed under is what its mail is credited to,
 * and the sequence and the enrollment ride with it as the mail's own facts.
 */
export function platformOutreachCampaignCredit(): OutreachCampaignCredit {
  return {
    async credit({ hostId, orgId, campaignIds, outcome, atMs }) {
      await creditConversionOutcome({ hostId, orgId, containerIds: campaignIds, outcome, atMs })
    },
    async attributeRecord({ hostId, kind, refId, campaignId, sequenceId, enrollmentId, atMs }) {
      await creditConversion({
        hostId,
        kind,
        refId,
        click: { hostId, creditTo: campaignId, atMs, via: { sequenceId, enrollmentId } },
        convertedAtMs: atMs,
      })
    },
    async recordTouch({ hostId, email, campaignId, sequenceId, enrollmentId, atMs }) {
      await recordConversionClick({
        email,
        hostId,
        creditTo: campaignId,
        atMs,
        via: { sequenceId, enrollmentId },
      })
    },
  }
}

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
    campaignCredit: platformOutreachCampaignCredit(),
    openMailbox: (mailboxId) => openOutreachMailboxClient(firestore(), { mailboxId }),
    // The domain's MX (AGL-3326) and, for a domain with none, its address
    // record — through the platform's pinned resolver (AGL-3328), which
    // asks twice before it says a domain takes no mail.
    resolveMx: (domain) => platformMailDnsResolver().resolveMx(domain),
    resolveAddress: (domain) => platformMailDnsResolver().resolveAddress?.(domain) ?? Promise.resolve(false),
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
      await recordTopicOptOut(hostId, email, SALES_TOPIC_ID, { firestore: firestore() })
    },
    async suppressBouncedEmail({ email, hostId }) {
      // The runtime stamps the record itself, with the richer verdict — the
      // domain block, the enrollment — so the list's own stamp stands down.
      await suppressEmail({ email, reason: 'bounce', context: 'outreach', hostId, stampRecord: false, firestore: firestore() })
    },
    async stampRecordEmailState(stamp) {
      await stampRecordEmailState(stamp)
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
    clickLinkUrl: (linkId, trackingOrigin) =>
      outreachShortLinkUrl({ origin: canonicalConsoleOrigin(), linkId, trackingOrigin }),
    // The sending domain's own `links.` host once the organization has
    // verified it (AGL-3306). A static import like every other
    // `tenant-data-admin` module here: a dynamic one marks the whole library
    // lazy-loaded, and `@nx/enforce-module-boundaries` then refuses every
    // static import of it across the plugin and the console.
    clickLinkOrigin({ orgId, senderAddress }) {
      return resolveTrackingLinkOrigin(firestore(), orgId, senderAddress)
    },
    // The one phishing screen every tenant message passes (AGL-3356). The
    // review module's import installs its store, so a hold files the same
    // abuse-queue row a held newsletter or campaign does.
    async screenMessage({ orgId, org, hostId, host, subject, text, fromName, fromAddress }) {
      const refusal = await screenTenantMessage(
        {
          workspace: sendingWorkspaceFor({ hostId, orgId, org, host }),
          subject,
          fromName,
          fromAddress: fromAddress ?? null,
          bodies: [text],
          context: 'outreach sequence',
        },
        'outreach email',
      )
      return refusal?.detail ?? null
    },
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

/** The short tracking link's redirect on the platform's own reach (AGL-3297). */
export function platformOutreachShortLinkRoute(): PluginWebApiHandler {
  return createOutreachShortLinkRoute(platformOutreachRuntimeDeps())
}

/** The person eraser on the platform's own Firestore. */
export function platformOutreachPersonEraser(): PluginPersonEraser {
  return createOutreachPersonEraser({ firestore: () => firebaseAdmin.app().firestore() })
}
