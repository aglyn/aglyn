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

/**
 * The deal page's Properties card (AGL-3516): Salesforce's Opportunity
 * fields read as the deal holds them — the deal's own probability beside
 * its stage's, the forecast category its own else its stage's, and the
 * campaign by the name the page resolved.
 */

import { DEFAULT_DEAL_STAGES } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import { crmRoutes } from '../model/crm-routes'
import type { DealDoc, PipelineDoc } from '../model/deal-board-model'
import { DealPropertiesCard } from './deal-properties-card'

const pipeline = { $id: 'sales', name: 'Sales', stages: [...DEFAULT_DEAL_STAGES] } as PipelineDoc

const deal = (fields: Partial<DealDoc>): DealDoc => ({
  $id: 'd1',
  title: 'Roaster',
  pipelineId: 'sales',
  stageId: 'proposal-price-quote',
  status: 'open',
  amountCents: 100_000,
  currency: 'usd',
  visibleTo: ['org'],
  hostId: 'shop',
  ...fields,
})

/** The value beside a row's label. */
const row = (label: string) => screen.getByText(label).nextElementSibling?.textContent

function mount(record: DealDoc, campaignName?: string) {
  render(
    <DealPropertiesCard
      deal={record}
      pipeline={pipeline}
      ownerLabel=""
      routes={crmRoutes('/acme/crm')}
      campaignName={campaignName}
    />,
  )
}

describe('the deal Properties card (AGL-3516)', () => {
  it("reads the stage's odds and category on a deal that sets neither", () => {
    mount(deal({}))
    expect(row('Probability')).toBe('75%')
    expect(row('Forecast category')).toBe('Best Case')
    expect(row('Weighted value')).toMatch(/750\.00 at 75%/)
    expect(row('Type')).toBe('Not set')
    expect(row('Campaign')).toBe('None')
  })

  it("reads the deal's own override beside its stage's, and its own category and fields", () => {
    mount(
      deal({
        probability: 40,
        forecastCategory: 'commit',
        type: 'New Business',
        leadSource: 'Trade show',
        nextStep: 'Send the quote',
        campaignId: 'spring',
      }),
      'Spring launch',
    )
    expect(row('Probability')).toBe('40% · from stage: 75%')
    expect(row('Forecast category')).toBe('Commit')
    expect(row('Weighted value')).toMatch(/400\.00 at 40%/)
    expect(row('Type')).toBe('New Business')
    expect(row('Lead source')).toBe('Trade show')
    expect(row('Next step')).toBe('Send the quote')
    expect(row('Campaign')).toBe('Spring launch')
  })
})
