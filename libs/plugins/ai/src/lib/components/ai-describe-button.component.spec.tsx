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
 * "Describe it" on the Templates, Layouts and Forms pages (AGL-3043), and on
 * the Components page (AGL-3051).
 *
 * Every render here goes through the component the AI plugin REGISTERED on
 * the page's zone, so what is asserted is what that page's slot draws:
 *
 * - each entry sits on its own page's zone behind the gates the page entry
 *   has, and stays absent while the jobs route says the feature is not this
 *   workspace's;
 * - the brief starts a job of that page's kind for this site, with the inputs
 *   the kind's door reads: a template's subject and an entry template's
 *   content collection, and nothing at all for a layout, a form or a
 *   component;
 * - a refusal is said in the door's words, a lockdown in the lockdown's, and
 *   the brief stays to try again;
 * - what it promises after is a plan to confirm in AI jobs, never a built or a
 *   published document.
 */

import { CONSOLE_WIDGET_SLOTS, listConsoleWidgets } from '@aglyn/aglyn'
import type { ConsoleHostTemplatesZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'

// ONE held object for the whole file: a fresh double each render turns the
// probe's effect into a loop, and an effect keys on the uid rather than on
// the object that carries it.
const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFirestore = { name: 'firestore' }

/** What the site's collections read answers, and every path it was asked for. */
let mockCollectionRead: { status: 'loading' | 'success' | 'error'; data: unknown[] } = {
  status: 'success',
  data: [],
}
const mockCollectionPaths = new Set<string>()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useFirestore: () => mockFirestore,
  useFirestoreCollection: (buildQuery: () => { path: string; ceiling: number }) => {
    const query = buildQuery()
    mockCollectionPaths.add(`${query.path} (${query.ceiling})`)
    return mockCollectionRead
  },
  collectionCeiling: (ref: { path: string }, ceiling: number) => ({ ...ref, ceiling }),
  ceilingedWindow: (read: unknown[] | undefined, ceiling: number) => ({
    rows: (read ?? []).slice(0, ceiling),
    truncated: (read ?? []).length > ceiling,
  }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  ...jest.requireActual('firebase/firestore'),
  collection: (db: unknown, ...segments: string[]) => {
    if (db !== mockFirestore) throw new Error('read on a handle the hook did not give')
    return { path: segments.join('/') }
  },
}))

import { AI_PLUGIN_ID } from '../constants'
import { registerAiConsole } from '../plugin'
import { aiBriefJobInputs, AI_BRIEF_NO_CHOICE } from './ai-brief-dialog.component'
import { aiTemplateCollectionOptions } from './ai-template-collection-field.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const zoneProps = (
  patch: Partial<ConsoleHostTemplatesZoneProps> = {},
): ConsoleHostTemplatesZoneProps => ({ hostId: 'demo-legal', orgId: 'org-1', ...patch })

/** The entries beside the page entry, with the page each is on and what it says. */
const ENTRIES = [
  {
    zone: 'hostTemplates',
    widgetId: 'ai-describe-template',
    kind: 'template',
    title: 'Describe a page template',
    label: 'What should each page show?',
    submit: 'Plan the template',
    noun: 'template',
  },
  {
    zone: 'hostLayouts',
    widgetId: 'ai-describe-layout',
    kind: 'layout',
    title: 'Describe a layout',
    label: 'What should the layout hold?',
    submit: 'Plan the layout',
    noun: 'layout',
  },
  {
    zone: 'hostForms',
    widgetId: 'ai-describe-form',
    kind: 'form',
    title: 'Describe a form',
    label: 'What is the form for?',
    submit: 'Plan the form',
    noun: 'form',
  },
  {
    zone: 'hostComponents',
    widgetId: 'ai-describe-component',
    kind: 'component',
    title: 'Describe a reusable component',
    label: 'What should the component show?',
    submit: 'Plan the component',
    noun: 'component',
  },
] as const

type Entry = (typeof ENTRIES)[number]

const registeredOn = (zone: string) =>
  listConsoleWidgets(zone, [AI_PLUGIN_ID]).map(({ widget }) => widget)

/** The component the AI plugin registered on the zone: what its page draws. */
function widgetFor(zone: string): ComponentType<ConsoleHostTemplatesZoneProps> {
  const [widget] = registeredOn(zone)
  if (!widget) throw new Error(`nothing registered on ${zone}`)
  return widget.Component
}

/** The attorney template that could not be retried from the console (AGL-3024). */
const ATTORNEY_BRIEF =
  'A page template for each of our attorneys at Harborline Law: their name and photo, the ' +
  'practice areas they focus on, a short biography, and a way to request a consultation with them.'

let mockFetch: jest.Mock

beforeAll(() => {
  registerAiConsole()
})

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
  mockCollectionRead = { status: 'success', data: [] }
  mockCollectionPaths.clear()
})

afterEach(() => {
  // The whole flow is the jobs route. No draft is written from here, and no
  // publish door is reached from a control that offers a plan.
  for (const [url] of mockFetch.mock.calls) expect(String(url)).toMatch(/^\/api\/ai\/jobs/)
})

/** Renders the entry the zone draws, and opens its dialog once the route said yes. */
async function openDialog(entry: Entry) {
  const Widget = widgetFor(entry.zone)
  mockFetch.mockResolvedValueOnce(json({ jobs: [] }))
  render(<Widget {...zoneProps()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Describe it' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(entry.title)).toBeTruthy()
  return dialog
}

function writeBrief(entry: Entry, brief: string) {
  fireEvent.change(screen.getByLabelText(entry.label), { target: { value: brief } })
}

/** Starts the job, answering with a job of the entry's kind, and returns the body sent. */
async function planIt(entry: Entry) {
  mockFetch.mockResolvedValueOnce(
    json({ job: { id: 'job-1', kind: entry.kind, status: 'needs_review' } }),
  )
  fireEvent.click(screen.getByRole('button', { name: entry.submit }))
  await screen.findByText(new RegExp(`The ${entry.noun} is being planned`))
  const [url, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
  expect(url).toBe('/api/ai/jobs')
  expect(init.method).toBe('POST')
  return JSON.parse(init.body)
}

const planButton = (entry: Entry) =>
  screen.getByRole('button', { name: entry.submit }) as HTMLButtonElement

const TEMPLATE = ENTRIES[0]
const LAYOUT = ENTRIES[1]
const FORM = ENTRIES[2]
const COMPONENT = ENTRIES[3]

describe('each entry is on its own page’s zone, gated as the page entry is', () => {
  it('names each zone in the catalog', () => {
    expect(CONSOLE_WIDGET_SLOTS.hostTemplates).toBe('hostTemplates')
    expect(CONSOLE_WIDGET_SLOTS.hostLayouts).toBe('hostLayouts')
    expect(CONSOLE_WIDGET_SLOTS.hostForms).toBe('hostForms')
    expect(CONSOLE_WIDGET_SLOTS.hostComponents).toBe('hostComponents')
  })

  it.each(ENTRIES)('registers $widgetId on $zone, alone', (entry) => {
    expect(registeredOn(entry.zone)).toEqual([
      expect.objectContaining({
        slot: entry.zone,
        widgetId: entry.widgetId,
        title: entry.title,
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
      }),
    ])
  })

  it('carries exactly the gates the Screens page entry carries', () => {
    const [page] = registeredOn(CONSOLE_WIDGET_SLOTS.hostScreens)
    expect(page).toEqual(expect.objectContaining({ widgetId: 'ai-describe-page' }))
    for (const entry of ENTRIES) {
      const [widget] = registeredOn(entry.zone)
      expect({ featureFlag: widget.featureFlag, permission: widget.permission }).toEqual({
        featureFlag: page.featureFlag,
        permission: page.permission,
      })
    }
  })
})

describe('whether the button is here at all', () => {
  describe.each(ENTRIES)('on $zone', (entry) => {
    it.each([
      ['the route is not registered for this deployment', 404],
      ['the workspace or the member may not generate', 403],
    ])('stays absent when %s', async (_why, status) => {
      const Widget = widgetFor(entry.zone)
      mockFetch.mockResolvedValue(json({ error: 'No' }, status))
      const { container } = render(<Widget {...zoneProps()} />)
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      expect(container.textContent).toBe('')
    })

    it('stays absent when the route cannot be reached', async () => {
      const Widget = widgetFor(entry.zone)
      mockFetch.mockRejectedValue(new Error('offline'))
      const { container } = render(<Widget {...zoneProps()} />)
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      expect(container.textContent).toBe('')
    })

    it('stays absent while the probe is still out, and asks the route only once', async () => {
      const Widget = widgetFor(entry.zone)
      mockFetch.mockReturnValue(new Promise(() => undefined))
      const { container, rerender } = render(<Widget {...zoneProps()} />)
      rerender(<Widget {...zoneProps()} />)
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      expect(String(mockFetch.mock.calls[0][0])).toBe('/api/ai/jobs?orgId=org-1&limit=1')
      expect(container.textContent).toBe('')
    })

    it('asks nothing while the page has not resolved its org', async () => {
      const Widget = widgetFor(entry.zone)
      const { container } = render(<Widget {...zoneProps({ orgId: undefined })} />)
      await waitFor(() => expect(mockFetch).not.toHaveBeenCalled())
      expect(container.textContent).toBe('')
    })
  })
})

describe('a page template', () => {
  it('starts a template job for this site with the subject the member picked', async () => {
    await openDialog(TEMPLATE)
    writeBrief(TEMPLATE, `  ${ATTORNEY_BRIEF}  `)
    // A template names what each page is for before it can be planned.
    expect(planButton(TEMPLATE).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    expect(screen.getByRole('button', { name: 'Author' }).getAttribute('aria-pressed')).toBe('true')

    expect(await planIt(TEMPLATE)).toEqual({
      orgId: 'org-1',
      hostId: 'demo-legal',
      kind: 'template',
      brief: ATTORNEY_BRIEF,
      inputs: { subject: 'author' },
    })
    // A product or an author page names no collection, so none was read.
    expect([...mockCollectionPaths]).toEqual([])
  })

  it('says the subject is required, because the page dialog beside it says its type is optional (AGL-3143 §12)', async () => {
    // The button is disabled until a subject is picked — asserted above — but
    // a member reads the labels, not the button's disabled attribute. While
    // this one was unmarked and the page dialog's read "(optional)", the pair
    // said the same thing and behaved differently, and the live AGL-3024 run
    // stalled here with a written brief and no way to tell why.
    await openDialog(TEMPLATE)
    expect(screen.getByText('One page for each (required)')).toBeTruthy()
    expect(screen.queryByText('One page for each')).toBeNull()
  })

  it('sends a product page with no collection', async () => {
    await openDialog(TEMPLATE)
    writeBrief(TEMPLATE, 'A page for each product: its photos, price and what is in the box')
    fireEvent.click(screen.getByRole('button', { name: 'Product' }))
    expect((await planIt(TEMPLATE)).inputs).toEqual({ subject: 'product' })
  })

  it('offers the site’s content collections for an entry page, and sends the one picked', async () => {
    mockCollectionRead = {
      status: 'success',
      data: [
        { $id: 'col-practice', displayName: 'Practice areas', kind: 'content' },
        // A commerce catalog collection shares the subcollection; the door
        // refuses one, so it is never offered.
        { $id: 'col-sale', displayName: 'Sale items', kind: 'catalog' },
        { $id: 'col-attorneys', displayName: 'Attorneys' },
      ],
    }
    await openDialog(TEMPLATE)
    writeBrief(TEMPLATE, 'A page for each attorney profile entry')
    // Nothing is read until an entry page is what the member is describing.
    expect([...mockCollectionPaths]).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Collection entry' }))
    // The whole list, bounded by the platform's per-site cap.
    expect([...mockCollectionPaths]).toEqual(['hosts/demo-legal/collections (100)'])
    // An entry page names its collection before it can be planned.
    expect(planButton(TEMPLATE).disabled).toBe(true)

    fireEvent.mouseDown(screen.getByLabelText('Collection'))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Attorneys', 'Practice areas'])
    fireEvent.click(screen.getByRole('option', { name: 'Attorneys' }))
    await waitFor(() => expect(planButton(TEMPLATE).disabled).toBe(false))

    expect((await planIt(TEMPLATE)).inputs).toEqual({
      subject: 'entry',
      collectionId: 'col-attorneys',
    })
  })

  it('drops the collection when the member moves off an entry page', async () => {
    mockCollectionRead = {
      status: 'success',
      data: [{ $id: 'col-attorneys', displayName: 'Attorneys', kind: 'content' }],
    }
    await openDialog(TEMPLATE)
    writeBrief(TEMPLATE, ATTORNEY_BRIEF)
    fireEvent.click(screen.getByRole('button', { name: 'Collection entry' }))
    fireEvent.mouseDown(screen.getByLabelText('Collection'))
    fireEvent.click(await screen.findByRole('option', { name: 'Attorneys' }))
    fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    expect(screen.queryByLabelText('Collection')).toBeNull()
    expect((await planIt(TEMPLATE)).inputs).toEqual({ subject: 'author' })
  })

  it('says so when the site has no content collection, and will not plan an entry page', async () => {
    mockCollectionRead = {
      status: 'success',
      data: [{ $id: 'col-sale', displayName: 'Sale items', kind: 'catalog' }],
    }
    await openDialog(TEMPLATE)
    writeBrief(TEMPLATE, 'A page for each blog post')
    fireEvent.click(screen.getByRole('button', { name: 'Collection entry' }))
    expect(
      screen.getByText('This site has no content collections yet. Add one in Content first.'),
    ).toBeTruthy()
    expect(planButton(TEMPLATE).disabled).toBe(true)
  })

  it('says so when the collections could not be read', async () => {
    mockCollectionRead = { status: 'error', data: [] }
    await openDialog(TEMPLATE)
    fireEvent.click(screen.getByRole('button', { name: 'Collection entry' }))
    expect(
      screen.getByText('This site’s collections could not be loaded. Close this and try again.'),
    ).toBeTruthy()
  })
})

describe.each([LAYOUT, FORM, COMPONENT])('a $kind', (entry) => {
  it(`starts a ${entry.kind} job for this site with no inputs of its own`, async () => {
    await openDialog(entry)
    writeBrief(entry, '  Something for our law firm  ')
    expect(await planIt(entry)).toEqual({
      orgId: 'org-1',
      hostId: 'demo-legal',
      kind: entry.kind,
      brief: 'Something for our law firm',
      inputs: {},
    })
    // None of these kinds reads anything but the brief, so nothing else was read.
    expect([...mockCollectionPaths]).toEqual([])
  })
})

describe.each(ENTRIES)('what the $kind entry promises, and what it says when refused', (entry) => {
  it('promises a plan to review and confirm in AI jobs, never a built or live document', async () => {
    await openDialog(entry)
    writeBrief(entry, 'A brief')
    if (entry.kind === 'template') fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    await planIt(entry)
    const said = screen.getByText(new RegExp(`The ${entry.noun} is being planned`)).textContent
    expect(said).toContain('Open AI jobs in the Assist panel to review the plan and confirm it.')
    expect(said).not.toMatch(/\bpublish|\blive\b|\bcredit/i)
    // The dialog closes on Close, with nothing left to start.
    expect(screen.queryByRole('button', { name: entry.submit })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('will not send an empty brief', async () => {
    await openDialog(entry)
    writeBrief(entry, '   ')
    if (entry.kind === 'template') fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    expect(planButton(entry).disabled).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('says why the door refused, and leaves the brief to try again', async () => {
    await openDialog(entry)
    writeBrief(entry, 'A contact form')
    if (entry.kind === 'template') fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    mockFetch.mockResolvedValueOnce(
      json({ error: 'This feature is not included in your plan — see Billing' }, 403),
    )
    fireEvent.click(planButton(entry))
    await screen.findByText('This feature is not included in your plan — see Billing')
    expect((screen.getByLabelText(entry.label) as HTMLTextAreaElement).value).toBe('A contact form')
    expect(planButton(entry).disabled).toBe(false)
  })

  it('says a switched-off site in the door’s own words', async () => {
    await openDialog(entry)
    writeBrief(entry, 'A brief')
    if (entry.kind === 'template') fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    mockFetch.mockResolvedValueOnce(json({ error: 'AI is switched off for this site.' }, 404))
    fireEvent.click(planButton(entry))
    expect(await screen.findByText('AI is switched off for this site.')).toBeTruthy()
  })

  it('reports a lockdown as the lockdown, not as a failure', async () => {
    await openDialog(entry)
    writeBrief(entry, 'A brief')
    if (entry.kind === 'template') fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    mockFetch.mockResolvedValueOnce(
      json(
        {
          error: 'Locked',
          feature: 'ai-generate',
          title: 'AI generation is temporarily unavailable',
          message:
            'Generating sections, pages and automations with AI is temporarily unavailable. ' +
            'Everything already built is unaffected — please try again shortly.',
        },
        423,
      ),
    )
    fireEvent.click(planButton(entry))
    expect(
      await screen.findByText(
        'AI generation is temporarily unavailable — Generating sections, pages and automations ' +
          'with AI is temporarily unavailable. Everything already built is unaffected — please ' +
          'try again shortly.',
      ),
    ).toBeTruthy()
  })

  it(`falls back to its own sentence when the door cannot be reached`, async () => {
    await openDialog(entry)
    writeBrief(entry, 'A brief')
    if (entry.kind === 'template') fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(planButton(entry))
    expect(
      await screen.findByText(`The ${entry.noun} could not be started. Try again.`),
    ).toBeTruthy()
  })
})

describe('the inputs each kind sends', () => {
  it('reads a template’s the way its door does', () => {
    const none = AI_BRIEF_NO_CHOICE
    expect(aiBriefJobInputs('template', none)).toBeNull()
    expect(aiBriefJobInputs('template', { ...none, subject: 'entry' })).toBeNull()
    expect(aiBriefJobInputs('template', { ...none, subject: 'entry', collectionId: 'a/b' })).toBeNull()
    expect(aiBriefJobInputs('template', { ...none, subject: 'entry', collectionId: 'c1' })).toEqual({
      subject: 'entry',
      collectionId: 'c1',
    })
    expect(aiBriefJobInputs('template', { ...none, subject: 'author', collectionId: 'c1' })).toEqual({
      subject: 'author',
    })
  })

  it('sends a page’s type only when one is picked, and nothing for a layout, a form or a component', () => {
    expect(aiBriefJobInputs('page', AI_BRIEF_NO_CHOICE)).toEqual({})
    expect(aiBriefJobInputs('page', { ...AI_BRIEF_NO_CHOICE, pageType: 'about' })).toEqual({
      pageType: 'about',
    })
    const everything = { pageType: 'about' as const, subject: 'author' as const, collectionId: 'c1' }
    expect(aiBriefJobInputs('layout', everything)).toEqual({})
    expect(aiBriefJobInputs('form', everything)).toEqual({})
    expect(aiBriefJobInputs('component', everything)).toEqual({})
  })

  it('names a collection as the template step does, content collections only, by name', () => {
    expect(
      aiTemplateCollectionOptions([
        { $id: 'z', slug: 'zebra-notes' },
        { $id: 'b', name: 'Blog' },
        { $id: 'c', kind: 'catalog', displayName: 'Catalog' },
        { $id: 'a', displayName: '  Attorneys ', name: 'People' },
        { $id: 'id-only' },
      ]),
    ).toEqual([
      { id: 'a', name: 'Attorneys' },
      { id: 'b', name: 'Blog' },
      { id: 'id-only', name: 'id-only' },
      { id: 'z', name: 'zebra-notes' },
    ])
  })
})
