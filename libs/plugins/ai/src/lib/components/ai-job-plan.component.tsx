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

import {
  AI_BUILD_PLAN_CREATION_NOUNS,
  AI_BUILD_PLAN_EMBED_HOST_NAMES,
  isAiPlanNewRef,
  type AiBuildPlanEmbed,
} from '../model/ai-build-plan'
import type { AiJobReview, AiJobSummary } from '../model/ai-jobs.types'
import { aiJobPlanCreditEstimate } from '../model/ai-site-job'
import { Box, Button, Collapse, Stack, Typography } from '@mui/material'
import { useState } from 'react'

/**
 * A job's plan and what it waits for (AGL-2935), inside the AI jobs drawer:
 * what the job reuses from the site, what it creates and why, the screens it
 * builds — and, while the job waits for a person, the one button that
 * confirms the plan or tries a refused step again. The drawer owns the
 * request; this renders.
 */
export interface AiJobPlanProps {
  job: AiJobSummary
  /** Confirms the plan, or tries the refused step again. */
  onResume: (job: AiJobSummary) => void
  /** A resume for this job is in flight. */
  busy?: boolean
  /**
   * The viewer is staff (AGL-3078), who can open where a refused answer broke
   * its rules and the outline of those parts, to tell a shape the rules should
   * allow from an answer that ignored its re-ask. A member reads the findings.
   */
  staff?: boolean
}

/**
 * Where a refused answer broke its rules, and the outline of those parts, as
 * lines staff read (AGL-3078): each finding with the nodes or plan entries it
 * names, then each outlined node indented by its depth, with its element, a
 * Grid's layout as written, and the names of what it sets and holds.
 */
export function aiJobReviewDetails(review: AiJobReview | null): string[] {
  if (review?.reason !== 'doctrine') return []
  const lines = review.findings.flatMap((finding) => {
    const where = finding.nodeIds?.length
      ? `nodes ${finding.nodeIds.join(', ')}`
      : finding.paths?.length
        ? `at ${finding.paths.join(', ')}`
        : null
    return where ? [`${finding.rule === null ? '' : `Rule ${finding.rule} `}${finding.code}: ${where}`] : []
  })
  for (const node of review.outline ?? []) {
    lines.push(
      [
        `${'  '.repeat(node.depth)}${node.id} ${node.componentId}`,
        ...Object.entries(node.grid ?? {}).map(([name, value]) => `${name}=${JSON.stringify(value)}`),
        ...(node.props.length ? [`props ${node.props.join(', ')}`] : []),
        ...(node.sx?.length ? [`sx ${node.sx.join(', ')}`] : []),
        ...(node.children.length ? [`holds ${node.children.join(', ')}`] : []),
      ].join(' · '),
    )
  }
  return lines
}

/**
 * A third-party player the plan lists, with what it costs the page, read
 * before the member confirms it (rule 16, AGL-3433). The cost is the
 * platform's sentence, never the model's: the player is framed lazily, so its
 * host's code loads when a visitor reaches it, whether or not they press play.
 */
export function aiPlanEmbedLine(
  embed: AiBuildPlanEmbed,
  named: (ref: string) => string,
): string {
  const host = AI_BUILD_PLAN_EMBED_HOST_NAMES[embed.host]
  const where = isAiPlanNewRef(embed.where) ? `the component ${named(embed.where)}` : embed.where
  const link = embed.url ? ` playing ${embed.url}` : ', its link left for you to paste'
  return `Embeds a ${host} player on ${where}${link}, as you asked (“${embed.asked}”). It loads ${host}’s own code when a visitor reaches it, whether or not they press play.`
}

export function AiJobPlan({
  job,
  onResume,
  busy = false,
  staff = false,
}: AiJobPlanProps): JSX.Element | null {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { plan, review } = job
  if (!plan && !review) return null
  const details = staff ? aiJobReviewDetails(review) : []
  /** A reference as a person reads it: the record's name, or what the plan creates. */
  const named = (ref: string | null): string =>
    !ref
      ? ''
      : isAiPlanNewRef(ref)
        ? ref.slice('new:'.length)
        : (plan?.labels[ref] ?? ref)
  const waiting = job.status === 'needs_review' && review !== null
  // The guard rail (AGL-2911): what the plan is estimated to cost is read
  // before it is confirmed, not after it has been spent. An estimate, and
  // said to be one — the plan's own passes at the nominal credits a step
  // holds, where what a step really costs is its model's tokens. A page job
  // counts the creations it builds before its page (AGL-3031).
  const estimate =
    plan && waiting && review.reason === 'plan' ? aiJobPlanCreditEstimate(job.kind, plan) : 0
  return (
    <Box sx={{ mt: 1 }}>
      {plan && (
        <Stack spacing={0.5} role="list" aria-label="Plan">
          <Typography variant="caption" color="text.secondary">
            {plan.status === 'confirmed' ? 'Confirmed plan' : 'Proposed plan'}
          </Typography>
          {plan.reuse.map((entry, index) => (
            <Typography key={`reuse-${index}`} variant="body2" role="listitem">
              Reuses the {entry.kind === 'screen' ? 'page' : entry.kind} {named(entry.id)} — {entry.purpose}
            </Typography>
          ))}
          {plan.create.map((entry, index) => (
            <Typography key={`create-${index}`} variant="body2" role="listitem">
              Creates the {AI_BUILD_PLAN_CREATION_NOUNS[entry.kind].noun} {entry.name}
              {entry.duplicateOf
                ? `, from a copy of ${named(entry.duplicateOf)}`
                : ''}{' '}
              — {entry.why}
            </Typography>
          ))}
          {plan.screens.map((screen, index) => (
            <Typography key={`screen-${index}`} variant="body2" role="listitem">
              {screen.record
                ? `Builds the record template ${screen.title}, a page per record of ${named(screen.record.dataset)} at /${screen.record.base}/…`
                : `Builds the page ${screen.title} at ${screen.slug}`}
              {screen.duplicateOf
                ? `, from a copy of ${named(screen.duplicateOf)}`
                : ''}
              {screen.layout ? ` in ${named(screen.layout)}` : ''}
              {screen.sections.length
                ? `: ${screen.sections.map((section) => section.name).join(', ')}`
                : ''}
            </Typography>
          ))}
          {(plan.embeds ?? []).map((embed, index) => (
            <Typography key={`embed-${index}`} variant="body2" role="listitem">
              {aiPlanEmbedLine(embed, named)}
            </Typography>
          ))}
        </Stack>
      )}
      {review?.reason === 'doctrine' && review.findings.length > 0 && (
        <Box
          component="ul"
          sx={{ my: 0.5, pl: 2.5 }}
          aria-label="Building rules broken"
        >
          {review.findings.map((finding, index) => (
            <Typography
              key={`finding-${index}`}
              component="li"
              variant="caption"
            >
              {finding.message}
            </Typography>
          ))}
        </Box>
      )}
      {details.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          <Button
            size="small"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((prior) => !prior)}
          >
            {detailsOpen ? 'Hide what was refused' : 'Show what was refused'}
          </Button>
          <Collapse in={detailsOpen} unmountOnExit>
            <Typography
              variant="caption"
              component="pre"
              aria-label="What was refused"
              sx={{ m: 0, fontFamily: 'monospace', whiteSpace: 'pre', overflowX: 'auto' }}
            >
              {details.join('\n')}
            </Typography>
          </Collapse>
        </Box>
      )}
      {estimate > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1 }}
        >
          {`Estimated cost: about ${estimate.toLocaleString('en-US')} credits. What it costs is what its steps spend.`}
        </Typography>
      )}
      {waiting && (
        <Button
          size="small"
          variant="contained"
          disabled={busy}
          onClick={() => onResume(job)}
          sx={{ mt: 1 }}
        >
          {review.reason === 'plan' ? 'Confirm plan' : 'Try again'}
        </Button>
      )}
    </Box>
  )
}

export default AiJobPlan
