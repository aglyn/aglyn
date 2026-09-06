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

import { dealStageById, pluginDocsHelp, weightedDealAmountCents } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import {
  type DealDoc,
  formatMoney,
  type PipelineDoc,
  timestampMs,
} from '../model/deal-board-model'
import type { CrmRoutes } from '../model/crm-routes'

export interface DealPropertiesCardProps {
  deal: DealDoc
  pipeline: PipelineDoc | null
  ownerLabel: string
  routes: CrmRoutes
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 120, flexShrink: 0 }}
      >
        {props.label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 0 }}>
        {props.children}
      </Typography>
    </Stack>
  )
}

/**
 * What the deal is worth and who it is with (AGL-2598).
 *
 * The weighted value is computed here from the live pipeline rather than
 * stored, because the stage's probability is the merchant's to change and
 * a stored figure would go stale the moment they did. The contact and the
 * company are links into their own pages — the id is the link; the name on
 * the deal is a caption that may lag a rename.
 */
export function DealPropertiesCard(props: DealPropertiesCardProps) {
  const { deal, pipeline, ownerLabel, routes } = props
  const stage = dealStageById(pipeline, deal.stageId)
  const weighted = weightedDealAmountCents(deal, stage)
  const createdMs = timestampMs(deal.createdAt)
  return (
    <CardDisplay
      header={'Properties'}
      help={pluginDocsHelp('deals', { anchor: '#a-deals-page' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.25}>
        <Row label="Amount">
          {typeof deal.amountCents === 'number'
            ? formatMoney(deal.amountCents, deal.currency)
            : 'Not set'}
        </Row>
        <Row label="Weighted value">
          {`${formatMoney(weighted, deal.currency)}` +
            (deal.status === 'open' && stage ? ` at ${stage.probability}%` : '')}
        </Row>
        <Row label="Expected close">
          {typeof deal.expectedCloseAtMs === 'number'
            ? new Date(deal.expectedCloseAtMs).toLocaleDateString()
            : 'Not set'}
        </Row>
        <Row label="Owner">{ownerLabel || 'Nobody yet'}</Row>
        <Row label="Contact">
          {deal.contactId ? (
            <AppLink href={routes.contact(deal.contactId)}>
              {deal.contactName || 'Open contact'}
            </AppLink>
          ) : (
            'None'
          )}
        </Row>
        <Row label="Company">
          {deal.companyId ? (
            <AppLink href={routes.company(deal.companyId)}>
              {deal.companyName || 'Open company'}
            </AppLink>
          ) : (
            'None'
          )}
        </Row>
        <Row label="Pipeline">{pipeline?.name ?? deal.pipelineId}</Row>
        <Row label="Created">
          {createdMs ? new Date(createdMs).toLocaleDateString() : '—'}
        </Row>
        {deal.notes ? (
          <Row label="Notes">
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {deal.notes}
            </Typography>
          </Row>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
DealPropertiesCard.displayName = 'DealPropertiesCard'

export default DealPropertiesCard
