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
 * THE GATE IN FRONT OF EVERY LIST ENROLLMENT THE CONSOLE MAKES.
 *
 * Who is allowed to change a list's membership, and what is true about each
 * address they name. Three route modules ask it — the audience card's add and
 * preview, the filter search, and the file importer — and they ask this one
 * copy of it.
 *
 * ## Why it is a module of its own
 *
 * It began inside `server-console.ts`, beside its first two callers, and that
 * was right while there were two. The importer made three, and an importer is
 * exactly the surface where a second, laxer idea of "may this person be
 * enrolled" is most tempting: a file is bulk, bulk is slow, and skipping the
 * per-address consent read is the obvious saving. A bulk path that reached the
 * membership without the suppression check and the attestation would be a way
 * to enroll precisely the people the one-at-a-time path refuses, which is the
 * defect class `docs/specs/email-competitive-gaps.md` has a closed P1 entry
 * for.
 *
 * Sharing the gate is also what stops the cheaper failure: two modules that
 * merely agree today, with nothing in either one saying the other exists.
 *
 * ## What it decides, and what it deliberately does not
 *
 * {@link resolveAddresses} answers the questions that are FACTS about a
 * person — a stored refusal, a suppression on either list, an opt-in already
 * on record, a line that is not an address. It never consults an attestation,
 * because an attestation is a fact about the operator and folding it in here
 * would make the preview's numbers move as the box was ticked. The basis is
 * decided once, at the write, by `assignmentBasis`.
 */

import {
  ASSIGNMENT_REFUSAL_MESSAGES,
  assignmentReadout,
  isOrgWideMember,
  normalizeContactEmail,
  readMarketingBasis,
  type AddressRefusal,
  type AssignmentRefusal,
  type ConsentGroup,
  type MarketingConsentRecord,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  filterSendableForHost,
  filterSuppressedEmails,
  firebaseAdmin,
  getOrgForHost,
  orgDataCollectionForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
// The leaf, not the barrel: this plugin's specs substitute both barrels
// wholesale, and what a deleted contact's refusal still says must be read
// under them by the real store and the real merge.
import { readContactConsent } from '@aglyn/tenant-data-admin/server/consent-by-address'
import { holdsStampedSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { EMAIL_SITE_ROLE_PRESET, emailSitePermissionRefusal } from './model/email-permissions'

/**
 * The most addresses one request may name.
 *
 * A ceiling on the WRITE, not on the audience. It bounds the work one request
 * does — the resolution below is a handful of reads per address — and it can
 * never refuse a person already enrolled or make room by removing one, which
 * is the difference between a batch size and a capacity limit. Nothing in the
 * product caps list membership: `contactsPerHost` is the audience band and it
 * is metered against CONTACTS, in `upsert-contact.ts`, and enrolling somebody
 * on a list writes no contact. If a membership ceiling is ever introduced,
 * this function is where it refuses, because this is where something is
 * added.
 */
export const LIST_MEMBER_BATCH_MAX = 100

/** Everything a list-membership route needs, or the refusal to send back. */
export type ListContext =
  | {
      ok: true
      uid: string
      hostId: string
      orgId: string
      listRef: FirebaseFirestore.DocumentReference
      listName: string
    }
  | { ok: false; status: number; body: Record<string, unknown> }

/**
 * Who is asking, and about which list.
 *
 * ## Two gates, not one — the same two the Inbox assignment route applies
 *
 * A host role is necessary and NOT sufficient. Lists live at
 * `orgs/{orgId}/lists` and their members are contacts, so the rules put both
 * behind `isOrgWideMember()`. An editor invited to ONE site is an org member
 * with `allHosts: false`, and gating an org-wide write on the host role alone
 * would let a single-site collaborator enroll people into an audience every
 * other site in the org can mail — and, through the preview, read the consent
 * record of any address they care to type. The Admin SDK evaluates no rules,
 * so this route is the enforcement rather than an echo of it.
 *
 * The plugin's own gates sit above this and are the dispatcher's: a workspace
 * that has switched the email plugin off, or a site it is disabled for, or a
 * release flag that has not reached this org, all 404 before a handler runs.
 */
export async function resolveListContext(
  req: Parameters<PluginApiHandler>[0],
): Promise<ListContext> {
  const hostId = String(req.body?.hostId ?? '')
  const listId = String(req.body?.listId ?? '')
  if (!hostId || !listId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Missing hostId or listId' },
    }
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return { ok: false, status: 401, body: { error: 'Unauthenticated' } }
  }

  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  const firestore = firebaseAdmin.app().firestore()
  const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
  if (!hostSnapshot.exists) {
    return { ok: false, status: 404, body: { error: 'Unknown site' } }
  }
  // "Add people to marketing lists from a site" (AGL-4047): the site's
  // stamp, else the preset of the member's site role, the Admin and Editor
  // this asked for. The organization-wide writer is still asked below.
  if (!holdsStampedSiteKey(hostSnapshot, decoded.uid, 'email.lists', EMAIL_SITE_ROLE_PRESET)) {
    return {
      ok: false,
      status: 403,
      body: { error: emailSitePermissionRefusal('email.lists') },
    }
  }

  const orgId = String(
    (await getOrgForHost(hostId).catch(() => null))?.orgId ?? '',
  )
  if (!orgId) {
    return {
      ok: false,
      status: 404,
      body: { error: 'This site has no organization, so it has no lists.' },
    }
  }
  const membership = await resolveOrgMembership(decoded.uid, orgId).catch(
    () => null,
  )
  if (!isOrgWideListWriter(membership?.member)) {
    return {
      ok: false,
      status: 403,
      body: {
        error:
          'Marketing lists belong to the whole organization, so changing who ' +
          'is on one needs organization-wide access rather than access to ' +
          'this site.',
      },
    }
  }

  const listRef = firestore
    .collection('orgs')
    .doc(orgId)
    .collection('lists')
    .doc(listId)
  const listSnapshot = await listRef.get()
  // A stale or mistyped id must not CREATE a list: a campaign's `list`
  // audience would then read a list nobody set up.
  if (!listSnapshot.exists) {
    return { ok: false, status: 404, body: { error: 'Unknown list' } }
  }

  return {
    ok: true,
    uid: decoded.uid,
    hostId,
    orgId,
    listRef,
    listName: String(listSnapshot.get('name') ?? listId),
  }
}

/**
 * Whether an org member may change who is on the organization's lists: an
 * org-wide owner, admin or editor whose membership is not suspended. The one
 * answer the list routes and the list-member import ask (see
 * {@link resolveListContext} for why a site role is not enough).
 */
export function isOrgWideListWriter(member: unknown): boolean {
  const entry = member as
    | { role?: string; orgSuspended?: boolean }
    | null
    | undefined
  return (
    isOrgWideMember(entry as Parameters<typeof isOrgWideMember>[0]) &&
    (entry?.role === 'owner' ||
      entry?.role === 'admin' ||
      entry?.role === 'editor') &&
    entry?.orgSuspended !== true
  )
}

/** What would happen to one address, and why. */
export interface AddressVerdict {
  /** Exactly what the operator typed, so a bad line can be pointed at. */
  input: string
  /** The normalized address, or `null` when there is not one. */
  email: string | null
  /**
   * Why this address can never go on the list, or `null`.
   *
   * A HARD refusal only — a stored `declined`, either suppression list, or a
   * line that is not an address. `no-basis` is deliberately NOT one of them:
   * "you have not said you have permission yet" is an unanswered question,
   * not a refusal, and reporting it as one would list the very people an
   * attestation is about to admit under the heading of people it cannot.
   * That distinction is {@link requiresAttestation}.
   */
  refusal: AssignmentRefusal | null
  /** True when only an attestation stands between this address and the list. */
  requiresAttestation: boolean
  /** One sentence of consent facts, in the merchant's terms. */
  summary: string
}

/** The whole answer, per address and in totals. */
export interface AddressResolution {
  verdicts: AddressVerdict[]
  /** Addresses a stored opt-in already covers — no attestation needed. */
  optedIn: number
  /** Addresses that need the operator to state they have permission. */
  needAttestation: number
  /** Addresses nothing can enroll, whatever the operator says. */
  refused: number
}

/**
 * The resolution plus the consent records it was computed from.
 *
 * The records ride along so the write path can derive the basis it STORES
 * from the same read the verdicts were built on. Re-reading them would be a
 * second answer to "what does this person's record say", between which a
 * concurrent edit fits — and the operator would have attested against the
 * first one.
 */
export interface ResolvedBatch extends AddressResolution {
  stored: Map<string, MarketingConsentRecord>
  /**
   * Each opted-in person's own grants, as `grantEntriesAsRecorded` read them
   * off the SAME contact document `stored` was read from — what a
   * pass-through enrollment carries onto the membership (AGL-3320).
   *
   * From the same read for the reason `stored` is: the basis decided and the
   * sites it covers must describe one version of the person's record.
   */
  grants: Map<string, Record<string, Record<string, unknown>>>
  /**
   * The consent group the resolution was made against, so the WRITE records
   * a basis for exactly the controller the verdicts were computed for.
   *
   * Returned rather than re-resolved by the caller for the same reason
   * `stored` is: two resolutions of the same question are two answers a
   * concurrent edit can fit between, and the operator attested against the
   * first one.
   */
  group: ConsentGroup
}

/**
 * Every address, normalized, deduplicated and put through the policy.
 *
 * ## Deduplicated on the NORMALIZED address, and reported once
 *
 * A pasted column routinely names the same person twice with different
 * casing, and `enrollListMember` keys the membership from the normalized
 * address, so two lines would be one row. Counting them twice would tell the
 * operator they are attesting for more people than they are.
 *
 * ## An unusable line is REPORTED, never dropped
 *
 * A paste that silently discarded its malformed lines would tell an operator
 * that 100 addresses went on the list when 94 did, and the six they never
 * hear about are the six they typed wrong. Every input line comes back with a
 * verdict, including the ones that are not addresses at all.
 *
 * ## Suppression is attributed, and costs nothing when there is none
 *
 * `filterSendableForHost` answers both lists in one pass and fails CLOSED, so
 * it is asked first; only the addresses it refused are put through the
 * platform half again to find out WHICH list holds them. In the ordinary case
 * that second call is never made.
 */
export async function resolveAddresses(input: {
  hostId: string
  inputs: readonly string[]
}): Promise<ResolvedBatch> {
  const seen = new Set<string>()
  const rows: Array<{ input: string; email: string | null }> = []
  for (const raw of input.inputs) {
    const email = normalizeContactEmail(raw)
    if (email && seen.has(email)) continue
    if (email) seen.add(email)
    rows.push({ input: String(raw ?? '').trim(), email })
  }

  const addresses = rows
    .map((row) => row.email)
    .filter((email): email is string => Boolean(email))

  /*
   * The group first, because every answer below is about a CONTROLLER and
   * not about a site: a business running three sites as one sender enrolls
   * into all three at once, and an agency's client — which declared no group
   * — resolves to itself.
   */
  const group = await consentGroupForSite(input.hostId)
  const [suppression, { stored, grants }] = await Promise.all([
    suppressionFor(input.hostId, group, addresses),
    readContactConsent(
      orgDataCollectionForHost(input.hostId, 'contacts'),
      group,
      addresses,
    ),
  ])

  const unrecorded: MarketingConsentRecord = readMarketingBasis(null, group)
  const verdicts = rows.map((row): AddressVerdict => {
    if (!row.email) {
      return {
        input: row.input,
        email: null,
        refusal: 'unroutable-address',
        requiresAttestation: false,
        summary: ASSIGNMENT_REFUSAL_MESSAGES['unroutable-address'],
      }
    }
    const record = stored.get(row.email) ?? unrecorded
    const readout = assignmentReadout({
      stored: record,
      suppression: suppression.get(row.email) ?? null,
    })
    return {
      input: row.input,
      email: row.email,
      /*
       * Straight off the readout, with no attestation in the question.
       *
       * `assignmentReadout` answers what is TRUE about this person — a stored
       * refusal, a suppression, an opt-in, or nothing on record — and none of
       * those changes because the operator did or did not tick a box. Feeding
       * the flag in here would make the preview's answer depend on it, so the
       * count the operator stands behind would move as they answered. The
       * basis itself is decided once, at the write, by `assignmentBasis`.
       */
      refusal: readout.enrollable
        ? null
        : (suppression.get(row.email) ?? 'declined'),
      requiresAttestation: readout.requiresAttestation,
      summary: readout.summary,
    }
  })

  return {
    verdicts,
    stored,
    grants,
    group,
    optedIn: verdicts.filter(
      (verdict) => !verdict.refusal && !verdict.requiresAttestation,
    ).length,
    needAttestation: verdicts.filter((verdict) => verdict.requiresAttestation)
      .length,
    refused: verdicts.filter(
      (verdict) => verdict.refusal && !verdict.requiresAttestation,
    ).length,
  }
}

/**
 * Which of these addresses is suppressed, and by which list.
 *
 * Composed from the shipped helpers rather than reading the two collections
 * here: normalization, de-duplication and the fail-closed posture live in
 * `email-suppression.ts`, and a second copy of them is a second set of rules
 * for the enrollment check and the send-time check to disagree about — which
 * is exactly the disagreement `an-enrollment-is-not-a-license-to-send.spec.ts`
 * exists to stop.
 *
 * Read across the site's consent group, as the send reads it: somebody who
 * unsubscribed from a sibling of a declared group is refused here too, rather
 * than enrolled onto a list whose campaigns will never reach them.
 */
async function suppressionFor(
  hostId: string,
  group: ConsentGroup,
  addresses: readonly string[],
): Promise<Map<string, AddressRefusal>> {
  const refusals = new Map<string, AddressRefusal>()
  if (!addresses.length) return refusals
  const sendable = new Set(
    await filterSendableForHost(hostId, addresses, undefined, group),
  )
  const blocked = addresses.filter((email) => !sendable.has(email))
  if (!blocked.length) return refusals
  // Only the blocked ones, and only to say WHICH list. Survivors of the
  // platform half are held by this site's own list, or a group sibling's.
  const platformSendable = new Set(await filterSuppressedEmails(blocked))
  for (const email of blocked) {
    refusals.set(
      email,
      platformSendable.has(email) ? 'suppressed-host' : 'suppressed-platform',
    )
  }
  return refusals
}

/** The addresses named by one request, or the refusal to send back. */
export function readAddresses(
  req: Parameters<PluginApiHandler>[0],
): { emails: string[] } | { error: string } {
  const body = req.body as { emails?: unknown; email?: unknown } | undefined
  const raw = Array.isArray(body?.emails)
    ? body.emails
    : body?.email === undefined
      ? []
      : [body.email]
  const emails = raw
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0)
  if (!emails.length) return { error: 'No addresses' }
  if (emails.length > LIST_MEMBER_BATCH_MAX) {
    return {
      error:
        `${emails.length} addresses is more than one go can take. Add up to ` +
        `${LIST_MEMBER_BATCH_MAX} at a time.`,
    }
  }
  return { emails }
}
