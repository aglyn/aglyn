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

import { Box, Button, Card, Chip, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AI_JOB_WHEN, aiJobKindLabel } from './ai-jobs-list-page.component'

/** How much of a request shows before Show all. */
export const AI_JOB_REQUEST_PREVIEW_CHARS = 280

/**
 * What a job is for: its kind, when it started, and the request itself, word
 * for word. A job's heading says where it stands and could be any job's, so
 * this is what tells one apart from the rest.
 */
export function AiJobRequest({ job }: { job: Pick<AiJobSummary, 'kind' | 'brief' | 'createdAt'> }) {
  const [showAll, setShowAll] = useState(false)
  const brief = job.brief.trim()
  const long = brief.length > AI_JOB_REQUEST_PREVIEW_CHARS
  const created = new Date(job.createdAt)
  return (
    <Card variant="outlined" component="section" aria-label="What this job is for" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Chip size="small" variant="outlined" label={aiJobKindLabel(job.kind)} />
          {Number.isNaN(created.getTime()) ? null : (
            <Typography variant="caption" color="text.secondary">
              <time dateTime={job.createdAt}>{AI_JOB_WHEN.format(created)}</time>
            </Typography>
          )}
        </Stack>
        {brief ? (
          <Box>
            <Typography variant="overline" color="text.secondary" component="h2">
              {'Request'}
            </Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {long && !showAll ? `${brief.slice(0, AI_JOB_REQUEST_PREVIEW_CHARS).trimEnd()}…` : brief}
            </Typography>
            {long ? (
              <Button size="small" sx={{ mt: 0.5, ml: -0.5 }} onClick={() => setShowAll((open) => !open)}>
                {showAll ? 'Show less' : 'Show all'}
              </Button>
            ) : null}
          </Box>
        ) : null}
      </Stack>
    </Card>
  )
}

export default AiJobRequest
