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

import * as Aglyn from '@aglyn/aglyn/server'
import { extractEmailFromFields } from '@aglyn/aglyn/server'
import {
  consumeRateLimit,
  firebaseAdmin,
  getOrgForHost,
  notifyHostManagers,
  orgDataCollectionForHost,
  upsertHostContact,
  visitorWriteRefusal,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent, resolveDatasetDoc } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const MAX_FIELDS = 20
const MAX_PAYLOAD_CHARS = 10000

// Per-IP submission limit (AGL-794). Previously a per-instance Map, which on
// serverless resets each cold start and is held per concurrent instance — so
// a spammer got roughly RATE_MAX × instances and could widen it by going
// wider. The monthly plan quota was never the right thing to be defended BY:
// burning a site's whole allowance is the damage, not the protection — and
// since AGL-1280 it is not even a wall on a paid plan, it meters. This
// counter is global, keyed per (site, IP).
//
// It is the SHAPE of abuse control, not the whole of it (AGL-1655): 10/60s
// per address is 14,400/day from one IP and multiplies by the number of
// addresses, so per-IP alone leaves the site's total unbounded. The per-site
// monthly ceiling below is what bounds the total.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * The ceiling is a per-MONTH count, so the honest retry hint is the month
 * boundary rather than a made-up interval. UTC, matching `monthKey`.
 */
const secondsUntilNextMonth = (now = new Date()): number => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

/**
 * The one useful thing a refused visitor can be given (AGL-1666): the site's
 * OWN published support address, so a lost lead has somewhere else to go.
 *
 * Read through the host-token registry rather than reaching into the
 * document, because that registry is what defines this field as the address
 * a site publishes to visitors — its description is literally "where
 * visitors should write for help". Anything else on the host document is
 * account data and must not leave the console.
 *
 * Free: the host snapshot is already loaded for the existence check.
 */
const publishedContactEmail = (
  host: Record<string, any> | undefined,
): string | undefined =>
  host ? Aglyn.HOST_TOKENS['supportEmail']?.resolve(host) : undefined

/**
 * Make a tripped ceiling OBSERVABLE (AGL-1655) rather than a silent drop.
 *
 * Two audiences, one write. Staff get a durable per-month refusal count at
 * `hosts/{id}/counters/formSubmissionsRefused` — the same counters-document
 * shape `contactsDropped` already uses for free-tier contact drops, and
 * client-unwritable for the same reason (AGL-1367). The site's managers get
 * one in-app notification, on the FIRST refusal of the month only: a
 * notification per refused bot request would be the flood again, delivered.
 *
 * Best-effort throughout. A bookkeeping failure must not turn a contained
 * refusal into a 500, because a 500 is a retry invitation.
 */
async function recordAbuseCeilingTrip(
  hostRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  monthKey: string,
  ceiling: number,
): Promise<void> {
  try {
    const refusedRef = hostRef
      .collection('counters')
      .doc('formSubmissionsRefused')
    const refusedSnapshot = await refusedRef.get()
    const alreadyRefused = Number(refusedSnapshot.get(monthKey) ?? 0)
    await refusedRef.set(
      {
        [monthKey]: FieldValue.increment(1),
        // Explicit values only — Firestore rejects `undefined`.
        ceiling,
        lastRefusedAtMs: Date.now(),
      },
      { merge: true },
    )
    if (alreadyRefused === 0) {
      await notifyHostManagers(hostId, {
        type: 'system.formSubmissionsPaused',
        title: 'Form submissions paused — unusual volume',
        body: `This site reached ${ceiling} submissions this month, so further submissions are being refused. They are not being billed. Contact support if this is real traffic.`,
        link: `/${hostId}/inbox`,
      })
    }
  } catch (error) {
    console.error('form abuse ceiling bookkeeping failed', error)
  }
}

/**
 * Count a honeypot hit so the bot rate is a NUMBER, not a guess (AGL-1664).
 *
 * The attestation decision (App Check / CAPTCHA / neither) asked to be made
 * on a measured per-host bot rate, and the honeypot was the instrument named
 * for it — but a hit used to return fake success and record nothing, so the
 * number it was supposed to produce did not exist. This writes the same
 * counters-document shape `formSubmissionsRefused` uses (per-month key,
 * client-unwritable, AGL-1367), keyed per host because "which site is the
 * bot filling in" is the decision input.
 *
 * The host-existence read is the orphan guard: this path runs BEFORE the
 * route's shape validation, and an attacker spraying invented host ids must
 * not mint counter documents under hosts that do not exist. Cost per hit is
 * one read + one write — the same order the legitimate path already pays the
 * rate limiter — where the old path cost nothing; that is the price of the
 * measurement, paid only on requests that self-identified as bots.
 *
 * No notification, ever: honeypot hits are routine background noise, and a
 * flood of them delivered as alerts would be the flood again (the
 * `formSubmissionsPaused` lesson). Best-effort for the same reason the
 * refusal bookkeeping is — a bookkeeping failure must not turn a dropped bot
 * request into a 500 retry invitation.
 */
async function recordHoneypotHit(hostId: unknown): Promise<void> {
  try {
    if (typeof hostId !== 'string' || !hostId || hostId.length > 128) return
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
    if (!(await hostRef.get()).exists) return
    await hostRef
      .collection('counters')
      .doc('formSubmissionsSpam')
      .set(
        {
          [Aglyn.submissionMonthKey()]: FieldValue.increment(1),
          lastSpamAtMs: Date.now(),
        },
        { merge: true },
      )
  } catch (error) {
    console.error('honeypot bookkeeping failed', error)
  }
}

/**
 * Lead-capture submissions endpoint (AGL-76): validates the target host,
 * drops honeypot hits silently, applies the plan's monthly submission quota
 * via a per-month counter — a hard wall on free, a meter on plans that carry
 * the infra pass-through (AGL-1280) — refuses above the per-site abuse
 * ceiling (AGL-1655), and stores the submission for the console inbox. Writes
 * go through the admin SDK, so client rules never allow arbitrary submission
 * writes.
 *
 * The two 429s are different answers and must stay distinguishable: the plan
 * wall means the customer's allowance is spent, the ceiling means the site is
 * being flooded. Only the ceiling refusal carries `code`.
 */
export async function POST(request: Request): Promise<Response> {
  const payload = (await request.json().catch(() => ({}))) as Record<string, any>
  const { hostId, formName, dataset, datasetId, fieldMap, path, fields, website } =
    payload

  // Honeypot filled → pretend success so bots learn nothing, counted so the
  // owner of the attestation decision learns something (AGL-1664).
  if (typeof website === 'string' && website.trim()) {
    await recordHoneypotHit(hostId)
    return json({ received: true })
  }
  if (
    typeof hostId !== 'string' ||
    !hostId ||
    typeof fields !== 'object' ||
    fields === null ||
    Array.isArray(fields) ||
    Object.keys(fields).length === 0 ||
    Object.keys(fields).length > MAX_FIELDS ||
    JSON.stringify(fields).length > MAX_PAYLOAD_CHARS
  ) {
    return json({ error: 'Invalid submission' }, 400)
  }
  const ip = String(
    request.headers.get('x-forwarded-for') ?? 'unknown',
  ).split(',')[0]
  const rate = await consumeRateLimit(`form:${hostId}:${ip}`, {
    limit: RATE_MAX,
    windowMs: RATE_WINDOW_MS,
  })
  if (!rate.allowed) {
    // Note this is NOT told to the caller, degraded or not. The body and the
    // status are identical either way: "the global limiter is currently a
    // per-instance one" is exactly the sentence an abuser would spend the
    // window on, and this endpoint is public and unauthenticated.
    return Response.json(
      { error: 'Too many submissions' },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.max(1, Math.ceil((rate.resetMs - Date.now()) / 1000)),
          ),
        },
      },
    )
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return json({ error: 'Unknown site' }, 404)
    }

    // Lockdown (AGL-1511). Placed after the host exists and BEFORE the quota
    // read and every write: a paused submission must not consume the
    // customer's monthly allowance, and it must not be half-recorded.
    // Refused with the visitor pause copy — the site around this form is
    // still serving, so an outage page here would be both a lie and a lost
    // lead. The `/api` surface is outside the middleware matcher, so this is
    // the only lockdown enforcement a form POST ever meets, full or
    // read-only.
    const paused = await visitorWriteRefusal({
      hostId,
      request,
      surface: 'form',
    })
    if (paused) return paused

    // Monthly quota by the owning org's plan (dark-launch: orgs
    // without a plan are uncapped, matching every other gate).
    // Plan/quota gates ride the owning org's doc (AGL-238).
    const orgBilling = (await getOrgForHost(hostId))?.org
    // Shared with the console surface that reads these counters back
    // (AGL-1666) — a differently-derived key there would read 0 refusals on
    // exactly the sites being refused.
    const monthKey = Aglyn.submissionMonthKey()
    const counterRef = hostRef.collection('counters').doc('formSubmissions')
    {
      // Plan-less orgs resolve as free (AGL-247) — the cap always runs.
      const counterSnapshot = await counterRef.get()
      const used = Number(counterSnapshot.get(monthKey) ?? 0)
      // AGL-1280: a plan with the metered infra pass-through is never cut
      // off — submissions past the included count bill at cost × 1.3 like
      // storage, API requests and contacts already do. Free keeps the hard
      // wall, because there is no subscription to meter onto. A dropped
      // submission is a lost lead, so this is the meter where being wrong
      // in the "cut them off" direction costs the customer the most.
      if (!Aglyn.checkFormSubmissionQuota(orgBilling as any, used).allowed) {
        return json({ error: 'Submission limit reached' }, 429)
      }
      // Abuse ceiling (AGL-1655). The plan gate above cannot refuse a
      // metered plan by design, so on every paying customer it was the only
      // thing between a bot flood and an unbounded invoice — and it always
      // said yes. The per-IP limiter is 10/60s, which one address turns into
      // 14,400/day and any number of addresses multiplies.
      //
      // This is the ceiling that can say no. It reuses the count already
      // read above (no extra Firestore read on the happy path) and sits
      // BEFORE every write, so a refused submission never touches
      // `counters/formSubmissions` — the document /api/billing/report-usage
      // invoices from. Refusing and still billing would have been the same
      // bug with a smaller number.
      const ceiling = Aglyn.checkFormSubmissionAbuseCeiling(
        orgBilling as any,
        used,
      )
      if (ceiling.exceeded) {
        await recordAbuseCeilingTrip(hostRef, hostId, monthKey, ceiling.ceiling)
        const contact = publishedContactEmail(hostSnapshot.data())
        return Response.json(
          {
            error: 'Submissions are paused for this site',
            // Machine-readable so a client can tell containment apart from
            // the plan wall it shares a status with.
            code: Aglyn.FORM_ABUSE_CEILING_CODE,
            // The site's own published support address, when it has one
            // (AGL-1666). NOT the ceiling, the count or the plan: this body
            // is read by a stranger to the site, and the reason a site
            // stopped accepting is the owner's to see, not a caller's.
            ...(contact ? { contact } : {}),
          },
          {
            status: 429,
            headers: { 'Retry-After': String(secondsUntilNextMonth()) },
          },
        )
      }
    }

    const sanitizedFields: Record<string, string> = {}
    for (const [key, value] of Object.entries(fields)) {
      sanitizedFields[String(key).slice(0, 64)] = String(value).slice(0, 2000)
    }
    const submissionRef = await hostRef.collection('formSubmissions').add({
      formName: String(formName ?? 'Form').slice(0, 100),
      path: String(path ?? '').slice(0, 500),
      fields: sanitizedFields,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      // Accepted while the durable limiter was degraded (AGL-1667).
      //
      // The limiter fails soft by design (AGL-794, reaffirmed in AGL-1679) and
      // that is not reversed here: a Firestore blip must not stop a customer's
      // site collecting leads, and the fallback can only ever allow MORE than
      // 10/min, never fewer, so nothing legitimate is refused by it. What was
      // wrong is that the route read `allowed` and `resetMs` and never
      // `degraded`, so the window left no trace on THIS endpoint at all.
      //
      // The AGL-1679 marker records that the store degraded; it cannot say
      // which submissions came in under the wider cap, and that is the
      // correlation the incident actually needs — these rows are billed
      // (`/api/billing/report-usage` prices `counters/formSubmissions`) and a
      // customer disputing a spike is owed a per-row answer, not "the limiter
      // was unwell around then".
      //
      // Stamped rather than counted because it rides a write that is already
      // happening: a separate counter would mean an EXTRA Firestore write per
      // submission, issued precisely while Firestore is the thing that is
      // failing. Written only when true — an absent field is the healthy case
      // and costs nothing on the millions of rows that are fine.
      ...(rate.degraded ? { rateDegraded: true } : {}),
    })
    // Contacts ingestion (AGL-197): forms don't guarantee an email field —
    // best-effort extraction; never blocks the submission.
    const contactEmail = extractEmailFromFields(sanitizedFields)
    if (contactEmail) {
      void upsertHostContact({
        hostId,
        email: contactEmail,
        name: sanitizedFields['name'] ?? sanitizedFields['fullName'],
        source: 'form',
        interaction: {
          refId: submissionRef.id,
          summary: `Submitted "${String(formName ?? 'Form').slice(0, 60)}"`,
        },
      })
    }
    // Dataset binding (AGL-141/556): append a record into the bound
    // dataset — by id first (rename-safe), by human name for legacy nodes.
    // Best-effort — a missing dataset or a full record quota never fails
    // the submission (the inbox copy above is canonical).
    const datasetName = String(dataset ?? '')
      .trim()
      .slice(0, 60)
    const boundDatasetId = String(datasetId ?? '')
      .trim()
      .slice(0, 128)
    // Client-supplied field → model-fieldId mapping (AGL-556); entries
    // are re-validated against the dataset model below (unknown ids drop).
    const sanitizedFieldMap: Record<string, string> = {}
    if (fieldMap && typeof fieldMap === 'object' && !Array.isArray(fieldMap)) {
      for (const [key, value] of Object.entries(fieldMap).slice(0, MAX_FIELDS)) {
        if (typeof value !== 'string' || !value) continue
        sanitizedFieldMap[String(key).slice(0, 64)] = value.slice(0, 64)
      }
    }
    if (boundDatasetId || datasetName) {
      try {
        // Org-scoped datasets (AGL-237): the form's dataset resolves
        // against the org so every host shares it.
        const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
        const datasetDoc = await resolveDatasetDoc(
          datasetsRef,
          { datasetId: boundDatasetId, datasetName },
          hostId,
        )
        if (datasetDoc?.exists && !datasetDoc.get('deletedAt')) {
          const values = Aglyn.buildDatasetRecordValues(
            {
              model: datasetDoc.get('model'),
              fields: Array.isArray(datasetDoc.get('fields'))
                ? datasetDoc.get('fields')
                : [],
            },
            sanitizedFields,
            sanitizedFieldMap,
          )
          let allowed = Object.keys(values).length > 0
          if (allowed) {
            const recordCount = (
              await datasetDoc.ref.collection('records').count().get()
            ).data().count
            allowed = Aglyn.checkQuota(
              orgBilling as any,
              'recordsPerDataset',
              recordCount,
            ).allowed
          }
          if (allowed) {
            await datasetDoc.ref.collection('records').add({
              values,
              createdAt: FieldValue.serverTimestamp(),
            })
          }
        }
      } catch (error) {
        console.error('form dataset append failed', error)
      }
    }
    await counterRef.set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
    // Event trigger (AGL-128/148): field values join the automation
    // scope; action-produced site alerts ride back to the visitor.
    // In-app notification to the site's managers (AGL-259).
    void notifyHostManagers(hostId, {
      type: 'content.formSubmission',
      title: `New form submission${formName ? ` — ${formName}` : ''}`,
      ...(typeof path === 'string' && path ? { body: `Page: ${path}` } : {}),
      link: `/${hostId}/inbox`,
    })
    const { alerts } = await emitHostEvent(hostId, 'formSubmission', {
      formName: String(formName ?? 'Form').slice(0, 100),
      path: String(path ?? '').slice(0, 500),
      ...sanitizedFields,
    })
    return json({ received: true, alerts })
  } catch (error) {
    console.error(error)
    return json({ error: 'Submission failed' }, 500)
  }
}
