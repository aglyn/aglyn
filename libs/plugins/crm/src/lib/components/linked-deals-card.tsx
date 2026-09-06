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

import { dealStageById, pluginDocsHelp } from '@aglyn/aglyn'
import { mdiPlus } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { Button, Chip, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { type CrmOrgDoc, useCrmScope } from '../hooks/use-crm-scope'
import { useLinkedDeals } from '../hooks/use-deals'
import { usePipeline } from '../hooks/use-pipeline'
import { crmRoutes } from '../model/crm-routes'
import {
  DEAL_STATUS_LABELS,
  formatMoney,
} from '../model/deal-board-model'
import type { DealFormValues } from '../model/deal-form-model'
import { DealEditDrawer } from './deal-edit-drawer'

export interface LinkedDealsCardProps {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  org: CrmOrgDoc
  /** The CRM surface's own path, for links into deals. */
  basePath: string
  /** Which record this card sits on. */
  link: { contactId: string; contactName?: string } | { companyId: string; companyName?: string }
}

/**
 * The deals that name one record, on that record's page (AGL-2598).
 *
 * One bounded listener over the indexed link — `(visibleTo, contactId |
 * companyId, updatedAt DESC)` — and a "New deal" that opens the shared
 * drawer with this record already chosen, so a deal started from a person's
 * page is linked to them without anybody searching for them again. The
 * contact card and the company card are this component with the link
 * named; the two exports below exist so the pages that host them import
 * one name each.
 */
export function LinkedDealsCard(props: LinkedDealsCardProps) {
  const { hostId, org, basePath, link } = props
  const routes = crmRoutes(basePath)
  const scope = useCrmScope({ hostId, org })
  const pipelineState = usePipeline(scope.orgId, {
    hostId,
    org: (org ?? null) as Record<string, unknown> | null,
  })
  const { data: deals, status } = useLinkedDeals(
    scope.orgId,
    scope.visibleTo,
    'contactId' in link ? { contactId: link.contactId } : { companyId: link.companyId },
  )
  const [creating, setCreating] = useState(false)
  const defaults = useMemo<Partial<DealFormValues>>(
    () =>
      'contactId' in link
        ? { contactId: link.contactId, contactName: link.contactName ?? '' }
        : { companyId: link.companyId, companyName: link.companyName ?? '' },
    [link],
  )

  return (
    <>
      <CardDisplay
        header={'Deals'}
        help={pluginDocsHelp('deals', { anchor: '#a-deals-page' })}
        actions={
          <Button
            size="small"
            startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
            disabled={!pipelineState.pipeline || !scope.orgId}
            onClick={() => setCreating(true)}
          >
            {'New deal'}
          </Button>
        }
        contentGutterX
        contentGutterY
      >
        {status === 'success' && deals.length === 0 ? (
          <EmptyStateComponent
            compact
            label={'No deals yet'}
            description={'A deal started here is linked to this record from the first save.'}
            action={
              <Button
                size="small"
                variant="contained"
                startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
                disabled={!pipelineState.pipeline || !scope.orgId}
                onClick={() => setCreating(true)}
              >
                {'New deal'}
              </Button>
            }
          />
        ) : (
          <Stack spacing={1}>
            {deals.map((deal) => {
              const stage = dealStageById(
                pipelineState.pipelineById(deal.pipelineId),
                deal.stageId,
              )
              return (
                <Stack
                  key={deal.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
                >
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }} noWrap>
                    <AppLink href={routes.deal(deal.$id)}>{deal.title || 'Untitled deal'}</AppLink>
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={
                      deal.status === 'open'
                        ? (stage?.name ?? deal.stageId)
                        : DEAL_STATUS_LABELS[deal.status]
                    }
                    color={deal.status === 'won' ? 'success' : 'default'}
                  />
                  <Typography variant="body2" sx={{ minWidth: 90, textAlign: 'right' }}>
                    {typeof deal.amountCents === 'number'
                      ? formatMoney(deal.amountCents, deal.currency)
                      : '—'}
                  </Typography>
                </Stack>
              )
            })}
          </Stack>
        )}
      </CardDisplay>
      <DealEditDrawer
        open={creating}
        onClose={() => setCreating(false)}
        hostId={hostId}
        org={org}
        defaults={defaults}
        pipelines={pipelineState.activePipelines}
        defaultPipeline={pipelineState.pipeline}
      />
    </>
  )
}
LinkedDealsCard.displayName = 'LinkedDealsCard'

export default LinkedDealsCard
