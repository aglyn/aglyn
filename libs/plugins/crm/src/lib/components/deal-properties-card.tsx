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

import {
  type ContactFieldDefinition,
  CRM_FORECAST_CATEGORY_LABELS,
  dealForecastCategory,
  dealProbability,
  dealStageById,
  pluginDocsHelp,
  readDealProbability,
  weightedDealAmountCents,
} from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Link, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { formatContactCustomValue } from './contact-custom-columns'
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
  /**
   * The org's ACTIVE deal field definitions (AGL-2661), one row each under
   * the fixed properties. Handed in by the page, which resolves the org
   * once for every card on it.
   */
  customFields?: readonly ContactFieldDefinition[]
  /** The deal's campaign by name, resolved by the page; absent when it names none. */
  campaignName?: string
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
 *
 * Salesforce's Opportunity fields (AGL-3516) follow: the Type, the Lead
 * source, the Next step, the probability — the deal's own override, with
 * its stage's beside it, or the stage's — the forecast category and the
 * campaign. Edit changes them; a stage move re-stamps the last two.
 */
export function DealPropertiesCard(props: DealPropertiesCardProps) {
  const { deal, pipeline, ownerLabel, routes, customFields = [], campaignName } = props
  const stage = dealStageById(pipeline, deal.stageId)
  const weighted = weightedDealAmountCents(deal, stage)
  const probability = dealProbability(deal, stage)
  const overridden = typeof readDealProbability(deal.probability) === 'number'
  const createdMs = timestampMs(deal.createdAt)
  return (
    <CardDisplay
      header={'Properties'}
      help={pluginDocsHelp('deals', {
        anchor: '#a-deals-page',
        title: 'Properties',
        excerpt:
          'The amount and its weighted value, the probability beside its ' +
          "stage's, the forecast category, the expected close, the owner and " +
          'every custom deal field. Edit carries a control for each.',
      })}
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
            (deal.status === 'open' && stage && probability !== null ? ` at ${probability}%` : '')}
        </Row>
        <Row label="Probability">
          {probability === null
            ? 'Not set'
            : overridden && stage
              ? `${probability}% · from stage: ${stage.probability}%`
              : `${probability}%`}
        </Row>
        <Row label="Forecast category">
          {CRM_FORECAST_CATEGORY_LABELS[dealForecastCategory(deal, stage)]}
        </Row>
        <Row label="Expected close">
          {typeof deal.expectedCloseAtMs === 'number'
            ? new Date(deal.expectedCloseAtMs).toLocaleDateString()
            : 'Not set'}
        </Row>
        <Row label="Type">{deal.type || 'Not set'}</Row>
        <Row label="Lead source">{deal.leadSource || 'Not set'}</Row>
        <Row label="Next step">{deal.nextStep || 'Not set'}</Row>
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
        <Row label="Campaign">{campaignName || 'None'}</Row>
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
        {/*
          The org's own deal fields (AGL-2661), after the built-in ones under
          "More fields", as a record's Details keep them; none defined, none
          drawn.
        */}
        {customFields.length ? (
          <Typography variant="subtitle2" sx={{ pt: 1 }}>
            {'More fields'}
          </Typography>
        ) : null}
        {customFields.map((definition) => {
          const text = formatContactCustomValue(definition, deal.custom?.[definition.key])
          return (
            <Row key={definition.key} label={definition.label || definition.key}>
              {text && definition.type === 'url' ? (
                <Link href={text} target="_blank" rel="noreferrer noopener">
                  {text}
                </Link>
              ) : (
                text || 'Not set'
              )}
            </Row>
          )
        })}
      </Stack>
    </CardDisplay>
  )
}
DealPropertiesCard.displayName = 'DealPropertiesCard'

export default DealPropertiesCard
