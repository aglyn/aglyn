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
  createResourceUid,
  HOST_EVENT_TYPES,
  SITE_EVENT_TYPES,
  summarizeVariantStats,
  validateExperiment,
  type ExperimentTarget,
  type ExperimentVariant,
  type HostExperiment,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Chip,
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
} from 'firebase/firestore'
import { useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useHostActivityLogger from '../hooks/use-host-activity-logger'

export interface HostExperimentsCardProps {
  hostId: string
}

type ExperimentDraft = HostExperiment & { $id?: string }

const STATUS_COLORS: Record<string, 'default' | 'success' | 'info' | 'warning'> =
  {
    draft: 'default',
    running: 'success',
    paused: 'warning',
    done: 'info',
  }

/**
 * Experiments manager (AGL-252): create screen/section/email A/B tests
 * with weighted variants and a conversion goal; start/pause/finish them
 * and read exposures/conversions per variant. Business tier
 * (`ab-testing`).
 */
export function HostExperimentsCard(props: HostExperimentsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { tenant } = useCurrentTenant()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const entitled = hasEntitlement('ab-testing', tenant)

  const { data: experimentDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'experiments'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const experiments: ExperimentDraft[] = [...(experimentDocs ?? [])]
    .filter((experiment: any) => !experiment.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screenOptions = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt)
    .map((screen: any) => ({
      id: screen.$id as string,
      name: (screen.displayName ?? screen.name ?? screen.$id) as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const [editor, setEditor] = useState<ExperimentDraft | null>(null)
  const [results, setResults] = useState<{
    experiment: ExperimentDraft
    stats: Record<string, { exposures?: number; conversions?: number }>
  } | null>(null)

  const patch = (partial: Partial<ExperimentDraft>) =>
    setEditor((previous) =>
      previous ? { ...previous, ...partial } : previous,
    )
  const patchVariant = (index: number, partial: Partial<ExperimentVariant>) =>
    setEditor((previous) =>
      previous
        ? {
            ...previous,
            variants: previous.variants.map((variant, index2) =>
              index2 === index ? { ...variant, ...partial } : variant,
            ),
          }
        : previous,
    )

  const newExperiment = (): ExperimentDraft => ({
    name: '',
    status: 'draft',
    target: 'screen' as ExperimentTarget,
    variants: [
      { id: 'a', name: 'A (control)', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ],
    goal: { event: 'formSubmission' },
  })

  const handleSave = async () => {
    if (!editor) return
    const problem = validateExperiment(editor)
    if (problem) {
      return void enqueueSnackbar(problem, {
        variant: 'warning',
        persist: false,
      })
    }
    const id = editor.$id ?? createResourceUid()
    const { $id: _ignored, ...payload } = editor
    try {
      await setDoc(
        doc(firestore, 'hosts', hostId, 'experiments', id),
        {
          ...JSON.parse(JSON.stringify(payload)),
          updatedAt: Timestamp.now(),
          ...(editor.$id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      enqueueSnackbar('Experiment saved', {
        variant: 'success',
        persist: false,
      })
      logActivity(editor.$id ? 'Updated experiment' : 'Created experiment', {
        type: 'content',
        id,
        name: editor.name,
      })
      setEditor(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    }
  }

  const setStatus = async (
    experiment: ExperimentDraft,
    status: HostExperiment['status'],
    winnerVariantId?: string,
  ) => {
    if (!experiment.$id) return
    await setDoc(
      doc(firestore, 'hosts', hostId, 'experiments', experiment.$id),
      {
        status,
        ...(winnerVariantId ? { winnerVariantId } : {}),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    )
    logActivity(`Experiment ${status}`, {
      type: 'content',
      id: experiment.$id,
      name: experiment.name,
    })
  }

  const handleDelete = async (experiment: ExperimentDraft) => {
    if (!experiment.$id) return
    const accepted = await confirm({
      title: 'Delete experiment?',
      description: `"${experiment.name}" and its results are removed.`,
      confirmationButtonProps: { color: 'error' },
    })
    if (!accepted) return
    await deleteDoc(
      doc(firestore, 'hosts', hostId, 'experiments', experiment.$id),
    )
  }

  const openResults = async (experiment: ExperimentDraft) => {
    if (!experiment.$id) return
    const snapshot = await getDocs(
      collection(
        firestore,
        'hosts',
        hostId,
        'experiments',
        experiment.$id,
        'stats',
      ),
    )
    const stats: Record<string, any> = {}
    snapshot.forEach((entry) => {
      stats[entry.id] = entry.data()
    })
    setResults({ experiment, stats })
  }

  return (
    <CardDisplay
      header="Experiments"
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {!entitled ? (
        <Alert severity="info">
          {'A/B experiments are included in the Business plan — see ' +
            'Billing to upgrade.'}
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {'Split traffic between variants of a screen, a section, or a ' +
              'campaign email, and measure which one converts. Visitors ' +
              'are assigned deterministically, so everyone keeps seeing ' +
              'the same variant.'}
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="secondary"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setEditor(newExperiment())}
          >
            {'New experiment'}
          </Button>
          {experiments.length === 0 ? null : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Experiment'}</TableCell>
                  <TableCell>{'Tests'}</TableCell>
                  <TableCell>{'Status'}</TableCell>
                  <TableCell align="right">{'Actions'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {experiments.map((experiment) => (
                  <TableRow key={experiment.$id}>
                    <TableCell>{experiment.name}</TableCell>
                    <TableCell>
                      {experiment.target}
                      {` · ${(experiment.variants ?? []).length} variants`}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={STATUS_COLORS[experiment.status] ?? 'default'}
                        label={experiment.status}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {experiment.status === 'running' ? (
                        <Button
                          size="small"
                          onClick={() => void setStatus(experiment, 'paused')}
                        >
                          {'Pause'}
                        </Button>
                      ) : experiment.status !== 'done' ? (
                        <Button
                          size="small"
                          color="secondary"
                          onClick={() => void setStatus(experiment, 'running')}
                        >
                          {'Start'}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        onClick={() => void openResults(experiment)}
                      >
                        {'Results'}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => setEditor({ ...experiment })}
                      >
                        {'Edit'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => void handleDelete(experiment)}
                      >
                        {'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Stack>
      )}

      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editor?.$id ? 'Edit experiment' : 'New experiment'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            size="small"
            label="Name"
            required
            value={editor?.name ?? ''}
            onChange={(event) => patch({ name: event.target.value })}
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              select
              size="small"
              label="Tests"
              value={editor?.target ?? 'screen'}
              onChange={(event) =>
                patch({ target: event.target.value as ExperimentTarget })
              }
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="screen">{'A screen'}</MenuItem>
              <MenuItem value="section">{'A section'}</MenuItem>
              <MenuItem value="email">{'An email'}</MenuItem>
            </TextField>
            {editor?.target !== 'email' ? (
              <TextField
                select
                size="small"
                label="Screen"
                value={editor?.screenId ?? ''}
                onChange={(event) => patch({ screenId: event.target.value })}
                sx={{ flex: 1 }}
              >
                {screenOptions.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
          {editor?.target === 'section' ? (
            <TextField
              size="small"
              label="Element id"
              helperText="The canvas element the variants swap (from the besigner)"
              value={editor?.nodeId ?? ''}
              onChange={(event) => patch({ nodeId: event.target.value })}
            />
          ) : null}
          <TextField
            select
            size="small"
            label="Conversion goal"
            value={editor?.goal?.event ?? 'formSubmission'}
            onChange={(event) =>
              patch({ goal: { ...editor?.goal, event: event.target.value } })
            }
            sx={{ maxWidth: 260 }}
          >
            {[...HOST_EVENT_TYPES, ...SITE_EVENT_TYPES].map((eventType) => (
              <MenuItem key={eventType} value={eventType}>
                {eventType}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="subtitle2">{'Variants'}</Typography>
          {(editor?.variants ?? []).map((variant, index) => (
            <Stack key={variant.id} direction="row" spacing={1}>
              <TextField
                size="small"
                label={`Variant ${variant.id.toUpperCase()}`}
                value={variant.name ?? ''}
                onChange={(event) =>
                  patchVariant(index, { name: event.target.value })
                }
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                type="number"
                label="Weight"
                value={variant.weight ?? 1}
                onChange={(event) =>
                  patchVariant(index, { weight: Number(event.target.value) })
                }
                sx={{ width: 100 }}
              />
            </Stack>
          ))}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditor(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={() => void handleSave()}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(results)}
        onClose={() => setResults(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{`Results — ${results?.experiment.name ?? ''}`}</DialogTitle>
        <DialogContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Variant'}</TableCell>
                <TableCell>{'Exposures'}</TableCell>
                <TableCell>{'Conversions'}</TableCell>
                <TableCell>{'Rate'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(results?.experiment.variants ?? []).map((variant) => {
                const summary = summarizeVariantStats(
                  results?.stats[variant.id] ?? {},
                )
                return (
                  <TableRow key={variant.id}>
                    <TableCell>
                      {variant.name ?? variant.id.toUpperCase()}
                      {results?.experiment.winnerVariantId === variant.id
                        ? ' 🏆'
                        : ''}
                    </TableCell>
                    <TableCell>{summary.exposures}</TableCell>
                    <TableCell>{summary.conversions}</TableCell>
                    <TableCell>
                      {`${(summary.rate * 100).toFixed(1)}%`}
                    </TableCell>
                    <TableCell align="right">
                      {results?.experiment.status !== 'done' ? (
                        <Button
                          size="small"
                          onClick={() => {
                            if (results) {
                              void setStatus(
                                results.experiment,
                                'done',
                                variant.id,
                              )
                              setResults(null)
                            }
                          }}
                        >
                          {'Pick winner'}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setResults(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostExperimentsCard.displayName = 'HostExperimentsCard'

export default HostExperimentsCard
