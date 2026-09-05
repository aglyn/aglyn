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

import { CRM_COLLECTIONS, type CrmDealStage } from '@aglyn/aglyn'
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiDeleteOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import {
  addStage,
  moveStage,
  type PipelineDoc,
  removeStage,
  renameStage,
  setStageProbability,
  sortedStages,
  stageRemovalRefusal,
  stagesProblem,
} from '../model/deal-board-model'

export interface PipelineStagesDialogProps {
  open: boolean
  onClose: () => void
  orgId: string
  pipeline: PipelineDoc | null
  /** The listener's verdict on the pipeline row the draft is seeded from. */
  fromCache: boolean
  unreadable: boolean
  /** The scope tokens the deal count is filtered by — the viewer's own. */
  visibleToTokens: string[]
}

/**
 * The pipeline's stages, edited as one draft and saved as one write.
 *
 * ## One document, one save
 *
 * The stages live as an array on the pipeline document, so every edit here
 * is a local change to a copy and the Save button writes the whole array
 * back. A per-row write would be a pipeline that is half renamed when the
 * network drops, and — because the board draws columns from this array —
 * a board that redraws between every keystroke for everybody looking at it.
 *
 * ## A stage with deals in it stays
 *
 * Removing a stage is the one edit that can strand data: every deal in it
 * would point at a stage id the pipeline no longer has, sit in no column,
 * and be worth nothing to the forecast. So the remove button first asks the
 * server how many deals are in the stage — an aggregate count over the same
 * scoped query the board reads — and refuses with that number when it is
 * not zero. The count is taken at the moment of the click rather than held
 * from when the dialog opened, because a deal can be dragged in from the
 * board in another tab meanwhile.
 *
 * Won and Lost cannot be removed or reordered; their probabilities are
 * fixed by what they mean.
 */
export function PipelineStagesDialog(props: PipelineStagesDialogProps) {
  const { open, onClose, orgId, pipeline, fromCache, unreadable, visibleToTokens } =
    props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [stages, setStages] = useState<CrmDealStage[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [counting, setCounting] = useState<string | null>(null)

  // Re-seeded on every open, so the draft starts from the stored stages
  // rather than from whatever the last session left unsaved.
  useEffect(() => {
    if (!open) return
    setStages(sortedStages(pipeline))
    setNewName('')
  }, [open, pipeline])

  const handleRemove = useCallback(
    async (stageId: string) => {
      if (!pipeline) return
      setCounting(stageId)
      try {
        const snapshot = await getCountFromServer(
          query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals),
            where('visibleTo', 'array-contains-any', visibleToTokens),
            where('pipelineId', '==', pipeline.$id),
            where('stageId', '==', stageId),
          ),
        )
        const refusal = stageRemovalRefusal(stages, stageId, snapshot.data().count)
        if (refusal) {
          enqueueSnackbar(refusal, { variant: 'warning', persist: false })
          return
        }
        setStages((current) => removeStage(current, stageId))
      } catch (error) {
        console.error(error)
        enqueueSnackbar('The deals in this stage could not be counted, so it stays.', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setCounting(null)
      }
    },
    [firestore, orgId, pipeline, visibleToTokens, stages, enqueueSnackbar],
  )

  const problem = stagesProblem(stages)

  const handleSave = useCallback(async () => {
    if (!pipeline || problem) return
    setBusy(true)
    try {
      const verdict = await writeGuardedBySeed(
        { subject: 'pipeline', unreadable, fromCache },
        async () => {
          await updateDoc(
            doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.pipelines, pipeline.$id),
            { stages, updatedAt: new Date() },
          )
        },
      )
      if (!verdict.ok) {
        enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
        return
      }
      enqueueSnackbar('Stages saved', { variant: 'success', persist: false })
      onClose()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [firestore, orgId, pipeline, problem, stages, unreadable, fromCache, enqueueSnackbar, onClose])

  const openCount = stages.filter((stage) => stage.kind === 'open').length

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{pipeline ? `${pipeline.name} stages` : 'Stages'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {'The probability is the chance a deal in that stage closes, which ' +
              'is what the weighted value multiplies by. Won is always 100% and ' +
              'Lost always 0%.'}
          </Typography>
          {stages.map((stage, index) => {
            const isOpen = stage.kind === 'open'
            const first = index === 0
            const lastOpen = index === openCount - 1
            return (
              <Stack
                key={stage.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <TextField
                  size="small"
                  label="Stage"
                  value={stage.name}
                  onChange={(event) =>
                    setStages((current) =>
                      renameStage(current, stage.id, event.target.value),
                    )
                  }
                  sx={{ flex: 1 }}
                  slotProps={{ htmlInput: { maxLength: 60 } }}
                />
                <TextField
                  size="small"
                  label="Probability"
                  type="number"
                  value={stage.probability}
                  disabled={!isOpen}
                  onChange={(event) =>
                    setStages((current) =>
                      setStageProbability(current, stage.id, event.target.value),
                    )
                  }
                  sx={{ width: 120 }}
                  slotProps={{
                    htmlInput: { min: 0, max: 100, step: 5 },
                    input: { endAdornment: '%' },
                  }}
                />
                {isOpen ? (
                  <>
                    <Tooltip title="Move up">
                      <span>
                        <IconButton
                          size="small"
                          disabled={first}
                          onClick={() =>
                            setStages((current) => moveStage(current, stage.id, 'up'))
                          }
                        >
                          <MdiIcon path={mdiArrowUp.path} size={0.8} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Move down">
                      <span>
                        <IconButton
                          size="small"
                          disabled={lastOpen}
                          onClick={() =>
                            setStages((current) => moveStage(current, stage.id, 'down'))
                          }
                        >
                          <MdiIcon path={mdiArrowDown.path} size={0.8} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Remove stage">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={counting === stage.id || busy}
                          onClick={() => void handleRemove(stage.id)}
                        >
                          <MdiIcon path={mdiDeleteOutline.path} size={0.8} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                ) : (
                  <Chip
                    size="small"
                    label={stage.kind === 'won' ? 'Won' : 'Lost'}
                    color={stage.kind === 'won' ? 'success' : 'default'}
                    sx={{ minWidth: 120 }}
                  />
                )}
              </Stack>
            )
          })}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              label="New stage"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !newName.trim()) return
                event.preventDefault()
                setStages((current) => addStage(current, newName))
                setNewName('')
              }}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
            <Button
              disabled={!newName.trim()}
              onClick={() => {
                setStages((current) => addStage(current, newName))
                setNewName('')
              }}
            >
              {'Add stage'}
            </Button>
          </Stack>
          {problem ? (
            <Typography variant="caption" color="error">
              {problem}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !pipeline || Boolean(problem)}
          onClick={() => void handleSave()}
        >
          {'Save stages'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
PipelineStagesDialog.displayName = 'PipelineStagesDialog'

export default PipelineStagesDialog
