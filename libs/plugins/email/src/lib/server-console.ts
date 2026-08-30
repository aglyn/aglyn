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
 * Putting somebody on an email list from the Emails console.
 *
 * The audience card could create a list and delete a list and nothing else:
 * no way to see who was on one, no way to add anybody, no way to take anybody
 * off. Every member document in production arrived from a capture surface —
 * the newsletter handler, the workflow `enrollList` step, the dynamic-list
 * materializer, the Inbox assignment — so the one act a merchant most expects
 * of a list, "add this person", was the one act the product refused.
 *
 * ## Why this is a route and not a client write
 *
 * Rules put `orgs/{orgId}/lists/{listId}/members` behind org-wide membership,
 * and until now that block allowed a client CREATE. Nothing used it, and it
 * was the whole feature waiting to be built wrong: a browser that can write a
 * member document can write `marketingConsent: true` beside an address it has
 * never checked, which is a consent record minted by pressing a button. The
 * rules now deny client create and update on that collection, and this route
 * is the writer — through `enrollListMember`, which owns the document id, and
 * through the shared `list-assignment-policy`, which owns the basis.
 *
 * ## The same policy the Inbox uses, not a second one
 *
 * `assignmentBasis` and `assignmentReadout` are imported from the framework,
 * where they moved when this became their second caller. There is no third
 * consent basis and no console-only override: a stored `declined` refuses
 * here exactly as it refuses there, an attestation is recorded with the
 * account that made it, and a stored opt-in is carried across with the date
 * the PERSON set rather than the date somebody pressed Add.
 *
 * ## Reads only, until the operator has seen the count
 *
 * `email/list-members-preview` writes nothing. It answers, per address, what
 * would happen and why, so the attestation the operator gives on the second
 * call is given with the numbers in front of them. Both routes run the SAME
 * resolution over the SAME inputs — {@link resolveAddresses} — so the summary
 * they were shown is the summary that acts.
 */

import {
  ASSIGNMENT_REFUSAL_MESSAGES,
  assignmentBasis,
  assignmentReadout,
  isOrgWideMember,
  normalizeContactEmail,
  readMarketingBasis,
  registerPluginApiRoute,
  type AddressRefusal,
  type AssignmentRefusal,
  type MarketingConsentRecord,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  enrollListMember,
  filterSendableForHost,
  filterSuppressedEmails,
  firebaseAdmin,
  getOrgForHost,
  orgDataCollectionForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/** `source` stamped on every membership these routes write. */
export const CONSOLE_ADD_SOURCE = 'console:list-add'

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

/** How many contact addresses one `in` query may carry. */
const CONTACT_LOOKUP_CHUNK = 30

/** Everything the two routes need, or the refusal to send back. */
type ListContext =
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
async function resolveListContext(
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
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
  if (memberRole !== 'admin' && memberRole !== 'editor') {
    return {
      ok: false,
      status: 403,
      body: { error: 'Not a site admin or editor' },
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
  const member = membership?.member
  const orgWideWriter =
    isOrgWideMember(member) &&
    (member?.role === 'owner' ||
      member?.role === 'admin' ||
      member?.role === 'editor') &&
    (member as { orgSuspended?: boolean } | undefined)?.orgSuspended !== true
  if (!orgWideWriter) {
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
interface ResolvedBatch extends AddressResolution {
  stored: Map<string, MarketingConsentRecord>
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
async function resolveAddresses(input: {
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

  const [suppression, stored] = await Promise.all([
    suppressionFor(input.hostId, addresses),
    storedConsentFor(input.hostId, addresses),
  ])

  const unrecorded: MarketingConsentRecord = readMarketingBasis(null)
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
 */
async function suppressionFor(
  hostId: string,
  addresses: readonly string[],
): Promise<Map<string, AddressRefusal>> {
  const refusals = new Map<string, AddressRefusal>()
  if (!addresses.length) return refusals
  const sendable = new Set(await filterSendableForHost(hostId, addresses))
  const blocked = addresses.filter((email) => !sendable.has(email))
  if (!blocked.length) return refusals
  // Only the blocked ones, and only to say WHICH list. Survivors of the
  // platform half are held by this site's own list.
  const platformSendable = new Set(await filterSuppressedEmails(blocked))
  for (const email of blocked) {
    refusals.set(
      email,
      platformSendable.has(email) ? 'suppressed-host' : 'suppressed-platform',
    )
  }
  return refusals
}

/**
 * The stored consent facts for these addresses, off the org's contacts.
 *
 * Read UNSCOPED, deliberately, exactly as the Inbox route reads it:
 * `scopedToHost` narrows an org collection to what one site may see, and a
 * refusal filtered out by that narrowing is a refusal this route would then
 * step over — the failure mode is enrolling somebody who said no. It is safe
 * because the caller has already been proved an org-wide member, which is the
 * tier the rules grant the whole org's contacts to.
 *
 * ## A refusal wins over an opt-in when the CRM holds both
 *
 * Nothing guarantees one contact per address — the collection is keyed by
 * resource id, not by email — so two records for one person can disagree.
 * Taking whichever the query happened to answer first would make the outcome
 * depend on document order. A recorded refusal is the answer whenever one
 * exists, which is the same precedence `assignmentBasis` applies within a
 * single record.
 *
 * A failed read falls to `declined` for the whole batch, for the reason the
 * Inbox route states: a read that throws can neither say the person consented
 * nor that they refused, and the direction that costs a retry is the one that
 * does not enroll somebody whose stored refusal we simply failed to see.
 */
async function storedConsentFor(
  hostId: string,
  addresses: readonly string[],
): Promise<Map<string, MarketingConsentRecord>> {
  const found = new Map<string, MarketingConsentRecord>()
  if (!addresses.length) return found
  try {
    const contacts = await orgDataCollectionForHost(hostId, 'contacts')
    const chunks: string[][] = []
    for (let at = 0; at < addresses.length; at += CONTACT_LOOKUP_CHUNK) {
      chunks.push(addresses.slice(at, at + CONTACT_LOOKUP_CHUNK))
    }
    const snapshots = await Promise.all(
      chunks.map((chunk) => contacts.where('email', 'in', chunk).get()),
    )
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        const email = normalizeContactEmail(doc.get('email'))
        if (!email) continue
        const record = readMarketingBasis(doc.data() as Record<string, unknown>)
        const already = found.get(email)
        if (already?.basis === 'declined') continue
        if (already && record.basis !== 'declined') continue
        found.set(email, record)
      }
    }
    return found
  } catch (error) {
    console.error('[email] consent lookup failed', error)
    const refused: MarketingConsentRecord = {
      basis: 'declined',
      // Attributed to nobody: this is what a failed read falls back to, not a
      // refusal anybody recorded.
      assertedBy: null,
      source: null,
      basisAtMs: null,
      capturedAtMs: null,
    }
    return new Map(addresses.map((email) => [email, refused]))
  }
}

/** The addresses named by one request, or the refusal to send back. */
function readAddresses(
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

/**
 * `POST email/list-members-preview` — what adding these addresses would do.
 *
 * Reads only, and reached by an explicit act — typing an address or pasting a
 * column — never on mount. It exists because the answer needs three things
 * the browser cannot have: the org's contacts (rules put them behind org-wide
 * membership, which the acting console session may not hold) and both
 * suppression lists. Computing any of it client-side would be a second copy
 * of the rule, on the surface whose whole job is to tell the operator the
 * truth about what is about to happen.
 *
 * It takes no attestation and has nowhere to put one. The preview answers
 * what is TRUE about each person, which is the input to the operator's
 * decision rather than a function of it — a preview whose numbers moved as
 * the box was ticked would not be a count anybody could stand behind.
 */
export const emailListMembersPreviewHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const requested = readAddresses(req)
  if ('error' in requested) {
    return res.status(400).json({ error: requested.error })
  }
  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const { verdicts, optedIn, needAttestation, refused } =
      await resolveAddresses({
        hostId: context.hostId,
        inputs: requested.emails,
      })
    /*
     * Named fields rather than a spread of the resolution.
     *
     * The resolution carries the consent RECORDS it was computed from, for the
     * write path's use — raw stored basis, provenance, the account behind an
     * operator assertion. None of that is the browser's, and a spread would
     * put all of it on the wire the moment a field was added to the internal
     * shape. What the surface needs is the verdicts and the counts.
     */
    return res.status(200).json({
      listName: context.listName,
      verdicts,
      optedIn,
      needAttestation,
      refused,
    })
  } catch (error) {
    console.error('[email] list member preview failed', error)
    return res.status(500).json({ error: 'The addresses could not be checked.' })
  }
}

/**
 * `POST email/list-members-add` — put these addresses on the list.
 *
 * Body: `{ hostId, listId, email | emails[], name?, attestConsent? }`.
 * `attestConsent` is the operator STATING that they have these people's
 * permission; it is not a way to name a basis, because the pass-through basis
 * is derived server-side from each person's own record.
 *
 * ## One attestation, for the count the operator was shown
 *
 * The batch carries a single assertion because it is a single act: an
 * operator pasting a column is making one claim about where that column came
 * from. What makes that safe is that the claim is applied per address by the
 * same function the preview ran, so it reaches only the addresses that
 * actually need it — an address with a stored opt-in keeps its own basis and
 * its own date, and an address nothing can enroll is refused with the
 * attestation on the table.
 *
 * ## Partial success is the honest answer
 *
 * A batch where one address is suppressed and forty are fine is not a failed
 * request. Every address comes back with what happened to it, so 200 here
 * means "the request was processed", never "everybody was added" — the caller
 * reads the per-address verdicts, which is why they are returned rather than
 * a count.
 */
export const emailListMembersAddHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const requested = readAddresses(req)
  if ('error' in requested) {
    return res.status(400).json({ error: requested.error })
  }
  const attested = req.body?.attestConsent === true
  const name = String(req.body?.name ?? '').trim()

  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const nowMs = Date.now()
    const resolution = await resolveAddresses({
      hostId: context.hostId,
      inputs: requested.emails,
    })

    const results = []
    for (const verdict of resolution.verdicts) {
      if (verdict.refusal || !verdict.email) {
        results.push({
          input: verdict.input,
          email: verdict.email,
          enrolled: false,
          reason: verdict.refusal,
          error: verdict.summary,
        })
        continue
      }
      /*
       * The ONE place a basis is decided, and the only place the attestation
       * is consulted.
       *
       * `resolveAddresses` has already answered the questions that are facts
       * about the person; this answers the question that is about the
       * operator, per address, from the consent record that resolution read.
       * `no-basis` — an address with nothing on record and nobody asserting
       * anything — is refused HERE and only here.
       */
      const decision = assignmentBasis({
        stored: resolution.stored.get(verdict.email) ?? readMarketingBasis(null),
        attested,
        actingUid: context.uid,
        nowMs,
      })
      if ('refusal' in decision) {
        results.push({
          input: verdict.input,
          email: verdict.email,
          enrolled: false,
          reason: decision.refusal,
          error: ASSIGNMENT_REFUSAL_MESSAGES[decision.refusal],
        })
        continue
      }
      const enrollment = await enrollListMember({
        listRef: context.listRef,
        email: verdict.email,
        ...(name && requested.emails.length === 1 ? { name } : {}),
        source: CONSOLE_ADD_SOURCE,
        // Never `'rule'`: the dynamic-list materializer reconciles its own
        // rows away when a person stops matching, and a decision somebody
        // made by hand is not a rule match that lapsed.
        via: 'manual',
        consent: decision,
      })
      if (enrollment.enrolled === false) {
        /*
         * The membership itself records a refusal the CRM record did not.
         * `enrollListMember` is the only writer of the collection and holds
         * the row, so it is the backstop for every enrollment route; reaching
         * it here means the two records disagree, and the refusal wins.
         */
        const reason: AssignmentRefusal =
          enrollment.refusal === 'declined' ? 'declined' : 'unroutable-address'
        results.push({
          input: verdict.input,
          email: verdict.email,
          enrolled: false,
          reason,
          error: ASSIGNMENT_REFUSAL_MESSAGES[reason],
        })
        continue
      }
      results.push({
        input: verdict.input,
        email: verdict.email,
        enrolled: true,
        memberId: enrollment.memberId,
        created: enrollment.created,
        basis: decision.basis,
      })
    }

    return res.status(200).json({
      listName: context.listName,
      added: results.filter((result) => result.enrolled).length,
      results,
    })
  } catch (error) {
    console.error('[email] list member add failed', error)
    return res.status(500).json({ error: 'The addresses could not be added.' })
  }
}

/**
 * Console API registration.
 *
 * Neither of these is on the machine-path exemption list in
 * `plugin-api-rate-limit.ts`. Each is reached by a person pressing a button in
 * a browser, so the visitor limiter's per-(site, IP) budget is far above any
 * real use of them and is the right ceiling for a surface that puts a person
 * into a marketing audience.
 */
export function registerEmailConsoleApi(): void {
  registerPluginApiRoute(
    'email/list-members-preview',
    emailListMembersPreviewHandler,
  )
  registerPluginApiRoute('email/list-members-add', emailListMembersAddHandler)
}
