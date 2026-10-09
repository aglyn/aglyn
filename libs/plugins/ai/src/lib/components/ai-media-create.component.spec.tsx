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
 * - The Kind menu lists the vector kinds everywhere and, only where the
 *   deployment makes them, the Photo, Art and Design kinds in their own
 *   sections, each with what one costs; it says what the pictures will cost
 *   before anything is spent, sends what the door reads, and hands the
 *   library the new assets.
 * - Mounted as its own upsell, it opens the add-on instead.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleMediaLibraryZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
let mockOrg: { data: Record<string, unknown> | undefined; status: string } = {
  data: { plan: 'pro' },
  status: 'success',
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => ({}),
  useFirestoreDoc: () => mockOrg,
}))

import { AI_PLUGIN_ID } from '../constants'
import { aiMediaCreditsPerPicture } from '../model/ai-media-credits'
import { registerAiConsole } from '../plugin'
import {
  AI_MEDIA_DESCRIBE_COLORS_NOTE,
  AI_MEDIA_RASTER_SAFETY_NOTE,
  aiMediaCreditEstimate,
  type AiMediaCreateButtonProps,
} from './ai-media-create.component'

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

/** Opens the Kind menu and answers its listbox. */
function openKinds(dialog: HTMLElement) {
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Kind' }))
  return screen.getByRole('listbox')
}

/** Chooses a kind by its label. */
function chooseKind(dialog: HTMLElement, label: string) {
  const listbox = openKinds(dialog)
  fireEvent.click(within(listbox).getByText(label))
}

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
      releaseFlag: 'release_ai_generative',
    })
  })

  /**
   * Without `showWhenNotEntitled` the shell never mounts the entry for a
   * plan without the add-on, so the upsell below could never be seen
   * (AGL-3601: the sparkle button is on every AI-creatable list).
   */
  it('is mounted without the AI add-on too, so its upsell can show', () => {
    expect(widget()).toMatchObject({ showWhenNotEntitled: true })
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

describe('the kinds', () => {
  it('lists only the vector kinds, under no headings, where the deployment makes no photos', async () => {
    const dialog = await open()
    expect(within(dialog).getByLabelText('Describe what to draw')).toBeTruthy()
    expect(within(dialog).getByText(aiMediaCreditEstimate('illustration', 1))).toBeTruthy()
    const listbox = openKinds(dialog)
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Illustrationabout 18 credits',
      'Iconabout 18 credits',
      'Patternabout 18 credits',
      'Logo markabout 18 credits',
    ])
    expect(within(listbox).queryByText('Vector')).toBeNull()
    expect(within(listbox).queryByText('Photo')).toBeNull()
  })

  it('lists every kind in four sections where it does, Photo first, each with what one costs', async () => {
    process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS = 'on'
    const dialog = await open()
    expect(within(dialog).getByLabelText('Describe the picture')).toBeTruthy()
    expect(within(dialog).getByText(aiMediaCreditEstimate('photo', 1))).toBeTruthy()
    const listbox = openKinds(dialog)
    const headings = Array.from(listbox.querySelectorAll('li.MuiListSubheader-root')).map(
      (heading) => heading.textContent,
    )
    expect(headings).toEqual(['Vector', 'Photo', 'Art', 'Design'])
    // MUI's Select gives a heading the option role too; the kinds are the rest.
    const options = within(listbox)
      .getAllByRole('option')
      .filter((option) => !option.classList.contains('MuiListSubheader-root'))
      .map((option) => option.textContent)
    expect(options).toHaveLength(21)
    expect(options).toContain('Studio product shotabout 108 credits')
    expect(options).toContain('Watercolorabout 108 credits')
    expect(options).toContain('Mockupabout 108 credits')
    expect(options).toContain('Iconabout 18 credits')
  })

  it('hides the colors for a photo kind and says what may be declined', async () => {
    process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS = 'on'
    const dialog = await open()
    chooseKind(dialog, 'Food')
    expect(within(dialog).queryByLabelText("Use my site's theme colors")).toBeNull()
    expect(within(dialog).getByText(AI_MEDIA_RASTER_SAFETY_NOTE)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Portrait 3:4' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('brings a design kind’s shape and suggests naming colors, and an icon its palette', async () => {
    process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS = 'on'
    const dialog = await open()
    chooseKind(dialog, 'Banner or hero image')
    expect(within(dialog).getByRole('button', { name: 'Wide 16:9' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByText(new RegExp(AI_MEDIA_DESCRIBE_COLORS_NOTE))).toBeTruthy()
    expect(within(dialog).queryByLabelText("Use my site's theme colors")).toBeNull()
    chooseKind(dialog, 'Icon')
    expect(within(dialog).getByRole('button', { name: 'Square 1:1' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog).getByLabelText("Use my site's theme colors")).toBeTruthy()
    expect(within(dialog).queryByText(AI_MEDIA_RASTER_SAFETY_NOTE)).toBeNull()
    expect(within(dialog).getByText(aiMediaCreditEstimate('illustration', 1))).toBeTruthy()
  })

  it('estimates a photo at about 108 credits and an illustration at about 18', () => {
    expect(aiMediaCreditsPerPicture('photo')).toBe(108)
    expect(aiMediaCreditsPerPicture('illustration')).toBe(18)
    expect(aiMediaCreditEstimate('photo', 3)).toMatch(/^3 pictures uses about 324 AI credits \(about 108 each\)/)
  })

  it('estimates a Free workspace’s 512 px photo at about 75 credits', () => {
    expect(aiMediaCreditsPerPicture('photo', undefined, '512')).toBe(75)
    expect(aiMediaCreditsPerPicture('illustration', undefined, '512')).toBe(18)
    expect(aiMediaCreditEstimate('photo', 2, '512')).toMatch(/^2 pictures uses about 150 AI credits \(about 75 each\)/)
  })

  it('shows a Free workspace the 512 px estimate, and the 1K one until the plan has arrived', async () => {
    process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS = 'on'
    try {
      mockOrg = { data: { plan: 'free' }, status: 'success' }
      const free = await open()
      expect(within(free).getByText(aiMediaCreditEstimate('photo', 1, '512'))).toBeTruthy()
      expect(within(openKinds(free)).getByRole('option', { name: 'Photo about 75 credits' }).textContent).toBe(
        'Photoabout 75 credits',
      )
      cleanup()
      mockOrg = { data: undefined, status: 'loading' }
      const pending = await open()
      expect(within(pending).getByText(aiMediaCreditEstimate('photo', 1, '1K'))).toBeTruthy()
    } finally {
      mockOrg = { data: { plan: 'pro' }, status: 'success' }
    }
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
      style: 'photo',
    })
  })

  it('sends a design kind with its shape and no palette', async () => {
    process.env.NEXT_PUBLIC_AI_IMAGE_PHOTOS = 'on'
    const dialog = await open()
    chooseKind(dialog, 'Social post graphic')
    fireEvent.change(within(dialog).getByLabelText('Describe the picture'), {
      target: { value: 'Citrus fruit on a bright table' },
    })
    mockFetch.mockResolvedValueOnce(json({ mediaIds: ['m1'], filtered: 0, failed: 0, credits: 108 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(['m1']))
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toMatchObject({ mode: 'photo', style: 'social', aspectRatio: '1:1' })
    expect(body.palette).toBeUndefined()
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
