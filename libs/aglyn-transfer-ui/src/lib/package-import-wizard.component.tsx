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
 * The site package import wizard (AGL-3534): nothing about an item is
 * decided silently.
 *
 *   Upload → Items → Missing items → Changes → Review → Import
 *
 * Items are grouped by kind with their status (new, differs, already on
 * this site, needs something); each takes a decision — add, replace, keep
 * both, skip, or merge for settings and the theme — from the person's own
 * choice, the default they set for its kind of change, or the plan's
 * proposal. A dependency the import would leave pointing at nothing is
 * imported from the file, pointed at an item the site has, removed, or left.
 * Each changed item is shown against this site's copy, rendered side by side
 * and value by value, and a merged item is chosen key by key. The review
 * re-plans with every decision, says whether a plan limit refuses it, and
 * waits for each warning class to be acknowledged. An applied import can be
 * undone from its last step.
 */

import type { PackageItemDecision } from '@aglyn/aglyn/data-transfer'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PackageImportUndo } from './package-import-undo.component'
import { PackageItemDiff, type PackagePreviewHref } from './package-item-diff.component'
import type {
  SitePackageApplyAnswer,
  SitePackageCatalog,
  SitePackageClient,
  SitePackageComparison,
  SitePackageDependencyChoice,
  SitePackageMergeChoice,
  SitePackagePlanAnswer,
  SitePackagePlanItem,
  SitePackageUndoAnswer,
} from './site-package-client'
import {
  INITIAL_PACKAGE_BULK_DEFAULTS,
  PACKAGE_BULK_CHOICES,
  PACKAGE_DECISION_WORDS,
  PACKAGE_STATUS_WORDS,
  type PackageBulkDefaults,
  type PackageDependencyPrompt,
  packageAcknowledgements,
  packageDecided,
  packageDecisionCounts,
  packageDecisionOptions,
  packageDecisions,
  packageDependencyAnswer,
  packageDependencyOptions,
  packageDependencyPrompts,
  packageDependencyProblems,
  packageItemTitle,
} from './site-package-import-state'
import { TransferAcknowledgementList } from './transfer-acknowledgement-list.component'
import { TransferChoiceSelect } from './transfer-choice-select.component'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import { countOf } from './transfer-words'

export type PackageImportStep = 'upload' | 'items' | 'dependencies' | 'changes' | 'review' | 'results'

const STEPS: ReadonlyArray<{ id: PackageImportStep; label: string }> = [
  { id: 'upload', label: 'Upload' },
  { id: 'items', label: 'Items' },
  { id: 'dependencies', label: 'Missing items' },
  { id: 'changes', label: 'Changes' },
  { id: 'review', label: 'Review' },
  { id: 'results', label: 'Import' },
]

/** Rows shown per kind before "Show more". */
const GROUP_PAGE = 50

export interface PackageImportWizardProps {
  client: SitePackageClient
  /** A URL rendering one side of one item, or `null`; omitted, no rendered diff. */
  previewHref?: PackagePreviewHref
  /** A file already read: the wizard plans it and opens on Items. */
  initialFile?: { name: string; content: unknown }
  /** Told the import's id once it is applied, so the surface can offer undo later. */
  onImported?(answer: SitePackageApplyAnswer): void
  /** Told when the import is undone from the last step. */
  onUndone?(answer: SitePackageUndoAnswer): void
  /** Called from the last step's Done. */
  onDone?(): void
}

const message = (error: unknown) =>
  error instanceof SyntaxError
    ? 'That file is not a site package or backup.'
    : error instanceof Error && error.message
      ? error.message
      : 'Something went wrong. Try again.'

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

const MATCHED_BY_WORDS: Record<NonNullable<SitePackagePlanItem['matchedBy']>, string> = {
  id: 'by ID',
  slug: 'by address',
  name: 'by name',
}

export function PackageImportWizard(props: PackageImportWizardProps) {
  const { client, previewHref, initialFile, onImported, onUndone, onDone } = props
  const [step, setStep] = useState<PackageImportStep>('upload')
  const [file, setFile] = useState<{ name: string; content: unknown } | null>(null)
  const [answer, setAnswer] = useState<SitePackagePlanAnswer | null>(null)
  const [review, setReview] = useState<SitePackagePlanAnswer | null>(null)
  const [overrides, setOverrides] = useState<Record<string, PackageItemDecision>>({})
  const [bulk, setBulk] = useState<PackageBulkDefaults>(INITIAL_PACKAGE_BULK_DEFAULTS)
  const [dependencyChoices, setDependencyChoices] = useState<Record<string, SitePackageDependencyChoice>>({})
  const [mergeChoices, setMergeChoices] = useState<Record<string, Record<string, SitePackageMergeChoice>>>({})
  const [comparisons, setComparisons] = useState<Record<string, SitePackageComparison>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState<string[]>([])
  const [catalog, setCatalog] = useState<SitePackageCatalog | null>(null)
  const [result, setResult] = useState<SitePackageApplyAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }, [])

  const plan = answer?.plan ?? null
  const byKey = useMemo(() => new Map((plan?.items ?? []).map((item) => [item.key, item])), [plan])
  const titleOf = useCallback((key: string) => {
    const item = byKey.get(key)
    return item ? packageItemTitle(item) : key
  }, [byKey])
  const kindLabel = useCallback(
    (kind: string) => plan?.kinds.find((one) => one.kind === kind)?.label ?? kind,
    [plan],
  )

  const { decisions, undecided } = useMemo(
    () => (plan ? packageDecisions(plan, overrides, bulk) : { decisions: {}, undecided: [] }),
    [plan, overrides, bulk],
  )
  const prompts = useMemo(() => (plan ? packageDependencyPrompts(plan, decisions) : []), [plan, decisions])
  // A dependency the file carries is imported from it unless the person says otherwise.
  const effectiveDependencyChoices = useMemo(() => {
    const out: Record<string, SitePackageDependencyChoice> = {}
    for (const prompt of prompts) {
      const choice = dependencyChoices[prompt.key] ?? (prompt.inPackage ? 'import' : undefined)
      if (choice) out[prompt.key] = choice
    }
    return out
  }, [prompts, dependencyChoices])
  const decided = useMemo(
    () => packageDecided(decisions, prompts, effectiveDependencyChoices, mergeChoices),
    [decisions, prompts, effectiveDependencyChoices, mergeChoices],
  )

  const planFile = useCallback(
    (next: { name: string; content: unknown }) =>
      run(async () => {
        const planned = await client.plan(next.content)
        setFile(next)
        setAnswer(planned)
        setOverrides({})
        setBulk(INITIAL_PACKAGE_BULK_DEFAULTS)
        setDependencyChoices({})
        setMergeChoices({})
        setComparisons({})
        setSelected(null)
        setStep('items')
      }),
    [client, run],
  )

  const started = useRef(false)
  useEffect(() => {
    if (!initialFile || started.current) return
    started.current = true
    void planFile(initialFile)
  }, [initialFile, planFile])

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0]
    event.target.value = ''
    if (!chosen) return
    await run(async () => {
      const content = JSON.parse(await readFileText(chosen))
      await planFile({ name: chosen.name, content })
    })
  }

  const compare = useCallback(
    async (key: string) => {
      if (!file || comparisons[key]) return
      await run(async () => {
        const answered = await client.compare(file.content, [key])
        setComparisons((current) => ({
          ...current,
          ...Object.fromEntries(answered.map((one) => [one.key, one])),
        }))
      })
    },
    [client, file, comparisons, run],
  )

  const loadCatalog = useCallback(async () => {
    if (catalog) return
    await run(async () => setCatalog(await client.catalog()))
  }, [catalog, client, run])

  const toReview = () =>
    run(async () => {
      if (!file) return
      setReview(await client.plan(file.content, decided))
      setAcknowledged([])
      setStep('review')
    })

  const apply = () =>
    run(async () => {
      if (!file) return
      const applied = await client.apply(file.content, decided)
      setResult(applied)
      setStep('results')
      onImported?.(applied)
    })

  const changed = useMemo(
    () =>
      (plan?.items ?? []).filter((item) => {
        if (!item.existing) return false
        const decision = decisions[item.key]
        return item.comparison === 'differs' || (decision !== undefined && decision !== 'skip')
      }),
    [plan, decisions],
  )

  const goChanges = (key?: string) => {
    const first = key ?? selected ?? changed[0]?.key ?? null
    setSelected(first)
    setStep('changes')
    if (first) void compare(first)
  }

  const stepIndex = STEPS.findIndex((one) => one.id === step)
  const locked = step === 'results'

  let body: ReactNode = null
  if (step === 'upload') {
    body = (
      <Stack spacing={2}>
        <Typography variant="body2">
          Choose a site package, or a backup downloaded from any of your sites. Nothing is written until you
          import on the last step.
        </Typography>
        <Box>
          <Button variant="outlined" disabled={busy} onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Package file"
            onChange={(event) => void onFile(event)}
          />
        </Box>
        {file ? (
          <Typography variant="body2" color="text.secondary">
            {file.name}
          </Typography>
        ) : null}
        {answer ? <TransferWizardNav onNext={() => setStep('items')} busy={busy} /> : null}
      </Stack>
    )
  } else if (step === 'items' && plan && answer) {
    body = (
      <ItemsStep
        fileName={file?.name ?? ''}
        answer={answer}
        decisions={decisions}
        overrides={overrides}
        bulk={bulk}
        busy={busy}
        onBulk={(comparison, decision) => setBulk((current) => ({ ...current, [comparison]: decision }))}
        onDecision={(key, decision) => setOverrides((current) => ({ ...current, [key]: decision }))}
        onCompare={(key) => goChanges(key)}
        blockers={
          undecided.length
            ? [
                `Choose what to do with ${countOf(undecided.length, 'changed item')}: set a default for changed items, or choose for each.`,
              ]
            : []
        }
        onBack={() => setStep('upload')}
        onNext={() => setStep('dependencies')}
      />
    )
  } else if (step === 'dependencies' && plan) {
    body = (
      <DependenciesStep
        prompts={prompts}
        choices={effectiveDependencyChoices}
        catalog={catalog}
        busy={busy}
        titleOf={titleOf}
        kindLabel={kindLabel}
        onNeedCatalog={() => void loadCatalog()}
        onChoice={(key, choice) => setDependencyChoices((current) => ({ ...current, [key]: choice }))}
        onBack={() => setStep('items')}
        onNext={() => goChanges()}
      />
    )
  } else if (step === 'changes' && plan) {
    const item = selected ? byKey.get(selected) : undefined
    const comparison = selected ? comparisons[selected] : undefined
    const decision = item ? (decisions[item.key] ?? null) : null
    body = (
      <Stack spacing={2}>
        {changed.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing this site holds is changed by the import.
          </Typography>
        ) : (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Box sx={{ width: { md: 280 }, flexShrink: 0 }}>
              <List dense aria-label="Changed items" sx={{ maxHeight: 520, overflowY: 'auto' }}>
                {changed.map((one) => {
                  const chosen = decisions[one.key]
                  return (
                    <ListItemButton
                      key={one.key}
                      selected={one.key === selected}
                      onClick={() => {
                        setSelected(one.key)
                        void compare(one.key)
                      }}
                    >
                      <ListItemText
                        primary={packageItemTitle(one)}
                        secondary={`${kindLabel(one.kind)} · ${chosen ? PACKAGE_DECISION_WORDS[chosen].label : 'Not chosen'}`}
                      />
                    </ListItemButton>
                  )
                })}
              </List>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {item ? (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="h6" component="h3">
                      {packageItemTitle(item)}
                    </Typography>
                    <TransferChoiceSelect<PackageItemDecision>
                      label="Decision"
                      value={decision ?? ''}
                      placeholder="Choose…"
                      options={packageDecisionOptions(item.choices)}
                      onChange={(next) => setOverrides((current) => ({ ...current, [item.key]: next }))}
                    />
                  </Stack>
                  {comparison ? (
                    <PackageItemDiff
                      item={item}
                      comparison={comparison}
                      decision={decision}
                      {...(previewHref ? { previewHref } : {})}
                      mergeChoices={mergeChoices[item.key] ?? {}}
                      onMergeChoice={(key, choice) =>
                        setMergeChoices((current) => ({
                          ...current,
                          [item.key]: { ...(current[item.key] ?? {}), [key]: choice },
                        }))
                      }
                    />
                  ) : (
                    <CircularProgress size={24} aria-label="Comparing" />
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Choose an item to see what changes.
                </Typography>
              )}
            </Box>
          </Stack>
        )}
        <TransferWizardNav
          busy={busy}
          blockers={
            undecided.length
              ? [`Choose what to do with ${countOf(undecided.length, 'changed item')}.`]
              : []
          }
          onBack={() => setStep('dependencies')}
          onNext={() => void toReview()}
          nextLabel="Review"
        />
      </Stack>
    )
  } else if (step === 'review' && review) {
    const acknowledgements = packageAcknowledgements(review, decisions, titleOf)
    const unacknowledged = acknowledgements.filter(
      (one) => one.required && !acknowledged.includes(one.id),
    ).length
    const counts = packageDecisionCounts(decisions)
    body = (
      <Stack spacing={2}>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }} aria-label="What the import does">
          {counts.map(({ decision, count }) => (
            <Typography component="li" variant="body2" key={decision}>
              {`${PACKAGE_DECISION_WORDS[decision].label}: ${countOf(count, 'item')}`}
            </Typography>
          ))}
        </Box>
        {review.capRefusal ? <Alert severity="error">{review.capRefusal}</Alert> : null}
        <TransferAcknowledgementList
          items={acknowledgements}
          acknowledged={acknowledged}
          disabled={busy}
          onChange={(id, done) =>
            setAcknowledged((current) => (done ? [...current, id] : current.filter((one) => one !== id)))
          }
        />
        <TransferWizardNav
          busy={busy}
          blockers={[
            ...(review.capRefusal ? ['A plan limit refuses this import. Skip some new items, or upgrade.'] : []),
            ...(unacknowledged ? [`Acknowledge ${countOf(unacknowledged, 'warning')} to import.`] : []),
          ]}
          onBack={() => goChanges()}
          onNext={() => void apply()}
          nextLabel="Import"
        />
      </Stack>
    )
  } else if (step === 'results' && result) {
    const counts = Object.entries(result.counts).filter(([, count]) => count > 0)
    body = (
      <Stack spacing={2}>
        <Alert severity="success">
          {`Imported: ${counts
            .map(([decision, count]) =>
              `${PACKAGE_DECISION_WORDS[decision as PackageItemDecision]?.label ?? decision} ${count.toLocaleString()}`,
            )
            .join(', ')} (${countOf(result.written, 'document')} written).`}
        </Alert>
        <PackageImportUndo client={client} importId={result.importId} {...(onUndone ? { onUndone } : {})} />
        <TransferWizardNav onNext={onDone} nextLabel="Done" />
      </Stack>
    )
  }

  return (
    <Stack spacing={3}>
      <Box component="nav" aria-label="Import steps" sx={{ overflowX: 'auto' }}>
        <Stepper nonLinear activeStep={stepIndex} alternativeLabel>
          {STEPS.map((one, index) => {
            const reachable = index < stepIndex && !locked && Boolean(answer)
            return (
              <Step key={one.id} completed={index < stepIndex}>
                {reachable ? (
                  <StepButton
                    onClick={() => (one.id === 'changes' ? goChanges() : setStep(one.id))}
                  >
                    {one.label}
                  </StepButton>
                ) : (
                  <StepLabel aria-current={index === stepIndex ? 'step' : undefined}>{one.label}</StepLabel>
                )}
              </Step>
            )
          })}
        </Stepper>
      </Box>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {busy && step !== 'changes' ? <CircularProgress size={24} aria-label="Working" /> : null}
      <Box>{body}</Box>
    </Stack>
  )
}

/*==========================================
 * ITEMS
 *=========================================*/

interface ItemsStepProps {
  fileName: string
  answer: SitePackagePlanAnswer
  decisions: Readonly<Record<string, PackageItemDecision>>
  overrides: Readonly<Record<string, PackageItemDecision>>
  bulk: PackageBulkDefaults
  busy: boolean
  blockers: string[]
  onBulk(comparison: keyof PackageBulkDefaults, decision: PackageItemDecision): void
  onDecision(key: string, decision: PackageItemDecision): void
  onCompare(key: string): void
  onBack(): void
  onNext(): void
}

const BULK_LABELS: Record<keyof PackageBulkDefaults, string> = {
  new: 'New items',
  differs: 'Changed items',
  identical: 'Items already on this site',
}

function ItemsStep(props: ItemsStepProps) {
  const { answer, decisions, overrides, bulk } = props
  const { plan } = answer
  const [status, setStatus] = useState('all')
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState<Record<string, number>>({})
  const needle = search.trim().toLowerCase()
  const visible = plan.items.filter(
    (item) =>
      (status === 'all' || item.status === status) &&
      (kind === 'all' || item.kind === kind) &&
      (!needle ||
        [item.name, item.slug, item.id].some((value) => value?.toLowerCase().includes(needle))),
  )
  const comparisons = (Object.keys(BULK_LABELS) as Array<keyof PackageBulkDefaults>).filter((one) =>
    plan.items.some((item) => item.comparison === one),
  )
  const counts = plan.counts

  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        {`${props.fileName ? `${props.fileName}: ` : ''}${countOf(counts.new, 'new item')}, ` +
          `${countOf(counts.differs, 'item')} that differ from this site’s copy, ` +
          `${countOf(counts.identical, 'item')} already on this site` +
          (counts.missingDependency
            ? `, ${countOf(counts.missingDependency, 'item')} that need something neither the file nor this site holds.`
            : '.')}
      </Typography>
      <Stack spacing={1}>
        <Typography variant="subtitle2" component="h3">
          Defaults
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {comparisons.map((one) => (
            <TransferChoiceSelect<PackageItemDecision>
              key={one}
              label={BULK_LABELS[one]}
              value={bulk[one]}
              placeholder="Choose…"
              options={packageDecisionOptions(PACKAGE_BULK_CHOICES[one])}
              onChange={(decision) => props.onBulk(one, decision)}
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          A default applies to every item of that kind you have not chosen for, where the item can take it.
        </Typography>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TransferChoiceSelect
          label="Show"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: `All (${plan.items.length.toLocaleString()})` },
            ...(Object.keys(PACKAGE_STATUS_WORDS) as Array<keyof typeof PACKAGE_STATUS_WORDS>).map((one) => ({
              value: one,
              label: `${PACKAGE_STATUS_WORDS[one].label} (${counts[one].toLocaleString()})`,
              disabled: counts[one] === 0,
            })),
          ]}
        />
        <TransferChoiceSelect
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'Every kind' },
            ...plan.kinds.map((one) => ({ value: one.kind, label: `${one.label} (${one.count.toLocaleString()})` })),
          ]}
        />
        <TextField
          size="small"
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Stack>
      {visible.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No item matches.
        </Typography>
      ) : null}
      {plan.kinds.map((group) => {
        const items = visible.filter((item) => item.kind === group.kind)
        if (!items.length) return null
        const limit = shown[group.kind] ?? GROUP_PAGE
        return (
          <Stack spacing={1} key={group.kind}>
            <Typography variant="subtitle1" component="h3">
              {`${group.label} (${items.length.toLocaleString()})`}
            </Typography>
            <ScrollTable size="small" aria-label={group.label}>
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>On this site</TableCell>
                  <TableCell>Decision</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {items.slice(0, limit).map((item) => {
                  const title = packageItemTitle(item)
                  const words = PACKAGE_STATUS_WORDS[item.status]
                  return (
                    <TableRow key={item.key}>
                      <TableCell>
                        <Typography variant="body2">{title}</Typography>
                        {item.slug && item.slug !== title ? (
                          <Typography variant="caption" color="text.secondary">
                            {item.slug}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={words.label} color={words.color} />
                        {item.missing.length ? (
                          <Typography variant="caption" color="text.secondary" component="div">
                            {`Needs ${item.missing.map((dep) => `${dep.kind} ${dep.id}`).join(', ')}`}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {item.existing ? (
                          <>
                            <Typography variant="body2">{packageItemTitle(item.existing)}</Typography>
                            {item.matchedBy ? (
                              <Typography variant="caption" color="text.secondary">
                                {`Matched ${MATCHED_BY_WORDS[item.matchedBy]}`}
                              </Typography>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <TransferChoiceSelect<PackageItemDecision>
                          label={`Decision for ${title}`}
                          hideLabel
                          value={decisions[item.key] ?? ''}
                          placeholder="Choose…"
                          options={packageDecisionOptions(item.choices)}
                          onChange={(decision) => props.onDecision(item.key, decision)}
                          {...(overrides[item.key] ? { helperText: 'Your choice' } : {})}
                        />
                      </TableCell>
                      <TableCell>
                        {item.existing && item.comparison === 'differs' ? (
                          <Button size="small" onClick={() => props.onCompare(item.key)}>
                            {`Compare ${title}`}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </ScrollTable>
            {items.length > limit ? (
              <Box>
                <Button
                  size="small"
                  onClick={() => setShown((current) => ({ ...current, [group.kind]: limit + GROUP_PAGE }))}
                >
                  {`Show ${Math.min(GROUP_PAGE, items.length - limit).toLocaleString()} more ${group.label.toLowerCase()}`}
                </Button>
              </Box>
            ) : null}
          </Stack>
        )
      })}
      <TransferWizardNav busy={props.busy} blockers={props.blockers} onBack={props.onBack} onNext={props.onNext} />
    </Stack>
  )
}

/*==========================================
 * MISSING ITEMS
 *=========================================*/

interface DependenciesStepProps {
  prompts: readonly PackageDependencyPrompt[]
  choices: Readonly<Record<string, SitePackageDependencyChoice>>
  catalog: SitePackageCatalog | null
  busy: boolean
  titleOf(key: string): string
  kindLabel(kind: string): string
  onNeedCatalog(): void
  onChoice(key: string, choice: SitePackageDependencyChoice): void
  onBack(): void
  onNext(): void
}

function DependenciesStep(props: DependenciesStepProps) {
  const { prompts, choices, catalog, onNeedCatalog } = props
  const mapping = prompts.some((prompt) => typeof choices[prompt.key] === 'object')
  useEffect(() => {
    if (mapping && !catalog) onNeedCatalog()
  }, [mapping, catalog, onNeedCatalog])

  return (
    <Stack spacing={2}>
      {prompts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Every item you are importing has what it needs.
        </Typography>
      ) : (
        <>
          <Typography variant="body2">
            These items are named by what you are importing, and this site will not hold them. Choose what to
            do about each.
          </Typography>
          <ScrollTable size="small" aria-label="Missing items">
            <TableHead>
              <TableRow>
                <TableCell>Missing item</TableCell>
                <TableCell>Needed by</TableCell>
                <TableCell>What to do</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {prompts.map((prompt) => {
                const name = prompt.inPackage
                  ? packageItemTitle(prompt.inPackage)
                  : `${props.kindLabel(prompt.kind)}: ${prompt.id}`
                const choice = choices[prompt.key]
                const answer = packageDependencyAnswer(choice)
                const options = (catalog?.manifest.items ?? []).filter((one) => one.kind === prompt.kind)
                const picked =
                  typeof choice === 'object' ? (options.find((one) => one.$id === choice.mapTo) ?? null) : null
                return (
                  <TableRow key={prompt.key}>
                    <TableCell>
                      <Typography variant="body2">{name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {prompt.inPackage ? 'In the file, set to skip' : 'Neither in the file nor on this site'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {prompt.neededBy.slice(0, 3).map(props.titleOf).join(', ')}
                        {prompt.neededBy.length > 3 ? ` and ${(prompt.neededBy.length - 3).toLocaleString()} more` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack spacing={1}>
                        <TransferChoiceSelect
                          label={`What to do about ${name}`}
                          hideLabel
                          value={answer}
                          placeholder="Choose…"
                          options={packageDependencyOptions(prompt)}
                          onChange={(next) => props.onChoice(prompt.key, next === 'mapTo' ? { mapTo: '' } : next)}
                          {...(answer === 'drop'
                            ? { helperText: `Removed from ${countOf(prompt.neededBy.length, 'item')}.` }
                            : {})}
                        />
                        {answer === 'mapTo' ? (
                          <Autocomplete
                            size="small"
                            options={options}
                            loading={!catalog}
                            value={picked}
                            getOptionLabel={(option) => option.name || option.slug || option.$id}
                            isOptionEqualToValue={(option, value) => option.$id === value.$id}
                            onChange={(_event, value) => props.onChoice(prompt.key, { mapTo: value?.$id ?? '' })}
                            renderInput={(params) => (
                              <TextField {...params} label={`Use instead of ${name}`} />
                            )}
                          />
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ScrollTable>
        </>
      )}
      <TransferWizardNav
        busy={props.busy}
        blockers={packageDependencyProblems(prompts, choices)}
        onBack={props.onBack}
        onNext={props.onNext}
      />
    </Stack>
  )
}

export default PackageImportWizard
