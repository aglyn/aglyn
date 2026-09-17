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

import { act, render } from '@testing-library/react'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'

/**
 * The `recordInsights` zone on a CRM record's page (AGL-2917): hosted through
 * the shell's renderer and nowhere else, handing a widget the record and the
 * doors the page owns — a proposed task opens the CRM's own task form filled
 * in, and a proposed stage is confirmed before the stage route moves the deal.
 * Nothing a widget hands back is written by the zone itself.
 */

const confirm = jest.fn()
const enqueueSnackbar = jest.fn()
const scope = { scope: ['orgs', 'org-1'], orgId: 'org-1', visibleTo: ['org', 'host:site-1'] }
let drawerProps: Record<string, unknown> | null = null

jest.mock('../hooks/use-crm-scope', () => ({ useCrmScope: () => scope }))
jest.mock('@aglyn/shared-ui-jsx', () => ({ useConfirmationContext: () => ({ confirm: (...args: unknown[]) => confirm(...args) }) }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: (...args: unknown[]) => enqueueSnackbar(...args) }) }))
jest.mock('./task-edit-drawer', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    drawerProps = props
    return null
  },
}))

import { CrmRecordInsightsZone, crmProposedDueAtMs } from './crm-record-insights-zone'

let zone: Record<string, unknown> | null = null
function ZoneRenderer(props: Record<string, unknown>) {
  zone = props
  return null
}

const PIPELINE = {
  name: 'Sales',
  stages: [
    { id: 'qualified', name: 'Qualified', order: 0, probability: 10, kind: 'open' },
    { id: 'proposal', name: 'Proposal sent', order: 1, probability: 40, kind: 'open' },
    { id: 'won', name: 'Won', order: 2, probability: 100, kind: 'won' },
  ],
}
const moveToStage = jest.fn()
const api = { moveToStage, markWon: jest.fn(), markLost: jest.fn() }

const inShell = (ui: React.ReactElement) =>
  render(<ConsoleWidgetSlotContext.Provider value={ZoneRenderer}>{ui}</ConsoleWidgetSlotContext.Provider>)

beforeEach(() => {
  zone = null
  drawerProps = null
  jest.clearAllMocks()
  confirm.mockResolvedValue(undefined)
  moveToStage.mockResolvedValue({ ok: true })
})

describe('the record insights zone', () => {
  it('draws nothing outside the console shell, and reads nothing', () => {
    render(<CrmRecordInsightsZone hostId="site-1" kind="contact" recordId="c-1" name="Dana" taskLink={{ contactId: 'c-1' }} />)
    expect(zone).toBeNull()
    expect(drawerProps).toBeNull()
  })

  it('hands a contact’s widget the record and a task door, and opens the CRM task form with the proposal', async () => {
    inShell(<CrmRecordInsightsZone hostId="site-1" kind="contact" recordId="c-1" name="Dana" taskLink={{ contactId: 'c-1' }} />)
    expect(zone).toMatchObject({ slot: 'recordInsights', hostId: 'site-1', orgId: 'org-1', record: { kind: 'contact', id: 'c-1', name: 'Dana' } })
    expect(zone).not.toHaveProperty('proposeStage')
    expect(drawerProps).toMatchObject({ open: false })
    await act(async () => {
      ;(zone?.['proposeTask'] as (task: unknown, key: string) => void)(
        { title: 'Call Dana', notes: 'She opened the quote.', kind: 'call', priority: 'high', dueInDays: 2 },
        'job-1',
      )
    })
    expect(drawerProps).toMatchObject({
      open: true,
      hostId: 'site-1',
      orgId: 'org-1',
      scope: scope.scope,
      readTokens: scope.visibleTo,
      prefill: { contactId: 'c-1', title: 'Call Dana', notes: 'She opened the quote.', kind: 'call', priority: 'high' },
    })
    const due = new Date((drawerProps?.['prefill'] as { dueAtMs: number }).dueAtMs)
    expect(due.getHours()).toBe(17)
    await act(async () => {
      ;(drawerProps?.['onClose'] as () => void)()
    })
    expect(drawerProps).toMatchObject({ open: false })
  })

  it('offers a lead no task, which no task can name', () => {
    inShell(<CrmRecordInsightsZone hostId="site-1" kind="lead" recordId="l-1" name="Sam" />)
    expect(zone).toMatchObject({ record: { kind: 'lead', id: 'l-1' } })
    expect(zone).not.toHaveProperty('proposeTask')
    expect(drawerProps).toBeNull()
  })

  it('moves a deal to an open stage through its stage route, once the member confirms', async () => {
    const deal = { pipeline: PIPELINE as never, ref: { $id: 'd-1', hostId: 'site-1' }, stageId: 'qualified', status: 'open', api: api as never }
    inShell(<CrmRecordInsightsZone hostId={null} kind="deal" recordId="d-1" name="Re-roof" taskLink={{ dealId: 'd-1' }} deal={deal} />)
    expect(zone).toMatchObject({
      hostId: null,
      stageId: 'qualified',
      stages: [
        { id: 'qualified', name: 'Qualified' },
        { id: 'proposal', name: 'Proposal sent' },
      ],
    })
    const proposeStage = zone?.['proposeStage'] as (stageId: string, key: string) => void
    await act(async () => proposeStage('proposal', 'job-1'))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Move this deal to Proposal sent?' }))
    expect(moveToStage).toHaveBeenCalledWith({ $id: 'd-1', hostId: 'site-1' }, 'proposal')
    // Winning, the current stage, and a stage the pipeline lacks are not moves this door makes.
    for (const stageId of ['won', 'qualified', 'contract']) await act(async () => proposeStage(stageId, 'job-1'))
    expect(moveToStage).toHaveBeenCalledTimes(1)
    // Nor is anything, once the member declines.
    confirm.mockRejectedValueOnce(new Error('declined'))
    await act(async () => proposeStage('proposal', 'job-2'))
    expect(moveToStage).toHaveBeenCalledTimes(1)
  })

  it('moves nothing on a deal that is already closed', async () => {
    const deal = { pipeline: PIPELINE as never, ref: { $id: 'd-1' }, stageId: 'won', status: 'won', api: api as never }
    inShell(<CrmRecordInsightsZone hostId="site-1" kind="deal" recordId="d-1" name="Re-roof" taskLink={{ dealId: 'd-1' }} deal={deal} />)
    await act(async () => (zone?.['proposeStage'] as (stageId: string, key: string) => void)('proposal', 'job-1'))
    expect(confirm).not.toHaveBeenCalled()
    expect(moveToStage).not.toHaveBeenCalled()
  })

  it('dates a proposed task at the end of the working day, days from today', () => {
    const now = new Date(2026, 8, 16, 9, 30).getTime()
    const due = new Date(crmProposedDueAtMs(3, now))
    expect([due.getFullYear(), due.getMonth(), due.getDate(), due.getHours(), due.getMinutes()]).toEqual([2026, 8, 19, 17, 0])
    expect(new Date(crmProposedDueAtMs(-4, now)).getDate()).toBe(16)
  })
})
