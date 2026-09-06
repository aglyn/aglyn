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

import { dateInputValue } from './deal-board-model'
import { DEAL_CSV_COLUMNS, csvAmount, dealsCsv } from './deals-csv'

/**
 * The deals file (AGL-2621): stage and pipeline by name, the amount in
 * major units beside its currency, the owner by address, the contact and
 * the company by caption, and the close as a calendar day.
 */
describe('the deals CSV', () => {
  it('writes the amount in major units and an empty currency for no amount', () => {
    expect(csvAmount(125000)).toBe('1250.00')
    expect(csvAmount(5)).toBe('0.05')
    expect(csvAmount(null)).toBe('')
  })

  it('names the pipeline, the stage and the owner, and captions the records', () => {
    const closeMs = Date.UTC(2026, 8, 30, 12)
    const csv = dealsCsv(
      [
        {
          title: 'Acme, renewal',
          pipelineId: 'default',
          stageId: 'negotiation',
          status: 'open',
          amountCents: 125000,
          currency: 'usd',
          ownerUid: 'uid-1',
          expectedCloseAtMs: closeMs,
          contactName: 'Ada',
          companyName: 'Acme',
          notes: 'Q4',
        },
        {
          title: 'Globex',
          pipelineId: 'other',
          stageId: 'lost',
          status: 'lost',
          closedAtMs: Date.UTC(2026, 0, 2),
          lostReason: 'Went with a competitor',
        },
      ],
      {
        pipelineName: (id) => (id === 'default' ? 'Sales' : undefined),
        stageName: (pipelineId, stageId) =>
          pipelineId === 'default' && stageId === 'negotiation' ? 'Negotiation' : undefined,
        ownerEmail: (uid) => (uid === 'uid-1' ? 'owner@example.com' : uid),
      },
    )
    expect(csv.split('\n')).toEqual([
      DEAL_CSV_COLUMNS.join(','),
      `"Acme, renewal",Sales,Negotiation,1250.00,USD,owner@example.com,${dateInputValue(closeMs)},Open,Ada,Acme,,,Q4`,
      'Globex,other,lost,,,,,Lost,,,2026-01-02T00:00:00.000Z,Went with a competitor,',
    ])
  })
})
