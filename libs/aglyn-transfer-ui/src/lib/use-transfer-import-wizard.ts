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

/**
 * The import wizard's controller: the draft, what the server said, and the
 * moves between steps. Kept apart from the screens so each step renders
 * from one object and the order of server calls lives in one place.
 *
 * Entering a step loads what it shows — the values step re-reads the file
 * under the mapping, the conflicts and review steps re-plan it — so going
 * back, changing a choice and coming forward again always shows the
 * consequence of the change, never a stale answer.
 */

import { transferUndoAvailable } from '@aglyn/aglyn/data-transfer'
import type {
  TransferField,
  TransferJob,
  TransferRowResult,
  TransferWarningClass,
} from '@aglyn/aglyn/data-transfer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  TransferAnalysis,
  TransferClient,
  TransferFileSettings,
  TransferDryRun,
  TransferResourceInfo,
  TransferResults,
} from './transfer-client'
import {
  TRANSFER_WIZARD_STEPS,
  browserTransferWizardStorage,
  createTransferWizardDraft,
  draftPolicy,
  draftReadChoices,
  proposeMissingPicklistChoices,
  transferWizardStorageKey,
} from './transfer-wizard-state'
import type {
  TransferWizardDraft,
  TransferWizardStorage,
} from './transfer-wizard-state'
import {
  orderTransferWizardSteps,
  transferWizardStepsFor,
} from './transfer-wizard-steps'
import type { TransferWizardExtraStep } from './transfer-wizard-steps'

export interface UseTransferImportWizardOptions {
  client: TransferClient
  resource: string
  /** Resume this job: its draft is loaded and the wizard opens where it left off. */
  jobId?: string | null
  /** Told the job id once a file is uploaded, so the host can put it in the address. */
  onJobChange?(jobId: string | null): void
  storage?: TransferWizardStorage
  extraSteps?: readonly TransferWizardExtraStep[]
  now?: () => number
}

/** Where applying stands. */
export interface TransferApplyState {
  running: boolean
  rowsDone: number
  rowCount: number
  failures: TransferRowResult[]
  done: boolean
}

export interface TransferImportWizardController {
  client: TransferClient
  resourceKey: string
  info: TransferResourceInfo | null
  fields: TransferField[]
  fieldLabel(fieldId: string): string
  draft: TransferWizardDraft
  setDraft(update: (draft: TransferWizardDraft) => TransferWizardDraft): void
  steps: { id: string; label: string; extra?: TransferWizardExtraStep }[]
  stepIndex: number
  job: TransferJob | null
  analysis: TransferAnalysis | null
  planResponse: TransferDryRun | null
  results: TransferResults | null
  apply: TransferApplyState
  busy: boolean
  error: string | null
  clearError(): void
  /** Uploads a file and reads its header row; moves to the mapping step. */
  upload(file: {
    fileName: string
    text: string
    bytes: number
    settings: TransferFileSettings
  }): Promise<void>
  /** Re-reads the file under the current choices (values and matches). */
  reanalyze(draft?: TransferWizardDraft): Promise<void>
  /** Re-plans under the current choices. */
  replan(draft?: TransferWizardDraft): Promise<void>
  goTo(stepId: string): Promise<void>
  next(): Promise<void>
  back(): void
  startApply(): Promise<void>
  pauseApply(): void
  refreshResults(): Promise<void>
  /** Whether the import may still be undone. */
  undoOpen: boolean
  addField(field: TransferField): void
  now(): number
}

const message = (reason: unknown, fallback: string): string =>
  reason instanceof Error && reason.message ? reason.message : fallback

const BEFORE_APPLY = new Set([
  'upload',
  'mapping',
  'values',
  'matching',
  'conflicts',
  'dryRun',
])

/** The controller (see the block header). */
export function useTransferImportWizard(
  options: UseTransferImportWizardOptions,
): TransferImportWizardController {
  const { client, resource, onJobChange } = options
  const storage = options.storage ?? browserTransferWizardStorage
  const now = useCallback(() => (options.now ?? Date.now)(), [options.now])
  const [info, setInfo] = useState<TransferResourceInfo | null>(null)
  const [draft, setDraftState] = useState<TransferWizardDraft>(
    createTransferWizardDraft,
  )
  const [job, setJob] = useState<TransferJob | null>(null)
  const [analysis, setAnalysis] = useState<TransferAnalysis | null>(null)
  const [planResponse, setPlanResponse] = useState<TransferDryRun | null>(
    null,
  )
  const [results, setResults] = useState<TransferResults | null>(null)
  const [apply, setApply] = useState<TransferApplyState>({
    running: false,
    rowsDone: 0,
    rowCount: 0,
    failures: [],
    done: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftRef = useRef(draft)
  const running = useRef(false)
  const requestSeq = useRef(0)
  const planRef = useRef<TransferDryRun | null>(null)

  const extra = useMemo(
    () => [...(options.extraSteps ?? []), ...transferWizardStepsFor(resource)],
    [options.extraSteps, resource],
  )
  const steps = useMemo(
    () => orderTransferWizardSteps(TRANSFER_WIZARD_STEPS, extra),
    [extra],
  )
  const fields = useMemo(() => info?.fields ?? [], [info])
  const byId = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields],
  )
  const fieldLabel = useCallback(
    (fieldId: string) => byId.get(fieldId)?.label ?? fieldId,
    [byId],
  )
  const defaultKeys = useMemo(
    () =>
      info?.defaultMatchKeys ?? info?.matchKeys.map((key) => key.fieldId) ?? [],
    [info],
  )

  const setDraft = useCallback(
    (update: (current: TransferWizardDraft) => TransferWizardDraft) => {
      const next = update(draftRef.current)
      draftRef.current = next
      setDraftState(next)
      if (next.jobId)
        storage.save(transferWizardStorageKey(resource, next.jobId), next)
    },
    [storage, resource],
  )

  const guard = useCallback(
    async <T>(
      work: () => Promise<T>,
      fallback: string,
    ): Promise<T | undefined> => {
      setBusy(true)
      setError(null)
      try {
        return await work()
      } catch (reason) {
        setError(message(reason, fallback))
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const analyze = useCallback(
    async (current: TransferWizardDraft, withChoices: boolean) => {
      if (!current.jobId) return null
      const seq = ++requestSeq.current
      const result = await client.analyze(
        withChoices
          ? { jobId: current.jobId, ...draftReadChoices(current, defaultKeys) }
          : { jobId: current.jobId },
      )
      if (seq !== requestSeq.current) return null
      setAnalysis(result)
      setJob(result.job)
      return result
    },
    [client, defaultKeys],
  )

  const plan = useCallback(
    async (current: TransferWizardDraft) => {
      if (!current.jobId || !info) return null
      const seq = ++requestSeq.current
      const response = await client.plan({
        jobId: current.jobId,
        ...draftReadChoices(current, defaultKeys),
        policy: draftPolicy(current, info.locked),
        extras: current.extras,
      })
      if (seq !== requestSeq.current) return null
      // An acknowledgement covers the warnings as they were read: a class
      // whose count changed is asked again.
      const before = new Map(
        planRef.current?.plan.warnings.map((warning) => [
          warning.class,
          warning.count,
        ]) ?? [],
      )
      const changed = response.plan.warnings
        .filter((warning) => before.get(warning.class) !== warning.count)
        .map((warning) => warning.class)
      if (changed.length)
        setDraft((d) => ({
          ...d,
          acknowledged: d.acknowledged.filter(
            (entry) => !changed.includes(entry),
          ),
        }))
      planRef.current = response
      setPlanResponse(response)
      setJob(response.job)
      return response
    },
    [client, info, defaultKeys, setDraft],
  )

  const loadResults = useCallback(
    async (jobId: string) => {
      const loaded = await client.results({ jobId })
      setResults(loaded)
      setJob(loaded.job)
      return loaded
    },
    [client],
  )

  /** Loads what a step shows. */
  const load = useCallback(
    async (stepId: string, current: TransferWizardDraft) => {
      if (stepId === 'mapping') {
        const result = await analyze(current, false)
        // A job resumed with no saved draft starts from the proposals, as a fresh upload does.
        if (result && !Object.keys(current.mapping).length)
          setDraft((d) => ({ ...d, mapping: { ...result.proposal.mapping } }))
      } else if (stepId === 'values' || stepId === 'matching') {
        const result = await analyze(current, true)
        if (result && stepId === 'values') {
          setDraft((d) => ({
            ...d,
            picklistChoices: proposeMissingPicklistChoices(
              result,
              d.picklistChoices,
            ),
          }))
        }
      } else if (stepId === 'conflicts' || stepId === 'dryRun') {
        await plan(current)
      } else if (stepId === 'results' && current.jobId)
        await loadResults(current.jobId)
    },
    [analyze, plan, loadResults, setDraft],
  )

  const goTo = useCallback(
    async (stepId: string) => {
      const current = draftRef.current
      await guard(async () => {
        await load(stepId, current)
        setDraft((d) => ({ ...d, step: stepId }))
      }, 'That step could not be loaded.')
    },
    [guard, load, setDraft],
  )

  // Load the resource, then resume the job when one was named.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const loaded = await client.fields({ resource })
        if (!live) return
        setInfo(loaded)
      } catch (reason) {
        if (live) setError(message(reason, 'This import could not be opened.'))
      }
    })()
    return () => {
      live = false
    }
  }, [client, resource])

  const resumed = useRef<string | null>(null)
  useEffect(() => {
    const jobId = options.jobId
    if (!info || !jobId || resumed.current === jobId) return
    resumed.current = jobId
    void guard(async () => {
      const saved = storage.load(transferWizardStorageKey(resource, jobId))
      const status = await client.status({ jobId })
      setJob(status)
      let step = saved?.step ?? 'mapping'
      if (status.status === 'applying' || status.status === 'failed')
        step = 'apply'
      else if (status.status === 'applied' || status.status === 'undone')
        step = 'results'
      else if (
        step === 'upload' ||
        (!BEFORE_APPLY.has(step) && !extra.some((entry) => entry.id === step))
      )
        step = 'mapping'
      const base = { ...(saved ?? createTransferWizardDraft()), jobId, step }
      draftRef.current = base
      setDraftState(base)
      if (step === 'apply') {
        const loaded = await client.results({ jobId })
        setApply({
          running: false,
          rowsDone: status.cursor?.rowsDone ?? loaded.rows.length,
          rowCount: status.rowCount ?? 0,
          failures: loaded.rows.filter((row) => row.outcome === 'failed'),
          done: false,
        })
        return
      }
      // A step past the values shows answers to the person's choices, and
      // reads the file under them first.
      if (!['mapping', 'values', 'matching'].includes(step))
        await analyze(base, true)
      await load(step, base)
    }, 'This import could not be resumed.')
  }, [
    info,
    options.jobId,
    client,
    resource,
    storage,
    guard,
    load,
    analyze,
    extra,
  ])

  const upload = useCallback<TransferImportWizardController['upload']>(
    async (file) => {
      await guard(async () => {
        const created = await client.upload({ resource, ...file })
        const base: TransferWizardDraft = {
          ...createTransferWizardDraft(),
          jobId: created.id,
          fileName: file.fileName,
          settings: file.settings,
        }
        setJob(created)
        const read = await analyze(base, false)
        const next: TransferWizardDraft = {
          ...base,
          step: 'mapping',
          mapping: { ...(read?.proposal.mapping ?? {}) },
        }
        draftRef.current = next
        setDraftState(next)
        storage.save(transferWizardStorageKey(resource, created.id), next)
        resumed.current = created.id
        onJobChange?.(created.id)
      }, 'The file could not be uploaded.')
    },
    [guard, client, resource, analyze, storage, onJobChange],
  )

  const stepIndex = Math.max(
    0,
    steps.findIndex((entry) => entry.id === draft.step),
  )

  const next = useCallback(async () => {
    const following = steps[stepIndex + 1]
    if (following) await goTo(following.id)
  }, [steps, stepIndex, goTo])

  const back = useCallback(() => {
    const previous = steps[stepIndex - 1]
    const current = steps[stepIndex]
    if (previous && current && (BEFORE_APPLY.has(current.id) || current.extra))
      void goTo(previous.id)
  }, [steps, stepIndex, goTo])

  const startApply = useCallback(async () => {
    const current = draftRef.current
    if (!current.jobId || running.current) return
    running.current = true
    setDraft((d) => ({ ...d, step: 'apply' }))
    setError(null)
    setApply((state) => ({ ...state, running: true }))
    try {
      while (running.current) {
        const step = await client.apply({
          jobId: current.jobId,
          acknowledged: current.acknowledged as TransferWarningClass[],
        })
        setJob(step.job)
        setApply((state) => ({
          running: running.current && !step.done,
          rowsDone: step.rowsDone,
          rowCount: step.rowCount,
          failures: [
            ...state.failures,
            ...step.results.filter((result) => result.outcome === 'failed'),
          ],
          done: step.done,
        }))
        if (step.done) {
          running.current = false
          await loadResults(current.jobId)
          setDraft((d) => ({ ...d, step: 'results' }))
        }
      }
    } catch (reason) {
      running.current = false
      setApply((state) => ({ ...state, running: false }))
      setError(
        message(
          reason,
          'The import stopped. Resume to carry on from where it stopped.',
        ),
      )
    }
  }, [client, loadResults, setDraft])

  const pauseApply = useCallback(() => {
    running.current = false
    setApply((state) => ({ ...state, running: false }))
  }, [])

  useEffect(
    () => () => {
      running.current = false
    },
    [],
  )

  const reanalyze = useCallback(
    async (current?: TransferWizardDraft) => {
      await guard(
        () => analyze(current ?? draftRef.current, true),
        'The file could not be read again.',
      )
    },
    [guard, analyze],
  )
  const replan = useCallback(
    async (current?: TransferWizardDraft) => {
      await guard(
        () => plan(current ?? draftRef.current),
        'The import could not be planned.',
      )
    },
    [guard, plan],
  )
  const refreshResults = useCallback(async () => {
    const jobId = draftRef.current.jobId
    if (jobId)
      await guard(() => loadResults(jobId), 'The results could not be loaded.')
  }, [guard, loadResults])

  const addField = useCallback((field: TransferField) => {
    setInfo((current) =>
      current
        ? {
            ...current,
            fields: [
              ...current.fields.filter((entry) => entry.id !== field.id),
              field,
            ],
          }
        : current,
    )
  }, [])

  return {
    client,
    resourceKey: resource,
    info,
    fields,
    fieldLabel,
    draft,
    setDraft,
    steps,
    stepIndex,
    job,
    analysis,
    planResponse,
    results,
    apply,
    busy,
    error,
    clearError: () => setError(null),
    upload,
    reanalyze,
    replan,
    goTo,
    next,
    back,
    startApply,
    pauseApply,
    refreshResults,
    undoOpen: job ? transferUndoAvailable(job, now()) : false,
    addField,
    now,
  }
}
