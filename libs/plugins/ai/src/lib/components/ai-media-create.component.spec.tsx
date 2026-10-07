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
 * - It is on the `mediaLibrary` zone behind the generative widgets' gates,
 *   and it draws from those alone: no request is made until someone creates.
 * - The dialog offers Photo only where the deployment makes photos, and
 *   Illustration everywhere; it says what the pictures will cost before
 *   anything is spent, sends what the door reads, and hands the library the
 *   new assets.
 * - Mounted as its own upsell, it opens the add-on instead.
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
import { aiMediaCreditsPerPicture } from '../model/ai-media-credits'
import { registerAiConsole } from '../plugin'
import { aiMediaCreditEstimate, type AiMediaCreateButtonProps } from './ai-media-create.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

let mockFetch: jest.Mock
const onCreated = jest.fn()

const zoneProps = (patch: Partial<AiMediaCreateButtonProps> = {}): AiMediaCreateButtonProps => ({
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

const Widget = () => widget().Component as ComponentType<AiMediaCreateButtonProps>

beforeAll(() => {
  registerAiConsole()
})

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
  onCreated.mockReset()
  delete process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS
})

async function open(props = zoneProps()) {
  const Component = Widget()
  render(<Component {...props} />)
  // Registered lazily (AGL-3649): the button draws once its code has loaded.
  fireEvent.click(await screen.findByRole('button', { name: 'Create with AI' }))
  return screen.getByRole('dialog')
}

describe('the zone entry', () => {
  it('is on the media library’s zone, gated as the generative widgets are', () => {
    expect(widget()).toMatchObject({
      slot: 'mediaLibrary',
      widgetId: 'ai-media-create',
      featureFlag: 'aiGenerative',
      permission: 'ai.generate',
    })
  })

  it('draws at once and asks no server anything until someone creates', async () => {
    const dialog = await open()
    expect(within(dialog).getByText('Create images with AI')).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('opens the add-on, not the dialog, when the shell mounted it as its own upsell', async () => {
    const dialog = await open(
      zoneProps({ entitled: false, upgrade: { billingHref: '/acme/billing#add-ons', canManageBilling: true } }),
    )
    expect(within(dialog).getByText(/comes with the AI add-on/)).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'See the AI add-on' }).getAttribute('href')).toBe(
      '/acme/billing#add-ons',
    )
    expect(within(dialog).queryByLabelText('Describe what to draw')).toBeNull()
  })
})

describe('the modes', () => {
  it('offers only Illustration where the deployment makes no photos', async () => {
    const dialog = await open()
    expect(within(dialog).queryByRole('button', { name: 'Photo' })).toBeNull()
    expect(within(dialog).getByLabelText('Describe what to draw')).toBeTruthy()
    expect(within(dialog).getByText(aiMediaCreditEstimate('illustration', 1))).toBeTruthy()
  })

  it('offers Photo first where it does, and switches to Illustration', async () => {
    process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS = 'on'
    const dialog = await open()
    expect(within(dialog).getByLabelText('Describe the picture')).toBeTruthy()
    expect(within(dialog).getByText(aiMediaCreditEstimate('photo', 1))).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Illustration or icon' }))
    expect(within(dialog).getByLabelText('Describe what to draw')).toBeTruthy()
    expect(within(dialog).getByText(aiMediaCreditEstimate('illustration', 1))).toBeTruthy()
  })

  it('estimates a photo at about 108 credits and an illustration at about 18', () => {
    expect(aiMediaCreditsPerPicture('photo')).toBe(108)
    expect(aiMediaCreditsPerPicture('illustration')).toBe(18)
    expect(aiMediaCreditEstimate('photo', 3)).toMatch(/^3 pictures uses about 324 AI credits \(about 108 each\)/)
  })
})

describe('creating', () => {
  it('sends a photo’s description, shape, count, library and folder, and hands back the new assets', async () => {
    process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS = 'on'
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('Describe the picture'), {
      target: { value: 'A red barn at dawn' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wide 16:9' }))
    mockFetch.mockResolvedValueOnce(json({ mediaIds: ['m1', 'm2'], filtered: 0, failed: 0, credits: 216 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(['m1', 'm2']))
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/ai/media/images')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      library: 'host',
      hostId: 'host-1',
      folderId: 'folder-9',
      mode: 'photo',
      prompt: 'A red barn at dawn',
      aspectRatio: '16:9',
      count: 1,
    })
  })

  it('sends an illustration’s kind and the site theme’s colors', async () => {
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('Describe what to draw'), {
      target: { value: 'A delivery van' },
    })
    mockFetch.mockResolvedValueOnce(json({ mediaIds: ['m1'], filtered: 0, failed: 0, credits: 18 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(['m1']))
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      mode: 'illustration',
      style: 'illustration',
      palette: { source: 'theme' },
    })
  })

  it('sends the person’s own colors in the organization library, which has no site theme', async () => {
    const dialog = await open(zoneProps({ hostId: null, library: 'org' }))
    expect((within(dialog).getByLabelText("Use my site's theme colors") as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Describe what to draw'), {
      target: { value: 'A leaf icon' },
    })
    mockFetch.mockResolvedValueOnce(json({ mediaIds: ['m1'], filtered: 0, failed: 0, credits: 18 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).palette).toEqual({
      source: 'custom',
      colors: ['#1a73e8', '#fbbc04'],
    })
  })

  it('says a refusal in the door’s words and keeps the description', async () => {
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('Describe what to draw'), {
      target: { value: 'Something odd' },
    })
    mockFetch.mockResolvedValueOnce(json({ error: 'That is a real company’s logo.', reason: 'safety' }, 422))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText('That is a real company’s logo.')).toBeTruthy()
    expect((within(dialog).getByLabelText('Describe what to draw') as HTMLTextAreaElement).value).toBe(
      'Something odd',
    )
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('says how many were added when some did not come out', async () => {
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText('Describe what to draw'), { target: { value: 'Two dogs' } })
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'How many' }))
    fireEvent.click(await screen.findByRole('option', { name: '2' }))
    mockFetch.mockResolvedValueOnce(
      json({ mediaIds: ['m1'], filtered: 1, failed: 0, credits: 18, warning: 'This one’s on us.' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText(/Added 1 of 2 to the library\. This one’s on us\./)).toBeTruthy()
    expect(onCreated).toHaveBeenCalledWith(['m1'])
  })
})
