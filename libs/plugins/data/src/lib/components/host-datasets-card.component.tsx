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

import { type AglynOrgBilling, applyDatasetQuery, checkDatasetQuota, checkEntitlement, checkQuota, coerceDocumentValues, createResourceUid, datasetValueToInput, deriveModelFromFields, effectiveDatasetModel, formatDatasetValue, parseDatasetFields, parseDatasetFilter, parseDatasetSort, sortDatasetRecords, validateDocument, getCustomFieldType } from '@aglyn/aglyn'
import { datasetRecordsToCsv, mapImportColumns, parseImportRows, serializeDatasetValue } from '../model'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostActivityLogger,
  useHostOrgId,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { DatasetSchemaDialog } from './dataset-schema-dialog.component'

export interface HostDatasetsCardProps {
  /** Host context: resolves the owning org and logs host activity. */
  hostId?: string
  /**
   * Direct org scope (AGL-239): the org Data page renders the editor
   * without any host context. Wins over `hostId` resolution when set.
   */
  orgId?: string
  /**
   * The resolved entitlement source (org billing doc). Passed in by both
   * callers (the plugin Data page via the shell, the org Data page via its
   * own resolver) so this relocated card runs entitlement/quota checks
   * without console-app org/session hooks (AGL-395).
   */
  org?: Partial<AglynOrgBilling>
}

/**
 * Datasets editor (AGL-102): org-shared document collections at
 * `orgs/{orgId}/datasets` (AGL-237/239) with a `records` subcollection,
 * consumed by repeatable components (AGL-103) via `{{item.field}}`.
 * Starter+ (`data-store` flag) with per-plan dataset and record caps —
 * dark-launch rule as everywhere (no plan, no gate). The host path is
 * the pre-migration fallback for hosts not yet org-wired.
 */
export function HostDatasetsCard(props: HostDatasetsCardProps) {
  const { hostId } = props
  const hostOrgId = useHostOrgId(props.orgId ? undefined : hostId)
  const orgId = props.orgId ?? hostOrgId
  const dataScope = orgId
    ? (['orgs', orgId] as const)
    : (['hosts', hostId ?? '-none-'] as const)
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org } = props
  const logActivity = useHostActivityLogger(hostId)
  const { data: user } = useUser()

  // Creates go through the console API (AGL-473): rules deny client-side
  // `create` on org datasets/records so quotas are server-enforced.
  // Updates/deletes stay client-direct (they don't consume quota). The
  // legacy host scope (no org resolved) keeps the old client writes.
  const callDatasetApi = useCallback(
    async (payload: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/datasets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ orgId, ...payload }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Dataset operation failed')
      }
      return result
    },
    [user, orgId],
  )

  const { data: datasetDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, dataScope[0], dataScope[1], 'datasets'), limit(100)),
    [firestore, hostId, orgId],
    { idField: '$id' },
  )
  const datasets = useMemo(
    () =>
      [...(datasetDocs ?? [])].sort((a, b) =>
        String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
      ),
    [datasetDocs],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const selected =
    datasets.find((item) => item.$id === selectedId) ?? datasets[0]
  // Typed model (AGL-179): drives headers, cell rendering, and the
  // document form; v1 datasets get a derived all-text model.
  const model = useMemo(
    () => effectiveDatasetModel(selected ?? {}),
    [selected],
  )
  const fields: string[] = useMemo(() => model.order, [model])

  const { data: recordDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(
          firestore,
          dataScope[0],
          dataScope[1],
          'datasets',
          selected?.$id ?? '-none-',
          'records',
        ),
        limit(500),
      ),
    [firestore, hostId, orgId, selected?.$id],
    { idField: '$id' },
  )
  const records = useMemo(
    () => sortDatasetRecords([...(recordDocs ?? [])]),
    [recordDocs],
  )
  // Query layer (AGL-181): the same evaluator the renderer uses, applied
  // in memory over the loaded window (explicitly bounded, never silently
  // unbounded — the helper text says so).
  const [filterText, setFilterText] = useState('')
  const [sortText, setSortText] = useState('')
  const visibleRecords = useMemo(() => {
    const where = parseDatasetFilter(filterText)
    const orderBy = parseDatasetSort(sortText)
    if (!where && !orderBy) return records
    const rows = records.map((record: any) => ({
      __record: record,
      ...(record.values ?? {}),
    }))
    return applyDatasetQuery(model, rows, {
      ...(where ? { where: [where] } : {}),
      ...(orderBy ? { orderBy } : {}),
    }).map((row: any) => row.__record)
  }, [records, filterText, sortText, model])

  // --- Create dataset -----------------------------------------------------
  const [creator, setCreator] = useState<{
    name: string
    fields: string
  } | null>(null)
  const handleOpenCreator = useCallback(() => {
    if (!checkEntitlement(org, 'dataStore')) {
      return enqueueSnackbar(
        'Datasets require a Starter plan or higher — see Billing',
        { variant: 'warning', persist: false },
      )
    }
    // Addon-aware quota (AGL-132): purchased extra datasets raise the
    // limit up to the plan's hard max; beyond that only an upgrade helps.
    const quota = checkDatasetQuota(org as any, datasets.length)
    if (!quota.allowed) {
      return enqueueSnackbar(
        quota.upgradeRequired
          ? `Dataset limit reached (${quota.limit}) — upgrade in Billing`
          : `Dataset limit reached (${quota.limit}) — add extra datasets ` +
            `for $${quota.addonPriceUsd}/mo each or upgrade in Billing`,
        { variant: 'warning', persist: false },
      )
    }
    setCreator({ name: '', fields: '' })
  }, [org, datasets.length, enqueueSnackbar])
  const creatorFields = parseDatasetFields(creator?.fields ?? '')
  const handleCreate = useCallback(async () => {
    if (!creator?.name.trim() || creatorFields.length === 0) return
    let id: string
    try {
      if (orgId) {
        const result = await callDatasetApi({
          action: 'create-dataset',
          displayName: creator.name.trim(),
          fields: creatorFields,
          // Typed model from day one (AGL-178); refine in the Schema dialog.
          model: deriveModelFromFields(creatorFields),
        })
        id = String(result.id)
      } else {
        // Legacy host scope (pre-org hosts): client write, rules unchanged.
        id = createResourceUid()
        await setDoc(doc(firestore, dataScope[0], dataScope[1], 'datasets', id), {
          displayName: creator.name.trim(),
          fields: creatorFields,
          model: deriveModelFromFields(creatorFields),
          createdAt: Timestamp.now(),
        })
      }
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Dataset create failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setCreator(null)
    setSelectedId(id)
    enqueueSnackbar(`Dataset "${creator.name.trim()}" created`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Created dataset', {
      type: 'content',
      id,
      name: creator.name.trim(),
    })
  }, [creator, creatorFields, firestore, hostId, orgId, callDatasetApi, enqueueSnackbar, logActivity])

  // Join collection template (AGL-180): extrinsic many-to-many as a
  // visible, editable collection of FKey pairs — no magic.
  const [joiner, setJoiner] = useState<{ a: string; b: string } | null>(null)
  const handleCreateJoin = useCallback(async () => {
    if (!joiner?.a || !joiner?.b || joiner.a === joiner.b) return
    const a = datasets.find((item) => item.$id === joiner.a)
    const b = datasets.find((item) => item.$id === joiner.b)
    if (!a || !b) return
    const fieldFor = (target: any, fieldId: string) => ({
      name: String(target.displayName ?? fieldId),
      type: 'reference' as const,
      required: true,
      reference: {
        datasetId: target.$id as string,
        displayFieldId: effectiveDatasetModel(target).order[0],
        onDelete: 'setNull' as const,
      },
    })
    const payload = {
      displayName: `${a.displayName} ↔ ${b.displayName}`,
      fields: ['aRef', 'bRef'],
      model: {
        order: ['aRef', 'bRef'],
        fields: { aRef: fieldFor(a, 'aRef'), bRef: fieldFor(b, 'bRef') },
      },
    }
    let id: string
    try {
      if (orgId) {
        const result = await callDatasetApi({
          action: 'create-dataset',
          ...payload,
        })
        id = String(result.id)
      } else {
        // Legacy host scope (pre-org hosts): client write, rules unchanged.
        id = createResourceUid()
        await setDoc(doc(firestore, dataScope[0], dataScope[1], 'datasets', id), {
          ...payload,
          createdAt: Timestamp.now(),
        })
      }
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Join create failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setJoiner(null)
    setSelectedId(id)
    enqueueSnackbar('Join collection created', {
      variant: 'success',
      persist: false,
    })
  }, [joiner, datasets, firestore, hostId, orgId, callDatasetApi, enqueueSnackbar])

  const handleDeleteDataset = useCallback(async () => {
    if (!selected) return
    const confirmed = await confirm({
      title: 'Delete this collection?',
      description:
        `"${selected.displayName}"` +
        (records.length
          ? ` and its ${records.length} document${records.length === 1 ? '' : 's'}`
          : '') +
        ' stop resolving in repeatable components and bindings that ' +
        'reference it.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await deleteDoc(doc(firestore, dataScope[0], dataScope[1], 'datasets', selected.$id))
    setSelectedId(null)
    enqueueSnackbar('Dataset deleted', { variant: 'success', persist: false })
    logActivity('Deleted dataset', {
      type: 'content',
      id: selected.$id,
      name: selected.displayName,
    })
  }, [
    selected,
    records.length,
    confirm,
    firestore,
    hostId,
    orgId,
    enqueueSnackbar,
    logActivity,
  ])

  // Reference pickers (AGL-180): load target-collection rows for every
  // reference field in the model (id -> display label).
  const [refOptions, setRefOptions] = useState<
    Record<string, Array<{ id: string; label: string }>>
  >({})
  useEffect(() => {
    let active = true
    const referenceFields = model.order.filter(
      (fieldId) =>
        model.fields[fieldId]?.type === 'reference' &&
        model.fields[fieldId]?.reference?.datasetId,
    )
    if (!referenceFields.length) {
      setRefOptions({})
      return
    }
    void Promise.all(
      referenceFields.map(async (fieldId) => {
        const reference = model.fields[fieldId].reference as {
          datasetId: string
          displayFieldId?: string
        }
        const target = datasets.find(
          (item) => item.$id === reference.datasetId,
        )
        const displayFieldId =
          reference.displayFieldId ??
          effectiveDatasetModel(target ?? {}).order[0]
        const snapshot = await getDocs(
          query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'datasets',
              reference.datasetId,
              'records',
            ),
            limit(200),
          ),
        ).catch(() => null)
        const options = (snapshot?.docs ?? []).map((docSnapshot) => ({
          id: docSnapshot.id,
          label: String(
            docSnapshot.get('values')?.[displayFieldId ?? ''] ??
              docSnapshot.id,
          ),
        }))
        return [fieldId, options] as const
      }),
    ).then((entries) => {
      if (active) setRefOptions(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
  }, [model, datasets, firestore, hostId, orgId])
  const referenceLabel = useCallback(
    (fieldId: string, value: unknown): string => {
      const options = refOptions[fieldId] ?? []
      const ids = Array.isArray(value) ? value : value != null ? [value] : []
      return ids
        .map(
          (id) => options.find((option) => option.id === id)?.label ?? String(id),
        )
        .join(', ')
    },
    [refOptions],
  )

  // --- Document editor (null id = new; AGL-179 typed inputs) --------------
  const [editor, setEditor] = useState<{
    id: string | null
    values: Record<string, string>
    errors: Record<string, string>
  } | null>(null)
  const handleOpenRecord = useCallback(
    (record?: any) => () => {
      if (!record) {
        const quota = checkQuota(
          org,
          'recordsPerDataset',
          records.length,
        )
        if (!quota.allowed) {
          return enqueueSnackbar(
            `Record limit reached (${quota.limit}) — see Billing to upgrade`,
            { variant: 'warning', persist: false },
          )
        }
      }
      const values: Record<string, string> = {}
      for (const fieldId of model.order) {
        const field = model.fields[fieldId]
        if (!field) continue
        if (record) {
          values[fieldId] = datasetValueToInput(
            field,
            record.values?.[fieldId],
          )
        } else if (field.default != null) {
          values[fieldId] = String(field.default)
        }
      }
      // Flag non-conforming stored values (AGL-178 policy: type changes
      // never rewrite documents; the editor surfaces the mismatch).
      const errors = record
        ? validateDocument(model, record.values ?? {})
        : {}
      setEditor({ id: record?.$id ?? null, values, errors })
    },
    [org, records.length, model, enqueueSnackbar],
  )
  const handleSaveRecord = useCallback(async () => {
    if (!editor || !selected) return
    const coerced = coerceDocumentValues(model, editor.values)
    const errors = validateDocument(model, coerced)
    if (Object.keys(errors).length) {
      return void setEditor((prev) => (prev ? { ...prev, errors } : prev))
    }
    // `values` is replaced wholesale (not merged) so orphaned values from
    // removed fields strip here, lazily, per the documented AGL-178 policy.
    try {
      if (editor.id) {
        // Updates stay client-direct (no quota consumed).
        const recordRef = doc(
          firestore,
          dataScope[0],
          dataScope[1],
          'datasets',
          selected.$id,
          'records',
          editor.id,
        )
        await setDoc(
          recordRef,
          { values: coerced, updatedAt: Timestamp.now() },
          { mergeFields: ['values', 'updatedAt'] },
        )
      } else if (orgId) {
        // Creates go through the quota-enforcing API (AGL-473).
        await callDatasetApi({
          action: 'create-record',
          datasetId: selected.$id,
          values: coerced,
        })
      } else {
        // Legacy host scope (pre-org hosts): client write, rules unchanged.
        const recordRef = doc(
          firestore,
          dataScope[0],
          dataScope[1],
          'datasets',
          selected.$id,
          'records',
          createResourceUid(),
        )
        await setDoc(recordRef, {
          values: coerced,
          order: records.length,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
      }
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Record save failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setEditor(null)
    enqueueSnackbar(editor.id ? 'Record saved' : 'Record added', {
      variant: 'success',
      persist: false,
    })
    logActivity(editor.id ? 'Updated record' : 'Added record', {
      type: 'content',
      id: selected.$id,
      name: selected.displayName,
    })
  }, [
    editor,
    selected,
    firestore,
    hostId,
    orgId,
    model,
    records.length,
    callDatasetApi,
    enqueueSnackbar,
    logActivity,
  ])
  const handleDeleteRecord = useCallback(
    (record: any) => async () => {
      if (!selected) return
      // Delete integrity (AGL-180): scan collections whose models
      // reference this one; `restrict` blocks, `setNull` strips the FKey.
      for (const other of datasets) {
        const otherModel = effectiveDatasetModel(other)
        const referencing = otherModel.order.filter(
          (fieldId) =>
            otherModel.fields[fieldId]?.type === 'reference' &&
            otherModel.fields[fieldId]?.reference?.datasetId === selected.$id,
        )
        if (!referencing.length) continue
        const snapshot = await getDocs(
          query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'datasets',
              other.$id,
              'records',
            ),
            limit(500),
          ),
        ).catch(() => null)
        if (!snapshot) continue
        const hits = snapshot.docs.filter((docSnapshot) =>
          referencing.some((fieldId) => {
            const stored = docSnapshot.get('values')?.[fieldId]
            return Array.isArray(stored)
              ? stored.includes(record.$id)
              : stored === record.$id
          }),
        )
        if (!hits.length) continue
        const restricted = referencing.some(
          (fieldId) =>
            otherModel.fields[fieldId]?.reference?.onDelete === 'restrict',
        )
        if (restricted) {
          return void enqueueSnackbar(
            `Cannot delete: referenced by ${hits.length} document` +
              `${hits.length === 1 ? '' : 's'} in "${other.displayName}"`,
            { variant: 'warning', persist: false },
          )
        }
        const batch = writeBatch(firestore)
        for (const hit of hits) {
          const values = { ...(hit.get('values') ?? {}) }
          for (const fieldId of referencing) {
            const stored = values[fieldId]
            if (Array.isArray(stored)) {
              values[fieldId] = stored.filter((id: string) => id !== record.$id)
            } else if (stored === record.$id) {
              delete values[fieldId]
            }
          }
          batch.update(hit.ref, { values })
        }
        await batch.commit()
      }
      await deleteDoc(
        doc(
          firestore,
          dataScope[0],
          dataScope[1],
          'datasets',
          selected.$id,
          'records',
          record.$id,
        ),
      )
      enqueueSnackbar('Record deleted', { variant: 'success', persist: false })
    },
    [selected, datasets, firestore, hostId, orgId, enqueueSnackbar],
  )

  // CSV/JSON round-tripping (AGL-182) over the loaded window.
  const download = useCallback((name: string, mime: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])
  const handleExport = useCallback(
    (format: 'csv' | 'json') => () => {
      if (!selected) return
      const rows = records.map((record: any) => record.values ?? {})
      const base = String(selected.displayName ?? 'collection')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .toLowerCase()
      if (format === 'csv') {
        download(
          `${base}.csv`,
          'text/csv',
          datasetRecordsToCsv(model, rows),
        )
      } else {
        download(
          `${base}.json`,
          'application/json',
          JSON.stringify(
            rows.map((row) =>
              Object.fromEntries(
                model.order.map((fieldId) => [
                  fieldId,
                  model.fields[fieldId]
                    ? serializeDatasetValue(model.fields[fieldId], row[fieldId])
                    : '',
                ]),
              ),
            ),
            null,
            2,
          ),
        )
      }
    },
    [selected, records, model, download],
  )

  // keyField (wave v6): optional unique key — matching rows update the
  // existing record instead of appending a duplicate.
  const [importer, setImporter] = useState<{
    text: string
    keyField: string
  } | null>(null)
  const importPreview = useMemo(() => {
    if (!importer) return null
    const rows = parseImportRows(importer.text)
    if (!rows || !rows.length) return null
    const { mapping, unmatched } = mapImportColumns(
      model,
      Object.keys(rows[0]),
    )
    const prepared = rows.map((raw) => {
      const input: Record<string, string> = {}
      for (const [column, fieldId] of Object.entries(mapping)) {
        input[fieldId] = raw[column] ?? ''
      }
      const values = coerceDocumentValues(model, input)
      const errors = validateDocument(model, values)
      return { values, errors, valid: !Object.keys(errors).length }
    })
    return {
      prepared,
      unmatched,
      valid: prepared.filter((row) => row.valid).length,
    }
  }, [importer, model])
  const handleImport = useCallback(async () => {
    if (!selected || !importPreview) return
    const validRows = importPreview.prepared.filter((row) => row.valid)

    // Unique-key upsert (wave v6): with a key field picked, incoming rows
    // that match an existing record's key update it in place, and
    // duplicate keys within the import collapse to the last row.
    const keyField = importer?.keyField ?? ''
    const keyOf = (values: Record<string, unknown>) =>
      String(values?.[keyField] ?? '').trim().toLowerCase()
    let updates: Array<{ id: string; values: Record<string, unknown> }> = []
    let creates = validRows
    if (keyField) {
      const existingByKey = new Map<string, string>()
      for (const record of records as any[]) {
        const key = keyOf(record.values ?? {})
        if (key) existingByKey.set(key, record.$id)
      }
      const deduped = new Map<string, (typeof validRows)[number]>()
      const keyless: typeof validRows = []
      for (const row of validRows) {
        const key = keyOf(row.values)
        if (key) deduped.set(key, row)
        else keyless.push(row)
      }
      updates = []
      creates = [...keyless]
      for (const [key, row] of deduped) {
        const existingId = existingByKey.get(key)
        if (existingId) updates.push({ id: existingId, values: row.values })
        else creates.push(row)
      }
    }

    const quota = checkQuota(
      org,
      'recordsPerDataset',
      records.length + creates.length - 1,
    )
    const room = quota.allowed
      ? creates.length
      : Math.max(0, Number(quota.limit ?? 0) - records.length)
    const toWrite = creates.slice(0, room)
    if (!toWrite.length && !updates.length) {
      return void enqueueSnackbar(
        `Record limit reached (${quota.limit}) — see Billing to upgrade`,
        { variant: 'warning', persist: false },
      )
    }
    // Updates stay client-direct (no quota consumed), chunked under
    // Firestore's 500-writes/batch limit.
    for (let start = 0; start < updates.length; start += 400) {
      const batch = writeBatch(firestore)
      updates.slice(start, start + 400).forEach((update) => {
        const ref = doc(
          firestore,
          dataScope[0],
          dataScope[1],
          'datasets',
          selected.$id,
          'records',
          update.id,
        )
        batch.set(
          ref,
          { values: update.values, updatedAt: Timestamp.now() },
          { merge: true },
        )
      })
      await batch.commit()
    }
    // Creates go through the quota-enforcing API (AGL-473); the legacy
    // host scope (no org resolved) keeps the old client batch.
    try {
      if (toWrite.length && orgId) {
        await callDatasetApi({
          action: 'import-records',
          datasetId: selected.$id,
          records: toWrite.map((row) => ({ values: row.values })),
        })
      } else if (toWrite.length) {
        let createdSoFar = 0
        for (let start = 0; start < toWrite.length; start += 400) {
          const batch = writeBatch(firestore)
          toWrite.slice(start, start + 400).forEach((row) => {
            const ref = doc(
              firestore,
              dataScope[0],
              dataScope[1],
              'datasets',
              selected.$id,
              'records',
              createResourceUid(),
            )
            batch.set(ref, {
              values: row.values,
              order: records.length + createdSoFar,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            })
            createdSoFar += 1
          })
          await batch.commit()
        }
      }
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Import failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setImporter(null)
    const skippedInvalid = importPreview.prepared.length - validRows.length
    const skippedQuota = creates.length - toWrite.length
    enqueueSnackbar(
      `Imported ${toWrite.length} new` +
        (updates.length ? `, updated ${updates.length}` : '') +
        (skippedInvalid ? `, ${skippedInvalid} invalid skipped` : '') +
        (skippedQuota ? `, ${skippedQuota} over the record limit` : ''),
      { variant: skippedInvalid || skippedQuota ? 'warning' : 'success' },
    )
    logActivity('Imported records', {
      type: 'content',
      id: selected.$id,
      name: selected.displayName,
    })
  }, [
    selected,
    importPreview,
    importer?.keyField,
    org,
    records,
    firestore,
    hostId,
    orgId,
    callDatasetApi,
    enqueueSnackbar,
    logActivity,
  ])

  return (
    <CardDisplay
      header={'Data'}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        {orgId ? (
          <Typography variant="caption" color="text.secondary">
            {'Datasets belong to your organization and are shared by all ' +
              'of its sites.'}
          </Typography>
        ) : null}
        {datasets.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Create a dataset (e.g. Products) and repeat a component over ' +
              'its records with {{item.field}} bindings.'}
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Dataset"
              value={selected?.$id ?? ''}
              onChange={(event) => setSelectedId(event.target.value)}
              sx={{ minWidth: 180 }}
            >
              {datasets.map((item) => (
                <MenuItem key={item.$id} value={item.$id}>
                  {item.displayName}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              color="secondary"
              onClick={handleOpenRecord()}
            >
              {'Add record'}
            </Button>
            <Button size="small" onClick={() => setSchemaOpen(true)}>
              {'Schema'}
            </Button>
            <Button
              size="small"
              onClick={() => setImporter({ text: '', keyField: '' })}
            >
              {'Import'}
            </Button>
            {records.length ? (
              <>
                <Button size="small" onClick={handleExport('csv')}>
                  {'CSV'}
                </Button>
                <Button size="small" onClick={handleExport('json')}>
                  {'JSON'}
                </Button>
              </>
            ) : null}
            <Button size="small" color="error" onClick={handleDeleteDataset}>
              {'Delete'}
            </Button>
          </Stack>
        )}
        {selected && records.length > 0 ? (
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Filter"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              helperText={'e.g. price <= 20 · applies to loaded records'}
              sx={{ minWidth: 220 }}
            />
            <TextField
              size="small"
              label="Sort"
              value={sortText}
              onChange={(event) => setSortText(event.target.value)}
              helperText={'e.g. price desc'}
              sx={{ minWidth: 140 }}
            />
          </Stack>
        ) : null}
        {selected && records.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                {fields.map((fieldId) => (
                  <TableCell key={fieldId}>
                    {model.fields[fieldId]?.name ?? fieldId}
                  </TableCell>
                ))}
                <TableCell align="right">{'Actions'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRecords.map((record: any) => (
                <TableRow key={record.$id} hover>
                  {fields.map((fieldId) => (
                    <TableCell key={fieldId}>
                      {model.fields[fieldId]?.type === 'reference'
                        ? referenceLabel(fieldId, record.values?.[fieldId]) ||
                          '--'
                        : model.fields[fieldId]
                          ? formatDatasetValue(
                              model.fields[fieldId],
                              record.values?.[fieldId],
                            ) || '--'
                          : '--'}
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={handleOpenRecord(record)}>
                      {'Edit'}
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={handleDeleteRecord(record)}
                    >
                      {'Delete'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : selected ? (
          <Typography variant="body2" color="text.secondary">
            {'No records yet.'}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={handleOpenCreator}
          >
            {'Add dataset'}
          </Button>
          {datasets.length >= 2 ? (
            <Button size="small" onClick={() => setJoiner({ a: '', b: '' })}>
              {'Add join collection'}
            </Button>
          ) : null}
        </Stack>
      </Stack>
      <Dialog
        open={Boolean(creator)}
        onClose={() => setCreator(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New dataset'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Name"
            value={creator?.name ?? ''}
            onChange={(event) =>
              setCreator((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            helperText="e.g. Products, Team, FAQ"
          />
          <TextField
            label="Fields"
            value={creator?.fields ?? ''}
            onChange={(event) =>
              setCreator((prev) =>
                prev ? { ...prev, fields: event.target.value } : prev,
              )
            }
            size="small"
            helperText={
              creatorFields.length
                ? `Columns: ${creatorFields.join(', ')}`
                : 'Comma-separated column names, e.g. title, price'
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreator(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!creator?.name.trim() || creatorFields.length === 0}
            onClick={handleCreate}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{editor?.id ? 'Edit record' : 'New record'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {fields.map((fieldId, index) => {
            const field = model.fields[fieldId]
            if (!field) return null
            const value = editor?.values[fieldId] ?? ''
            const error = editor?.errors[fieldId]
            const label = field.required ? `${field.name} *` : field.name
            const setValue = (nextValue: string) =>
              setEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      values: { ...prev.values, [fieldId]: nextValue },
                      errors: { ...prev.errors, [fieldId]: '' },
                    }
                  : prev,
              )
            const common = {
              label,
              value,
              size: 'small' as const,
              autoFocus: index === 0,
              error: Boolean(error),
              helperText: error || field.description,
              sx: index === 0 ? { mt: 1 } : undefined,
              onChange: (event: { target: { value: string } }) =>
                setValue(event.target.value),
            }
            // Custom field types (AGL-434): the declaring plugin's Input
            // takes over; values stay in input form (strings) so the
            // existing coerce/validate pipeline is unchanged.
            const customFieldType = getCustomFieldType(field.customType)
            if (customFieldType?.Input) {
              const CustomInput = customFieldType.Input
              return (
                <Stack key={fieldId} sx={index === 0 ? { mt: 1 } : undefined}>
                  <CustomInput
                    value={value}
                    label={common.label}
                    onChange={(next) => setValue(String(next ?? ''))}
                  />
                  {(error || field.description) ? (
                    <Typography
                      variant="caption"
                      color={error ? 'error' : 'text.secondary'}
                    >
                      {error || field.description}
                    </Typography>
                  ) : null}
                </Stack>
              )
            }
            // Typed inputs per FT.Tag (AGL-179).
            if (field.type === 'bool') {
              return (
                <TextField key={fieldId} {...common} select>
                  <MenuItem value="">{'—'}</MenuItem>
                  <MenuItem value="true">{'Yes'}</MenuItem>
                  <MenuItem value="false">{'No'}</MenuItem>
                </TextField>
              )
            }
            if (field.type === 'text' && field.validation?.options?.length) {
              return (
                <TextField key={fieldId} {...common} select>
                  <MenuItem value="">{'—'}</MenuItem>
                  {field.validation.options.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
              )
            }
            if (field.type === 'reference') {
              const options = refOptions[fieldId] ?? []
              const multiple = Boolean(field.reference?.multiple)
              const selectedIds = value
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean)
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  select
                  value={multiple ? selectedIds : value}
                  slotProps={{
                    select: multiple
                      ? {
                          multiple: true,
                          onChange: (event: any) =>
                            setValue(
                              (event.target.value as string[]).join(', '),
                            ),
                        }
                      : undefined,
                  }}
                >
                  {multiple ? null : <MenuItem value="">{'—'}</MenuItem>}
                  {options.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )
            }
            if (
              field.type === 'int32' ||
              field.type === 'int64' ||
              field.type === 'float'
            ) {
              return <TextField key={fieldId} {...common} type="number" />
            }
            if (field.type === 'timestamp') {
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  type="datetime-local"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )
            }
            if (field.type === 'coordinates') {
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  helperText={error || field.description || 'lat, lon'}
                />
              )
            }
            if (field.type === 'sorted') {
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  helperText={
                    error || field.description || 'Comma-separated list'
                  }
                />
              )
            }
            return <TextField key={fieldId} {...common} />
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleSaveRecord}
          >
            {editor?.id ? 'Save' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(importer)}
        onClose={() => setImporter(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{'Import records'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            multiline
            minRows={6}
            size="small"
            label="CSV (with header row) or JSON array"
            value={importer?.text ?? ''}
            onChange={(event) =>
              setImporter((prev) =>
                prev ? { ...prev, text: event.target.value } : prev,
              )
            }
            sx={{ mt: 1 }}
            helperText="Columns match by field id or display name"
          />
          <TextField
            select
            size="small"
            label="Match on field (upsert)"
            value={importer?.keyField ?? ''}
            onChange={(event) =>
              setImporter((prev) =>
                prev ? { ...prev, keyField: event.target.value } : prev,
              )
            }
            helperText={
              'Rows whose value matches an existing record update it ' +
              'instead of appending a duplicate.'
            }
            sx={{ maxWidth: 280 }}
          >
            <MenuItem value="">{'None — always append'}</MenuItem>
            {model.order.map((fieldId) => (
              <MenuItem key={fieldId} value={fieldId}>
                {model.fields[fieldId]?.name ?? fieldId}
              </MenuItem>
            ))}
          </TextField>
          {importPreview ? (
            <Typography variant="body2" color="text.secondary">
              {`${importPreview.prepared.length} rows parsed · ` +
                `${importPreview.valid} valid` +
                (importPreview.prepared.length - importPreview.valid
                  ? ` · ${importPreview.prepared.length - importPreview.valid} invalid (skipped)`
                  : '') +
                (importPreview.unmatched.length
                  ? ` · unmatched columns: ${importPreview.unmatched.join(', ')}`
                  : '')}
            </Typography>
          ) : importer?.text.trim() ? (
            <Typography variant="body2" color="warning.main">
              {'Nothing parseable yet — CSV needs a header row.'}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImporter(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!importPreview?.valid}
            onClick={handleImport}
          >
            {'Import valid rows'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(joiner)}
        onClose={() => setJoiner(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New join collection'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {'Links two collections many-to-many; each row pairs one ' +
              'document from each side.'}
          </Typography>
          {(['a', 'b'] as const).map((side) => (
            <TextField
              key={side}
              select
              size="small"
              label={side === 'a' ? 'First collection' : 'Second collection'}
              value={joiner?.[side] ?? ''}
              onChange={(event) =>
                setJoiner((prev) =>
                  prev ? { ...prev, [side]: event.target.value } : prev,
                )
              }
            >
              {datasets.map((item) => (
                <MenuItem key={item.$id} value={item.$id}>
                  {item.displayName}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJoiner(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!joiner?.a || !joiner?.b || joiner.a === joiner.b}
            onClick={handleCreateJoin}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      <DatasetSchemaDialog
        hostId={hostId}
        orgId={orgId ?? undefined}
        dataset={schemaOpen && selected ? selected : null}
        datasets={datasets}
        recordCount={records.length}
        onClose={() => setSchemaOpen(false)}
      />
    </CardDisplay>
  )
}
HostDatasetsCard.displayName = 'HostDatasetsCard'

export default HostDatasetsCard
