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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import type { ConsoleImportMappingZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { useHostOrgId } from '@aglyn/tenant-feature-instance'
import { Alert, Box, Button, CircularProgress, Link, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import {
  AI_CRM_IMPORT_COLLECTIONS,
  AI_CRM_MAX_COLUMNS,
  aiCrmColumnsInput,
  type AiCrmAnswerWanted,
  type AiCrmColumnMatch,
  type AiCrmImportCollection,
} from '../model/ai-crm'
import { useAiCrmAnswer } from './use-ai-crm-answer'

const collectionOf = (collection: string): AiCrmImportCollection | null =>
  (AI_CRM_IMPORT_COLLECTIONS as readonly string[]).includes(collection)
    ? (collection as AiCrmImportCollection)
    : null

/** A job's matches as the import drawer's matching: column index to field key. */
export function aiCrmMappingOf(matches: readonly AiCrmColumnMatch[]): Record<number, string> {
  return Object.fromEntries(matches.map((match) => [match.column, match.field]))
}

/**
 * "Match columns" (AGL-2917), in a CRM spreadsheet import through the
 * `importMapping` zone: a `crm` job matches the file's columns to the fields
 * the import fills, and the matching goes into the drawer's own table and
 * preview through `proposeMapping`. The drawer's Import is the write.
 *
 * What is sent is what the zone hands over: each column's header and the
 * shape of its values, read in the browser, never a cell. A file is new each
 * time, so the card recalls no earlier matching, and the answer door serves a
 * matching only to the member who asked.
 */
export function AiCrmImportMapping(props: ConsoleImportMappingZoneProps) {
  const { hostId, columns, proposeMapping } = props
  const hostOrgId = useHostOrgId(props.orgId || !hostId ? undefined : hostId)
  const orgId = props.orgId ?? hostOrgId ?? undefined
  const collection = collectionOf(props.collection)
  const wanted = useMemo<AiCrmAnswerWanted | null>(
    () => (collection ? { kind: 'mapping', collection } : null),
    [collection],
  )
  const run = useAiCrmAnswer({ orgId, hostId, wanted, recall: 'none' })
  const [matched, setMatched] = useState<{ jobId: string; count: number; of: number } | null>(null)

  if (!collection || run.verdict !== 'ready') return null

  const working = run.busy || run.running
  const tooMany = columns.length > AI_CRM_MAX_COLUMNS
  const help = pluginDocsHelp('aiCrm', {
    anchor: '#match-columns',
    excerpt: "Suggests which column fills which field. Only each column's header and the kind of values in it are sent.",
  })

  const match = async () => {
    setMatched(null)
    const answer = await run.ask(`Match the columns of a ${collection} import`, {
      task: 'mapping',
      collection,
      columns: aiCrmColumnsInput(columns),
    })
    if (answer?.proposal.kind !== 'mapping') return
    proposeMapping(aiCrmMappingOf(answer.proposal.matches), answer.jobId)
    setMatched({ jobId: answer.jobId, count: answer.proposal.matches.length, of: answer.proposal.columns })
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="Match columns with AI">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'Match columns with AI'}
          </Typography>
          <Link href={help.href} target="_blank" rel="noopener" variant="caption" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {'Only each column’s header and the kind of values under it are sent, never a row of your file.'}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            disabled={working || !orgId || !columns.length || tooMany}
            onClick={() => void match()}
          >
            {'Match columns'}
          </Button>
          {working ? <CircularProgress size={16} aria-label="Matching columns" /> : null}
        </Stack>
        {tooMany ? (
          <Typography variant="caption" color="text.secondary">
            {`AI matches files of up to ${AI_CRM_MAX_COLUMNS} columns.`}
          </Typography>
        ) : null}
        {matched ? (
          <Alert severity={matched.count ? 'success' : 'info'}>
            {matched.count
              ? `Matched ${matched.count} of ${matched.of} columns. Check the matches below before you import.`
              : 'No column matched a field. Choose the matches below.'}
          </Alert>
        ) : null}
        {run.notice ? <Alert severity="warning">{run.notice}</Alert> : null}
        {run.job?.error && !run.answer ? (
          <Alert severity={run.job.status === 'failed' ? 'error' : 'warning'}>{run.job.error}</Alert>
        ) : null}
      </Stack>
    </Box>
  )
}
AiCrmImportMapping.displayName = 'AiCrmImportMapping'

export default AiCrmImportMapping
