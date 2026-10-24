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
import type { RepeatableDataset } from '@aglyn/aglyn/app-utils/expand-repeatables'
// By path: which sources exist is editor business, kept out of every barrel.
import { repeatSourceOf } from '@aglyn/aglyn/app-utils/repeat-sources'
import {
  RepeatRowsContext,
  type RepeatRowsRequest,
  repeatRowsKey,
} from '../contexts/repeat-rows-context'
import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react'

const subscribeToNothing = () => () => undefined
const noVersion = () => 0

/** Every repeat the tree asks for rows, once each. */
export function previewRepeatRequests(
  nodes: Record<string, unknown> | null | undefined,
): RepeatRowsRequest[] {
  const requests = new Map<string, RepeatRowsRequest>()
  for (const node of Object.values(nodes ?? {})) {
    const repeat = repeatSourceOf(node)
    if (!repeat) continue
    const request = { sourceId: repeat.source.id, key: repeat.key }
    requests.set(repeatRowsKey(request), request)
  }
  return [...requests.values()]
}

/**
 * The tree Preview draws, with its repeating elements expanded the way the
 * published page expands them.
 *
 * Preview used to draw the composed tree as stored, so a repeat showed its
 * template once with `{{item.name}}` printed in it, where the live page drew
 * a copy per record and the besigner drew the same copies on its canvas. The
 * rows come through the reader the besigner reads them with
 * (`BesignerRepeatRowsProvider`), and the expansion is the published page's
 * own, so the copies are the ones a visitor gets. A repeat whose rows answer
 * nothing — a filter that matches none, a dataset that is gone — draws no
 * copy, as it does live (AGL-3496).
 *
 * `undefined` while any repeat's rows are still being read, so Preview keeps
 * its spinner rather than flashing the raw template first. A tree with no
 * repeats, or one with no reader to ask, comes back as it went in.
 */
export function usePreviewRepeats(
  nodes: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  const store = useContext(RepeatRowsContext)
  const requests = useMemo(() => previewRepeatRequests(nodes), [nodes])
  const keys = requests.map(repeatRowsKey).join('\n')

  useEffect(() => {
    if (!store) return undefined
    const releases = requests.map((request) => store.retain(request))
    return () => releases.forEach((release) => release())
    // `keys` stands in for `requests`: the same reads are kept, not re-taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, keys])

  const version = useSyncExternalStore(
    store && requests.length ? store.subscribe : subscribeToNothing,
    store ? store.getVersion : noVersion,
    noVersion,
  )

  return useMemo(() => {
    if (!nodes || !store || !requests.length) return nodes
    const rows: Record<string, RepeatableDataset> = {}
    for (const request of requests) {
      const answer = store.get(repeatRowsKey(request))
      if (!answer || answer.status === 'loading') return undefined
      if (answer.status === 'ready') Object.assign(rows, answer.rowsByKey)
    }
    return Aglyn.expandRepeatables(nodes as any, rows) as Record<
      string,
      unknown
    >
    // `version` carries each new answer in; the body reads it through `get`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, store, requests, version])
}

export default usePreviewRepeats
