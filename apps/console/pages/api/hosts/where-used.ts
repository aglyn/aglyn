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
  type BindingRefVia,
  nodesReferenceBinding,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

export interface WhereUsedDependent {
  /** Resource collection the dependent lives in. */
  type: 'screen' | 'layout' | 'workflow' | 'variable'
  id: string
  name: string
  /** 'id' = rename-safe reference; 'name' = legacy token, breaks on rename. */
  via: BindingRefVia[]
  /** Published version scanned (screens/layouts) — deep-link target. */
  versionId?: string
}

/**
 * Where-used scan (AGL-187): finds host content referencing a variable,
 * function, or workflow. Screens/layouts are scanned on their PUBLISHED
 * version's nodes (matching what visitors see); workflow steps are
 * checked for function calls and variables for workflow backings. The
 * `via` field distinguishes rename-safe id references from legacy name
 * tokens — renames only endanger the latter. Auth: Firebase ID token,
 * host admin.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const kind = String(req.body?.kind ?? '') as
    | 'variable'
    | 'function'
    | 'workflow'
  const refId = String(req.body?.id ?? '')
  const refName = String(req.body?.name ?? '')
  if (
    !hostId ||
    !refId ||
    !['variable', 'function', 'workflow'].includes(kind)
  ) {
    return res.status(400).json({ error: 'Missing hostId, id, or kind' })
  }

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!memberRole) {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    const dependents: WhereUsedDependent[] = []

    if (kind === 'variable' || kind === 'function') {
      const ref = { kind, id: refId, name: refName || undefined }
      // Published-version nodes of screens and layouts.
      for (const collectionName of ['screens', 'layouts'] as const) {
        const docs = await hostRef.collection(collectionName).limit(200).get()
        for (const docSnapshot of docs.docs) {
          if (docSnapshot.get('deletedAt')) continue
          const versionId = docSnapshot.get('versionId')
          if (!versionId) continue
          const version = await docSnapshot.ref
            .collection('versions')
            .doc(String(versionId))
            .get()
            .catch(() => null)
          const nodes = version?.get('nodes')
          if (!nodes) continue
          const via = nodesReferenceBinding(nodes, ref)
          if (via.length) {
            dependents.push({
              type: collectionName === 'screens' ? 'screen' : 'layout',
              id: docSnapshot.id,
              name: String(docSnapshot.get('name') ?? docSnapshot.id),
              via,
              versionId: String(versionId),
            })
          }
        }
      }
    }

    if (kind === 'function') {
      // Workflow steps call functions by name (AGL-129).
      const workflows = await hostRef.collection('workflows').limit(100).get()
      for (const docSnapshot of workflows.docs) {
        if (docSnapshot.get('deletedAt')) continue
        const steps = (docSnapshot.get('steps') ?? []) as Array<{
          functionName?: string
        }>
        if (
          refName &&
          steps.some((step) => String(step?.functionName ?? '') === refName)
        ) {
          dependents.push({
            type: 'workflow',
            id: docSnapshot.id,
            name: String(docSnapshot.get('name') ?? docSnapshot.id),
            via: ['name'],
          })
        }
      }
    }

    if (kind === 'workflow') {
      // Computed variables back onto workflows by name (AGL-129).
      const variables = await hostRef.collection('variables').limit(100).get()
      for (const docSnapshot of variables.docs) {
        if (docSnapshot.get('deletedAt')) continue
        if (
          refName &&
          String(docSnapshot.get('workflowName') ?? '') === refName
        ) {
          dependents.push({
            type: 'variable',
            id: docSnapshot.id,
            name: String(docSnapshot.get('name') ?? docSnapshot.id),
            via: ['name'],
          })
        }
      }
    }

    return res.status(200).json({
      dependents,
      total: dependents.length,
      // Any dependent still holding a legacy name token: a rename breaks it.
      legacyCount: dependents.filter((item) => item.via.includes('name'))
        .length,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Scan failed' })
  }
}
