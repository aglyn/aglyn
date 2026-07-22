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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  type BindingRefVia,
  nodesReferenceBinding,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  scanComponentUsage,
  scanLayoutUsage,
  type UsageCandidate,
} from '../../../../utils/server/scan-artifact-usage'

export interface WhereUsedDependent {
  /** Resource collection the dependent lives in. */
  type: 'screen' | 'layout' | 'workflow' | 'variable' | 'component'
  id: string
  name: string
  /** 'id' = rename-safe reference; 'name' = legacy token, breaks on rename. */
  via: BindingRefVia[]
  /** Published version scanned (screens/layouts) — deep-link target. */
  versionId?: string
}

/** Every `kind` this endpoint knows how to scan for. */
const SCANNABLE_KINDS = [
  'variable',
  'function',
  'workflow',
  'component',
  'layout',
] as const

/**
 * Where-used scan (AGL-187, extended for components and layouts by
 * AGL-703): finds host content referencing a variable, function, workflow,
 * reusable component, or layout.
 *
 * Screens/layouts are scanned on their PUBLISHED version's nodes (matching
 * what visitors see); workflow steps are checked for function calls and
 * variables for workflow backings. The `via` field distinguishes rename-safe
 * id references from legacy name tokens — renames only endanger the latter.
 * Auth: Firebase ID token, host admin.
 *
 * The two AGL-703 kinds follow the runtime's own reference model:
 *
 * - A COMPONENT is referenced by an instance node (`reusableInstance` with
 *   `props.refId`). Those live in screens, in layouts, AND in other
 *   component definitions — `composeReusableComponentNodes` expands nested
 *   instances — so all three are scanned. Skipping definitions would report
 *   "used nowhere" for a component used only inside another one.
 * - A LAYOUT is referenced by a `layoutId` pointer — on screens bound to it,
 *   and on layouts NESTED inside it, which AGL-703 made possible. Both are
 *   scanned: a nested layout is a real dependent, because deleting the outer
 *   layout unwraps every screen underneath the inner one too.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  const kind = String(body?.kind ?? '') as (typeof SCANNABLE_KINDS)[number]
  const refId = String(body?.id ?? '')
  const refName = String(body?.name ?? '')
  if (
    !hostId ||
    !refId ||
    !(SCANNABLE_KINDS as readonly string[]).includes(kind)
  ) {
    return Response.json({ error: 'Missing hostId, id, or kind' }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!memberRole) {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
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
              // `displayName` first: screens and layouts have never stored a
              // `name`, so reading only that showed every dependent as a raw
              // document id — the one thing a "where is this used" list must
              // not do. Workflows and variables below genuinely use `name`.
              name: String(
                docSnapshot.get('displayName') ??
                  docSnapshot.get('name') ??
                  docSnapshot.id,
              ),
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

    if (kind === 'component' || kind === 'layout') {
      /** Documents plus, for screens/layouts, their published nodes. */
      const readCandidates = async (
        collectionName: 'screens' | 'layouts' | 'components',
        withNodes: boolean,
      ): Promise<UsageCandidate[]> => {
        const docs = await hostRef.collection(collectionName).limit(200).get()
        return Promise.all(
          docs.docs.map(async (docSnapshot) => {
            const versionId = docSnapshot.get('versionId')
            // Components keep their tree on the document; screens and
            // layouts keep it on the published version.
            const nodes =
              collectionName === 'components'
                ? docSnapshot.get('nodes')
                : withNodes && versionId
                  ? await docSnapshot.ref
                      .collection('versions')
                      .doc(String(versionId))
                      .get()
                      .then((version) => version.get('nodes'))
                      .catch(() => null)
                  : null
            return {
              id: docSnapshot.id,
              displayName: docSnapshot.get('displayName'),
              name: docSnapshot.get('name'),
              deletedAt: docSnapshot.get('deletedAt'),
              nodes,
              ...(versionId ? { versionId: String(versionId) } : {}),
              ...(docSnapshot.get('layoutId')
                ? { layoutId: String(docSnapshot.get('layoutId')) }
                : {}),
            }
          }),
        )
      }

      if (kind === 'layout') {
        // No node search needed: the reference is a `layoutId` field, on
        // screens and — since AGL-703 — on nested layouts too.
        const [screens, layouts] = await Promise.all([
          readCandidates('screens', false),
          readCandidates('layouts', false),
        ])
        dependents.push(...scanLayoutUsage(refId, screens, layouts))
      } else {
        const [screens, layouts, components] = await Promise.all([
          readCandidates('screens', true),
          readCandidates('layouts', true),
          readCandidates('components', true),
        ])
        dependents.push(
          ...scanComponentUsage(refId, { screens, layouts, components }),
        )
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

    return Response.json({
      dependents,
      total: dependents.length,
      // Any dependent still holding a legacy name token: a rename breaks it.
      legacyCount: dependents.filter((item) => item.via.includes('name'))
        .length,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Scan failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
