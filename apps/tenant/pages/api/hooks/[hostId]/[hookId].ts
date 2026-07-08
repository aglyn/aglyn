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

import {
  checkEntitlement,
  type HostFunction,
  type HostVariable,
  type HostWebhook,
  type HostWorkflow,
  runWorkflow,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { timingSafeEqual } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'

// Best-effort per-instance rate limit (mirrors forms/submit).
const recentByHook = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30

function rateLimited(key: string): boolean {
  const now = Date.now()
  const hits = (recentByHook.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  )
  hits.push(now)
  recentByHook.set(key, hits)
  return hits.length > RATE_MAX
}

function secretsMatch(expected: string, provided: string): boolean {
  if (!expected || expected.length !== provided.length) return false
  return timingSafeEqual(
    new Uint8Array(Buffer.from(expected)),
    new Uint8Array(Buffer.from(provided)),
  )
}

/**
 * Inbound webhook endpoint (AGL-149): external systems POST JSON to
 * `/api/hooks/{hostId}/{hookId}` with the hook's secret in
 * `x-aglyn-secret`; a valid call enrolls the configured workflow with the
 * payload's top-level primitives in scope. Business tier (`webhooks`
 * flag); runs bill against the workflow-runs meter like any other run.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  const hookId = String(req.query['hookId'] ?? '')
  if (!hostId || !hookId) {
    return res.status(400).json({ error: 'Invalid webhook address' })
  }
  if (rateLimited(`${hostId}/${hookId}`)) {
    return res.status(429).json({ error: 'Too many requests' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hookSnapshot = await hostRef.collection('webhooks').doc(hookId).get()
    const hook = hookSnapshot.data() as HostWebhook | undefined
    if (
      !hook ||
      hookSnapshot.get('deletedAt') ||
      hook.direction !== 'inbound' ||
      hook.enabled === false
    ) {
      return res.status(404).json({ error: 'Unknown webhook' })
    }
    const provided = String(req.headers['x-aglyn-secret'] ?? '')
    if (!secretsMatch(hook.secret ?? '', provided)) {
      return res.status(401).json({ error: 'Bad secret' })
    }

    // Plan gate (dark-launch rule preserved).
    const hostSnapshot = await hostRef.get()
    const tenantId = hostSnapshot.get('tenantId') as string | undefined
    if (tenantId) {
      const tenantSnapshot = await firestore
        .collection('tenants')
        .doc(tenantId)
        .get()
      const tenant = tenantSnapshot.exists ? tenantSnapshot.data() : undefined
      if (tenant?.['plan'] && !checkEntitlement(tenant as any, 'webhooks')) {
        return res
          .status(403)
          .json({ error: 'Webhooks are not enabled on this site' })
      }
    }

    // Top-level primitives from the JSON body join the workflow scope.
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body ?? {})
    const scope: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(body)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        scope[key.slice(0, 64)] =
          typeof value === 'string' ? value.slice(0, 2000) : value
      }
    }

    const [functionDocs, variableDocs, workflowDocs] = await Promise.all([
      hostRef.collection('functions').limit(100).get(),
      hostRef.collection('variables').limit(100).get(),
      hostRef.collection('workflows').limit(100).get(),
    ])
    const byName = <T extends { name?: string; deletedAt?: unknown }>(
      docs: FirebaseFirestore.QueryDocumentSnapshot[],
    ) => {
      const map: Record<string, T> = {}
      for (const doc of docs) {
        const data = doc.data() as T
        if (data?.name && !data.deletedAt) map[data.name] = data
      }
      return map
    }
    const workflows = byName<HostWorkflow>(workflowDocs.docs)
    const workflow = workflows[hook.workflowName?.trim() ?? '']
    if (!workflow) {
      return res.status(422).json({ error: 'No workflow bound to this hook' })
    }

    const run = runWorkflow(
      workflow,
      byName<HostFunction>(functionDocs.docs),
      byName<HostVariable>(variableDocs.docs),
      { event: `hook:${hook.name ?? hookId}`, ...scope },
      { workflows },
    )
    const failed = run.ok === false
    await hostRef
      .collection('activity')
      .add({
        actorId: null,
        actorEmail: null,
        action: failed
          ? `Inbound webhook run failed: ${run.error}`.slice(0, 300)
          : `Inbound webhook ran "${hook.workflowName}"`,
        target: { type: 'workflow', id: hookId, name: hook.name ?? '' },
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    if (failed) return res.status(422).json({ error: run.error })
    return res.status(200).json({ ok: true, value: run.value })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Webhook failed' })
  }
}
