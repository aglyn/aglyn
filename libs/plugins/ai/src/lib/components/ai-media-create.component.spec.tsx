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
 * "Create with AI" in Media (AGL-3602), as the media library's zone draws it.
 *
 * - It is on the `mediaLibrary` zone behind the generative widgets' gates.
 * - It stays absent until its door says this deployment makes pictures.
 * - The dialog says what the pictures will cost before anything is spent,
 *   sends the description, shape, count, library and folder, and hands the
 *   library the new assets.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleMediaLibraryZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => ({}),
}))

import { AI_PLUGIN_ID } from '../constants'
import { registerAiConsole } from '../plugin'
import { aiMediaCreditEstimate } from './ai-media-create.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const VERDICT = {
  model: { id: 'imagen-4.0-generate-001', label: 'Imagen 4' },
  aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
  maxCount: 4,
  creditsPerImage: 60,
}

let mockFetch: jest.Mock
const onCreated = jest.fn()

const zoneProps = (patch: Partial<ConsoleMediaLibraryZoneProps> = {}): ConsoleMediaLibraryZoneProps => ({
  hostId: 'host-1',
  orgId: 'org-1',
  library: 'host',
  folderId: 'folder-9',
  onCreated,
  ...patch,
})

function widget() {
  const [entry] = listConsoleWidgets(CONSOLE_WIDGET_SLOTS.mediaLibrary, [AI_PLUGIN_ID])
  if (!entry) throw new Error('nothing registered on mediaLibrary')
  return entry.widget
}

beforeAll(() => {
  registerAiConsole()
})

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
  onCreated.mockReset()
})

describe('the zone entry', () => {
  it('is on the media library’s zone, gated as the generative widgets are', () => {
    expect(widget()).toMatchObject({
      slot: 'mediaLibrary',
      widgetId: 'ai-media-create',
      featureFlag: 'aiGenerative',
      permission: 'ai.generate',
    })
  })

  it('draws nothing while the door says no image provider is configured', async () => {
    const Widget = widget().Component as ComponentType<ConsoleMediaLibraryZoneProps>
    mockFetch.mockResolvedValueOnce(json({ error: 'Not found' }, 404))
    const { container } = render(<Widget {...zoneProps()} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(String(mockFetch.mock.calls[0][0])).toBe('/api/ai/media/images?orgId=org-1')
    expect(container.textContent).toBe('')
  })
})

describe('the dialog', () => {
  async function open(props = zoneProps()) {
    const Widget = widget().Component as ComponentType<ConsoleMediaLibraryZoneProps>
    mockFetch.mockResolvedValueOnce(json(VERDICT))
    render(<Widget {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))
    return screen.getByRole('dialog')
  }

  it('says what the pictures cost before anything is spent', async () => {
    const dialog = await open()
    expect(within(dialog).getByText(aiMediaCreditEstimate(1, 60))).toBeTruthy()
    expect(aiMediaCreditEstimate(3, 60)).toMatch(/^3 pictures uses 180 AI credits \(60 each\)/)
  })

  it('sends the description, shape, count, library and folder, and hands back the new assets', async () => {
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('Describe the picture'), {
      target: { value: 'A red barn at dawn' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wide 16:9' }))
    mockFetch.mockResolvedValueOnce(json({ mediaIds: ['m1', 'm2'], filtered: 0, failed: 0, credits: 60 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(['m1', 'm2']))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe('/api/ai/media/images')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      library: 'host',
      hostId: 'host-1',
      folderId: 'folder-9',
      prompt: 'A red barn at dawn',
      aspectRatio: '16:9',
      count: 1,
    })
  })

  it('says a refusal in the door’s words and keeps the description', async () => {
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('Describe the picture'), {
      target: { value: 'Something odd' },
    })
    mockFetch.mockResolvedValueOnce(
      json({ error: 'The image service declined this description.', reason: 'safety' }, 422),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText('The image service declined this description.')).toBeTruthy()
    expect((within(dialog).getByLabelText('Describe the picture') as HTMLTextAreaElement).value).toBe(
      'Something odd',
    )
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('says how many were added when the filter held some back', async () => {
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('Describe the picture'), {
      target: { value: 'Two dogs' },
    })
    mockFetch.mockResolvedValueOnce(json({ mediaIds: ['m1'], filtered: 1, failed: 0, credits: 60 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText(/Added 1 of 1 to the library/)).toBeTruthy()
    expect(onCreated).toHaveBeenCalledWith(['m1'])
  })
})
