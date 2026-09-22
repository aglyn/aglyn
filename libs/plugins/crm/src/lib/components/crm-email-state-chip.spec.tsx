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

import { render, screen } from '@testing-library/react'
import { CrmEmailStateChip } from './crm-email-state-chip'
import { CrmSendEmailButton } from './crm-send-email-button'

/**
 * The record's email state where a member decides (AGL-3245): the chip
 * beside the status, with the date and the server's words on hover, and
 * Send email disabled with the reason when the state forbids email.
 */

jest.mock('../hooks/use-crm-org-mount', () => ({ useCrmOrgMount: () => null }))
jest.mock('./crm-send-email-dialog', () => ({ __esModule: true, default: () => null }))

const AT = Date.UTC(2026, 8, 22, 15, 30)

describe('CrmEmailStateChip', () => {
  it('names the verdict, and carries when and what the server said', () => {
    render(
      <CrmEmailStateChip
        state={{ status: 'blocked', atMs: AT, source: 'outreach', detail: '550 (the address:blocked)' }}
      />,
    )
    const chip = screen.getByTestId('crm-email-state')
    expect(chip.textContent).toBe('Blocked by their mail gateway')
    // The tooltip: when, and what the server said.
    expect(chip.getAttribute('aria-label')).toBe('Sep 22, 2026 · 550 (the address:blocked)')
  })

  it('draws nothing for a record with no state', () => {
    render(<CrmEmailStateChip state={null} />)
    expect(screen.queryByTestId('crm-email-state')).toBeNull()
  })
})

describe('Send email under an email state', () => {
  it('is disabled with the reason when the state forbids email, and enabled otherwise', () => {
    const { unmount } = render(
      <CrmSendEmailButton
        hostId="host-1"
        leadId="lead-1"
        email="morgan@kcorp.example"
        emailState={{ status: 'bounced', atMs: AT, source: 'outreach', detail: null }}
      />,
    )
    const disabled = screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    expect(disabled.parentElement?.getAttribute('aria-label')).toMatch(/^Email to this address bounced on Sep 22, 2026/)
    unmount()
    render(
      <CrmSendEmailButton
        hostId="host-1"
        leadId="lead-1"
        email="morgan@kcorp.example"
        emailState={{ status: 'ok', atMs: AT, source: 'member', detail: null }}
      />,
    )
    expect((screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
