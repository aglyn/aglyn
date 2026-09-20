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

import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useHostOrgId, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import {
  AI_EXPERIMENT_SUBJECT_MAX_CHARS,
  type AiExperimentArm,
  type AiExperimentTarget,
} from '../model/ai-experiment'
import {
  aiExperimentArmIsNamed,
  aiExperimentVerdictDisplay,
  readAiExperimentExplanation,
  readAiExperimentVariants,
  type AiExperimentExplanationProposal,
  type AiExperimentVariantsProposalView,
} from '../model/ai-experiment-proposal'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { aiJobProblem, useAiJobRun, useAiJobsVerdict } from './use-ai-job-run'

/**
 * A/B tests by AI in the console (AGL-2914): the two doors a person reaches
 * the `experiment` job through, and the surfaces that render what it answers.
 *
 * Both are widgets in zones the A/B TESTING card hosts, not surfaces of this
 * plugin's own. The test, the experiment document, the traffic split and the
 * counters belong to the plugin that draws that card, and neither plugin
 * imports the other: the zone's id and the props it hands a widget are the
 * whole contract, and the interfaces below restate the halves this widget
 * reads rather than importing the owner's.
 *
 * ## The result surface may not decide anything
 *
 * The step reached the verdict from the counts before a model was asked, and
 * cut the answer back to it. A card can undo all of that silently — a
 * confident heading, a highlighted row, a badge saying which to ship — and
 * the reader will take the layout for the claim. So {@link AiExperimentResultCard}
 * asks `aiExperimentVerdictDisplay` what the verdict permits before it draws
 * anything: an undecided result gets a neutral chip, a sentence saying it
 * settled nothing ABOVE the explanation, no marked arm and no recommendation.
 * Nothing on it is conditioned on which arm has the best rate.
 *
 * ## Neither card writes
 *
 * The variants card fills the experiment editor's own fields, unsaved, and
 * the dialog's Save is the write. The result card has nothing to apply.
 */

const VARIANTS_FAILED_COPY = 'Variants could not be written. Try again.'
const EXPLAIN_FAILED_COPY = 'The result could not be explained. Try again.'

/** What the test varies, in the words this card's own copy uses. */
const TARGET_NOUN: Record<AiExperimentTarget, string> = {
  screen: 'page',
  section: 'section',
  email: 'email',
}

/** One of the experiment editor's variants, as the zone hands it over. */
export interface AiExperimentZoneVariant {
  id: string
  name: string
  subject: string
  body: string
}

/** What the variants zone hands this widget. */
export interface AiExperimentVariantsCardProps {
  hostId: string
  experimentId: string
  name: string
  target: AiExperimentTarget
  goal: string
  variants: AiExperimentZoneVariant[]
  proposeVariants: (
    variants: readonly AiExperimentZoneVariant[],
    key: string,
  ) => void
}

/** What the result zone hands this widget. */
export interface AiExperimentResultCardProps {
  hostId: string
  experimentId: string
  test: string
}

/** The proposal a finished experiment job carries, whichever task it ran. */
function proposalOf(job: AiJobSummary | null): Record<string, unknown> | null {
  if (job?.status !== 'done') return null
  return job.outputs.find((output) => output.resource === 'experiment')?.proposal ?? null
}

const rateText = (value: number | null): string =>
  value === null ? '—' : `${value}%`

const liftText = (value: number | null): string =>
  value === null ? '—' : `${value >= 0 ? '+' : ''}${value}%`

/**
 * The copy an email test varies, as the editor holds it: the FIRST variant's
 * subject and body, which is the control. A screen or a section varies a
 * screen version, which the editor does not hold, so there is nothing to
 * prefill and the person pastes what is under test.
 */
export function aiExperimentSubjectFrom(
  target: AiExperimentTarget,
  variants: readonly AiExperimentZoneVariant[],
): string {
  if (target !== 'email') return ''
  const control = variants[0]
  if (!control) return ''
  return [control.subject, control.body].filter(Boolean).join('\n\n')
}

/**
 * A proposal mapped onto the editor's variants, in order. Only the fields
 * that target has a place for are filled: an email varies its subject and
 * body, and a screen or a section varies a screen version, so there only the
 * name is filled and the copy is read on the card.
 */
export function aiExperimentVariantDrafts(
  target: AiExperimentTarget,
  variants: readonly AiExperimentZoneVariant[],
  proposal: AiExperimentVariantsProposalView,
): AiExperimentZoneVariant[] {
  return variants.map((variant, index) => {
    const proposed = proposal.variants[index]
    if (!proposed) return variant
    return {
      id: variant.id,
      name: proposed.name,
      subject: target === 'email' ? proposed.subject : '',
      body: target === 'email' ? proposed.body : '',
    }
  })
}

/** Where a proposed variant's copy lands, said before the person presses the button. */
export function aiExperimentApplyCopy(target: AiExperimentTarget): string {
  return target === 'email'
    ? 'Each variant above takes its name, subject and body. Nothing is saved until you save the experiment.'
    : 'Each variant above takes its name. The copy itself is a screen version — make one per variant in the editor and pin it above.'
}

/**
 * "Write variants with AI", in the experiment editor beneath the variants it
 * writes for. It proposes COPY: no weight, no traffic split, no goal and no
 * schedule, and the first variant it writes is the copy as it stands so the
 * test has something to measure against.
 */
export function AiExperimentVariantsCard(props: AiExperimentVariantsCardProps) {
  const { hostId, target, variants, proposeVariants } = props
  // The zone hands the SITE, which is what the card it is drawn in knows. The
  // organization is this widget's to resolve, as every AI widget in another
  // plugin's zone resolves it.
  const orgId = useHostOrgId(hostId) ?? undefined
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, VARIANTS_FAILED_COPY)
  const prefill = useMemo(
    () => aiExperimentSubjectFrom(target, variants),
    [target, variants],
  )
  const [subject, setSubject] = useState(prefill)
  const [applied, setApplied] = useState<string | null>(null)
  // The control's copy follows the editor until the person edits this field,
  // so switching a draft test from a page to an email fills it rather than
  // leaving the earlier target's copy under a question about a new one.
  const [typed, setTyped] = useState(false)
  useEffect(() => {
    if (!typed) setSubject(prefill)
  }, [prefill, typed])

  const proposal = useMemo(
    () => readAiExperimentVariants(proposalOf(run.job)),
    [run.job],
  )
  const problem =
    aiJobProblem(run.job, VARIANTS_FAILED_COPY) ??
    (run.job?.status === 'done' && !proposal ? VARIANTS_FAILED_COPY : null)

  if (verdict !== 'ready') return null

  const busy = run.starting || run.running
  const noun = TARGET_NOUN[target]
  const write = () => {
    if (!orgId || !subject.trim()) return
    setApplied(null)
    void run.start({
      orgId,
      hostId,
      kind: 'experiment',
      brief:
        `Write variants of this ${noun} for the A/B test ` +
        `“${props.name.trim() || 'this test'}”.`,
      inputs: {
        task: 'variants',
        target,
        subject: subject.trim().slice(0, AI_EXPERIMENT_SUBJECT_MAX_CHARS),
        goal: props.goal,
        ...(props.experimentId ? { experimentId: props.experimentId } : {}),
      },
    })
  }

  const apply = () => {
    if (!proposal || !run.job) return
    proposeVariants(
      aiExperimentVariantDrafts(target, variants, proposal),
      run.job.id,
    )
    setApplied(run.job.id)
  }

  return (
    <Box
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
      aria-label="Write variants with AI"
    >
      <Stack spacing={1}>
        <Typography variant="subtitle2">{'Write variants with AI'}</Typography>
        <TextField
          size="small"
          multiline
          minRows={2}
          label={`The ${noun} copy under test`}
          placeholder={
            target === 'email'
              ? 'The subject line and message as they stand'
              : 'The headline and copy as they stand on the page'
          }
          helperText={
            'Variants are written from this. The first one it writes is this copy unchanged, so the test has a control.'
          }
          value={subject}
          onChange={(event) => {
            setTyped(true)
            setSubject(event.target.value.slice(0, AI_EXPERIMENT_SUBJECT_MAX_CHARS))
          }}
          disabled={busy}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            disabled={busy || !orgId || !subject.trim()}
            onClick={write}
          >
            {run.job && !busy ? 'Write them again' : 'Write variants'}
          </Button>
          {busy ? <CircularProgress size={16} aria-label="Writing variants" /> : null}
        </Stack>
        {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
        {problem ? (
          <Alert severity={run.job?.status === 'failed' ? 'error' : 'warning'}>
            {problem}
          </Alert>
        ) : null}

        {proposal ? (
          <Stack spacing={1} aria-label="Proposed variants">
            {proposal.goal ? (
              <Typography variant="body2" color="text.secondary">
                {`Written to move: ${proposal.goal}`}
              </Typography>
            ) : null}
            {proposal.variants.map((variant, index) => (
              <Box
                key={`${index}:${variant.name}`}
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}
              >
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">
                    {variant.name || `Variant ${index + 1}`}
                  </Typography>
                  {variant.subject ? (
                    <Typography variant="body2">{`Subject: ${variant.subject}`}</Typography>
                  ) : null}
                  {variant.preheader ? (
                    <Typography variant="body2">{`Preheader: ${variant.preheader}`}</Typography>
                  ) : null}
                  {variant.headline ? (
                    <Typography variant="body2">{variant.headline}</Typography>
                  ) : null}
                  {variant.body ? (
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}
                    >
                      {variant.body}
                    </Typography>
                  ) : null}
                  {variant.rationale ? (
                    <Typography variant="caption" color="text.secondary">
                      {variant.rationale}
                    </Typography>
                  ) : null}
                </Stack>
              </Box>
            ))}
            <Typography variant="caption" color="text.secondary">
              {aiExperimentApplyCopy(target)}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                disabled={applied === run.job?.id}
                onClick={apply}
              >
                {'Put into the variants'}
              </Button>
            </Stack>
            {applied === run.job?.id ? (
              <Alert severity="success">
                {'In the variants above. Review them, then Save the experiment — or Cancel to leave it as it was.'}
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}
AiExperimentVariantsCard.displayName = 'AiExperimentVariantsCard'

/** One arm, drawn the same way whatever the figures say about it. */
function ArmRow({
  arm,
  named,
}: {
  arm: AiExperimentArm
  named: boolean
}) {
  return (
    <TableRow>
      <TableCell>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2">{arm.id}</Typography>
          {named ? <Chip size="small" color="success" label="Ahead" /> : null}
        </Stack>
      </TableCell>
      <TableCell>{arm.exposures}</TableCell>
      <TableCell>{arm.conversions}</TableCell>
      <TableCell>{rateText(arm.rate)}</TableCell>
      <TableCell>{liftText(arm.lift)}</TableCell>
      <TableCell>{rateText(arm.confidence)}</TableCell>
    </TableRow>
  )
}

/**
 * The explanation, drawn to the verdict rather than to the numbers.
 *
 * The chip and the caveat come FIRST, above the prose: a reader who stops
 * after one line must stop on what the result settled, not on a sentence
 * about one variant. No row is marked unless the verdict names an arm, and
 * `aiExperimentArmIsNamed` is asked per row rather than `winnerId` compared
 * directly, so a stored winner beside an undecided verdict marks nothing.
 */
export function AiExperimentExplanation({
  explanation,
}: {
  explanation: AiExperimentExplanationProposal
}) {
  const display = aiExperimentVerdictDisplay(explanation.verdict)
  return (
    <Stack spacing={1} aria-label="What this result shows">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip size="small" color={display.tone} label={display.status} />
        {display.namesAnArm ? (
          <Typography variant="caption" color="text.secondary">
            {`Called at ${explanation.threshold}% confidence.`}
          </Typography>
        ) : null}
      </Stack>
      {display.caveat ? (
        <Typography variant="body2">{display.caveat}</Typography>
      ) : null}
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {explanation.headline}
      </Typography>
      {explanation.points.map((point) => (
        <Typography key={point} variant="body2" color="text.secondary">
          {point}
        </Typography>
      ))}
      {explanation.arms.length ? (
        <ScrollTable size="small" aria-label="The figures this reads">
          <TableHead>
            <TableRow>
              <TableCell>{'Variant'}</TableCell>
              <TableCell>{'Shown'}</TableCell>
              <TableCell>{'Conversions'}</TableCell>
              <TableCell>{'Rate'}</TableCell>
              <TableCell>{'Lift'}</TableCell>
              <TableCell>{'Confidence'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {explanation.arms.map((arm) => (
              <ArmRow
                key={arm.id}
                arm={arm}
                named={aiExperimentArmIsNamed(explanation, arm.id)}
              />
            ))}
          </TableBody>
        </ScrollTable>
      ) : null}
      {explanation.next ? (
        <Typography variant="body2">{explanation.next}</Typography>
      ) : null}
    </Stack>
  )
}
AiExperimentExplanation.displayName = 'AiExperimentExplanation'

/**
 * "Explain this result", below one test's figures. It starts an `experiment`
 * job, which reads the same figures the dialog above it shows, decides what
 * they support in code, and asks a model only for the words.
 */
export function AiExperimentResultCard(props: AiExperimentResultCardProps) {
  const { hostId, test } = props
  const orgId = useHostOrgId(hostId) ?? undefined
  const { data: user } = useUser()
  const verdict = useAiJobsVerdict(user, orgId)
  const run = useAiJobRun(user, EXPLAIN_FAILED_COPY)
  const explanation = useMemo(
    () => readAiExperimentExplanation(proposalOf(run.job)),
    [run.job],
  )
  const problem =
    aiJobProblem(run.job, EXPLAIN_FAILED_COPY) ??
    (run.job?.status === 'done' && !explanation ? EXPLAIN_FAILED_COPY : null)

  if (verdict !== 'ready') return null

  const busy = run.starting || run.running
  const explain = () => {
    if (!orgId || !test) return
    void run.start({
      orgId,
      hostId,
      kind: 'experiment',
      brief: `Explain the result of the A/B test “${test}” in plain words.`,
      inputs: {
        task: 'explain',
        test,
        ...(props.experimentId ? { experimentId: props.experimentId } : {}),
      },
    })
  }

  return (
    <Box
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, mt: 2 }}
      aria-label="Explain this result with AI"
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {'Read these figures in plain words, including whether they settle anything yet.'}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            disabled={busy || !orgId || !test}
            onClick={explain}
          >
            {run.job && !busy ? 'Ask again' : 'Explain this result'}
          </Button>
        </Stack>
        {busy ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={16} aria-label="Reading the result" />
            <Typography variant="body2" color="text.secondary">
              {'Reading the result.'}
            </Typography>
          </Stack>
        ) : null}
        {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
        {problem ? (
          <Alert severity={run.job?.status === 'failed' ? 'error' : 'warning'}>
            {problem}
          </Alert>
        ) : null}
        {explanation ? <AiExperimentExplanation explanation={explanation} /> : null}
      </Stack>
    </Box>
  )
}
AiExperimentResultCard.displayName = 'AiExperimentResultCard'
