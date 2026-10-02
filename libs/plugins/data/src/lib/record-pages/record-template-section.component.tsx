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

import { checkEntitlement, scopeTokensForHost } from '@aglyn/aglyn'
import type { ConsoleBesignerPagePropertiesZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
  useOrgPlan,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type DatasetModel, effectiveDatasetModel } from '../model/dataset-models'
import { type HostDataset, datasetDisplayName } from '../model/datasets'
import {
  type DatasetRecordPageBinding,
  isRecordAddressField,
  recordAddressFieldIds,
  recordPageBaseRefusal,
  recordPagePath,
} from './record-pages'
import { useRecordPagePreview, useSiteRecordPageBindings } from './record-page-source'

type DatasetDoc = HostDataset & { $id: string; deletedAt?: unknown }

/** The optional field pickers, in the order the section offers them. */
const FIELD_PICKERS = [
  {
    key: 'titleField',
    label: 'Page name from',
    helper: 'Names each page — its tab title and breadcrumb. Defaults to the first text field.',
    empty: 'First text field',
  },
  {
    key: 'seoTitleField',
    label: 'Search title from',
    helper: 'Used exactly as written. Without one, the page name and the site title are used.',
    empty: 'Page name',
  },
  {
    key: 'seoDescriptionField',
    label: 'Search description from',
    helper: 'Without one, this page’s own description is used.',
    empty: 'This page’s description',
  },
  {
    key: 'seoImageField',
    label: 'Sharing image from',
    helper: 'A media field or an image URL. Without one, this page’s image is used.',
    empty: 'This page’s image',
  },
] as const

type Draft = Omit<DatasetRecordPageBinding, 'screenId'>

const EMPTY_DRAFT: Draft = { datasetId: '', base: '', slugField: '' }

/**
 * Page Properties' "Record pages" section (AGL-3475): makes the page in the
 * editor the record template of a dataset, so it is served once per record at
 * `/{base}/{address}`, and picks the record the canvas draws it for.
 *
 * Saving a page that is not yet a template converts it first, through the
 * platform's own route, after saying what that means: it stops answering at
 * its own address and stops counting toward the plan's pages. The binding is
 * then written by the record-pages route, which re-checks everything this
 * section checks and the few things only the server can see.
 */
export function RecordTemplateSection(props: ConsoleBesignerPagePropertiesZoneProps) {
  const { hostId, orgId, screenId, screenKind } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org, ready: planReady } = useOrgPlan(hostId)
  const { scope } = useOrgDataScope({ hostId, orgId })
  const { bindings } = useSiteRecordPageBindings(hostId)
  const current = bindings.find((binding) => binding.screenId === screenId)
  const preview = useRecordPagePreview({ hostId, screenId })

  // The datasets THIS site may see, which are the ones a record page can
  // render: the same scope the published page's reads apply.
  const { data: datasetDocs } = useFirestoreCollection<DatasetDoc>(
    () =>
      scope
        ? query(
            collection(firestore, scope[0], scope[1], 'datasets'),
            where('visibleTo', 'array-contains-any', scopeTokensForHost(hostId)),
            limit(100),
          )
        : null,
    [firestore, scope, hostId],
    { idField: '$id' },
  )
  const datasets = useMemo(
    () =>
      (datasetDocs ?? [])
        .filter((dataset) => !dataset.deletedAt)
        .sort((a, b) => datasetDisplayName(a).localeCompare(datasetDisplayName(b))),
    [datasetDocs],
  )

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [sourceField, setSourceField] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (current) {
      const { screenId: _id, ...stored } = current
      setDraft(stored)
    } else {
      setDraft(EMPTY_DRAFT)
    }
  }, [current])

  const dataset = datasets.find((one) => one.$id === draft.datasetId)
  const model: DatasetModel | undefined = dataset ? effectiveDatasetModel(dataset) : undefined
  const addressFields = model ? recordAddressFieldIds(model) : []
  const textFields = model
    ? model.order.filter(
        (fieldId) =>
          model.fields[fieldId]?.type === 'text' && !isRecordAddressField(model.fields[fieldId]),
      )
    : []
  const baseRefusal = draft.base
    ? recordPageBaseRefusal(draft.base, {
        otherBases: bindings
          .filter((binding) => binding.screenId !== screenId)
          .map((binding) => binding.base),
      })
    : null

  // A dataset with exactly one address field needs no choice.
  useEffect(() => {
    if (model && !draft.slugField && addressFields.length === 1) {
      setDraft((previous) => ({ ...previous, slugField: addressFields[0] }))
    }
  }, [model, draft.slugField, addressFields])

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const response = await authorizedFetch(user, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = (await response.json().catch(() => ({}))) as Record<string, any>
      if (!response.ok) throw new Error(result?.['error'] ?? 'Something went wrong')
      return result
    },
    [user],
  )

  const handleAddAddresses = useCallback(async () => {
    if (!dataset || !sourceField || !orgId) return
    setBusy(true)
    try {
      const result = await post('/api/orgs/datasets', {
        orgId,
        action: 'add-address-field',
        datasetId: dataset.$id,
        sourceField,
      })
      setDraft((previous) => ({ ...previous, slugField: String(result['fieldId'] ?? '') }))
      enqueueSnackbar(
        result['truncated']
          ? `Gave ${result['filled']} records a page address — run it again for the rest`
          : `Gave ${result['filled']} records a page address`,
        { variant: 'success' },
      )
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [dataset, sourceField, orgId, post, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (screenKind !== 'template') {
      const accepted = await confirm({
        title: 'Make this page a record template?',
        description:
          `Each record gets its own page at ${recordPagePath(draft.base || 'base', 'address')}, ` +
          'drawn by this design. This page stops answering at its own address and no ' +
          'longer counts toward your plan’s pages.',
        confirmationText: 'Make it a template',
      })
        // The dialog rejects on cancel.
        .then(() => true)
        .catch(() => false)
      if (!accepted) return
    }
    setBusy(true)
    try {
      if (screenKind !== 'template') {
        await post('/api/hosts/screens', {
          action: 'convert',
          hostId,
          id: screenId,
          kind: 'template',
        })
      }
      await post('/api/hosts/record-pages', { action: 'save', hostId, screenId, ...draft })
      enqueueSnackbar('Record pages saved', { variant: 'success' })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [screenKind, confirm, draft, post, hostId, screenId, enqueueSnackbar])

  const handleRemove = useCallback(async () => {
    const accepted = await confirm({
      title: 'Stop serving record pages?',
      description:
        `Every page under /${current?.base ?? ''}/ stops answering. This page stays a ` +
        'template; make it a page again from the Pages list.',
      confirmationText: 'Stop serving them',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await post('/api/hosts/record-pages', { action: 'remove', hostId, screenId })
      enqueueSnackbar('Record pages removed', { variant: 'success' })
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [confirm, current?.base, post, hostId, screenId, enqueueSnackbar])

  if (planReady && !checkEntitlement(org as never, 'dataStore')) {
    return (
      <Stack spacing={1}>
        <Typography variant="subtitle2">{'Record pages'}</Typography>
        <Typography variant="caption" color="text.secondary">
          {'Serve this page once per record of a dataset — a page for every service or ' +
            'location. Record pages need a Starter plan or higher.'}
        </Typography>
      </Stack>
    )
  }

  const ready = preview.status === 'ready' ? preview : null
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{'Record pages'}</Typography>
      <Typography variant="caption" color="text.secondary">
        {current
          ? `This page is the template of every record of ${
              dataset ? datasetDisplayName(dataset) : 'its dataset'
            }, each at /${current.base}/ and its page address. Inside it, ` +
            '{{item.field}} fills in from the record.'
          : 'Serve this page once per record of a dataset, each at its own address — ' +
            '/services/roofing. Inside it, {{item.field}} fills in from the record, as in ' +
            'a repeat.'}
      </Typography>
      <TextField
        select
        size="small"
        label="Dataset"
        value={draft.datasetId}
        onChange={(event) =>
          setDraft({ ...EMPTY_DRAFT, base: draft.base, datasetId: event.target.value })
        }
        helperText="Only datasets shared with this site are listed"
      >
        {datasets.map((one) => (
          <MenuItem key={one.$id} value={one.$id}>
            {datasetDisplayName(one) || one.$id}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        label="Address"
        value={draft.base}
        onChange={(event) => setDraft({ ...draft, base: event.target.value })}
        error={Boolean(baseRefusal)}
        helperText={
          baseRefusal ??
          (draft.base
            ? `Records are served at /${draft.base.replace(/^\/+|\/+$/g, '')}/their-address`
            : 'One or more segments, like services or services/residential')
        }
        slotProps={{
          input: { startAdornment: <InputAdornment position="start">/</InputAdornment> },
        }}
      />
      {model && addressFields.length ? (
        <TextField
          select
          size="small"
          label="Page address field"
          value={draft.slugField}
          onChange={(event) => setDraft({ ...draft, slugField: event.target.value })}
          helperText="Each record's own segment of its address"
        >
          {addressFields.map((fieldId) => (
            <MenuItem key={fieldId} value={fieldId}>
              {model.fields[fieldId]?.name ?? fieldId}
            </MenuItem>
          ))}
        </TextField>
      ) : model ? (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {'This dataset has no Page address field yet. Make one from a text field: ' +
              'every record gets an address made from its value (Roof Repair → ' +
              'roof-repair), and new records get one as they are added. A record keeps its ' +
              'address when it is renamed.'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label="Make addresses from"
              value={sourceField}
              onChange={(event) => setSourceField(event.target.value)}
              sx={{ flex: 1 }}
            >
              {textFields.map((fieldId) => (
                <MenuItem key={fieldId} value={fieldId}>
                  {model.fields[fieldId]?.name ?? fieldId}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              variant="outlined"
              onClick={handleAddAddresses}
              disabled={!sourceField || busy}
            >
              {'Make addresses'}
            </Button>
          </Stack>
        </Stack>
      ) : null}
      {model
        ? FIELD_PICKERS.map((picker) => (
            <TextField
              key={picker.key}
              select
              size="small"
              label={picker.label}
              value={draft[picker.key] ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, [picker.key]: event.target.value || undefined })
              }
              helperText={picker.helper}
              // The empty choice is a real one — "use the default" — so it is
              // shown rather than leaving the field looking blank.
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            >
              <MenuItem value="">{picker.empty}</MenuItem>
              {model.order.map((fieldId) => (
                <MenuItem key={fieldId} value={fieldId}>
                  {model.fields[fieldId]?.name ?? fieldId}
                </MenuItem>
              ))}
            </TextField>
          ))
        : null}
      {ready ? (
        <TextField
          select
          size="small"
          label="Preview with"
          value={ready.selectedId}
          onChange={(event) => ready.select(event.target.value)}
          helperText={`The canvas draws this page for one of ${ready.choices.length}${
            ready.choices.length >= 100 ? '+' : ''
          } records`}
        >
          {ready.choices.map((choice) => (
            <MenuItem key={choice.id} value={choice.id}>
              {choice.label}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="outlined"
          onClick={handleSave}
          disabled={
            busy || !draft.datasetId || !draft.base || !draft.slugField || Boolean(baseRefusal)
          }
        >
          {current ? 'Save record pages' : 'Serve record pages'}
        </Button>
        {current ? (
          <Button size="small" color="error" onClick={handleRemove} disabled={busy}>
            {'Stop serving'}
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}

export default RecordTemplateSection
