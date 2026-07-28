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
} from '@aglyn/tenant-data-admin'
import { emitHostEvent, resolveDatasetDoc } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

const MAX_FIELDS = 20
const MAX_PAYLOAD_CHARS = 10000

// Per-IP submission limit (AGL-794). Previously a per-instance Map, which on
// serverless resets each cold start and is held per concurrent instance — so
// a spammer got roughly RATE_MAX × instances and could widen it by going
// wider. The monthly plan quota is still the hard cap, but it is the wrong
// thing to be defended BY: burning a site's whole allowance is the damage,
// not the protection. This counter is global, keyed per (site, IP).
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Lead-capture submissions endpoint (AGL-76): validates the target host,
 * drops honeypot hits silently, enforces the plan's monthly submission
 * quota via a per-month counter, and stores the submission for the console
 * inbox. Writes go through the admin SDK, so client rules never allow
 * arbitrary submission writes.
 */
export async function POST(request: Request): Promise<Response> {
  const payload = (await request.json().catch(() => ({}))) as Record<string, any>
  const { hostId, formName, dataset, datasetId, fieldMap, path, fields, website } =
    payload

  // Honeypot filled → pretend success so bots learn nothing.
  if (typeof website === 'string' && website.trim()) {
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

    // Monthly quota by the owning org's plan (dark-launch: orgs
    // without a plan are uncapped, matching every other gate).
    // Plan/quota gates ride the owning org's doc (AGL-238).
    const orgBilling = (await getOrgForHost(hostId))?.org
    const monthKey = new Date().toISOString().slice(0, 7)
    const counterRef = hostRef.collection('counters').doc('formSubmissions')
    {
      // Plan-less orgs resolve as free (AGL-247) — the cap always runs.
      const org = orgBilling
      const limit = Aglyn.resolveOrgEntitlements(
        org as any,
      ).formSubmissionsPerMonth
      const counterSnapshot = await counterRef.get()
      const used = Number(counterSnapshot.get(monthKey) ?? 0)
      if (used >= limit) {
        return json({ error: 'Submission limit reached' }, 429)
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
