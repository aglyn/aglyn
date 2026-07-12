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

import { type AglynTenant, checkEntitlement, createResourceUid, HOST_EVENT_TYPES, SITE_EVENT_TYPES } from '@aglyn/aglyn'
import { compareVariants, summarizeVariantStats, validateExperiment, type ExperimentTarget, type ExperimentVariant, type HostExperiment } from '../model'
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
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
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
import { useFirestore, useFirestoreCollection, useHostActivityLogger } from '@aglyn/tenant-feature-instance'

export interface HostExperimentsCardProps {
  hostId: string
  /** Resolved entitlement source (AGL-395). */
  tenant?: Partial<AglynTenant>
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
  const { tenant } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const entitled = checkEntitlement(tenant, 'abTesting')

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
  // Versions of the screen under test (AGL-253): variants pin one each.
  const { data: versionDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(
          firestore,
          'hosts',
          hostId,
          'screens',
          editor?.screenId ?? '-none-',
          'versions',
        ),
        limit(50),
      ),
    [firestore, hostId, editor?.screenId],
    { idField: '$id' },
  )
  const versionOptions = [...(versionDocs ?? [])]
    .filter((version: any) => !version.deletedAt)
    .map((version: any) => ({
      id: version.$id as string,
      name: (version.name ?? version.displayName ?? version.$id) as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
          // Clearing the end date / auto-winner must overwrite — a
          // merge-set keeps absent keys otherwise (AGL-273).
          endAtMs: editor.endAtMs ?? null,
          autoWinner: editor.autoWinner ?? null,
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
    // One running experiment per screen (AGL-265): the page runner only
    // serves the first, so a second would silently never split traffic.
    if (status === 'running' && experiment.screenId) {
      const clash = experiments.find(
        (candidate) =>
          candidate.$id !== experiment.$id &&
          candidate.status === 'running' &&
          candidate.screenId === experiment.screenId,
      )
      if (clash) {
        return void enqueueSnackbar(
          `"${clash.name}" is already running on that screen — pause or ` +
            'finish it first',
          { variant: 'warning', persist: false },
        )
      }
    }
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
          {/* Schedule + auto-winner (AGL-273). */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <TextField
              size="small"
              type="datetime-local"
              label="Ends at (optional)"
              slotProps={{ inputLabel: { shrink: true } }}
              value={
                editor?.endAtMs
                  ? new Date(
                      editor.endAtMs -
                        new Date().getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ''
              }
              onChange={(event) => {
                const ms = event.target.value
                  ? new Date(event.target.value).getTime()
                  : undefined
                patch({
                  endAtMs: Number.isFinite(ms as number) ? ms : undefined,
                })
              }}
              helperText="Past this, visitors get the default"
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={Boolean(editor?.autoWinner)}
                  onChange={(event) =>
                    patch({
                      autoWinner: event.target.checked
                        ? { minExposures: 200, confidence: 0.95 }
                        : undefined,
                    })
                  }
                />
              }
              label="Auto-declare winner"
            />
            {editor?.autoWinner ? (
              <>
                <TextField
                  size="small"
                  type="number"
                  label="Min exposures / variant"
                  value={editor.autoWinner.minExposures}
                  onChange={(event) =>
                    patch({
                      autoWinner: {
                        ...editor.autoWinner!,
                        minExposures: Number(event.target.value),
                      },
                    })
                  }
                  sx={{ width: 170 }}
                />
                <TextField
                  select
                  size="small"
                  label="Confidence"
                  value={String(editor.autoWinner.confidence)}
                  onChange={(event) =>
                    patch({
                      autoWinner: {
                        ...editor.autoWinner!,
                        confidence: Number(event.target.value),
                      },
                    })
                  }
                  sx={{ width: 120 }}
                >
                  <MenuItem value="0.9">{'90%'}</MenuItem>
                  <MenuItem value="0.95">{'95%'}</MenuItem>
                  <MenuItem value="0.99">{'99%'}</MenuItem>
                </TextField>
              </>
            ) : null}
          </Stack>
          <Typography variant="subtitle2">{'Variants'}</Typography>
          {(editor?.variants ?? []).map((variant, index) => (
            <Stack key={variant.id} spacing={1}>
              <Stack direction="row" spacing={1}>
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
                {editor?.target !== 'email' ? (
                  // Screen/section variants pin a screen version
                  // (AGL-253); empty = the published version.
                  <TextField
                    select
                    size="small"
                    label="Version"
                    value={variant.versionId ?? ''}
                    onChange={(event) =>
                      patchVariant(index, { versionId: event.target.value })
                    }
                    sx={{ minWidth: 160 }}
                  >
                    <MenuItem value="">{'Published (control)'}</MenuItem>
                    {versionOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {option.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
              </Stack>
              {editor?.target === 'email' ? (
                // Email variants override the campaign copy (AGL-255).
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    label="Subject override"
                    value={variant.subject ?? ''}
                    onChange={(event) =>
                      patchVariant(index, { subject: event.target.value })
                    }
                    sx={{ width: 220 }}
                  />
                  <TextField
                    size="small"
                    label="Body override"
                    value={variant.body ?? ''}
                    onChange={(event) =>
                      patchVariant(index, { body: event.target.value })
                    }
                    multiline
                    maxRows={3}
                    sx={{ flex: 1 }}
                  />
                </Stack>
              ) : null}
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
        <DialogTitle>
          {`Results — ${results?.experiment.name ?? ''}`}
          {results?.experiment.autoCompleted ? (
            // The track pipeline decided this one (AGL-273).
            <Chip
              size="small"
              color="success"
              label="Auto-completed"
              sx={{ ml: 1 }}
            />
          ) : null}
        </DialogTitle>
        <DialogContent>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Variant'}</TableCell>
                <TableCell>{'Exposures'}</TableCell>
                <TableCell>{'Conversions'}</TableCell>
                <TableCell>{'Rate'}</TableCell>
                <TableCell>{'vs control'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(results?.experiment.variants ?? []).map((variant, index) => {
                const summary = summarizeVariantStats(
                  results?.stats[variant.id] ?? {},
                )
                // Lift + z-test confidence vs the first variant (AGL-265).
                const control = results?.experiment.variants[0]
                const comparison =
                  index > 0 && control
                    ? compareVariants(
                        results?.stats[control.id] ?? {},
                        results?.stats[variant.id] ?? {},
                      )
                    : null
                const leader =
                  summary.exposures > 0 &&
                  (results?.experiment.variants ?? []).every((other) => {
                    const otherSummary = summarizeVariantStats(
                      results?.stats[other.id] ?? {},
                    )
                    return summary.rate >= otherSummary.rate
                  })
                return (
                  <TableRow key={variant.id} selected={leader}>
                    <TableCell>
                      {variant.name ?? variant.id.toUpperCase()}
                      {results?.experiment.winnerVariantId === variant.id
                        ? ' 🏆'
                        : leader
                          ? ' ▲'
                          : ''}
                    </TableCell>
                    <TableCell>{summary.exposures}</TableCell>
                    <TableCell>{summary.conversions}</TableCell>
                    <TableCell>
                      {`${(summary.rate * 100).toFixed(1)}%`}
                    </TableCell>
                    <TableCell>
                      {comparison
                        ? `${
                            comparison.lift != null
                              ? `${comparison.lift >= 0 ? '+' : ''}${(comparison.lift * 100).toFixed(0)}%`
                              : '—'
                          }${
                            comparison.confidence != null
                              ? ` · ${(comparison.confidence * 100).toFixed(0)}% conf.`
                              : ' · needs data'
                          }`
                        : 'control'}
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
