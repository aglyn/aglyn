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

import { render } from '@testing-library/react'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'

/**
 * The `crmRecordEmailActions` zone (AGL-4020): before a contact's or a lead's
 * Send email, through the shell's renderer and nowhere else, handing a widget
 * the person — so the plugin that keeps a thread with them can offer to
 * answer it there.
 */

const mockScope = jest.fn(() => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', visibleTo: null }))
jest.mock('../hooks/use-crm-scope', () => ({ useCrmScope: (...args: unknown[]) => mockScope(...(args as [])) }))

import { CRM_RECORD_EMAIL_ACTIONS_ZONE, CrmRecordEmailActionsZone } from './crm-email-actions-zone'

let drawn: Record<string, unknown> | null = null
function ZoneRenderer(props: Record<string, unknown>) {
  drawn = props
  return null
}

const inShell = (ui: React.ReactElement) =>
  render(<ConsoleWidgetSlotContext.Provider value={ZoneRenderer}>{ui}</ConsoleWidgetSlotContext.Provider>)

beforeEach(() => {
  drawn = null
  mockScope.mockClear()
})

describe('the record email actions zone', () => {
  it('hands a widget the site, the organization and the person', () => {
    inShell(
      <CrmRecordEmailActionsZone hostId="site-1" kind="lead" recordId="lead-1" name="Pat Example" email="pat@example.com" />,
    )
    expect(drawn).toEqual({
      slot: CRM_RECORD_EMAIL_ACTIONS_ZONE.id,
      hostId: 'site-1',
      orgId: 'org-1',
      kind: 'lead',
      recordId: 'lead-1',
      name: 'Pat Example',
      email: 'pat@example.com',
    })
    expect(CRM_RECORD_EMAIL_ACTIONS_ZONE.id).toBe('crmRecordEmailActions')
  })

  it('draws nothing, and reads nothing, outside the shell or for a record with no address', () => {
    render(<CrmRecordEmailActionsZone hostId="site-1" kind="contact" recordId="c-1" name="Dana" email="dana@example.com" />)
    inShell(<CrmRecordEmailActionsZone hostId="site-1" kind="contact" recordId="c-1" name="Dana" email={null} />)
    expect(drawn).toBeNull()
    expect(mockScope).not.toHaveBeenCalled()
  })
})
