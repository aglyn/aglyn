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

import type {
  PageRecordAnswer,
  PageRecordRequest,
  PageRecordSource,
} from '@aglyn/aglyn/app-utils/page-record-sources'
import type { RepeatableDataset } from '@aglyn/aglyn/app-utils/expand-repeatables'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import { collection, limit, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { readDatasetRepeatRows } from '../repeat/dataset-repeat-rows'
import {
  DATASET_RECORD_PAGES_COLLECTION,
  type DatasetRecordPageBinding,
  RECORD_PAGES_MAX_PER_SITE,
  parseRecordPageBinding,
} from './record-pages'

/** The record-page source's id on the page-record registry. */
export const RECORD_PAGE_SOURCE_ID = 'datasetRecordPages'

/**
 * A site's record templates, live (AGL-3475) — read once per site however
 * many rows of the Pages list or panels of the editor ask, because each asks
 * through this one listener. The rules let any member of the site read them;
 * only the record-pages route writes them.
 */
export function useSiteRecordPageBindings(hostId: string | null | undefined): {
  bindings: DatasetRecordPageBinding[]
  loading: boolean
} {
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<Record<string, unknown> & { $id: string }>(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, DATASET_RECORD_PAGES_COLLECTION),
            limit(RECORD_PAGES_MAX_PER_SITE),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  const bindings = useMemo(
    () =>
      (data ?? [])
        .map((doc) => parseRecordPageBinding(doc.$id, doc))
        .filter((binding): binding is DatasetRecordPageBinding => binding != null),
    [data],
  )
  return { bindings, loading: status === 'loading' }
}

/**
 * Which record each record template is previewed with, by page — kept for the
 * editor's session, so switching panels or reopening Page Properties keeps
 * the record the author picked.
 */
const previewSelections = new Map<string, string>()
const previewListeners = new Set<() => void>()

/** The record a page is previewed with, as last picked, and the picker. */
export function useRecordPagePreviewSelection(
  screenId: string,
): [string | undefined, (id: string) => void] {
  const selected = useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener)
      return () => previewListeners.delete(listener)
    },
    () => previewSelections.get(screenId),
    () => undefined,
  )
  const select = useCallback(
    (id: string) => {
      previewSelections.set(screenId, id)
      for (const listener of [...previewListeners]) listener()
    },
    [screenId],
  )
  return [selected, select]
}

/** A row's label for the picker: the first text value it has, or its id. */
function rowLabel(row: Record<string, unknown>, nameField: string | undefined): string {
  const named = nameField ? row[nameField] : undefined
  if (typeof named === 'string' && named.trim()) return named.trim()
  for (const [key, value] of Object.entries(row)) {
    if (key !== '$id' && key !== 'url' && typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return String(row['$id'] ?? '')
}

/**
 * The record a record template is drawn for on the canvas (AGL-3475): the
 * picked one, else the first in the dataset's order — the rows a repeat over
 * the dataset would list, read by the same reader, so a preview never draws a
 * record the site may not see. `none` for every page that is no record
 * template of this site.
 */
export function useRecordPagePreview(request: PageRecordRequest): PageRecordAnswer {
  const { hostId, screenId } = request
  const { bindings, loading } = useSiteRecordPageBindings(hostId)
  const binding = bindings.find((one) => one.screenId === screenId)
  const firestore = useFirestore()
  const { scope, ready } = useOrgDataScope({ hostId })
  const [selected, select] = useRecordPagePreviewSelection(screenId)
  const [rows, setRows] = useState<{
    key: string
    label: string
    rowsByKey: Record<string, RepeatableDataset>
  } | null>(null)
  const datasetId = binding?.datasetId

  useEffect(() => {
    if (!datasetId || !ready || !scope) {
      setRows(null)
      return undefined
    }
    let active = true
    readDatasetRepeatRows({ firestore, scope, hostId, key: datasetId }).then(
      (answer) => {
        if (!active) return
        setRows(
          answer.status === 'ready'
            ? { key: datasetId, label: answer.label, rowsByKey: answer.rowsByKey }
            : null,
        )
      },
      (error) => {
        console.error(error)
        if (active) setRows(null)
      },
    )
    return () => {
      active = false
    }
  }, [firestore, scope, ready, hostId, datasetId])

  return useMemo((): PageRecordAnswer => {
    if (loading) return { status: 'loading' }
    if (!binding) return { status: 'none' }
    if (!rows || rows.key !== binding.datasetId) return { status: 'loading' }
    const dataset = rows.rowsByKey[binding.datasetId]
    const records = dataset?.records ?? []
    const record = records.find((row) => row['$id'] === selected) ?? records[0]
    if (!record) return { status: 'none' }
    return {
      status: 'ready',
      label: rows.label,
      record,
      ...(dataset?.model ? { model: dataset.model } : {}),
      datasetsByKey: rows.rowsByKey,
      selectedId: String(record['$id'] ?? ''),
      choices: records.map((row) => ({
        id: String(row['$id'] ?? ''),
        label: rowLabel(row, binding.titleField),
      })),
      select,
    }
  }, [loading, binding, rows, selected, select])
}

/** Record templates, as the editor's page-record registry asks for them. */
export const RECORD_PAGE_SOURCE: PageRecordSource = {
  id: RECORD_PAGE_SOURCE_ID,
  usePageRecord: useRecordPagePreview,
}
