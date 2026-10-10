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
import { aiBuildFreePageCapNote, aiBuildSmaller, aiJobCreditRange } from '../model/ai-build-job'
import { aiCreditRangeText, aiCreditsPromptFor } from '../model/ai-credit-estimate'
import { aiFreeCreditsResetLabel } from '../model/ai-site-job'
import { AiCreditsPromptNotice } from './ai-credits-prompt.component'
import type { AiJobResumeOptions } from './ai-job-requests'
import { aiBuildOpNoun } from '../model/ai-build-progress'
import { aiJobConfirmingOwnPlan } from '../model/ai-job-activity'
import { aiSiteStarterFallbackOffered } from '../model/ai-job-failure-copy'
import { AiSiteStarterFallback } from './ai-site-starter-fallback.component'
import { Box, Button, Checkbox, Collapse, FormControlLabel, Stack, Typography } from '@mui/material'
import { useState } from 'react'

/**
 * A job's plan and what it waits for (AGL-2935), inside the AI jobs drawer
 * and the dialog that started the job (AGL-3593): what the job reuses from
 * the site, what it creates and why, the screens it builds — and, while the
 * job waits for a person, the one button that confirms the plan or tries a
 * refused step again. Both send the same request (`resumeAiJobRequest`);
 * this renders.
 */
export interface AiJobPlanProps {
  job: AiJobSummary
  /**
   * Confirms the plan, or tries the refused step again. A build whose request
   * asked to publish confirms with `publish` when its box is ticked (AGL-3616).
   */
  onResume: (job: AiJobSummary, options?: AiJobResumeOptions) => void
  /** A resume for this job is in flight. */
  busy?: boolean
  /**
   * The viewer is staff (AGL-3078), who can open where a refused answer broke
   * its rules and the outline of those parts, to tell a shape the rules should
   * allow from an answer that ignored its re-ask. A member reads the findings.
   */
  staff?: boolean
  /**
   * The signed-in user, for "Use the starter site instead" on a guided start
   * that did not work out (AGL-3594); the action is drawn only when given.
   */
  user?: Parameters<typeof AiSiteStarterFallback>[0]['user']
  /** The workspace's path slug, for the Upgrade a Free build past what is left offers (AGL-3722). */
  orgSlug?: string | null
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
  user,
  orgSlug,
}: AiJobPlanProps): JSX.Element | null {
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Unticked until the person ticks it: a build publishes only when its
  // request asked AND they confirm it here (AGL-3616).
  const [publish, setPublish] = useState(false)
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
  // A plan the machine is confirming itself is not one to confirm (AGL-3596).
  const waiting = job.status === 'needs_review' && review !== null && !aiJobConfirmingOwnPlan(job)
  // The guard rail (AGL-2911): what the plan is estimated to cost is read
  // before it is confirmed, not after it has been spent. An estimate, and
  // said to be one: what it is likely to cost — what builds like it measured
  // — and its ceiling, every pass at its reserve (AGL-3722). A page job
  // counts the creations it builds before its page (AGL-3031).
  const range = plan && waiting && review.reason === 'plan' ? aiJobCreditRange(job.kind, plan) : null
  // A Free build past what is left asks first (AGL-3722): build what fits,
  // the home page first, or upgrade — never a refusal with no way on.
  const freeCredits = review?.freeCredits ?? null
  const prompt =
    plan && range && job.kind === 'build' ? aiCreditsPromptFor(range, freeCredits, aiBuildSmaller(plan)) : null
  // A Free build at its page cap says so (AGL-3722): pages past it were left for a later request.
  const pageCapNote =
    plan && waiting && review.reason === 'plan' && job.kind === 'build'
      ? aiBuildFreePageCapNote(plan, Boolean(freeCredits))
      : null
  const offersPublish = job.kind === 'build' && job.publishAsked === true && waiting && review.reason === 'plan'
  const publishing = offersPublish && publish ? { publish: true } : {}
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
          {(plan.items ?? []).map((item) => (
            <Typography key={`item-${item.slot}`} variant="body2" role="listitem">
              {`Makes the ${aiBuildOpNoun(item.op).toLowerCase()} ${item.name}`}
              {item.why ? ` — ${item.why}` : ''}
            </Typography>
          ))}
          {(plan.embeds ?? []).map((embed, index) => (
            <Typography key={`embed-${index}`} variant="body2" role="listitem">
              {aiPlanEmbedLine(embed, named)}
            </Typography>
          ))}
        </Stack>
      )}
      {/*
        A review written for the member (AGL-3594) carries the checks' own
        sentence as `detail`: its findings are then staff reading too, and the
        member reads the job's one sentence alone.
      */}
      {staff && review?.detail && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          {review.detail}
        </Typography>
      )}
      {review?.reason === 'doctrine' && review.findings.length > 0 && (staff || !review.detail) && (
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
      {range && range.ceiling > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1 }}
        >
          {`Estimated cost: ${aiCreditRangeText(range)}. What it costs is what its steps spend.`}
          {freeCredits && !prompt
            ? ` You have ${freeCredits.left.toLocaleString('en-US')} of your free AI credits left this month, until ${aiFreeCreditsResetLabel(freeCredits.resetsOn)}.`
            : ''}
        </Typography>
      )}
      {pageCapNote && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {pageCapNote}
        </Typography>
      )}
      {waiting && review.retryRefusal && review.reason !== 'plan' && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {review.retryRefusal}
        </Typography>
      )}
      {offersPublish && (
        <FormControlLabel
          sx={{ display: 'flex', mt: 1 }}
          control={<Checkbox size="small" checked={publish} onChange={(event) => setPublish(event.target.checked)} />}
          label={<Typography variant="body2">{'Publish the new pages when they are built'}</Typography>}
        />
      )}
      {waiting && prompt && (
        <AiCreditsPromptNotice
          prompt={prompt}
          noun="build"
          orgSlug={orgSlug}
          busy={busy}
          onBuildWhatFits={() => onResume(job, { ...publishing, creditsConfirmed: true })}
          onSmaller={() => onResume(job, { ...publishing, creditsConfirmed: true, reduce: 'first-page' })}
        />
      )}
      {waiting && !prompt && (
        <Button
          size="small"
          variant="contained"
          // Disabled with its reason above when the Free allowance left
          // cannot pay for another try (AGL-3594).
          disabled={busy || (review.reason !== 'plan' && Boolean(review.retryRefusal))}
          onClick={() => onResume(job, offersPublish && publish ? publishing : undefined)}
          sx={{ mt: 1 }}
        >
          {review.reason === 'plan' ? 'Confirm plan' : 'Try again'}
        </Button>
      )}
      {/* A guided start that did not work out can take the starter instead (AGL-3594). */}
      {waiting && user && aiSiteStarterFallbackOffered(job) && <AiSiteStarterFallback job={job} user={user} />}
    </Box>
  )
}

export default AiJobPlan
