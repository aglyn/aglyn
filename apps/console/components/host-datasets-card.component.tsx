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

import {
  checkDatasetQuota,
  createResourceUid,
  parseDatasetFields,
  sanitizeRecordValues,
  sortDatasetRecords,
} from '@aglyn/aglyn'
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
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'
import {
  checkTenantQuota,
  hasEntitlement,
} from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'
import useHostActivityLogger from '../hooks/use-host-activity-logger'

export interface HostDatasetsCardProps {
  hostId: string
}

/**
 * Datasets editor (AGL-102): tabular data at `hosts/{hostId}/datasets` with
 * a `records` subcollection, consumed by repeatable components (AGL-103)
 * via `{{item.field}}`. Starter+ (`data-store` flag) with per-plan dataset
 * and record caps — dark-launch rule as everywhere (no plan, no gate).
 */
export function HostDatasetsCard(props: HostDatasetsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  const logActivity = useHostActivityLogger(hostId)

  const { data: datasetDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'datasets'), limit(100)),
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
  const selected =
    datasets.find((item) => item.$id === selectedId) ?? datasets[0]
  const fields: string[] = selected?.fields ?? []

  const { data: recordDocs } = useFirestoreCollectionData<any>(
    query(
      collection(
        firestore,
        'hosts',
        hostId,
        'datasets',
        selected?.$id ?? '-none-',
        'records',
      ),
      limit(500),
    ),
    { idField: '$id' },
  )
  const records = useMemo(
    () => sortDatasetRecords([...(recordDocs ?? [])]),
    [recordDocs],
  )

  // --- Create dataset -----------------------------------------------------
  const [creator, setCreator] = useState<{
    name: string
    fields: string
  } | null>(null)
  const handleOpenCreator = useCallback(() => {
    if (!hasEntitlement('data-store', tenant)) {
      return enqueueSnackbar(
        'Datasets require a Starter plan or higher — see Billing',
        { variant: 'warning', persist: false },
      )
    }
    // Addon-aware quota (AGL-132): purchased extra datasets raise the
    // limit up to the plan's hard max; beyond that only an upgrade helps.
    const quota = checkDatasetQuota(tenant as any, datasets.length)
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
  }, [tenant, datasets.length, enqueueSnackbar])
  const creatorFields = parseDatasetFields(creator?.fields ?? '')
  const handleCreate = useCallback(async () => {
    if (!creator?.name.trim() || creatorFields.length === 0) return
    const id = createResourceUid()
    await setDoc(doc(firestore, 'hosts', hostId, 'datasets', id), {
      displayName: creator.name.trim(),
      fields: creatorFields,
      createdAt: Timestamp.now(),
    })
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
  }, [creator, creatorFields, firestore, hostId, enqueueSnackbar, logActivity])

  const handleDeleteDataset = useCallback(async () => {
    if (!selected) return
    const confirmed = await confirm({
      title: 'Delete this dataset?',
      description:
        `"${selected.displayName}" and its records stop resolving in ` +
        'repeatable components.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await deleteDoc(doc(firestore, 'hosts', hostId, 'datasets', selected.$id))
    setSelectedId(null)
    enqueueSnackbar('Dataset deleted', { variant: 'success', persist: false })
    logActivity('Deleted dataset', {
      type: 'content',
      id: selected.$id,
      name: selected.displayName,
    })
  }, [selected, confirm, firestore, hostId, enqueueSnackbar, logActivity])

  // --- Record editor (null id = new row) ----------------------------------
  const [editor, setEditor] = useState<{
    id: string | null
    values: Record<string, string>
  } | null>(null)
  const handleOpenRecord = useCallback(
    (record?: any) => () => {
      if (!record) {
        const quota = checkTenantQuota(
          tenant,
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
      setEditor({
        id: record?.$id ?? null,
        values: { ...(record?.values ?? {}) },
      })
    },
    [tenant, records.length, enqueueSnackbar],
  )
  const handleSaveRecord = useCallback(async () => {
    if (!editor || !selected) return
    const id = editor.id ?? createResourceUid()
    await setDoc(
      doc(firestore, 'hosts', hostId, 'datasets', selected.$id, 'records', id),
      {
        values: sanitizeRecordValues(fields, editor.values),
        ...(editor.id ? {} : { order: records.length, createdAt: Timestamp.now() }),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    )
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
    fields,
    records.length,
    enqueueSnackbar,
    logActivity,
  ])
  const handleDeleteRecord = useCallback(
    (record: any) => async () => {
      if (!selected) return
      await deleteDoc(
        doc(
          firestore,
          'hosts',
          hostId,
          'datasets',
          selected.$id,
          'records',
          record.$id,
        ),
      )
      enqueueSnackbar('Record deleted', { variant: 'success', persist: false })
    },
    [selected, firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header={'Data'}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
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
            <Button size="small" color="error" onClick={handleDeleteDataset}>
              {'Delete'}
            </Button>
          </Stack>
        )}
        {selected && records.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                {fields.map((field) => (
                  <TableCell key={field}>{field}</TableCell>
                ))}
                <TableCell align="right">{'Actions'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.$id} hover>
                  {fields.map((field) => (
                    <TableCell key={field}>
                      {record.values?.[field] ?? '--'}
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
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          onClick={handleOpenCreator}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Add dataset'}
        </Button>
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
          {fields.map((field, index) => (
            <TextField
              key={field}
              label={field}
              value={editor?.values[field] ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev
                    ? {
                        ...prev,
                        values: { ...prev.values, [field]: event.target.value },
                      }
                    : prev,
                )
              }
              size="small"
              autoFocus={index === 0}
              sx={index === 0 ? { mt: 1 } : undefined}
            />
          ))}
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
    </CardDisplay>
  )
}
HostDatasetsCard.displayName = 'HostDatasetsCard'

export default HostDatasetsCard
