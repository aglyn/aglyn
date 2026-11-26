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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { defaultPhoneSettings } from '../model/phone-rules'
import type { PhoneThread } from '../model/phone.types'
import PhoneInboxSection from './phone-inbox-section'
import type { PhoneApi, PhoneStatus } from './use-phone-api'

jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))

const thread: PhoneThread = {
  id: '18305550100_18305550142',
  numberId: 'n1',
  ours: '+18305550100',
  theirs: '+18305550142',
  contact: { kind: 'contact', id: 'c1', name: 'Rider One' },
  lastMessageAtMs: Date.UTC(2026, 10, 26, 16, 0),
  lastMessagePreview: 'Open today?',
  lastDirection: 'inbound',
  unread: 1,
}

function status(overrides: Partial<PhoneStatus> = {}): PhoneStatus {
  return {
    configured: true,
    hasAccount: true,
    numbers: [
      {
        id: 'n1',
        e164: '+18305550100',
        kind: 'local',
        twilioSid: 'PN1',
        status: 'active',
        hostId: 'site1',
        label: 'Front desk',
        createdAtMs: 1,
        createdByUid: 'u1',
      },
    ],
    compliance: null,
    settings: defaultPhoneSettings(1),
    ports: [],
    myCell: null,
    canManage: true,
    ...overrides,
  }
}

function api(): PhoneApi {
  return {
    threads: jest.fn(async () => [thread]),
    thread: jest.fn(async () => ({
      thread,
      messages: [
        { id: 'm1', threadId: thread.id, direction: 'inbound' as const, body: 'Open today?', status: 'received' as const, segments: 1, twilioSid: 'SM1', atMs: thread.lastMessageAtMs },
      ],
      calls: [],
    })),
    send: jest.fn(async () => ({ thread, message: {} as never })),
  } as unknown as PhoneApi
}

const sites = [{ id: 'site1', name: 'Ranch', subdomain: 'ranch' }]

describe('Phone inbox (AGL-4251)', () => {
  it('asks for a number first when the workspace has none', () => {
    render(<PhoneInboxSection api={api()} status={status({ numbers: [] })} reload={jest.fn()} sites={sites} basePath="/o/phone" />)
    expect(screen.getByText(/Choose your business number on Setup/)).toBeTruthy()
  })

  it('warns until the number is registered, lists conversations and replies in one', async () => {
    const phone = api()
    render(<PhoneInboxSection api={phone} status={status()} reload={jest.fn()} sites={sites} basePath="/o/phone" />)
    expect(screen.getByText(/US carriers block texts/)).toBeTruthy()
    fireEvent.click(await screen.findByText('Rider One'))
    expect(await screen.findAllByText('Open today?')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Yes, 9 to 5.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(phone.send).toHaveBeenCalledWith({ threadId: thread.id, body: 'Yes, 9 to 5.' }))
  })
})
