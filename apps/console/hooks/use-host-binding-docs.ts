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

import type { CanvasBindingLookups } from '@aglyn/besigner-ui'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import useFirestoreCollection from './use-firestore-collection'

/**
 * A site's variable and function documents, as the Besigner reads them for
 * bindings: the insert picker, the canvas's live values and the save that
 * converts typed names (AGL-3481).
 *
 * One pair of queries for all three, so they cannot disagree about which
 * variables exist — and the Firestore SDK shares one listener per identical
 * query, so an editor that reads them here and through the picker pays for
 * one listen, not two.
 */
export function useHostBindingDocs(hostId: string) {
  const firestore = useFirestore()
  const variables = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const functions = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'functions'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  return {
    variableDocs: variables.data,
    functionDocs: functions.data,
    loaded: variables.status === 'success' && functions.status === 'success',
  }
}

/**
 * The site's variables and functions keyed by id AND by name, deleted and
 * unnamed ones left out.
 *
 * Id keys serve `resolveBindings`, which reads nothing else (AGL-97, AGL-194).
 * Name keys serve typed-name normalization, which looks a typed `{{name}}` up
 * by its name (`normalizeBindingTokens`). Names first so an id key wins a
 * collision — the id is the reference that survives a rename.
 */
export function bindingLookupsFromDocs(
  variableDocs: readonly any[] | undefined,
  functionDocs: readonly any[] | undefined,
): { variables: Record<string, any>; functions: Record<string, any> } {
  const live = (docs: readonly any[] | undefined) =>
    (docs ?? []).filter((one) => !one?.deletedAt && one?.name)
  const keyed = (docs: readonly any[] | undefined) => {
    const map: Record<string, any> = {}
    for (const one of live(docs)) map[one.name] = one
    for (const one of live(docs)) map[one.$id] = one
    return map
  }
  return { variables: keyed(variableDocs), functions: keyed(functionDocs) }
}

/**
 * The lookups every Besigner save converts typed names against
 * (`useBesignerDocument`'s `bindingLookups`, AGL-3481), or `null` until both
 * lists have loaded — a save before then keeps its tokens as typed rather
 * than reading an empty list as "this site has no variables".
 */
export function useBindingTokenLookups(
  hostId: string,
): CanvasBindingLookups | null {
  const { variableDocs, functionDocs, loaded } = useHostBindingDocs(hostId)
  return useMemo(
    () => (loaded ? bindingLookupsFromDocs(variableDocs, functionDocs) : null),
    [loaded, variableDocs, functionDocs],
  )
}

export default useBindingTokenLookups
