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
import { LIVE_CHAT_DEFAULT_SETTINGS, type LiveChatSettings } from '../model/settings'
import type { LiveChatApi } from './live-chat-api'
import { LiveChatCard } from './live-chat-card.component'

jest.mock('./live-chat-api', () => ({ useLiveChatApi: () => null }))
const mockSnack = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: mockSnack }) }))

const TIDIO_KEY = 'abcdefghijklmnopqrstuvwxyz123456'

function api(settings: Partial<LiveChatSettings> = {}, canManage = true, overrides: Partial<LiveChatApi> = {}): LiveChatApi {
  const stored = { ...LIVE_CHAT_DEFAULT_SETTINGS, ...settings }
  return {
    read: jest.fn(async () => ({ settings: stored, canManage })),
    save: jest.fn(async (next: LiveChatSettings) => ({ settings: next, canManage, refreshed: true })),
    ...overrides,
  }
}

beforeEach(() => mockSnack.mockClear())

describe('the Live chat card (AGL-3698)', () => {
  it('saves a pasted Tidio key as the checked key and turns the chat on', async () => {
    const routes = api()
    render(<LiveChatCard hostId="h1" api={routes} />)
    fireEvent.change(await screen.findByLabelText('Public key'), {
      target: { value: `<script src="//code.tidio.co/${TIDIO_KEY}.js" async></script>` },
    })
    fireEvent.click(screen.getByLabelText('Show the chat on this site'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(routes.save).toHaveBeenCalled())
    expect(routes.save).toHaveBeenCalledWith({ ...LIVE_CHAT_DEFAULT_SETTINGS, enabled: true, publicKey: TIDIO_KEY })
    expect(mockSnack).toHaveBeenCalledWith('Saved. Your live pages are updated.', expect.anything())
  })

  it('shows the refusal and saves nothing for a key of the wrong shape', async () => {
    const routes = api()
    render(<LiveChatCard hostId="h1" api={routes} />)
    fireEvent.change(await screen.findByLabelText('Public key'), { target: { value: 'not-a-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/That is not a Tidio public key/)).toBeTruthy()
    expect(routes.save).not.toHaveBeenCalled()
  })

  it('lists the pages one per line for "only these pages"', async () => {
    const routes = api({ enabled: true, publicKey: TIDIO_KEY })
    render(<LiveChatCard hostId="h1" api={routes} />)
    fireEvent.click(await screen.findByLabelText('Only these pages'))
    fireEvent.change(screen.getByLabelText('Page addresses'), { target: { value: '/contact\n/shop/*' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(routes.save).toHaveBeenCalled())
    expect(routes.save).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 'only', paths: ['/contact', '/shop/*'] }),
    )
  })

  it('names LiveChat’s license number when LiveChat is chosen', async () => {
    render(<LiveChatCard hostId="h1" api={api({ provider: 'livechat' })} />)
    expect(await screen.findByLabelText('License number')).toBeTruthy()
  })

  it('shows a member who is not a site admin how it is set, with nothing to change', async () => {
    render(<LiveChatCard hostId="h1" api={api({ enabled: true, publicKey: TIDIO_KEY }, false)} />)
    expect(await screen.findByText('Live chat is set up by a site admin.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect((screen.getByLabelText('Public key') as HTMLInputElement).disabled).toBe(true)
  })
})
