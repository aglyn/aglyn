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
 * `POST /api/crm/contact-email-history` (AGL-2616): the campaign mail one
 * contact was sent, as the timeline draws it.
 *
 * ## Why a server route
 *
 * The per-recipient delivery log — `emailDeliveries/{key}/messages` — is
 * closed to every client by the rules, and rightly: it is keyed by an
 * address hash across every org on the platform, and a row carries the
 * recipient's address, the provider and the links they followed. What a
 * contact's timeline needs is one slice of it — this person, this group's
 * campaigns — projected to the fields a timeline shows. That projection is
 * this route, and the authorization in front of it is the contacts read
 * rule restated for the Admin SDK, which evaluates no rules of its own.
 *
 * ## What one open of a contact page costs
 *
 * Bounded by the PERSON, never by the campaign ledger: one keyed query down
 * the person's own message subcollection, newest first and capped at
 * {@link EMAIL_DELIVERY_READ_LIMIT}, then one `getAll` for the names of the
 * distinct emails those rows name. Nothing here walks a campaign's
 * recipients — that direction is the campaign report's, and is a
 * collection-group query this route never issues.
 *
 * ## Only this group's campaigns
 *
 * The log holds every message ever sent to the address, from every site on
 * the platform. The rows handed back are those a campaign on one of the
 * reading group's sites sent — the `hostId` tag `campaign-send` stamps,
 * filtered against the consent group's `hostIds` — so a sibling business
 * sharing the same contact row never sees the mail another business sent
 * the person, and transactional mail (a receipt, an invite, which carry no
 * site) is not on a CRM timeline at all. The filter runs over the newest
 * fifty messages, so a person mailed heavily by several orgs can have this
 * group's older campaigns fall past the window; the response says what the
 * window was.
 */

import {
  type AglynOrgMember,
  type ContactCampaignEmail,
  memberCanSee,
  type PluginApiHandler,
  type PluginApiRequest,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  getOrgForHost,
  memberHasOrgPermission,
  orgDataCollectionForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
// The leaf, for the reason the webhook imports it from the leaf: a spec that
// mocks the admin barrel wholesale must not silently replace the reader.
import {
  EMAIL_DELIVERY_READ_LIMIT,
  type EmailDeliveryRecord,
  readEmailDeliveryHistory,
} from '@aglyn/tenant-data-admin/server/email-delivery-log'

/** The route key, as `registerCrmConsoleApi` registers it. */
export const CONTACT_EMAIL_HISTORY_ROUTE = 'crm/contact-email-history'

/** What the route answers with. */
export interface ContactEmailHistoryResponse {
  ok: true
  /** Newest first, by the instant each was sent. */
  emails: ContactCampaignEmail[]
  /**
   * True when the log could not be read, so an empty list means "unknown"
   * rather than "nothing was sent" — the two lead a reader to opposite
   * conclusions about the relationship.
   */
  lookupFailed: boolean
  /** How many of the person's newest messages the campaign filter ran over. */
  limit: number
}

type Refusal = { ok: false; status: number; error: string }

interface Reader {
  ok: true
  uid: string
  staff: boolean
  orgId: string
  org: Record<string, unknown>
  member: Partial<AglynOrgMember> | null
}

const refuse = (status: number, error: string): Refusal => ({
  ok: false,
  status,
  error,
})

/**
 * Who is asking, and whether they may read this site's CRM at all — the
 * rules' `canReadScopedPeople` restated, minus the per-document half that
 * the handler asks against the contact once it has it.
 *
 * `data.manage` is the key, because it is the key the contacts read rule
 * gates on: an org viewer holding no grant may open no contact in the
 * console and may not read one here. Staff pass on the claim alone, as the
 * rules admit them.
 */
async function authorizeCrmReader(
  req: PluginApiRequest,
  hostId: string,
): Promise<Reader | Refusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return refuse(401, 'Unauthenticated')
  let decoded: { uid: string; staff?: unknown }
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch {
    return refuse(401, 'Unauthenticated')
  }
  const staff = decoded.staff === true
  const resolved = await getOrgForHost(hostId).catch(() => null)
  if (!resolved) {
    return refuse(404, 'This site has no organization, so it has no CRM.')
  }
  const { orgId, org } = resolved
  const membership = await resolveOrgMembership(decoded.uid, orgId).catch(
    () => null,
  )
  const member = (membership?.member ?? null) as Partial<AglynOrgMember> | null
  if (!staff) {
    const suspended =
      (member as { orgSuspended?: boolean } | null)?.orgSuspended === true
    if (!member || suspended) {
      return refuse(403, 'Your organization role does not allow reading the CRM.')
    }
    if (!(await memberHasOrgPermission(orgId, member, 'data.manage'))) {
      return refuse(403, 'Your organization role does not allow reading the CRM.')
    }
  }
  return {
    ok: true,
    uid: decoded.uid,
    staff,
    orgId,
    org: (org ?? {}) as Record<string, unknown>,
    member,
  }
}

/** A finite, positive instant, or nothing. */
const instant = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * One delivery-log row as the timeline reads it.
 *
 * Exported for the spec, and pure: it is the projection that decides what
 * leaves the server — the address, the provider, the followed links and the
 * bounce detail stay behind. `sentAtMs` prefers the provider's own `sent`
 * instant and falls back to the first event seen, which the log guarantees
 * on every row, so an entry can always be placed.
 */
export function contactCampaignEmailFromDelivery(
  row: EmailDeliveryRecord,
  campaignName: string | null,
): ContactCampaignEmail | null {
  if (!row.campaignId || !row.hostId) return null
  const stamps = row.timestamps ?? {}
  const sentAtMs = instant(stamps.sent) ?? instant(row.firstSeenAtMs)
  if (!sentAtMs) return null
  const delivered = instant(stamps.delivered)
  const opened = instant(stamps.opened)
  const clicked = instant(stamps.clicked)
  const bounced = instant(stamps.bounced)
  const complained = instant(stamps.complained)
  return {
    messageId: row.messageId,
    hostId: row.hostId,
    campaignId: row.campaignId,
    campaignName,
    subject: row.subject ?? null,
    sentAtMs,
    ...(delivered ? { deliveredAtMs: delivered } : {}),
    ...(opened ? { openedAtMs: opened } : {}),
    ...(clicked ? { clickedAtMs: clicked } : {}),
    ...(bounced ? { bouncedAtMs: bounced } : {}),
    ...(complained ? { complainedAtMs: complained } : {}),
    openCount: Number(row.openCount ?? 0),
    clickCount: Number(row.clickCount ?? 0),
  }
}

/**
 * The names of the emails these rows name, in one `getAll`.
 *
 * Keyed reads rather than a query: the ids are known, a `getAll` is one round
 * trip however many there are, and it needs no index. An email the team has
 * since deleted reads as `null`, which the timeline draws as the subject the
 * person received with no report to link to.
 */
async function readCampaignNames(
  rows: readonly EmailDeliveryRecord[],
): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>()
  const firestore = firebaseAdmin.app().firestore()
  const refs: FirebaseFirestore.DocumentReference[] = []
  for (const row of rows) {
    const key = `${row.hostId}/${row.campaignId}`
    if (names.has(key)) continue
    names.set(key, null)
    refs.push(
      firestore
        .collection('hosts')
        .doc(String(row.hostId))
        .collection('campaigns')
        .doc(String(row.campaignId)),
    )
  }
  if (!refs.length) return names
  const snapshots = await firestore.getAll(...refs)
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue
    const hostId = snapshot.ref.parent.parent?.id ?? ''
    const name =
      String(snapshot.get('displayName') ?? '').trim() ||
      String(snapshot.get('subject') ?? '').trim()
    names.set(`${hostId}/${snapshot.id}`, name || null)
  }
  return names
}

export const contactEmailHistoryHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const hostId = String(req.body?.hostId ?? '').trim()
  const contactId = String(req.body?.contactId ?? '').trim()
  if (!hostId || !contactId) {
    res.status(400).json({ error: 'Missing hostId or contactId' })
    return
  }
  const reader = await authorizeCrmReader(req, hostId)
  if (reader.ok === false) {
    res.status(reader.status).json({ error: reader.error })
    return
  }
  try {
    /*
     * The contact by id, then the per-document half of the read rule: the
     * Admin SDK evaluates no rules, so a scoped member who can guess an id
     * must be refused here exactly as their listener would refuse the row.
     * "Not visible" and "not there" are one answer on purpose — a 403 would
     * confirm the id exists.
     */
    const contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
    const snapshot = await contactsRef.doc(contactId).get()
    const visibleTo = snapshot.exists
      ? (snapshot.get('visibleTo') as string[] | undefined)
      : undefined
    if (!snapshot.exists || !(reader.staff || memberCanSee(reader.member, visibleTo))) {
      res.status(404).json({ error: 'Unknown contact' })
      return
    }
    const email = String(snapshot.get('email') ?? '')
    const group = await consentGroupForSite(hostId, reader.org)
    const history = await readEmailDeliveryHistory(email, {
      limit: EMAIL_DELIVERY_READ_LIMIT,
    })
    const rows = history.rows.filter(
      (row) =>
        Boolean(row.campaignId) &&
        Boolean(row.hostId) &&
        group.hostIds.includes(String(row.hostId)),
    )
    const names = await readCampaignNames(rows)
    const emails = rows
      .map((row) =>
        contactCampaignEmailFromDelivery(
          row,
          names.get(`${row.hostId}/${row.campaignId}`) ?? null,
        ),
      )
      .filter((entry): entry is ContactCampaignEmail => entry !== null)
      .sort((a, b) => b.sentAtMs - a.sentAtMs)
    const body: ContactEmailHistoryResponse = {
      ok: true,
      emails,
      lookupFailed: history.lookupFailed,
      limit: EMAIL_DELIVERY_READ_LIMIT,
    }
    res.status(200).json(body)
  } catch (error) {
    console.error('[crm] contact-email-history failed', hostId, contactId, error)
    res.status(500).json({ error: 'The campaign history could not be read' })
  }
}
