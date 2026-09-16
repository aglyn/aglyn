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

import { isAiPlanNewRef } from '../model/ai-build-plan'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { Box, Button, Stack, Typography } from '@mui/material'

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
}

export function AiJobPlan({ job, onResume, busy = false }: AiJobPlanProps): JSX.Element | null {
  const { plan, review } = job
  if (!plan && !review) return null
  /** A reference as a person reads it: the record's name, or what the plan creates. */
  const named = (ref: string | null): string =>
    !ref ? '' : isAiPlanNewRef(ref) ? ref.slice('new:'.length) : (plan?.labels[ref] ?? ref)
  const waiting = job.status === 'needs_review' && review !== null
  return (
    <Box sx={{ mt: 1 }}>
      {plan && (
        <Stack spacing={0.5} role="list" aria-label="Plan">
          <Typography variant="caption" color="text.secondary">
            {plan.status === 'confirmed' ? 'Confirmed plan' : 'Proposed plan'}
          </Typography>
          {plan.reuse.map((entry, index) => (
            <Typography key={`reuse-${index}`} variant="body2" role="listitem">
              Reuses the {entry.kind} {named(entry.id)} — {entry.purpose}
            </Typography>
          ))}
          {plan.create.map((entry, index) => (
            <Typography key={`create-${index}`} variant="body2" role="listitem">
              Creates the {entry.kind} {entry.name}
              {entry.duplicateOf ? `, from a copy of ${named(entry.duplicateOf)}` : ''} — {entry.why}
            </Typography>
          ))}
          {plan.screens.map((screen, index) => (
            <Typography key={`screen-${index}`} variant="body2" role="listitem">
              Builds the screen {screen.title} at {screen.slug}
              {screen.layout ? ` in ${named(screen.layout)}` : ''}
              {screen.sections.length
                ? `: ${screen.sections.map((section) => section.name).join(', ')}`
                : ''}
            </Typography>
          ))}
        </Stack>
      )}
      {review?.reason === 'doctrine' && review.findings.length > 0 && (
        <Box component="ul" sx={{ my: 0.5, pl: 2.5 }} aria-label="Building rules broken">
          {review.findings.map((finding, index) => (
            <Typography key={`finding-${index}`} component="li" variant="caption">
              {finding.message}
            </Typography>
          ))}
        </Box>
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
