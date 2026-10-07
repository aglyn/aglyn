'use client'

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

import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useConsoleHostRoute, useHostOrgId, useUser } from '@aglyn/tenant-feature-instance'
import { Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { AiInsightDialog } from './ai-insight-dialog.component'
import { useAiJobsVerdict } from './use-ai-job-run'

/**
 * "Ask AI about these numbers" (AGL-3603): a tile on a site's dashboard and
 * Analytics page (`hostDashboard`, which both draw) and on the workspace's
 * sites page (`orgDashboard`), opening the insight dialog the Assist panel
 * opens. A question becomes an `insight` job — the figures read by code
 * through the readers the surface offers, every insight traced to the rows
 * it cites — charged as that job is. Hidden until the jobs route says the
 * feature is this workspace's.
 */

export const AI_INSIGHT_CARD_COPY = {
  title: 'Ask AI about these numbers',
  site: 'Ask a question about this site’s traffic, sales, bookings, automation runs and pipeline. Every answer shows the figures it is built from.',
  workspace: 'Ask a question about your workspace’s pipeline, the deals it closed and your datasets. Every answer shows the figures it is built from.',
  action: 'Ask a question',
} as const

function InsightTile(props: {
  text: string
  orgId: string | null
  onAsk: () => void
}) {
  const help = pluginDocsHelp('aiInsights')
  return (
    <CardDisplay header={AI_INSIGHT_CARD_COPY.title} help={help} contentGutterX contentGutterY>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="body2" color="text.secondary">
          {props.text}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MdiIcon path={mdiCreation.path} />}
          disabled={!props.orgId}
          onClick={props.onAsk}
        >
          {AI_INSIGHT_CARD_COPY.action}
        </Button>
      </Stack>
    </CardDisplay>
  )
}

/** On a site's dashboard and its Analytics page. */
export function AiInsightHostCard({ hostId }: { hostId: string }) {
  const { data: user } = useUser()
  const orgId = useHostOrgId(hostId)
  const route = useConsoleHostRoute(hostId)
  const verdict = useAiJobsVerdict(user, orgId ?? undefined)
  const [open, setOpen] = useState(false)
  if (verdict !== 'ready' || !orgId) return null
  return (
    <>
      <InsightTile text={AI_INSIGHT_CARD_COPY.site} orgId={orgId} onAsk={() => setOpen(true)} />
      {open ? (
        <AiInsightDialog
          open
          onClose={() => setOpen(false)}
          orgId={orgId}
          orgSlug={route.orgSlug ?? ''}
          hostId={hostId}
          host={route.subdomain}
          surface="analytics"
          user={user}
          uid={(user as { uid?: string } | null | undefined)?.uid ?? null}
        />
      ) : null}
    </>
  )
}

/** On the workspace's sites page, totaling the organization rather than one site. */
export function AiInsightOrgCard({ orgMount }: { orgMount?: ConsolePluginOrgMount | null }) {
  const { data: user } = useUser()
  const orgId = orgMount?.orgId ?? null
  const verdict = useAiJobsVerdict(user, orgId ?? undefined)
  const [open, setOpen] = useState(false)
  if (verdict !== 'ready' || !orgId) return null
  return (
    <>
      <InsightTile text={AI_INSIGHT_CARD_COPY.workspace} orgId={orgId} onAsk={() => setOpen(true)} />
      {open ? (
        <AiInsightDialog
          open
          onClose={() => setOpen(false)}
          orgId={orgId}
          orgSlug={orgMount?.orgSlug ?? ''}
          hostId={null}
          host={null}
          surface="workspace"
          user={user}
          uid={(user as { uid?: string } | null | undefined)?.uid ?? null}
        />
      ) : null}
    </>
  )
}
