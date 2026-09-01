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

import type * as Aglyn from '@aglyn/aglyn'
// Deep path, keeping the type-only barrel import above erased.
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import useFirestoreCollection from './use-firestore-collection'

/** Matches the tenant render read, so the canvas cannot see more than a page. */
const FORMS_PER_CANVAS = 200

/** A form document as the query hands it back, with its id stamped on. */
type FormDocumentWithId = Aglyn.FormDocument & { $id: string }

export interface UseHostFormDesignsResult {
  /** Raw form docs, `$id` included, unpublished ones and all. */
  docs: FormDocumentWithId[]
  /**
   * The published design of each form, keyed by id, or `undefined` until the
   * first snapshot settles — "loading" and "this host has none" must not look
   * the same, or the canvas paints the page's own fields and swaps them for
   * the entity's a beat later.
   */
  designs: Record<string, Aglyn.PlacedFormDesign> | undefined
}

/**
 * Client-side twin of `libs/tenant/runtime/src/lib/get-forms.ts`: the host's
 * form entities read through ONE query, so a placed form draws its entity's
 * fields on the canvas exactly as the published page will
 * (`docs/specs/reusable-forms.md`).
 *
 * A sibling of `use-host-component-definitions.ts` in every respect that
 * matters, because the two answer the same question about different documents.
 * That includes the live `onSnapshot`, which is load-bearing rather than
 * incidental: it is the whole transport for propagating a form publish into
 * already-open screen besigners. A one-shot read would "save reads" and
 * silently leave every open canvas drawing a stale form until reloaded.
 *
 * Note the boundary, the same one the components hook draws: this watches the
 * form's PARENT doc, which only Publish writes. The form besigner's Save
 * writes the version doc and is invisible here — a screen must not show fields
 * the live site has never had.
 *
 * A doc with no `rootId`/`nodes`, or whose root is missing from its own nodes,
 * is unpublished rather than broken; skipping it is what keeps the canvas
 * agreeing with the live site about which placements resolve. Fail-open like
 * the server loader: an error yields an empty map, leaving each placement
 * rendering its own fields rather than blanking it.
 */
export function useHostFormDesigns(
  hostId: string | undefined,
): UseHostFormDesignsResult {
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<FormDocumentWithId>(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'forms'),
            limit(FORMS_PER_CANVAS),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )

  const designs = useMemo(() => {
    if (status === 'loading') return undefined
    const next: Record<string, Aglyn.PlacedFormDesign> = {}
    for (const value of data ?? []) {
      if (!value?.nodes || !value?.rootId) continue
      // BOTH stored forms (AGL-1151). This is a raw collection query, so
      // `nodes` arrives exactly as stored — msgpack for anything published
      // since compression landed, a plain map for anything older. A `Bytes`
      // reaching the graft has no `rootId` entry, so every placed form on the
      // canvas would draw empty while the live site still renders it.
      const nodes = decodeStoredNodes<
        NonNullable<Aglyn.FormDocument['nodes']>
      >(value.nodes)
      if (!nodes?.[value.rootId]) continue
      next[value.$id] = { rootId: value.rootId, nodes }
    }
    return next
  }, [data, status])

  return { docs: data ?? [], designs }
}

export default useHostFormDesigns
