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

import { canvas } from '@aglyn/aglyn'
// By path: the repeat rules and the source registry stay out of every
// `@aglyn/aglyn` barrel, so nothing on a published page can pull them in.
import {
  expandRepeatables,
  type RepeatableDataset,
  type RepeatScope,
  repeatedRecords,
  repeatScope,
  substituteRecordTokens,
} from '@aglyn/aglyn/app-utils/expand-repeatables'
import { repeatSourceOf } from '@aglyn/aglyn/app-utils/repeat-sources'
import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  RepeatRowsContext,
  repeatRowsKey,
} from '../contexts/repeat-rows-context'
import { RepeatRecordContext } from '../contexts/repeat-record-context'

const subscribeToNothing = () => () => undefined
const noVersion = () => 0

/** What a repeating element draws on the canvas. */
export interface RepeatPreview {
  /** What authors call the thing being repeated, for the badge. */
  label: string
  /**
   * The records this element renders, in order, bounded exactly as the
   * published page's composition bounds them.
   */
  records: ReadonlyArray<Record<string, unknown>>
  /** Which scope applies, so the canvas draws what the page will build. */
  scope: RepeatScope
  /** The repeated rows, for the token substitution's reference hops. */
  dataset?: RepeatableDataset
  /** Every key the rows answered under, for a one-hop reference (AGL-180). */
  datasetsByKey?: Readonly<Record<string, RepeatableDataset>>
}

/**
 * The rows a canvas element repeats over, and the copies it therefore draws
 * (AGL-3111).
 *
 * The designer cannot read them itself — it renders inside a plugin sandbox,
 * and which documents hold them is the source's business — so this HOLDS the
 * request and reads back whatever the host app's reader filed. Without a
 * provider, or before an answer, it returns `undefined` and the element draws
 * its template once, the way the canvas always did.
 *
 * The records are {@link repeatedRecords}, not a second reading of the same
 * props: the filter, the sort, the limit and `REPEAT_MAX_RECORDS` are applied
 * by the function the page applies them with, so a copy on the canvas is a
 * copy a visitor gets.
 */
export function useRepeatPreview(node: unknown): RepeatPreview | undefined {
  const source = useContext(RepeatRowsContext)
  const props = (node as { props?: Record<string, unknown> })?.props
  // MobX props are observable and change in place; their JSON keys the memos
  // below, the way every other render copy in the canvas is keyed.
  const propsJson = JSON.stringify(props ?? null)
  const request = useMemo(() => {
    const repeat = source ? repeatSourceOf({ props }) : undefined
    return repeat
      ? { sourceId: repeat.source.id, key: repeat.key, label: repeat.source.label }
      : undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, props, propsJson])

  const key = request ? repeatRowsKey(request) : ''
  useEffect(() => {
    if (!source || !request) return undefined
    return source.retain(request)
    // `key` stands in for `request`: the same source and key keeps the read
    // it already holds rather than dropping and re-taking it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key])

  const version = useSyncExternalStore(
    source && request ? source.subscribe : subscribeToNothing,
    source ? source.getVersion : noVersion,
    noVersion,
  )

  return useMemo(() => {
    if (!source || !request) return undefined
    const answer = source.get(key)
    if (answer?.status !== 'ready') return undefined
    const dataset = answer.rowsByKey[request.key]
    const records = repeatedRecords({ props }, dataset)
    if (!records.length) return undefined
    return {
      label: answer.label,
      records,
      scope: repeatScope(node),
      dataset,
      datasetsByKey: answer.rowsByKey,
    }
    // `version` carries a new answer in; the body reads it through `get`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, request, key, version, node, props, propsJson])
}

/**
 * The stored subtree under `rootId`, as a plain snapshot.
 *
 * Canvas nodes are MobX observables the expansion must not read through — it
 * copies props by reference into the copies it builds, and an observable read
 * outside a reaction is both a stale value and a missing dependency.
 */
function subtreeSnapshot(rootId: string): Record<string, any> {
  const nodes = (canvas.toJSON().nodes ?? {}) as Record<string, any>
  const snapshot: Record<string, any> = {}
  const walk = (id: string) => {
    const node = nodes[id]
    if (!node || snapshot[id]) return
    snapshot[id] = JSON.parse(JSON.stringify(node))
    for (const childId of (node.nodes ?? []) as string[]) walk(childId)
  }
  walk(rootId)
  return snapshot
}

/**
 * The copies a repeating element draws BESIDE the one an author edits
 * (AGL-3111): records 2..n, as denormalized trees ready for an inert render.
 *
 * The first record is deliberately missing. It is drawn by the element's own
 * children — the real canvas nodes, selectable and draggable, with that
 * record's values laid over their render copies through
 * {@link RepeatRecordContext}. That is what makes editing the template edit
 * every copy: there is one template, it is on the canvas, and the copies are
 * pictures of it.
 *
 * Built by running the published page's own {@link expandRepeatables} over a
 * snapshot of this subtree, so the canvas cannot draw a shape the page would
 * not compose.
 */
export function useRepeatCopies(
  node: { $id?: string; parentId?: string } | null | undefined,
  preview: RepeatPreview | undefined,
): any[] {
  const $id = node?.$id
  const recordCount = preview?.records.length ?? 0
  const key = preview
    ? `${$id}\n${preview.scope}\n${JSON.stringify(preview.records)}`
    : ''
  return useMemo(() => {
    if (!$id || !preview || recordCount < 2) return []
    const snapshot = subtreeSnapshot($id)
    if (!snapshot[$id]) return []
    // A parent the copies can take their place in. The real parent is not in
    // this snapshot — only the subtree is — so a self-scoped repeat is given
    // a holder that lists it, which is all the expansion reads a parent for.
    const holderId = `${$id}__repeat-preview-parent`
    snapshot[$id] = { ...snapshot[$id], parentId: holderId }
    snapshot[holderId] = { $id: holderId, nodes: [$id] }
    const expanded = expandRepeatables(snapshot as never, {
      // Under the key the node stores, which is the key the expansion looks
      // the rows up by.
      ...(preview.datasetsByKey ?? {}),
    } as never) as Record<string, any>
    const copyIds =
      preview.scope === 'self'
        ? (expanded[holderId]?.nodes ?? []).slice(1)
        : (expanded[$id]?.nodes ?? []).slice(
            // One template's worth of children per record: the first
            // record's copies are the ones the real children already draw.
            (expanded[$id]?.nodes ?? []).length / recordCount,
          )
    return copyIds
      .map((id: string) => denormalize(expanded, id))
      .filter(Boolean)
    // `key` stands in for the records and the node; both are snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [$id, key, recordCount])
}

/** Nested-object form of an expanded map, which is what `Stem` walks. */
function denormalize(
  nodes: Record<string, any>,
  rootId: string,
  seen: Set<string> = new Set(),
): any {
  const node = nodes?.[rootId]
  if (!node || seen.has(rootId)) return undefined
  seen.add(rootId)
  return {
    ...node,
    children: ((node.nodes ?? []) as string[])
      .map((childId) => denormalize(nodes, childId, seen))
      .filter(Boolean),
  }
}

/**
 * A node's render copy with the record its subtree is drawing laid over it
 * (AGL-3111).
 *
 * Inside a repeating element the FIRST record's values belong on the real
 * canvas nodes, so the element an author edits reads as the first copy rather
 * than as a row of raw `{{item.*}}` tokens beside the copies that resolved
 * them. Render copies only — the node keeps its tokens, and every save writes
 * the template.
 */
export function useNodeWithRepeatRecord<N>(node: N): N {
  const context = useContext(RepeatRecordContext)
  const rendered = node as { props?: Record<string, unknown> } | null | undefined
  const propsJson = context ? JSON.stringify(rendered?.props ?? null) : ''
  return useMemo(() => {
    if (!context || !rendered?.props) return node
    const props = substituteRecordTokens({ ...rendered.props }, context)
    return { ...rendered, props } as N
    // Observable props: the JSON string keys the copy, as everywhere else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, rendered, context, propsJson])
}

export default useRepeatPreview
