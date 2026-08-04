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
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import useFirestoreCollection from './use-firestore-collection'

export interface UseHostComponentDefinitionsResult {
  /** Raw definition docs, `$id` included, tombstones and all. */
  docs: Aglyn.AglynHostComponent[]
  /**
   * Live definitions keyed by id in the shape
   * `composeReusableComponentNodes` consumes, or `undefined` until the
   * first snapshot settles — see the callers for why "loading" and "this
   * host has none" must not look the same.
   */
  definitions: Record<string, Aglyn.ReusableComponentTree> | undefined
}

/**
 * Client-side twin of `libs/tenant/runtime/src/lib/get-components.ts`: the
 * host's reusable-component definitions, read once and shared by everything
 * in the editor that needs them (AGL-1217).
 *
 * One hook rather than a read per consumer so the console asks the same
 * question the same way — identical `Query`, so the SDK serves every caller
 * from a single listener — and so the skip rules stay in one place. A doc
 * missing `rootId`/`nodes` is unpublished, not broken; skipping it here is
 * what keeps the canvas agreeing with the live site about which instances
 * expand. Fail-open like the server loader: an error yields an empty map,
 * leaving instances as-is rather than blanking the document.
 */
export function useHostComponentDefinitions(
  hostId: string | undefined,
): UseHostComponentDefinitionsResult {
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<Aglyn.AglynHostComponent>(
    () =>
      hostId
        ? query(collection(firestore, 'hosts', hostId, 'components'), limit(200))
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )

  const definitions = useMemo(() => {
    if (status === 'loading') return undefined
    const next: Record<string, Aglyn.ReusableComponentTree> = {}
    for (const value of data ?? []) {
      if (value?.deletedAt || !value?.nodes || !value?.rootId) continue
      next[value.$id] = {
        rootId: value.rootId,
        nodes: value.nodes as Aglyn.ReusableComponentTree['nodes'],
        // Declared props ride along (AGL-1247) so the editor's graft
        // substitutes the same values the live site will.
        ...(value.props?.length && { props: value.props }),
      }
    }
    return next
  }, [data, status])

  return { docs: data ?? [], definitions }
}

export default useHostComponentDefinitions
