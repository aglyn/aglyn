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
import {
  ICON_VARIANT_DATE_TIME,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_EDIT,
} from '@aglyn/shared-data-enums'
import {
  HelpTip,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { docsHelp } from '../constants/docs-links'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import { buildRoute, Route } from '../constants/route-links'
import { useHostSubdomain } from '../components/host-id-provider'
import { useOrgSlug } from '../hooks/use-org-scope'
import useCurrentOrg from '../hooks/use-current-org'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'

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
    const orgSlug = useOrgSlug()
    const host = useHostSubdomain()
    const router = useRouter()
    const { enqueueSnackbar } = useSnackbar()
    const { queueLoading } = useLoading()
    const { org } = useCurrentOrg()
    const { confirm } = useConfirmationContext()
    const [open, setOpen] = useState(false)
    // Name dialog serves both "create with a name" (AGL-59) and rename.
    const [nameDialog, setNameDialog] = useState<
      { mode: 'create' } | { mode: 'rename'; targetId: string } | null
    >(null)
    const [nameValue, setNameValue] = useState('')
    // Schedule dialog (AGL-61): datetime-local string for the picked time.
    const [scheduleFor, setScheduleFor] = useState<string | null>(null)
    const [scheduleAt, setScheduleAt] = useState('')

    const parentCollection = parent.kind === 'screen' ? 'screens' : 'layouts'
    const parentPath = ['hosts', hostId, parentCollection, parent.id] as const
    // No orderBy: Firestore drops docs missing the ordered field, and the
    // oldest version docs predate `createdAt`. Sort client-side instead.
    const { data: versionDocs } = useFirestoreCollection<any>(
      () => query(collection(firestore, ...parentPath, 'versions'), limit(100)),
      [firestore, hostId, parentCollection, parent.id],
      { idField: '$id' },
    )
    // Parent doc carries the pending publish schedule (AGL-61).
    const { data: parentDoc } = useFirestoreDoc<any>(
      () => doc(firestore, ...parentPath),
      [firestore, hostId, parentCollection, parent.id],
      { idField: '$id' },
    )
    const schedule =
      parentDoc?.publishSchedule?.status === 'pending'
        ? parentDoc.publishSchedule
        : undefined
    const versions = [...(versionDocs ?? [])].sort(
      (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
    )

    const besignerUrl = useCallback(
      (targetVersionId: string) =>
        parent.kind === 'screen'
          ? buildRoute(Route.SCREEN_BESIGNER, { orgSlug, 
              host,
              screenId: parent.id,
              versionId: targetVersionId,
            })
          : buildRoute(Route.LAYOUT_BESIGNER, { orgSlug, 
              host,
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
          // Publish-time normalization (AGL-193): legacy {{name}} tokens in
          // the version being published rewrite to rename-safe id form, so
          // actively-maintained content converges without the AGL-188
          // script. Best-effort — a failure never blocks the publish.
          try {
            const [variableDocs, functionDocs] = await Promise.all([
              getDocs(
                query(
                  collection(firestore, 'hosts', hostId, 'variables'),
                  limit(1000),
                ),
              ),
              getDocs(
                query(
                  collection(firestore, 'hosts', hostId, 'functions'),
                  limit(1000),
                ),
              ),
            ])
            const toLookup = (docs: typeof variableDocs) => {
              const lookup: Record<string, { name?: string; $id?: string }> =
                {}
              for (const snapshot of docs.docs) {
                const name = snapshot.get('name')
                if (!name || snapshot.get('deletedAt')) continue
                lookup[String(name)] = { name, $id: snapshot.id }
                lookup[snapshot.id] = { name, $id: snapshot.id }
              }
              return lookup
            }
            const versionRef = doc(
              firestore,
              ...parentPath,
              'versions',
              targetVersionId,
            )
            const versionSnapshot = await getDoc(versionRef)
            const nodes = versionSnapshot.get('nodes')
            if (nodes) {
              const { value, changed } = Aglyn.rewriteBindingTokensDeep(
                nodes,
                toLookup(variableDocs),
                toLookup(functionDocs),
              )
              if (changed) await updateDoc(versionRef, { nodes: value })
            }
          } catch (error) {
            console.warn('Publish-time token normalization skipped', error)
          }
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
      [firestore, hostId, parentPath, queueLoading, enqueueSnackbar],
    )

    const handleCreateVersion = useCallback(() => {
      if (!hasEntitlement('versioning', org)) {
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
      const currentName =
        (versionDocs ?? []).find((version: any) => version.$id === versionId)
          ?.displayName ?? versionId
      setNameValue(`Copy of ${currentName}`)
      setNameDialog({ mode: 'create' })
    }, [org, enqueueSnackbar, versionDocs, versionId])

    const handleRename = useCallback(
      (targetId: string, currentName: string) => () => {
        setNameValue(currentName)
        setNameDialog({ mode: 'rename', targetId })
      },
      [],
    )

    const handleNameConfirm = useCallback(async () => {
      const dialog = nameDialog
      if (!dialog || !nameValue.trim()) return
      const dequeue = queueLoading()
      try {
        const timestamp = Timestamp.now()
        if (dialog.mode === 'rename') {
          await updateDoc(
            doc(firestore, ...parentPath, 'versions', dialog.targetId),
            { displayName: nameValue.trim(), updatedAt: timestamp },
          )
          setNameDialog(null)
          return void enqueueSnackbar('Version renamed', {
            variant: 'success',
            persist: false,
          })
        }
        const source = await getDoc(
          doc(firestore, ...parentPath, 'versions', versionId),
        )
        if (!source.exists()) throw new Error('Source version missing')
        const newVersionId = Aglyn.createResourceUid()
        await setDoc(doc(firestore, ...parentPath, 'versions', newVersionId), {
          ...source.data(),
          displayName: nameValue.trim(),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        enqueueSnackbar(`Version "${nameValue.trim()}" created`, {
          variant: 'success',
          persist: false,
        })
        setNameDialog(null)
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
      nameDialog,
      nameValue,
      firestore,
      parentPath,
      versionId,
      queueLoading,
      enqueueSnackbar,
      router,
      besignerUrl,
    ])

    const handleDelete = useCallback(
      (targetId: string, name: string) => async () => {
        const confirmed = await confirm({
          title: 'Delete this version?',
          description:
            `"${name}" will be permanently deleted. ` +
            'This cannot be undone.',
          confirmationText: 'Delete',
          confirmationButtonProps: { color: 'error' },
        })
          .then(() => true)
          .catch(() => false)
        if (!confirmed) return
        const dequeue = queueLoading()
        try {
          await deleteDoc(doc(firestore, ...parentPath, 'versions', targetId))
          // Clear a pending schedule that pointed at the deleted version.
          if (schedule?.versionId === targetId) {
            await updateDoc(doc(firestore, ...parentPath), {
              publishSchedule: deleteField(),
              updatedAt: Timestamp.now(),
            })
          }
          enqueueSnackbar('Version deleted', {
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
      [confirm, firestore, parentPath, schedule, queueLoading, enqueueSnackbar],
    )

    const handleScheduleOpen = useCallback(
      (targetId: string) => () => {
        if (!hasEntitlement('scheduled-publishing', org)) {
          return void enqueueSnackbar(
            'Scheduled publishing requires a Business plan — see Billing',
            { variant: 'warning', persist: false },
          )
        }
        // Default one hour out, in the datetime-local format (local time).
        const initial = new Date(Date.now() + 60 * 60 * 1000)
        initial.setSeconds(0, 0)
        const pad = (value: number) => String(value).padStart(2, '0')
        setScheduleAt(
          `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-` +
            `${pad(initial.getDate())}T${pad(initial.getHours())}:` +
            `${pad(initial.getMinutes())}`,
        )
        setScheduleFor(targetId)
      },
      [org, enqueueSnackbar],
    )

    const handleScheduleConfirm = useCallback(async () => {
      if (!scheduleFor || !scheduleAt) return
      const publishAt = new Date(scheduleAt)
      if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) {
        return void enqueueSnackbar('Pick a future date and time', {
          variant: 'warning',
          persist: false,
        })
      }
      const dequeue = queueLoading()
      try {
        await updateDoc(doc(firestore, ...parentPath), {
          publishSchedule: {
            versionId: scheduleFor,
            publishAt: Timestamp.fromDate(publishAt),
            status: 'pending',
            createdAt: Timestamp.now(),
          },
          updatedAt: Timestamp.now(),
        })
        enqueueSnackbar(
          `Scheduled to publish ${publishAt.toLocaleString()}`,
          { variant: 'success', persist: false },
        )
        setScheduleFor(null)
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
      scheduleFor,
      scheduleAt,
      firestore,
      parentPath,
      queueLoading,
      enqueueSnackbar,
    ])

    const handleScheduleCancel = useCallback(async () => {
      const dequeue = queueLoading()
      try {
        await updateDoc(doc(firestore, ...parentPath), {
          publishSchedule: deleteField(),
          updatedAt: Timestamp.now(),
        })
        enqueueSnackbar('Scheduled publication canceled', {
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
    }, [firestore, parentPath, queueLoading, enqueueSnackbar])

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
            <Box
              component="span"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              {'Versions'}
              <HelpTip
                {...docsHelp('screens', {
                  anchor: '#versions--scheduled-publishing',
                  title: 'Versions & scheduled publishing',
                  excerpt:
                    'Every publish creates a version you can view, restore, or schedule to go live at a set time.',
                })}
                sx={{ fontSize: '0.7em' }}
              />
            </Box>
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
                          {schedule?.versionId === version.$id ? (
                            <Chip
                              label={`Publishes ${
                                schedule.publishAt
                                  ?.toDate?.()
                                  .toLocaleString() ?? ''
                              }`}
                              color="info"
                              size="small"
                              variant="outlined"
                              onDelete={handleScheduleCancel}
                            />
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
                        <Tooltip
                          title={
                            isPublished
                              ? 'This version is already live — create a new version to schedule it'
                              : 'Publish this version automatically at a date/time'
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              color="secondary"
                              disabled={isPublished}
                              onClick={handleScheduleOpen(version.$id)}
                              aria-label="schedule publish"
                              startIcon={
                                <MdiIcon
                                  fontSize="inherit"
                                  path={ICON_VARIANT_DATE_TIME.path}
                                />
                              }
                            >
                              {'Schedule'}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title="Rename">
                          <IconButton
                            size="small"
                            onClick={handleRename(
                              version.$id,
                              version.displayName ?? version.$id,
                            )}
                            aria-label="rename version"
                          >
                            <MdiIcon
                              fontSize="inherit"
                              path={ICON_VARIANT_MODIFY_EDIT.path}
                            />
                          </IconButton>
                        </Tooltip>
                        <Tooltip
                          title={
                            isPublished
                              ? 'The published version cannot be deleted'
                              : isCurrent
                                ? 'Close this version before deleting it'
                                : 'Delete'
                          }
                        >
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={isPublished || isCurrent}
                              onClick={handleDelete(
                                version.$id,
                                version.displayName ?? version.$id,
                              )}
                              aria-label="delete version"
                            >
                              <MdiIcon
                                fontSize="inherit"
                                path={ICON_VARIANT_MODIFY_DELETE.path}
                              />
                            </IconButton>
                          </span>
                        </Tooltip>
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
        <Dialog
          open={Boolean(nameDialog)}
          onClose={() => setNameDialog(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>
            {nameDialog?.mode === 'rename' ? 'Rename version' : 'New version'}
          </DialogTitle>
          <DialogContent>
            <TextField
              label="Version name"
              value={nameValue}
              onChange={(event) => setNameValue(event.target.value)}
              size="small"
              fullWidth
              autoFocus
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setNameDialog(null)}>{'Cancel'}</Button>
            <Button
              variant="contained"
              color="secondary"
              disabled={!nameValue.trim()}
              onClick={handleNameConfirm}
            >
              {nameDialog?.mode === 'rename' ? 'Rename' : 'Create version'}
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog
          open={Boolean(scheduleFor)}
          onClose={() => setScheduleFor(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{'Schedule publication'}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {'The selected version becomes the published version at the ' +
                'chosen time (applied on the next site refresh after it ' +
                'passes). Only one pending schedule exists per document.'}
            </Typography>
            <TextField
              label="Publish at"
              type="datetime-local"
              value={scheduleAt}
              onChange={(event) => setScheduleAt(event.target.value)}
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setScheduleFor(null)}>{'Cancel'}</Button>
            <Button
              variant="contained"
              color="secondary"
              disabled={!scheduleAt}
              onClick={handleScheduleConfirm}
            >
              {'Schedule'}
            </Button>
          </DialogActions>
        </Dialog>
      </>
    )
  },
)

export default BesignerVersionsComponent
