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

import * as Aglyn from '@aglyn/aglyn'
import { ICON_VARIANT_MENU_DOWN } from '@aglyn/shared-data-enums'
import { MdiIcon, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Chip,
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
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getDoc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import { useRouter } from 'next/router'
import { useCallback, useState } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'
import { hasEntitlement } from '../constants/entitlements'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentTenant from '../hooks/use-current-tenant'

export interface BesignerVersionsProps {
  hostId: string
  /** Parent document holding the versions subcollection. */
  parent: { kind: 'screen' | 'layout'; id: string }
  /** Version currently open in the besigner. */
  versionId: string
  /** Published version pointer from the parent doc (`versionId` field). */
  publishedVersionId?: string
}

/**
 * App-bar version dropdown (current version id/name) + version list dialog:
 * open any version's besigner, publish a version (moves the parent doc's
 * `versionId` pointer the tenant renders through), or snapshot the SAVED
 * state of the open version as a new one. Creating a version requires the
 * canvas to be saved first — the snapshot copies the stored doc verbatim.
 */
export const BesignerVersionsComponent = observer(
  function BesignerVersionsComponent(props: BesignerVersionsProps) {
    const { hostId, parent, versionId, publishedVersionId } = props
    const firestore = useFirestore()
    const router = useRouter()
    const { enqueueSnackbar } = useSnackbar()
    const { queueLoading } = useLoading()
    const { tenant } = useCurrentTenant()
    const [open, setOpen] = useState(false)

    const parentCollection = parent.kind === 'screen' ? 'screens' : 'layouts'
    const parentPath = ['hosts', hostId, parentCollection, parent.id] as const
    // No orderBy: Firestore drops docs missing the ordered field, and the
    // oldest version docs predate `createdAt`. Sort client-side instead.
    const { data: versionDocs } = useFirestoreCollectionData<any>(
      query(collection(firestore, ...parentPath, 'versions'), limit(100)),
      { idField: '$id' },
    )
    const versions = [...(versionDocs ?? [])].sort(
      (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
    )

    const besignerUrl = useCallback(
      (targetVersionId: string) =>
        parent.kind === 'screen'
          ? buildRoute(Route.SCREEN_BESIGNER, {
              hostId,
              screenId: parent.id,
              versionId: targetVersionId,
            })
          : buildRoute(Route.LAYOUT_BESIGNER, {
              hostId,
              layoutId: parent.id,
              versionId: targetVersionId,
            }),
      [hostId, parent],
    )

    const handleOpenVersion = useCallback(
      (targetVersionId: string) => () => {
        setOpen(false)
        if (targetVersionId !== versionId) {
          void router.push(besignerUrl(targetVersionId))
        }
      },
      [router, besignerUrl, versionId],
    )

    const handlePublish = useCallback(
      (targetVersionId: string) => async () => {
        const dequeue = queueLoading()
        try {
          await updateDoc(doc(firestore, ...parentPath), {
            versionId: targetVersionId,
            updatedAt: Timestamp.now(),
          })
          enqueueSnackbar(`Version ${targetVersionId} published`, {
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
          dequeue()
        }
      },
      [firestore, parentPath, queueLoading, enqueueSnackbar],
    )

    const handleCreateVersion = useCallback(async () => {
      if (!hasEntitlement('versioning', tenant)) {
        return enqueueSnackbar(
          'Versioning requires a Pro plan — see Billing to upgrade',
          { variant: 'warning', persist: false },
        )
      }
      // Snapshot the SAVED doc, so unsaved canvas edits are never silently
      // captured (or lost) — require a save first.
      if (!Aglyn.canvas.isInitialSame) {
        return enqueueSnackbar('Save the canvas before creating a version', {
          variant: 'warning',
          persist: false,
        })
      }
      const dequeue = queueLoading()
      try {
        const source = await getDoc(
          doc(firestore, ...parentPath, 'versions', versionId),
        )
        if (!source.exists()) throw new Error('Source version missing')
        const newVersionId = Aglyn.createResourceUid()
        const timestamp = Timestamp.now()
        await setDoc(doc(firestore, ...parentPath, 'versions', newVersionId), {
          ...source.data(),
          displayName: `Copy of ${source.get('displayName') ?? versionId}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        enqueueSnackbar('New version created', {
          variant: 'success',
          persist: false,
        })
        setOpen(false)
        void router.push(besignerUrl(newVersionId))
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    }, [
      firestore,
      parentPath,
      versionId,
      tenant,
      queueLoading,
      enqueueSnackbar,
      router,
      besignerUrl,
    ])

    const current = (versions ?? []).find(
      (version: any) => version.$id === versionId,
    )
    const label = current?.displayName ?? versionId

    return (
      <>
        <Button
          id="besigner-version-menu"
          size="small"
          color="inherit"
          onClick={() => setOpen(true)}
          endIcon={<MdiIcon path={ICON_VARIANT_MENU_DOWN.path} />}
          sx={{
            maxWidth: 220,
            '& .MuiButton-endIcon': { marginLeft: 0 },
          }}
        >
          <Typography variant="body2" component="span" noWrap>
            {label}
          </Typography>
        </Button>
        <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            {'Versions'}
            <Button
              variant="outlined"
              color="secondary"
              size="small"
              onClick={handleCreateVersion}
            >
              {'New version'}
            </Button>
          </DialogTitle>
          <DialogContent>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Version'}</TableCell>
                  <TableCell>{'Created'}</TableCell>
                  <TableCell>{'Updated'}</TableCell>
                  <TableCell align="right">{'Actions'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(versions ?? []).map((version: any) => {
                  const isCurrent = version.$id === versionId
                  const isPublished = version.$id === publishedVersionId
                  return (
                    <TableRow key={version.$id} selected={isCurrent} hover>
                      <TableCell>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <Typography variant="body2" component="span">
                            {version.displayName ?? version.$id}
                          </Typography>
                          {version.displayName ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              component="span"
                            >
                              {version.$id}
                            </Typography>
                          ) : null}
                          {isPublished ? (
                            <Chip
                              label="Published"
                              color="success"
                              size="small"
                            />
                          ) : null}
                          {isCurrent ? (
                            <Chip label="Open" size="small" variant="outlined" />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {version.createdAt?.toDate?.().toLocaleString() ?? '--'}
                      </TableCell>
                      <TableCell>
                        {version.updatedAt?.toDate?.().toLocaleString() ?? '--'}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Button
                          size="small"
                          disabled={isCurrent}
                          onClick={handleOpenVersion(version.$id)}
                        >
                          {'Open'}
                        </Button>
                        <Button
                          size="small"
                          color="secondary"
                          disabled={isPublished}
                          onClick={handlePublish(version.$id)}
                        >
                          {'Publish'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{'Close'}</Button>
          </DialogActions>
        </Dialog>
      </>
    )
  },
)

export default BesignerVersionsComponent
