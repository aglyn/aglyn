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

import { CRM_COLLECTIONS, isPipelineArchived } from '@aglyn/aglyn'
import {
  mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline,
  mdiFormatListBulleted,
  mdiPencilOutline,
  mdiStarOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import {
  activePipelines,
  newPipelineDocument,
  PIPELINE_NAME_MAX,
  type PipelineDoc,
  pipelineArchiveRefusal,
  pipelineNameProblem,
  sortedStages,
} from '../model/deal-board-model'
import { PipelineStagesDialog } from './pipeline-stages-dialog'

export interface PipelinesDialogProps {
  open: boolean
  onClose: () => void
  orgId: string
  /** The site this console is viewed from — provenance on a pipeline created here. */
  hostId: string
  /** Every pipeline the viewer may read, archived ones included. */
  pipelines: PipelineDoc[]
  /** The listener's verdict on the rows, for the stale-seed guard. */
  fromCache: boolean
  unreadable: boolean
  /** The scope tokens the open-deal count is filtered by — the viewer's own. */
  visibleToTokens: readonly string[]
  /** What a pipeline created here is stamped with. */
  createTokens: readonly string[]
}

/**
 * The org's pipelines (AGL-2620): list, create, rename, set as default,
 * archive, and a door into each one's stages.
 *
 * ## Org documents, scoped like every CRM row
 *
 * A pipeline lives at `orgs/{orgId}/pipelines` and is stamped with the same
 * scope tokens a contact captured on this site would carry, so an agency's
 * client sees its own pipelines and the org-wide ones — the same rule the
 * board reads by. Nothing here assumes one site: the tokens come in as
 * props from `useCrmScope`, and an org-level mount passes its own.
 *
 * ## What each verb writes
 *
 * - **New pipeline** — one `addDoc` of `newPipelineDocument`: a COPY of the
 *   default stages, not the default, active. The field sits UNDER the list.
 * - **Rename** — `name` on the one document, refused when an active
 *   pipeline already has the name (`pipelineNameProblem`).
 * - **Set as default** — one batch: the flag on, and off on every other
 *   document that had it. A batch rather than two updates because two
 *   defaults for the length of a network round trip is a board that opens
 *   on either.
 * - **Archive** — `archivedAt: now`, after the server has counted the
 *   pipeline's OPEN deals and `pipelineArchiveRefusal` has agreed; the
 *   count is taken at the click because a deal can be created into the
 *   pipeline from another tab meanwhile. The default pipeline and the last
 *   active one refuse. **Restore** clears the stamp.
 * - **Edit stages** — opens the stages dialog for that pipeline, unchanged.
 */
export function PipelinesDialog(props: PipelinesDialogProps) {
  const {
    open,
    onClose,
    orgId,
    hostId,
    pipelines,
    fromCache,
    unreadable,
    visibleToTokens,
    createTokens,
  } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: user } = useUser()
  const [busy, setBusy] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [editingStages, setEditingStages] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNewName('')
    setRenaming(null)
    setEditingStages(null)
  }, [open])

  const pipelineRef = useCallback(
    (id: string) => doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.pipelines, id),
    [firestore, orgId],
  )

  /** One guarded write, reported as a snackbar either way. */
  const run = useCallback(
    async (key: string, write: () => Promise<void>, done: string) => {
      setBusy(key)
      try {
        const verdict = await writeGuardedBySeed(
          { subject: 'pipeline', unreadable, fromCache },
          write,
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
          return false
        }
        enqueueSnackbar(done, { variant: 'success', persist: false })
        return true
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
        return false
      } finally {
        setBusy(null)
      }
    },
    [unreadable, fromCache, enqueueSnackbar],
  )

  const newProblem = newName.trim() ? pipelineNameProblem(newName, pipelines) : null
  const handleCreate = useCallback(async () => {
    if (!user?.uid || newProblem || !newName.trim()) return
    const ok = await run(
      'create',
      async () => {
        await addDoc(
          collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.pipelines),
          newPipelineDocument(newName, {
            visibleTo: createTokens,
            hostId,
            uid: user.uid,
            nowMs: Date.now(),
          }),
        )
      },
      'Pipeline created',
    )
    if (ok) setNewName('')
  }, [user, newProblem, newName, run, firestore, orgId, createTokens, hostId])

  const handleRename = useCallback(async () => {
    if (!renaming) return
    const problem = pipelineNameProblem(renaming.name, pipelines, renaming.id)
    if (problem) {
      enqueueSnackbar(problem, { variant: 'warning', persist: false })
      return
    }
    const ok = await run(
      `rename:${renaming.id}`,
      async () => {
        await updateDoc(pipelineRef(renaming.id), {
          name: renaming.name.trim().slice(0, PIPELINE_NAME_MAX),
          updatedAt: new Date(),
        })
      },
      'Pipeline renamed',
    )
    if (ok) setRenaming(null)
  }, [renaming, pipelines, enqueueSnackbar, run, pipelineRef])

  const handleSetDefault = useCallback(
    (pipeline: PipelineDoc) =>
      void run(
        `default:${pipeline.$id}`,
        async () => {
          const batch = writeBatch(firestore)
          const now = new Date()
          for (const entry of pipelines) {
            if (entry.$id === pipeline.$id) {
              batch.update(pipelineRef(entry.$id), { isDefault: true, updatedAt: now })
            } else if (entry.isDefault) {
              batch.update(pipelineRef(entry.$id), { isDefault: false, updatedAt: now })
            }
          }
          await batch.commit()
        },
        `${pipeline.name} is now the default pipeline`,
      ),
    [run, firestore, pipelines, pipelineRef],
  )

  const handleArchive = useCallback(
    async (pipeline: PipelineDoc) => {
      setBusy(`archive:${pipeline.$id}`)
      let openDeals: number
      try {
        const snapshot = await getCountFromServer(
          query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals),
            where('visibleTo', 'array-contains-any', [...visibleToTokens]),
            where('pipelineId', '==', pipeline.$id),
            where('status', '==', 'open'),
          ),
        )
        openDeals = snapshot.data().count
      } catch (error) {
        console.error(error)
        setBusy(null)
        enqueueSnackbar('The open deals in this pipeline could not be counted, so it stays.', {
          variant: 'error',
          allowDuplicate: true,
        })
        return
      }
      const refusal = pipelineArchiveRefusal(pipeline, pipelines, openDeals)
      if (refusal) {
        setBusy(null)
        enqueueSnackbar(refusal, { variant: 'warning', persist: false })
        return
      }
      await run(
        `archive:${pipeline.$id}`,
        async () => {
          await updateDoc(pipelineRef(pipeline.$id), {
            archivedAt: Date.now(),
            isDefault: false,
            updatedAt: new Date(),
          })
        },
        `${pipeline.name} archived`,
      )
    },
    [firestore, orgId, visibleToTokens, pipelines, run, pipelineRef, enqueueSnackbar],
  )

  const handleRestore = useCallback(
    (pipeline: PipelineDoc) => {
      const problem = pipelineNameProblem(pipeline.name, pipelines, pipeline.$id)
      if (problem) {
        enqueueSnackbar(`${problem} Rename it after restoring, or rename the other one first.`, {
          variant: 'warning',
          persist: false,
        })
        return
      }
      void run(
        `restore:${pipeline.$id}`,
        async () => {
          await updateDoc(pipelineRef(pipeline.$id), { archivedAt: null, updatedAt: new Date() })
        },
        `${pipeline.name} restored`,
      )
    },
    [pipelines, enqueueSnackbar, run, pipelineRef],
  )

  const actionsFor = (pipeline: PipelineDoc): RowActionsMenuItem[] => {
    const archived = isPipelineArchived(pipeline)
    const working = busy !== null
    return archived
      ? [
          {
            key: 'restore',
            label: 'Restore',
            icon: <MdiIcon path={mdiArchiveArrowUpOutline.path} size={0.8} />,
            disabled: working,
            onClick: () => handleRestore(pipeline),
          },
        ]
      : [
          {
            key: 'stages',
            label: 'Edit stages',
            icon: <MdiIcon path={mdiFormatListBulleted.path} size={0.8} />,
            disabled: working,
            onClick: () => setEditingStages(pipeline.$id),
          },
          {
            key: 'rename',
            label: 'Rename',
            icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
            disabled: working,
            onClick: () => setRenaming({ id: pipeline.$id, name: pipeline.name }),
          },
          {
            key: 'default',
            label: 'Set as default',
            icon: <MdiIcon path={mdiStarOutline.path} size={0.8} />,
            disabled: working || Boolean(pipeline.isDefault),
            disabledReason: pipeline.isDefault ? 'Already the default' : undefined,
            onClick: () => handleSetDefault(pipeline),
          },
          {
            key: 'archive',
            label: 'Archive',
            icon: <MdiIcon path={mdiArchiveArrowDownOutline.path} size={0.8} />,
            disabled: working,
            destructive: true,
            onClick: () => void handleArchive(pipeline),
          },
        ]
  }

  const active = activePipelines(pipelines)
  const archived = pipelines.filter((pipeline) => isPipelineArchived(pipeline))
  const stagesPipeline = editingStages
    ? (pipelines.find((pipeline) => pipeline.$id === editingStages) ?? null)
    : null

  const row = (pipeline: PipelineDoc) => {
    const stageCount = sortedStages(pipeline).filter((stage) => stage.kind === 'open').length
    const isRenaming = renaming?.id === pipeline.$id
    return (
      <Stack
        key={pipeline.$id}
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', py: 0.5 }}
        data-pipeline-id={pipeline.$id}
      >
        {isRenaming ? (
          <>
            <TextField
              size="small"
              label="Name"
              value={renaming.name}
              autoFocus
              onChange={(event) => setRenaming({ id: pipeline.$id, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleRename()
                }
                if (event.key === 'Escape') setRenaming(null)
              }}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { maxLength: PIPELINE_NAME_MAX } }}
            />
            <Button size="small" onClick={() => setRenaming(null)} disabled={busy !== null}>
              {'Cancel'}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={busy !== null || !renaming.name.trim()}
              onClick={() => void handleRename()}
            >
              {'Save'}
            </Button>
          </>
        ) : (
          <>
            <Stack sx={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
              <Typography variant="body2" noWrap>
                {pipeline.name || 'Untitled pipeline'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {`${stageCount} open ${stageCount === 1 ? 'stage' : 'stages'}`}
              </Typography>
            </Stack>
            {pipeline.isDefault && !isPipelineArchived(pipeline) ? (
              <Chip size="small" color="primary" variant="outlined" label="Default" />
            ) : null}
            {isPipelineArchived(pipeline) ? <Chip size="small" label="Archived" /> : null}
            <RowActionsMenu items={actionsFor(pipeline)} label={pipeline.name} />
          </>
        )}
      </Stack>
    )
  }

  return (
    <>
      <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
        <DialogTitle>{'Pipelines'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {'A pipeline is one way your business sells — its own stages, its own board. ' +
                'New deals land in the default pipeline unless the drawer picks another.'}
            </Typography>
            {active.length ? (
              active.map(row)
            ) : (
              <Typography variant="body2" color="text.secondary">
                {'No active pipeline. Create one below.'}
              </Typography>
            )}
            {archived.length ? (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {'Archived — kept so closed deals still show their stages'}
                </Typography>
                {archived.map(row)}
              </>
            ) : null}
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                size="small"
                label="New pipeline"
                placeholder="Renewals"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !newName.trim() || newProblem) return
                  event.preventDefault()
                  void handleCreate()
                }}
                error={Boolean(newProblem)}
                helperText={newProblem ?? 'Starts with the default stages, which you can then edit.'}
                sx={{ flex: 1 }}
                slotProps={{ htmlInput: { maxLength: PIPELINE_NAME_MAX } }}
              />
              <Button
                variant="contained"
                disabled={busy !== null || !newName.trim() || Boolean(newProblem) || !user?.uid}
                onClick={() => void handleCreate()}
                sx={{ mt: 0.25 }}
              >
                {'Create'}
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy !== null}>
            {'Done'}
          </Button>
        </DialogActions>
      </Dialog>
      <PipelineStagesDialog
        open={Boolean(stagesPipeline)}
        onClose={() => setEditingStages(null)}
        orgId={orgId}
        pipeline={stagesPipeline}
        fromCache={fromCache}
        unreadable={unreadable}
        visibleToTokens={visibleToTokens}
      />
    </>
  )
}
PipelinesDialog.displayName = 'PipelinesDialog'

export default PipelinesDialog
