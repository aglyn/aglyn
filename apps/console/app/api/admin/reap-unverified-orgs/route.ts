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
 * COLLECT THE WORKSPACES A SIGNUP MADE AND NOBODY EVER CLAIMED (AGL-2585).
 *
 * `provisionAndLandSignUp` creates the workspace seconds after the Firebase
 * account and three seconds before the verification email — deliberately, so
 * a new customer lands in a workspace rather than a picker (AGL-1115) — and
 * until this route existed nothing anywhere looked at the other end of it. A
 * workspace whose owner never confirmed an address stood forever, and so did
 * the name it took: an org's name is its address, `acme-inc.aglyn.com`, and
 * one throwaway inbox claimed any name permanently, a competitor's and a
 * customer's included.
 *
 * This is the sweep that ends both, and it does two things per pass:
 *
 *   - erases the workspaces {@link refuseUnverifiedOrgReap} can prove belong
 *     to nobody, which releases their address through `eraseOrgSlugs`; and
 *   - PROMOTES the held address of every owner who has since verified, from
 *     a reservation with an expiry to the grant this collection has always
 *     written. That half is not optional bookkeeping: an address left pending
 *     becomes claimable when its reservation lapses, and doing that to a real
 *     customer is the worst outcome this whole change could produce.
 *
 * ## ⛔ DRY RUN IS THE DEFAULT, ON EVERY METHOD
 *
 * `isCronDryRun` keys the default on the HTTP method — a GET reports, a
 * bodyless POST acts — and that is right for its five callers, whose worst
 * mistake is archiving audit rows early. It is not right here. This route
 * erases whole workspaces, so a POST that forgot to say what it wanted must
 * report rather than destroy, and arming it is an explicit `dryRun=0` that
 * appears in exactly one place: the schedule in `cloud/functions/src/index.ts`.
 * Turning this sweep back into a preview is deleting eight characters there.
 *
 * ## What it reads, and in what order
 *
 * Three stages, cheapest first, and the staging is a cost decision that must
 * never become a safety one. Stage one asks the org document alone; stage two
 * adds the owner's auth record; stage three adds the roster, the sites, the
 * subcollections, the activity and the billing document. A workspace that
 * stops early keeps REFUSING placeholders for everything unread — values that
 * can only ever produce a refusal — so a stage that never ran cannot be the
 * reason something was selected.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  eraseOrg,
  findUserByUidAcrossPools,
  firebaseAdmin,
} from '@aglyn/tenant-data-admin'
import { isCronAuthorized } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import {
  planUnverifiedOrgReap,
  UNVERIFIED_ORG_GRACE_MS,
  type UnverifiedOrgFacts,
} from '../../../../utils/server/reap-unverified-orgs'

export const dynamic = 'force-dynamic'

/** Org documents read per page while walking the creation window. */
const ORG_PAGE = 200

/**
 * The oldest workspace this sweep will consider.
 *
 * A window rather than "everything before the grace", so the walk is bounded
 * and does not re-read the whole platform every night to learn what it
 * learned yesterday. Deliberately generous: anything older than this is
 * reported as out of range and left to a human, because a workspace that has
 * stood for half a year unverified is a question about how it got there
 * rather than an obvious piece of junk.
 */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

/** The most org documents one run walks before reporting and stopping. */
const MAX_ORGS_SCANNED = 5_000

/**
 * Ceiling on erasures per run.
 *
 * Low on purpose. Nothing waits on this sweep, the remainder is picked up
 * tomorrow, and a bug that selected wrongly destroys twenty-five workspaces
 * rather than five thousand before somebody reads the report.
 */
const MAX_REAPS = 25

/** Slug reservations fetched per `getAll`. */
const READ_BATCH = 200

/**
 * The values every unread fact takes.
 *
 * ⛔ EVERY ONE OF THESE MUST BE A REFUSING VALUE. They stand in for reads a
 * stage did not reach, and the property that makes the staging safe rather
 * than merely cheap is that no combination of them can select a workspace: an
 * empty roster is `has-other-members`, one site is `has-sites`, an unknown
 * subcollection is `has-content`, and a billing relationship is `has-billing`.
 */
const UNREAD_FACTS = {
  memberUids: [] as readonly string[],
  hostCount: 1,
  subcollections: ['⛔unread'] as readonly string[],
  activityCount: Number.MAX_SAFE_INTEGER,
  hasBillingRelationship: true,
} as const

/**
 * Org-document keys that mean this workspace has reached the processor.
 *
 * The pre-AGL-1028 shape, when billing lived on the org document itself. An
 * org young enough to be in this window has its billing in the subcollection,
 * so this is a belt on top of a brace — which is the correct amount of care
 * for "has this workspace ever paid us".
 */
const LEGACY_BILLING_KEYS = [
  'stripeCustomerId',
  'subscription',
  'billingStatus',
  'plan',
  'planPriceId',
  'enterprise',
  'discount',
  'suspendedAt',
]

/** Whether an unarmed run reports instead of acting. See the note above. */
function isDryRun(request: {
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}): boolean {
  const requested =
    (request.body as { dryRun?: unknown } | undefined)?.dryRun ??
    request.query?.['dryRun']
  if (requested === undefined) return true
  return requested !== '0' && requested !== 'false' && requested !== false
}

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>

  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'Unverified-org reaping is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  // The mark `/api/health/crons` reads to notice this job going AWAY. On the
  // invocation, not on the work: a sweep that erases nothing still proves the
  // schedule is alive, and erasing nothing is the healthy day.
  if (method === 'POST') await recordCronBeat('reap-unverified-orgs')

  const dryRun = isDryRun({ query, body })
  const now = Date.now()

  try {
    const firestore = firebaseAdmin.app().firestore()
    const Timestamp = firebaseAdmin.firestore.Timestamp

    /*
     * The creation window, walked in pages.
     *
     * One range on one field, so no composite index is owed. Ascending from
     * the old end, which is where anything genuinely abandoned already sits —
     * a truncated walk therefore yields a smaller correct answer rather than
     * a different one, and `truncated` says when that happened.
     */
    const scanned: (UnverifiedOrgFacts & {
      slugReservedUntilMs: number | null
    })[] = []
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null

    for (;;) {
      let page = firestore
        .collection('orgs')
        .where('createdAt', '>=', Timestamp.fromMillis(now - MAX_AGE_MS))
        .where(
          'createdAt',
          '<=',
          Timestamp.fromMillis(now - UNVERIFIED_ORG_GRACE_MS),
        )
        .orderBy('createdAt', 'asc')
        .limit(ORG_PAGE)
      if (cursor) page = page.startAfter(cursor)
      const snapshot = await page.get()
      if (snapshot.empty) break

      // The addresses this page holds, in one round trip rather than one read
      // per workspace. Needed for the promotion half, which applies to every
      // scanned workspace and not only to the ones being considered for
      // erasure.
      const slugs = snapshot.docs
        .map((doc) => doc.get('slug'))
        .filter((slug): slug is string => typeof slug === 'string' && !!slug)
      const reservedUntil = new Map<string, number | null>()
      for (let index = 0; index < slugs.length; index += READ_BATCH) {
        const refs = slugs
          .slice(index, index + READ_BATCH)
          .map((slug) => firestore.collection('orgSlugs').doc(slug))
        if (!refs.length) continue
        for (const doc of await firestore.getAll(...refs)) {
          const until = doc.get('reservedUntil')
          reservedUntil.set(doc.id, typeof until === 'number' ? until : null)
        }
      }

      for (const doc of snapshot.docs) {
        const slug = (doc.get('slug') as string | undefined) ?? null
        const ownerUid = (doc.get('ownerUid') as string | undefined) ?? null
        const facts: UnverifiedOrgFacts & { slugReservedUntilMs: number | null } =
          {
            orgId: doc.id,
            slug,
            createdAtMs: doc.get('createdAt')?.toMillis?.() ?? null,
            ownerUid,
            createdByUid: (doc.get('createdByUid') as string | undefined) ?? null,
            erasureRequested: Boolean(doc.get('erasureRequestedAt')),
            owner: null,
            ...UNREAD_FACTS,
            slugReservedUntilMs: slug
              ? (reservedUntil.get(slug) ?? null)
              : null,
          }

        // Stage two: the auth record. Every workspace in the window pays for
        // this, and it is what prunes almost all of them — the overwhelming
        // majority of owners verified within minutes of signing up.
        if (ownerUid) {
          const found = await findUserByUidAcrossPools(ownerUid).catch(
            () => null,
          )
          if (found) {
            facts.owner = {
              uid: found.record.uid,
              emailVerified: found.record.emailVerified === true,
              tenantId: found.tenantId ?? null,
              providerIds: (found.record.providerData ?? []).map(
                (provider) => provider.providerId,
              ),
            }
          }
        }

        /*
         * Stage three, for the few still standing: the reads that prove the
         * workspace is empty. Guarded by exactly the conditions that make
         * stage three's answers the only ones left to give — the placeholders
         * above already refuse everything else, so running these on a
         * workspace whose owner is verified would be reads bought for nothing.
         */
        if (facts.owner && !facts.owner.emailVerified && facts.ownerUid) {
          const orgRef = firestore.collection('orgs').doc(doc.id)
          const [members, hosts, activity, billing, collections] =
            await Promise.all([
              orgRef.collection('members').limit(3).get(),
              firestore
                .collection('hosts')
                .where('orgId', '==', doc.id)
                .limit(1)
                .get(),
              orgRef.collection('activity').limit(3).get(),
              orgRef.collection('billing').doc('stripe').get(),
              orgRef.listCollections(),
            ])
          const billingData = billing.exists ? (billing.data() ?? {}) : {}
          facts.memberUids = members.docs.map((member) => member.id)
          facts.hostCount = hosts.size
          facts.activityCount = activity.size
          facts.subcollections = collections.map((collection) => collection.id)
          // ANY key on the billing document, plus the legacy shape on the org
          // itself. `createOrganization` writes `{}` there deliberately
          // (AGL-1152), so a single key means something happened.
          facts.hasBillingRelationship =
            Object.keys(billingData).length > 0 ||
            LEGACY_BILLING_KEYS.some(
              (key) => doc.get(key) !== undefined && doc.get(key) !== null,
            )
        }

        scanned.push(facts)
      }

      cursor = snapshot.docs[snapshot.docs.length - 1] ?? null
      if (snapshot.size < ORG_PAGE) break
      if (scanned.length >= MAX_ORGS_SCANNED) break
    }

    const plan = planUnverifiedOrgReap(scanned, {
      now,
      maxReaps: MAX_REAPS,
      graceMs: UNVERIFIED_ORG_GRACE_MS,
    })

    let erased = 0
    let promoted = 0
    const failed: { orgId: string; reason: string }[] = []

    if (!dryRun) {
      /*
       * PROMOTIONS FIRST, and the ordering is not cosmetic.
       *
       * A promotion turns a held address into a granted one and can only ever
       * protect a workspace. An erasure destroys one. If the run dies halfway,
       * the half that has already happened should be the safe half.
       */
      for (const promotion of plan.toPromote) {
        // `update`, never a merging `set`. A `set` on a document that has
        // gone would CREATE one carrying nothing but a deleted field — a
        // reservation with no `orgId`, which `isSlugReservationClaimable`
        // reads as held by nobody-knows-who and refuses to anyone forever.
        // An update on a missing document throws, and throwing is right.
        await firestore
          .collection('orgSlugs')
          .doc(promotion.slug)
          .update({
            reservedUntil: firebaseAdmin.firestore.FieldValue.delete(),
          })
          .then(() => {
            promoted += 1
          })
          .catch(() => undefined)
      }

      for (const candidate of plan.toReap) {
        /*
         * The same function every other erasure runs through (AGL-1481), so
         * the API credentials, the SSO and console domains, the publisher
         * identity, the Storage prefixes, the member back-references and every
         * slug the workspace ever held are released by the code that is
         * maintained for that job — and the address comes back through
         * `eraseOrgSlugs` rather than through a delete written here.
         *
         * `withoutRequest` is the one option this route passes and the only
         * caller that passes it: there is no erasure REQUEST because there is
         * nobody proven to have made one.
         */
        const result = await eraseOrg(candidate.orgId, {
          actorUid: 'cron:reap-unverified-orgs',
          withoutRequest: { reason: 'unverified-signup' },
        }).catch((error) => ({
          ok: false as const,
          skippedReason: (error as { name?: string })?.name ?? 'threw',
        }))
        if (!result.ok) {
          failed.push({
            orgId: candidate.orgId,
            reason: result.skippedReason ?? 'unknown',
          })
          console.error(
            `[reap-unverified-orgs] ${candidate.orgId} was NOT erased ` +
              `(${result.skippedReason ?? 'unknown'}) — its address ` +
              `${candidate.slug ?? '(none)'} is still held.`,
          )
          continue
        }
        erased += 1
        console.warn(
          `[reap-unverified-orgs] erased ${candidate.orgId} ` +
            `(${candidate.ageDays} days old, address ` +
            `${candidate.slug ?? '(none)'} released) — its sole owner never ` +
            'confirmed an email address.',
        )
      }

      if (erased || promoted || failed.length) {
        await firestore
          .collection('adminAudit')
          .add({
            actorUid: 'system:cron',
            action: 'orgs.unverified.reap',
            target: 'orgs',
            after: {
              erased: plan.toReap
                .filter(
                  (candidate) =>
                    !failed.some((entry) => entry.orgId === candidate.orgId),
                )
                .map((candidate) => candidate.orgId),
              promoted: plan.toPromote.map((promotion) => promotion.orgId),
              failed,
            },
            at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          })
          .catch(() => undefined)
      }
    }

    return Response.json(
      {
        dryRun,
        scanned: plan.scanned,
        truncated: plan.scanned >= MAX_ORGS_SCANNED,
        graceDays: Math.round(UNVERIFIED_ORG_GRACE_MS / (24 * 60 * 60 * 1000)),
        selected: plan.toReap.length,
        erased,
        promotions: plan.toPromote.length,
        promoted,
        deferredByCap: plan.deferredByCap,
        // Every reason a workspace was left standing, and how many it held.
        // The number to read on a run that reaped nothing.
        refused: plan.refusedCounts,
        // Ids and ages only. A report on workspaces that may be about to be
        // destroyed must not carry their owners' addresses.
        candidates: plan.toReap.map((candidate) => ({
          orgId: candidate.orgId,
          slug: candidate.slug,
          ageDays: candidate.ageDays,
        })),
        failed,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(
      '[reap-unverified-orgs] sweep failed',
      (error as { name?: string })?.name ?? 'unknown',
    )
    return Response.json(
      { error: 'Unverified-org reaping failed' },
      { status: 500 },
    )
  }
}

export { handler as GET, handler as POST }

/** The walk covers every workspace in the creation window. */
export const maxDuration = 60
