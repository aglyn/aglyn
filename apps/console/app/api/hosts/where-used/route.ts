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
  decodeStoredNodes,
  nodesReferenceBinding,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import {
  scanComponentUsage,
  scanLayoutUsage,
  scanScreenUsage,
  type CollectionCandidate,
  type UsageCandidate,
} from '../../../../utils/server/scan-artifact-usage'
import { readUsageCandidates } from '../../../../utils/server/read-usage-candidates'

export interface WhereUsedDependent {
  /** Resource collection the dependent lives in. */
  type: 'screen' | 'layout' | 'workflow' | 'variable' | 'component' | 'collection'
  id: string
  name: string
  /** 'id' = rename-safe reference; 'name' = legacy token, breaks on rename. */
  via: BindingRefVia[]
  /** Published version scanned (screens/layouts) — deep-link target. */
  versionId?: string
  /** Screens only: link, child, or collection-template binding (AGL-703). */
  relation?: 'link' | 'child' | 'template'
}

/** Every `kind` this endpoint knows how to scan for. */
const SCANNABLE_KINDS = [
  'variable',
  'function',
  'workflow',
  'component',
  'layout',
  'screen',
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

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes; distinct
    // 423 body — API consumers see it on reads too. The org doc is fetched
    // deliberately — an org lock never stamps host docs, so a host-only
    // verdict would silently miss it. Staff bypass is the un-panic
    // invariant.
    const locked = await lockdownRefusal({
      request,
      // POST-shaped READ (AGL-1511): this is a dependency query with a body,
      // not a mutation, so a read-only lock must not refuse it — the method
      // would say otherwise.
      intent: 'read',
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

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
          // Version nodes are msgpack bytes for anything saved through the
          // client converter — the majority (AGL-1223). Reading them raw
          // hands `nodesReferenceBinding` a Buffer, which it walks without
          // matching anything and reports as "used nowhere".
          const nodes = decodeStoredNodes(version?.get('nodes'))
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

    /**
     * Did every scan read its whole collection?
     *
     * `false` means the answer is a LOWER BOUND: everything listed is real,
     * but "nothing listed" proves nothing. Callers must not present an empty
     * result as "unused" while this is false — `artifact-usage-copy.ts` is
     * where that rule lives for the console.
     */
    let truncated = false

    if (kind === 'component' || kind === 'layout' || kind === 'screen') {
      /**
       * Documents plus, for screens/layouts, their published nodes.
       *
       * Shared with the publish-time cache drop (AGL-1161) so there is one
       * reader and one node-decode. Advisory here, so the 200 cap stands and
       * a truncated answer is acceptable — this endpoint answers "what would
       * I break", not "which caches must be dropped".
       */
      const readCandidates = async (
        collectionName: 'screens' | 'layouts' | 'components',
        withNodes: boolean,
      ): Promise<UsageCandidate[]> => {
        const read = await readUsageCandidates(hostRef, collectionName, {
          withNodes,
          limit: 200,
        })
        /*
          The cap is REPORTED, not swallowed (AGL-703).

          `readUsageCandidates` fetches one document over the limit precisely
          so it can say whether there were more, and this function threw that
          away — so a site with 201 screens got an answer indistinguishable
          from a complete one, and the delete confirmation built on it would
          say "nothing uses this" on the strength of a scan that stopped
          reading. That is the same defect `media-usage-copy` exists to
          prevent one collection over.
        */
        if (read.truncated) truncated = true
        return read.candidates
      }

      /**
       * A collection's template pointers (AGL-703) — the one screen dependent
       * that takes a live route DOWN rather than degrading it.
       *
       * Same limit+1 idiom as `readUsageCandidates`, and it feeds the same
       * `truncated` flag: a host with more collections than one pass reads
       * must not answer "nothing binds this screen" on the strength of a
       * prefix.
       */
      const readCollections = async (): Promise<CollectionCandidate[]> => {
        const docs = await hostRef.collection('collections').limit(201).get()
        if (docs.size > 200) truncated = true
        return docs.docs.slice(0, 200).map((docSnapshot) => ({
          id: docSnapshot.id,
          displayName: docSnapshot.get('displayName'),
          slug: docSnapshot.get('slug'),
          deletedAt: docSnapshot.get('deletedAt'),
          listScreenId: docSnapshot.get('listScreenId'),
          entryScreenId: docSnapshot.get('entryScreenId'),
          templateScreenId: docSnapshot.get('templateScreenId'),
        }))
      }

      if (kind === 'screen') {
        // Every corpus a screen id can hide in: link props on published
        // screens and layouts, on component definitions, and the collection
        // pointers that are not node data at all.
        const [screens, layouts, components, collections] = await Promise.all([
          readCandidates('screens', true),
          readCandidates('layouts', true),
          readCandidates('components', true),
          readCollections(),
        ])
        dependents.push(
          ...scanScreenUsage(refId, {
            screens,
            layouts,
            components,
            collections,
          }),
        )
      } else if (kind === 'layout') {
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
      /**
       * Whether the scan read everything it needed to.
       *
       * The field a caller must consult before saying "nothing uses this".
       * Absent on an older deployment, and every reader treats absent as
       * INCOMPLETE for the reason `coverageOf` documents: the alternative is a
       * delete confirmation promising safety on the strength of a field that
       * was not there.
       */
      complete: !truncated,
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
