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
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import {
  DataTableComponent,
} from '@aglyn/shared-ui-jsx/components/data-table.component'
import { GridActionsCellItem, type GridColDef } from '@mui/x-data-grid'
import {
  mdiBookmarkOutline,
  mdiPencilOutline,
  mdiStorefrontOutline,
  mdiTrashCanOutline,
  mdiVectorSquare,
} from '@aglyn/shared-data-mdi'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import * as Aglyn from '@aglyn/aglyn'
import {
  collection,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useHostSubdomain } from './host-id-provider'
import { useCallback, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import SaveAsTemplateDialog, {
  type SaveAsTemplateSource,
} from './templates/save-as-template-dialog.component'

export interface HostComponentsCardProps {
  hostId: string
}

/**
 * Reusable-component management (user request 2026-07-07): rename/describe
 * and delete host component definitions. Deletion is a soft delete
 * (`deletedAt`), so already-published tenant pages keep grafting until
 * their next revalidate and nothing hard-breaks; the element drawer and
 * tenant compose both filter deleted definitions. Content editing lands
 * with the marketplace component editor.
 */
export function HostComponentsCard(props: HostComponentsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: componentDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const components = [...(componentDocs ?? [])]
    .filter((definition: any) => !definition.deletedAt)
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  const [editor, setEditor] = useState<{
    id: string
    name: string
    description: string
  } | null>(null)

  // Marketplace publish (AGL-44): posts to the server-side publish API —
  // sanitization/allowlisting happen there; clients cannot create listings.
  const { data: user } = useUser()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const [publisher, setPublisher] = useState<{
    id: string
    name: string
    description: string
    category: string
    price: string
    busy?: boolean
  } | null>(null)
  // Save as template (AGL-668) — same dialog as screens and layouts.
  const [saveTemplateFor, setSaveTemplateFor] =
    useState<SaveAsTemplateSource | null>(null)

  const handlePublishConfirm = useCallback(async () => {
    if (!publisher || !publisher.name.trim() || publisher.busy) return
    setPublisher((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/marketplace/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          componentId: publisher.id,
          displayName: publisher.name.trim(),
          description: publisher.description.trim(),
          category: publisher.category.trim(),
          priceUsd: Number(publisher.price) || 0,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: response.status === 412 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      setPublisher(null)
      enqueueSnackbar(`Published v${payload.version} to the marketplace`, {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setPublisher((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [publisher, user, hostId, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!editor || !editor.name.trim()) return
    await updateDoc(
      doc(firestore, 'hosts', hostId, 'components', editor.id),
      {
        displayName: editor.name.trim(),
        description: editor.description.trim(),
        updatedAt: Timestamp.now(),
      },
    )
    setEditor(null)
    enqueueSnackbar('Component updated', { variant: 'success', persist: false })
  }, [editor, firestore, hostId, enqueueSnackbar])

  /**
   * Open a component in its own besigner (AGL-680).
   *
   * Components that predate the standalone editor have no `versionId` —
   * they were only ever edited from inside a screen. Opening one creates
   * version 1 from whatever is published on the doc, so nothing needs
   * migrating up front and a component nobody opens stays untouched.
   */
  const [opening, setOpening] = useState<string | null>(null)
  const handleOpenInBesigner = useCallback(
    async (definition: any) => {
      if (opening) return
      setOpening(definition.$id)
      try {
        let versionId = definition.versionId as string | undefined
        if (!versionId) {
          versionId = Aglyn.createResourceUid()
          const timestamp = Timestamp.now()
          await setDoc(
            doc(
              firestore,
              'hosts',
              hostId,
              'components',
              definition.$id,
              'versions',
              versionId,
            ),
            {
              componentId: definition.$id,
              hostId,
              displayName: 'Initial version',
              rootId: definition.rootId ?? null,
              nodes: definition.nodes ?? {},
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          )
          await updateDoc(
            doc(firestore, 'hosts', hostId, 'components', definition.$id),
            { versionId, updatedAt: timestamp },
          )
        }
        router.push(
          buildRoute(Route.COMPONENT_BESIGNER, {
            orgSlug,
            host,
            componentId: definition.$id,
            versionId,
          }),
        )
      } catch (error) {
        enqueueSnackbar(
          error instanceof Error ? error.message : 'Could not open the component',
          { variant: 'error', allowDuplicate: true },
        )
      } finally {
        setOpening(null)
      }
    },
    [opening, firestore, hostId, orgSlug, host, router, enqueueSnackbar],
  )

  const handleDelete = useCallback(
    (definition: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this component?',
        description:
          `"${definition.displayName ?? definition.$id}" disappears from ` +
          'Your components; existing instances on screens render as empty ' +
          'placeholders after the next publish.',
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'components', definition.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Component deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar],
  )

  // Same column/action shape the layouts and screens lists use (AGL-693),
  // so the four artifact listings read as one product rather than three.
  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      renderCell: ({ id, value }: any) => (
        <AppLink
          href={buildRoute(Route.COMPONENT_DETAILS, {
            orgSlug,
            host,
            componentId: id as string,
          })}
        >
          {value || (id as string)}
        </AppLink>
      ),
    },
    { field: '$id', headerName: 'ID', type: 'string', minWidth: 150 },
    {
      field: 'description',
      headerName: 'Description',
      flex: 1,
      minWidth: 240,
      type: 'string',
      // Blank reads as a rendering gap; '--' reads as "nothing here",
      // which is what the screens list has always shown.
      valueFormatter: (value: any) => value || '--',
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      flex: 1,
      minWidth: 170,
      type: 'date',
      // MUI X v9 passes the value positionally. The old v6 object form
      // (`({ value })`) silently destructures undefined off a Date and every
      // row renders '--', which is what these columns were doing.
      valueGetter: (value: any) => value?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      flex: 1,
      minWidth: 170,
      type: 'date',
      // MUI X v9 passes the value positionally. The old v6 object form
      // (`({ value })`) silently destructures undefined off a Date and every
      // row renders '--', which is what these columns were doing.
      valueGetter: (value: any) => value?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 190,
      getActions: ({ id, row }: any) => {
        const definition = { ...row, $id: id as string }
        return [
          <GridActionsCellItem
            key="action-besigner"
            icon={<MdiIcon path={mdiVectorSquare.path} />}
            label="Open in besigner"
            disabled={opening === definition.$id}
            onClick={() => void handleOpenInBesigner(definition)}
          />,
          <GridActionsCellItem
            key="action-rename"
            icon={<MdiIcon path={mdiPencilOutline.path} />}
            label="Rename"
            onClick={() =>
              setEditor({
                id: definition.$id,
                name: definition.displayName ?? '',
                description: definition.description ?? '',
              })
            }
          />,
          <GridActionsCellItem
            key="action-save-template"
            icon={<MdiIcon path={mdiBookmarkOutline.path} />}
            label="Save as template"
            showInMenu
            onClick={() =>
              setSaveTemplateFor({
                kind: 'component',
                displayName: definition.displayName ?? '',
                // Unlike screens and layouts, a component definition holds
                // its own nodes — there is no version doc to fetch.
                loadNodes: async () =>
                  definition.nodes
                    ? { nodes: definition.nodes, rootId: definition.rootId }
                    : null,
              })
            }
          />,
          <GridActionsCellItem
            key="action-publish"
            icon={<MdiIcon path={mdiStorefrontOutline.path} />}
            label="Publish to marketplace"
            showInMenu
            onClick={() =>
              setPublisher({
                id: definition.$id,
                name: definition.displayName ?? '',
                description: definition.description ?? '',
                category: '',
                price: '',
              })
            }
          />,
          <GridActionsCellItem
            key="action-delete"
            icon={<MdiIcon path={mdiTrashCanOutline.path} />}
            label="Delete"
            showInMenu
            onClick={handleDelete(definition)}
          />,
        ]
      },
    },
  ]

  // No card header: the page header already says "Reusable Components",
  // and screens/layouts do not repeat it either (AGL-693).
  return (
    <CardDisplay>
      <DataTableComponent
        rowHeight={TABLE_ROW_HEIGHT}
        getRowId={(row) => row.$id}
        columns={columns}
        noRowsLabel="No reusable components yet — use Create component above, or save one from the besigner"
        rows={components}
        // The whole row opens the detail page (AGL-693); action cells stop
        // propagation so a menu click never navigates underneath it.
        onRowClick={({ id }) =>
          router.push(
            buildRoute(Route.COMPONENT_DETAILS, {
              orgSlug,
              host,
              componentId: id as string,
            }),
          )
        }
        sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        pageSizeOptions={[5, 10, 15]}
        pagination
      />
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Edit component'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="Name"
            value={editor?.name ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={editor?.description ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!editor?.name.trim()}
            onClick={handleSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(publisher)}
        onClose={() => (publisher?.busy ? null : setPublisher(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Publish to marketplace'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Publishes a snapshot as a public listing under your ' +
              'marketplace profile. Re-publishing releases a new version; ' +
              'sites that installed it choose when to update.'}
          </Typography>
          <TextField
            label="Listing name"
            value={publisher?.name ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
          />
          <TextField
            label="Description"
            value={publisher?.description ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <TextField
            label="Category"
            placeholder="e.g. Hero, Footer, Pricing"
            value={publisher?.category ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, category: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Price (USD)"
            placeholder="0 = free"
            helperText="Paid listings need payouts set up on your marketplace profile"
            value={publisher?.price ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev
                  ? {
                      ...prev,
                      price: event.target.value.replace(/[^0-9]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button
            disabled={publisher?.busy}
            onClick={() => setPublisher(null)}
          >
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!publisher?.name.trim() || publisher?.busy}
            onClick={handlePublishConfirm}
          >
            {publisher?.busy ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
      <SaveAsTemplateDialog
        hostId={hostId}
        source={saveTemplateFor}
        onClose={() => setSaveTemplateFor(null)}
      />
    </CardDisplay>
  )
}
HostComponentsCard.displayName = 'HostComponentsCard'

export default HostComponentsCard
