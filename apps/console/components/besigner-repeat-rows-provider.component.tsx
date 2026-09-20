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

// By path: which sources exist is editor business, kept out of every barrel.
import { getRepeatSource } from '@aglyn/aglyn/app-utils/repeat-sources'
// Deep, not the designer barrel, so a surface that renders no besigner can
// mount this without loading one.
import {
  createRepeatRowsStore,
  RepeatRowsContext,
  type RepeatRowsRequest,
  repeatRowsKey,
  type RepeatRowsStore,
} from '@aglyn/besigner-ui/contexts/repeat-rows-context'
import { useEffect, useMemo, useSyncExternalStore } from 'react'

export interface BesignerRepeatRowsProviderProps {
  /** The site whose pages the canvas edits. */
  hostId: string
  children?: JSX.Children
}

/**
 * Answers the canvas's repeating elements with the rows they repeat over
 * (AGL-3111).
 *
 * The designer does not read Firestore — it renders inside a plugin sandbox,
 * and WHICH documents hold a repeat's rows is not the platform's business at
 * all. So a repeating element holds its source and key, and this renders one
 * reader per held request, which asks the registered source for the rows and
 * files the answer where the canvas looks for it.
 *
 * The reads are the source's own, which is what makes the copies on the
 * canvas the copies on the page: the data plugin reads the same documents,
 * under the same bounds and the same ordering rule, that the published page's
 * composition reads with the Admin SDK.
 *
 * Nothing here names a kind of data. A site whose org has no source-owning
 * plugin loaded holds nothing, reads nothing and renders every repeat's
 * template once, exactly as the canvas always did.
 */
export function BesignerRepeatRowsProvider(
  props: BesignerRepeatRowsProviderProps,
) {
  const { hostId, children } = props
  const store = useMemo(() => createRepeatRowsStore(), [])
  const requests = useSyncExternalStore(
    store.subscribeRetained,
    store.getRetained,
    store.getRetained,
  )
  return (
    <RepeatRowsContext.Provider value={store}>
      {children}
      {requests.map((request) => (
        // Keyed by the SOURCE too, so a source that registers while the
        // canvas is open remounts its reader rather than changing which
        // hooks the mounted one calls.
        <RepeatRowsReader
          key={`${request.sourceId}\n${request.key}`}
          request={request}
          hostId={hostId}
          store={store}
        />
      ))}
    </RepeatRowsContext.Provider>
  )
}
BesignerRepeatRowsProvider.displayName = 'BesignerRepeatRowsProvider'

/** One request's rows, read by its source and filed under its key. */
function RepeatRowsReader(props: {
  request: RepeatRowsRequest
  hostId: string
  store: RepeatRowsStore
}) {
  const { request, hostId, store } = props
  const source = getRepeatSource(request.sourceId)
  // A request whose source is not registered — its plugin still loading, or
  // disabled since the node was authored — has nobody to answer it. Rendering
  // a reader that calls no hook would change this component's hook count if
  // the source arrived, which is why the key above carries the source id.
  if (!source) return null
  return <SourceRows source={source} request={request} hostId={hostId} store={store} />
}

/** Calls the source's reader hook unconditionally. Renders nothing. */
function SourceRows(props: {
  source: NonNullable<ReturnType<typeof getRepeatSource>>
  request: RepeatRowsRequest
  hostId: string
  store: RepeatRowsStore
}) {
  const { source, request, hostId, store } = props
  const answer = source.useRows({ hostId, key: request.key })
  const key = repeatRowsKey(request)
  useEffect(() => {
    store.set(key, answer)
  }, [store, key, answer])
  // Withdrawn with the reader, so a request nothing holds any more stops
  // answering instead of answering from a read that has ended.
  useEffect(() => () => store.set(key, undefined), [store, key])
  return null
}

export default BesignerRepeatRowsProvider
