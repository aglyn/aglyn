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

import * as Aglyn from '@aglyn/aglyn'
import {
  orgDataCollectionForHost, firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { extractEmailFromFields } from '@aglyn/aglyn'
import { upsertHostContact } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'
import { emitHostEvent } from '../../../utils/emit-host-event'

const MAX_FIELDS = 20
const MAX_PAYLOAD_CHARS = 10000

// Best-effort per-instance rate limit — serverless instances are ephemeral,
// so this only blunts bursts; the monthly quota is the real cap.
const recentByIp = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recentByIp.get(ip) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  )
  hits.push(now)
  recentByIp.set(ip, hits)
  return hits.length > RATE_MAX
}

/**
 * Lead-capture submissions endpoint (AGL-76): validates the target host,
 * drops honeypot hits silently, enforces the plan's monthly submission
 * quota via a per-month counter, and stores the submission for the console
 * inbox. Writes go through the admin SDK, so client rules never allow
 * arbitrary submission writes.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const { hostId, formName, dataset, path, fields, website } = req.body ?? {}

  // Honeypot filled → pretend success so bots learn nothing.
  if (typeof website === 'string' && website.trim()) {
    return res.status(200).json({ received: true })
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
    return res.status(400).json({ error: 'Invalid submission' })
  }
  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown',
  ).split(',')[0]
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many submissions' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }

    // Monthly quota by the owning tenant's plan (dark-launch: tenants
    // without a plan are uncapped, matching every other gate).
    // Plan/quota gates ride the owning org's doc (AGL-238).
    const orgBilling = (await getOrgForHost(hostId))?.org
    const monthKey = new Date().toISOString().slice(0, 7)
    const counterRef = hostRef.collection('counters').doc('formSubmissions')
    {
      const tenant = orgBilling
      if (tenant?.['plan']) {
        const limit = Aglyn.resolveTenantEntitlements(
          tenant as any,
        ).formSubmissionsPerMonth
        const counterSnapshot = await counterRef.get()
        const used = Number(counterSnapshot.get(monthKey) ?? 0)
        if (used >= limit) {
          return res.status(429).json({ error: 'Submission limit reached' })
        }
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
    // Dataset binding (AGL-141): append a record mapped by field name into
    // the named dataset. Best-effort — a missing dataset or a full record
    // quota never fails the submission (the inbox copy above is canonical).
    const datasetName = String(dataset ?? '')
      .trim()
      .slice(0, 60)
    if (datasetName) {
      try {
        // Org-scoped datasets (AGL-237): the form's named dataset
        // resolves against the org so every host shares it.
        const datasetsSnapshot = await (
          await orgDataCollectionForHost(hostId, 'datasets')
        )
          .where('name', '==', datasetName)
          .limit(1)
          .get()
        const datasetDoc = datasetsSnapshot.docs[0]
        if (datasetDoc && !datasetDoc.get('deletedAt')) {
          const declaredFields: string[] = Array.isArray(
            datasetDoc.get('fields'),
          )
            ? datasetDoc.get('fields')
            : []
          const values = Aglyn.sanitizeRecordValues(
            declaredFields,
            sanitizedFields,
          )
          let allowed = Object.keys(values).length > 0
          if (allowed && orgBilling) {
            const tenant = orgBilling
            if (tenant?.['plan']) {
              const recordCount = (
                await datasetDoc.ref.collection('records').count().get()
              ).data().count
              allowed = Aglyn.checkQuota(
                tenant as any,
                'recordsPerDataset',
                recordCount,
              ).allowed
            }
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
    await counterRef.set(
      { [monthKey]: FieldValue.increment(1) },
      { merge: true },
    )
    // Event trigger (AGL-128/148): field values join the automation
    // scope; action-produced site alerts ride back to the visitor.
    const { alerts } = await emitHostEvent(hostId, 'formSubmission', {
      formName: String(formName ?? 'Form').slice(0, 100),
      path: String(path ?? '').slice(0, 500),
      ...sanitizedFields,
    })
    return res.status(200).json({ received: true, alerts })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Submission failed' })
  }
}
