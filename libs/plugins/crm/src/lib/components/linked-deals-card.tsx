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

import { dealContactRolesOf, dealStageById, pluginDocsHelp } from '@aglyn/aglyn'
import { mdiPlus } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { Button, Chip, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { type CrmOrgDoc, useCrmScope } from '../hooks/use-crm-scope'
import { useCrmFoldsScope } from '../hooks/use-crm-list-query'
import { useContactRoleDeals, useLinkedDeals } from '../hooks/use-deals'
import { usePipeline } from '../hooks/use-pipeline'
import { crmRoutes } from '../model/crm-routes'
import {
  type DealDoc,
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
 *
 * On a contact's page the card also lists the deals the person is on in
 * any other role (AGL-3521) — a second listener, `useContactRoleDeals`,
 * merged by id — and names the part they play on each.
 */
export function LinkedDealsCard(props: LinkedDealsCardProps) {
  const { hostId, org, basePath, link } = props
  const routes = crmRoutes(basePath)
  const scope = useCrmScope({ hostId, org })
  const pipelineState = usePipeline(scope.orgId, {
    hostId,
    org: (org ?? null) as Record<string, unknown> | null,
  })
  const { data: linked, status } = useLinkedDeals(
    scope.orgId,
    scope.visibleTo,
    'contactId' in link ? { contactId: link.contactId } : { companyId: link.companyId },
  )
  const contactId = 'contactId' in link ? link.contactId : null
  const foldsScope = useCrmFoldsScope(scope.orgId, scope.visibleTo)
  const { data: roleDeals } = useContactRoleDeals(scope.orgId, scope.visibleTo, foldsScope, contactId)
  // The two answers as one list, newest first; a deal in both is listed once.
  const deals = useMemo(() => {
    const byId = new Map<string, DealDoc>()
    for (const deal of [...(linked ?? []), ...(roleDeals ?? [])]) byId.set(deal.$id, deal)
    return [...byId.values()].sort((a, b) => updatedMs(b) - updatedMs(a))
  }, [linked, roleDeals])
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
        HeaderProps={{
          action: (
            <Button
              size="small"
              startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
              disabled={!pipelineState.pipeline || !scope.orgId}
              onClick={() => setCreating(true)}
            >
              {'New deal'}
            </Button>
          ),
        }}
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
                  useFlexGap
                  key={deal.$id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
                >
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }} noWrap>
                    <AppLink href={routes.deal(deal.$id)}>{deal.title || 'Untitled deal'}</AppLink>
                  </Typography>
                  {contactId ? <ContactRoleChip deal={deal} contactId={contactId} /> : null}
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

/** When a deal was last written, for the merged list's order. */
function updatedMs(deal: DealDoc): number {
  const value = (deal as { updatedAt?: unknown }).updatedAt
  if (value instanceof Date) return value.getTime()
  const stamp = value as { toMillis?: () => number } | null | undefined
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0
}

/** The part this contact plays on a deal — its role, and Primary when they are. */
function ContactRoleChip(props: { deal: DealDoc; contactId: string }) {
  const row = dealContactRolesOf(props.deal).find((entry) => entry.contactId === props.contactId)
  if (!row) return null
  const label = [row.role, row.primary ? 'Primary' : null].filter(Boolean).join(' · ')
  return label ? <Chip size="small" label={label} /> : null
}

export default LinkedDealsCard
