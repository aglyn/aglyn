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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import {
  CRM_COLLECTIONS,
  crmScopeTokens,
  DEFAULT_DEAL_STAGES,
} from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  collection,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PIPELINE_ID,
  DEFAULT_PIPELINE_NAME,
  type PipelineDoc,
} from '../model/deal-board-model'

/** The most pipelines one org is read with. */
export const PIPELINE_READ_LIMIT = 20

export interface UsePipelineOptions {
  /** The site whose console is reading — provenance on the seeded pipeline. */
  hostId: string
  /** The org document the shell passed, for the scope the seed is stamped with. */
  org: Record<string, unknown> | null | undefined
}

export interface UsePipelineResult {
  /** Every pipeline the viewer may read, in document-id order. */
  pipelines: PipelineDoc[]
  /** The default pipeline — `isDefault`, else the first — or null before one exists. */
  pipeline: PipelineDoc | null
  status: 'loading' | 'success' | 'error'
  fromCache: boolean
  /** A seed write is in flight because the org had no pipeline. */
  seeding: boolean
  /** The scope tokens this viewer reads with — what a new deal is filtered by. */
  visibleToTokens: string[]
  pipelineById: (id: string | undefined) => PipelineDoc | null
}

/**
 * The org's pipelines, and the default one seeded the first time nobody has
 * made any (AGL-2598).
 *
 * ## Bounded, scoped, ordered
 *
 * `orgs/{orgId}/pipelines` is read with the same `visibleTo` predicate every
 * CRM listener uses, ordered by document id and capped at twenty. A pipeline
 * is a handful of documents per org — the cap is there so the query has one,
 * not because anybody is expected to reach it.
 *
 * ## The seed
 *
 * A merchant opening Deals for the first time should see a board, not a
 * setup step. When the SERVER has confirmed the org has no pipeline at all,
 * the hook writes one — `Sales`, with the default stages, `isDefault` — under
 * a fixed document id inside a transaction that first re-reads it. The
 * transaction is what makes two tabs opening the section together produce
 * one pipeline rather than two: whichever commits second sees the document
 * and writes nothing.
 *
 * A cached empty answer does not seed. The listener reports `fromCache`
 * while the local cache is serving it, and an empty cache is what a first
 * load looks like in every org that already has a pipeline — seeding on it
 * would race the real answer and, on an offline tab, write a second default
 * once the tab reconnected.
 *
 * The seed carries what every CRM creator stamps: the scope a contact
 * captured on this site would carry, the site as provenance, and the
 * creating account.
 */
export function usePipeline(
  orgId: string | null | undefined,
  options: UsePipelineOptions,
): UsePipelineResult {
  const { hostId, org } = options
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid

  const consentGroup = useMemo(
    () => (hostId ? Aglyn.consentGroupForHost(org ?? null, hostId) : null),
    [org, hostId],
  )
  const visibleToTokens = useMemo(
    () =>
      consentGroup
        ? [
            Aglyn.ORG_SCOPE_TOKEN,
            ...consentGroup.hostIds.map((id) => Aglyn.hostScopeToken(id)),
          ].slice(0, Aglyn.MAX_SCOPE_HOSTS)
        : [],
    [consentGroup],
  )

  const { data, status, fromCache } = useFirestoreCollection<PipelineDoc>(
    () =>
      orgId && visibleToTokens.length
        ? query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.pipelines),
            where('visibleTo', 'array-contains-any', visibleToTokens),
            orderBy(documentId()),
            limit(PIPELINE_READ_LIMIT),
          )
        : null,
    [firestore, orgId, visibleToTokens],
    { idField: '$id' },
  )

  const [seeding, setSeeding] = useState(false)
  // One seed attempt per org per mount, whatever the listener does after.
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!orgId || !uid || !consentGroup) return
    if (status !== 'success' || fromCache || data.length > 0) return
    if (seededFor.current === orgId) return
    seededFor.current = orgId
    let active = true
    setSeeding(true)
    const ref = doc(
      firestore,
      'orgs',
      orgId,
      CRM_COLLECTIONS.pipelines,
      DEFAULT_PIPELINE_ID,
    )
    void runTransaction(firestore, async (transaction) => {
      const existing = await transaction.get(ref)
      if (existing.exists()) return
      transaction.set(ref, {
        name: DEFAULT_PIPELINE_NAME,
        stages: [...DEFAULT_DEAL_STAGES],
        isDefault: true,
        visibleTo: crmScopeTokens(org, consentGroup),
        hostId,
        createdByUid: uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })
      .catch((error) => {
        console.error(error)
      })
      .finally(() => {
        if (active) setSeeding(false)
      })
    return () => {
      active = false
    }
  }, [firestore, orgId, uid, consentGroup, org, hostId, status, fromCache, data])

  return useMemo(() => {
    const pipelines = data ?? []
    const pipeline =
      pipelines.find((entry) => entry.isDefault) ?? pipelines[0] ?? null
    return {
      pipelines,
      pipeline,
      status,
      fromCache,
      seeding,
      visibleToTokens,
      pipelineById: (id) =>
        id ? (pipelines.find((entry) => entry.$id === id) ?? null) : null,
    }
  }, [data, status, fromCache, seeding, visibleToTokens])
}

export default usePipeline
