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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
// Leaf imports, for the reason `email-events.ts` records: a spec that mocks
// the `@aglyn/tenant-data-admin` barrel would otherwise replace the real
// delivery-log reader with whatever the factory listed, and this handler's
// whole behaviour is what that reader returns.
import {
  readCampaignEngagement,
  EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS,
  type EmailEngagementFilter,
} from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { FieldPath } from 'firebase-admin/firestore'

/**
 * When a message went out, or is due to.
 *
 * There is no one date field: the send path writes `sentAt` from one branch
 * and `sendAtMs` from the other, and nothing stamps a `createdAt`. Both are
 * read so a scheduled message sorts beside a sent one instead of falling to
 * the bottom of every list that touches it.
 */
function messageTimeMs(snapshot: any): number {
  const sentAt = snapshot.get('sentAt')
  if (typeof sentAt?.toMillis === 'function') return sentAt.toMillis()
  const scheduled = Number(snapshot.get('sendAtMs') ?? 0)
  return Number.isFinite(scheduled) ? scheduled : 0
}

/**
 * WHO OPENED THIS, ONE PAGE AT A TIME.
 *
 * ## Why a server route rather than a client listen
 *
 * The per-recipient delivery log lives at `emailDeliveries/{sha256(address)}`
 * — a platform-level collection keyed by a hash of an address, holding the
 * mail of every site on the install and every transactional message besides.
 * No security rule can express "this site's editors may read the rows tagged
 * with this site" over a collection-group query, because the predicate that
 * narrows it is the query's own `where`, and a rule cannot require one. So
 * the narrowing happens here, behind a role check, on a server that holds the
 * admin credential.
 *
 * ## What the role check is
 *
 * Admin or editor on the site — deliberately the SAME role the send path
 * requires, and checked the same way. Whoever may address these people may
 * see which of them opened; a page that were readable by anyone the campaign
 * report is readable by would hand the address list to a role that cannot
 * mail it.
 *
 * ## What comes back, and what does not
 *
 * The rows carry the recipient address, because that is the question. They do
 * not carry the sha256 key, the suppression state, or anything about mail
 * this site did not send: the query is filtered on `hostId` as well as on the
 * message ids, so a row belonging to another site cannot be returned even if
 * a message id were wrong.
 *
 * ## Two scopes, one route
 *
 * `emailId` reads one message; `screenId` reads every message built from one
 * template. They are one route because they are one question asked at two
 * altitudes, and splitting them would mean two role checks, two cursors and
 * two chances for one of them to drift out of agreement with the other.
 */
export const campaignRecipientsHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const hostId = String(req.body?.hostId ?? '')
  const screenId = String(req.body?.screenId ?? '')
  const emailId = String(req.body?.emailId ?? '')
  const rawFilter = String(req.body?.filter ?? 'all')
  const cursor = String(req.body?.cursor ?? '')
  if (!isDocumentId(hostId)) {
    return res.status(400).json({ error: 'Missing hostId' })
  }
  /*
   * ONE scope, named, and validated as a document id.
   *
   * Both are path components on the reads below, so "non-empty" was never the
   * whole question: a value carrying a slash names the nesting as well as the
   * document. Refusing both-or-neither rather than preferring one keeps the
   * answer a function of what was asked, so a caller who sends both because a
   * component forgot to clear a prop is told rather than silently served the
   * wrong scope.
   */
  if (Boolean(screenId) === Boolean(emailId)) {
    return res.status(400).json({ error: 'Name one of screenId or emailId' })
  }
  if (screenId && !isDocumentId(screenId)) {
    return res.status(400).json({ error: 'Invalid screenId' })
  }
  if (emailId && !isDocumentId(emailId)) {
    return res.status(400).json({ error: 'Invalid emailId' })
  }
  const filter: EmailEngagementFilter =
    rawFilter === 'opened' || rawFilter === 'clicked' ? rawFilter : 'all'

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }

    /*
     * The messages this read covers.
     *
     * A single message is its own id and costs no query. A TEMPLATE resolves
     * to its messages here rather than taking a list of ids from the request:
     * a caller who could name message ids could name another site's, and
     * while the `hostId` filter below would still refuse them, the narrower
     * input is the one that cannot be got wrong later.
     *
     * ORDERED BY DOCUMENT ID, not by date, and that is forced rather than
     * chosen. A sent message carries `sentAt` and a scheduled one carries
     * `sendAtMs`; `orderBy` DROPS every document missing the ordered field,
     * so ordering on either would silently hide half the template's messages.
     * The document id is the one ordering every message satisfies, it needs
     * no composite index beside the equality filter, and the messages are
     * then sorted by send time here — over a window already read, so the
     * "most recent" the caller is told about really is the most recent.
     *
     * One MORE than the reader can span, so the overflow is a fact rather
     * than the surface silently describing thirty messages as if they were
     * all of them.
     */
    const ceiling = EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS + 1
    const messageDocs = emailId
      ? [await hostRef.collection('campaigns').doc(emailId).get()].filter(
          (snapshot: any) => snapshot.exists,
        )
      : (
          await hostRef
            .collection('campaigns')
            .where('templateScreenId', '==', screenId)
            .orderBy(FieldPath.documentId())
            .limit(ceiling)
            .get()
        ).docs
    if (emailId && !messageDocs.length) {
      return res.status(404).json({ error: 'Unknown email' })
    }
    const ordered = [...messageDocs].sort(
      (a: any, b: any) => messageTimeMs(b) - messageTimeMs(a),
    )
    const campaignIds = ordered.map((doc: any) => doc.id)
    const subjects: Record<string, string> = {}
    for (const doc of ordered) {
      subjects[doc.id] = String(doc.get('subject') ?? '')
    }

    const page = await readCampaignEngagement({
      hostId,
      campaignIds,
      filter,
      cursor: cursor || null,
      firestore,
    })

    return res.status(200).json({
      /*
       * The rows, reduced to what the table renders. Not the stored document:
       * `provider`, `bounceType` and `detail` are operational fields a
       * merchant has no reading for, and shipping every field of an internal
       * record to a browser is how one becomes an accidental contract.
       */
      rows: page.rows.map((row) => ({
        messageId: row.messageId,
        to: row.to,
        subject: row.subject ?? subjects[row.campaignId ?? ''] ?? null,
        campaignId: row.campaignId,
        status: row.status,
        openCount: row.openCount,
        clickCount: row.clickCount,
        clickedLinks: row.clickedLinks,
        firstSeenAtMs: row.firstSeenAtMs,
        lastEventAtMs:
          row.timestamps.clicked ??
          row.timestamps.opened ??
          row.timestamps.delivered ??
          row.firstSeenAtMs,
      })),
      cursor: page.cursor,
      lookupFailed: page.lookupFailed,
      campaignsRead: campaignIds.length - page.campaignsOmitted,
      campaignsOmitted: page.campaignsOmitted,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Could not read recipients' })
  }
}
