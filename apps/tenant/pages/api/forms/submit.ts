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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'
import { runEventWorkflows } from '../../../utils/run-event-workflows'

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
  const { hostId, formName, path, fields, website } = req.body ?? {}

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
    const tenantId = hostSnapshot.get('tenantId') as string | undefined
    const monthKey = new Date().toISOString().slice(0, 7)
    const counterRef = hostRef.collection('counters').doc('formSubmissions')
    if (tenantId) {
      const tenantSnapshot = await firestore
        .collection('tenants')
        .doc(tenantId)
        .get()
      const tenant = tenantSnapshot.exists ? tenantSnapshot.data() : undefined
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
    await hostRef.collection('formSubmissions').add({
      formName: String(formName ?? 'Form').slice(0, 100),
      path: String(path ?? '').slice(0, 500),
      fields: sanitizedFields,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    })
    await counterRef.set(
      { [monthKey]: FieldValue.increment(1) },
      { merge: true },
    )
    // Event trigger (AGL-128): field values join the workflow scope.
    await runEventWorkflows(hostId, 'formSubmission', {
      formName: String(formName ?? 'Form').slice(0, 100),
      path: String(path ?? '').slice(0, 500),
      ...sanitizedFields,
    })
    return res.status(200).json({ received: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Submission failed' })
  }
}
