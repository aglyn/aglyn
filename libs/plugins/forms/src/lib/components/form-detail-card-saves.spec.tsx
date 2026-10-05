/**
 * @jest-environment jsdom
 */

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
 * EACH CARD ON ONE FORM'S PAGE SAVES WHAT IT SHOWS (AGL-3508).
 *
 * The page used to hold one Save, in the Details card, that wrote the name,
 * the campaigns, the lead switch and the consent field together. A change
 * made in the CRM routing card therefore did nothing until a button in a
 * different card was pressed, and leaving the page dropped it without a word.
 *
 * What is held here: each card's Save and Discard sit in THAT card's header;
 * each Save is disabled until its own card differs from what is stored; each
 * writes only its own fields; and a page holding a change says so on the way
 * out.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useMemo, useState, type ReactNode } from 'react'
import { PageHeaderActionsContext } from '@aglyn/aglyn'

/** The form document the surface reads. */
let mockForm: Record<string, unknown> | undefined

const mockUpdateDoc = jest.fn(
  async (_ref: { path: string }, _data: Record<string, unknown>) => undefined,
)
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (source: unknown) => source,
  limit: (value: number) => ({ type: 'limit', value }),
  updateDoc: (ref: { path: string }, data: Record<string, unknown>) =>
    mockUpdateDoc(ref, data),
}))

const mockRecountFormStats = jest.fn(async (_target: unknown) => true)
jest.mock('./use-form-stats-recount-api', () => ({
  __esModule: true,
  default: () => mockRecountFormStats,
}))

const mockCreateHostVersion = jest.fn(async (_input: unknown) => 'v1')
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: mockForm, status: 'success' }),
  useFirestoreCollection: () => ({ data: [] }),
  useConsoleHostRoute: () => ({
    base: '/acme/hosts/demo',
    orgSlug: 'acme',
    subdomain: 'demo',
  }),
  useHostVersionApi: () => mockCreateHostVersion,
  useSiteContainerOptions: () => ({
    options: [{ id: 'camp-1', label: 'Spring push' }],
    truncated: false,
    ready: true,
  }),
}))

/*
 * The shared campaign picker, reduced to the one move these tests make:
 * adding a campaign. Its own behavior is its own spec's.
 */
jest.mock('@aglyn/tenant-feature-instance/components/container-picker', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => (
    <button type="button" onClick={() => onChange([...value, 'camp-1'])}>
      {'Add campaign'}
    </button>
  ),
}))

const mockConfirm = jest.fn(async (_options: unknown): Promise<unknown> => undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children, href }: any) => <a href={href}>{children}</a>,
  /*
   * A card is a region named by its header, and its header action renders
   * in a toolbar of its own — so "this button is in the card's HEADER" is a
   * question the DOM can answer, not a guess about layout.
   */
  CardDisplay: (props: any) => (
    <section aria-label={props.header}>
      <div role="toolbar" aria-label={`${props.header} actions`}>
        {props.HeaderProps?.action ?? null}
      </div>
      {props.children}
    </section>
  ),
  GridItems: ({ items }: any) => (
    <div>
      {(items ?? []).map((item: any, index: number) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush }),
}))

/* The cards this file is not about. */
jest.mock('./form-design-preview.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./form-metrics-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./form-submissions-card.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./use-form-promote-api', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))

import FormDetailCard from './form-detail-card'

const STORED_FORM = {
  $id: 'form-abc',
  displayName: 'Test Form',
  slug: 'test-form',
  // A routing key this page does not edit, which a routing save must keep.
  routing: { lead: false, inbox: true },
  consentFieldName: '',
  campaignIds: [],
  fields: [
    { fieldName: 'email', type: 'email', label: 'Email' },
    { fieldName: 'marketingConsent', type: 'checkbox', label: 'Marketing emails' },
  ],
}

/**
 * The page header's action slot, which is where "Edit in besigner" renders.
 * Built once, so a publish never re-renders the surface that published it.
 */
function HeaderHarness(props: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null)
  const value = useMemo(() => ({ setHeaderActions: setActions }), [])
  return (
    <PageHeaderActionsContext.Provider value={value}>
      <header>{actions}</header>
      {props.children}
    </PageHeaderActionsContext.Provider>
  )
}

function renderDetail(form: Record<string, unknown> = STORED_FORM) {
  mockForm = form
  return render(
    (
      <HeaderHarness>
        <FormDetailCard
          hostId="host-1"
          formId="form-abc"
          basePath="/acme/hosts/demo/forms"
          canPublish
          hostRoleLoaded
        />
      </HeaderHarness>
    ) as any,
  )
}

const card = (name: string) => screen.getByRole('region', { name })
const header = (name: string) => screen.getByRole('toolbar', { name: `${name} actions` })
const saveIn = (name: string) =>
  within(header(name)).getByRole('button', { name: 'Save' }) as HTMLButtonElement
const discardIn = (name: string) =>
  within(header(name)).getByRole('button', {
    name: 'Discard changes',
  }) as HTMLButtonElement

const leadSwitch = () =>
  within(card('CRM routing')).getByLabelText(/Also create a lead/) as HTMLInputElement

function rename(value: string) {
  fireEvent.change(within(card('Details')).getByLabelText('Display name'), {
    target: { value },
  })
}

function pickConsentField(optionName: RegExp) {
  fireEvent.mouseDown(
    within(card('CRM routing')).getByRole('combobox', {
      name: /Marketing consent field/,
    }),
  )
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

/** The one write a save made, by its payload. */
function onlyWrite(): Record<string, unknown> {
  expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
  const [ref, data] = mockUpdateDoc.mock.calls[0]
  expect(ref.path).toBe('hosts/host-1/forms/form-abc')
  return data
}

beforeEach(() => {
  mockUpdateDoc.mockClear()
  mockRecountFormStats.mockClear()
  mockCreateHostVersion.mockClear()
  mockConfirm.mockReset()
  mockConfirm.mockResolvedValue(undefined)
  mockPush.mockClear()
})

describe('each card saves from its own header', () => {
  it('puts a Save and a Discard in the Details header and in the CRM routing header', () => {
    renderDetail()
    expect(saveIn('Details')).toBeTruthy()
    expect(saveIn('CRM routing')).toBeTruthy()
    expect(discardIn('Details')).toBeTruthy()
    expect(discardIn('CRM routing')).toBeTruthy()
    // No Save left in a card's body: the one that used to sit under the
    // campaign picker is the button this issue moved.
    expect(within(card('Details')).getAllByRole('button', { name: 'Save' })).toHaveLength(1)
  })

  it('offers neither Save while nothing has changed', () => {
    renderDetail()
    expect(saveIn('Details').disabled).toBe(true)
    expect(saveIn('CRM routing').disabled).toBe(true)
    expect(discardIn('Details').disabled).toBe(true)
    expect(discardIn('CRM routing').disabled).toBe(true)
  })
})

describe('CRM routing saves the lead switch and the consent field, and nothing else', () => {
  it('enables only its own Save when the switch is flipped', () => {
    renderDetail()
    fireEvent.click(leadSwitch())
    expect(saveIn('CRM routing').disabled).toBe(false)
    expect(saveIn('Details').disabled).toBe(true)
  })

  it('writes routing without touching the name or the campaigns, and recounts', async () => {
    renderDetail()
    fireEvent.click(leadSwitch())
    await act(async () => {
      fireEvent.click(saveIn('CRM routing'))
    })
    const data = onlyWrite()
    expect(data['routing']).toEqual({ lead: true, inbox: true })
    expect(data['updatedAt']).toBeDefined()
    for (const key of ['displayName', 'campaignIds', 'inCampaign', 'consentFieldName']) {
      expect([key, key in data]).toEqual([key, false])
    }
    // The counters are the server's; a change of the switch asks for them.
    expect(mockRecountFormStats).toHaveBeenCalledWith({
      hostId: 'host-1',
      formIds: ['form-abc'],
    })
    // Saved, so the card is clean again.
    expect(saveIn('CRM routing').disabled).toBe(true)
  })

  it('writes a picked consent field on its own, with no recount', async () => {
    renderDetail()
    pickConsentField(/marketingConsent/)
    expect(saveIn('CRM routing').disabled).toBe(false)
    expect(saveIn('Details').disabled).toBe(true)
    await act(async () => {
      fireEvent.click(saveIn('CRM routing'))
    })
    const data = onlyWrite()
    expect(data['consentFieldName']).toBe('marketingConsent')
    expect('routing' in data).toBe(false)
    expect('displayName' in data).toBe(false)
    expect(mockRecountFormStats).not.toHaveBeenCalled()
  })

  it('is no change once the switch is flipped back', () => {
    renderDetail()
    fireEvent.click(leadSwitch())
    fireEvent.click(leadSwitch())
    expect(saveIn('CRM routing').disabled).toBe(true)
  })

  it('discards its own edit and leaves the other card’s alone', () => {
    renderDetail()
    rename('Renamed')
    fireEvent.click(leadSwitch())
    fireEvent.click(discardIn('CRM routing'))
    expect(leadSwitch().checked).toBe(false)
    expect(saveIn('CRM routing').disabled).toBe(true)
    expect(saveIn('Details').disabled).toBe(false)
  })
})

describe('Details saves the name and the campaigns, and nothing else', () => {
  it('enables only its own Save on a rename', () => {
    renderDetail()
    rename('Renamed form')
    expect(saveIn('Details').disabled).toBe(false)
    expect(saveIn('CRM routing').disabled).toBe(true)
  })

  it('is no change when the name is typed back to what is stored', () => {
    renderDetail()
    rename('Renamed form')
    rename('Test Form')
    expect(saveIn('Details').disabled).toBe(true)
  })

  it('writes the name with the list keys and the campaigns, without routing', async () => {
    renderDetail()
    rename('  Renamed form ')
    fireEvent.click(within(card('Details')).getByRole('button', { name: 'Add campaign' }))
    await act(async () => {
      fireEvent.click(saveIn('Details'))
    })
    const data = onlyWrite()
    expect(data['displayName']).toBe('Renamed form')
    expect(data['campaignIds']).toEqual(['camp-1'])
    expect(data['inCampaign']).toBe(true)
    expect(data['updatedAt']).toBeDefined()
    expect('routing' in data).toBe(false)
    expect('consentFieldName' in data).toBe(false)
    expect(mockRecountFormStats).not.toHaveBeenCalled()
  })

  it('leaves a pending routing change pending, still offered in its own card', async () => {
    renderDetail()
    rename('Renamed form')
    fireEvent.click(leadSwitch())
    await act(async () => {
      fireEvent.click(saveIn('Details'))
    })
    expect('routing' in onlyWrite()).toBe(false)
    expect(leadSwitch().checked).toBe(true)
    expect(saveIn('CRM routing').disabled).toBe(false)
  })
})

describe('leaving with a change is not silent', () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('does not hold a clean page', () => {
    renderDetail()
    expect(unload()).toBe(false)
  })

  it('holds the page while the routing card has a change', () => {
    renderDetail()
    fireEvent.click(leadSwitch())
    expect(unload()).toBe(true)
  })

  it('holds the page while the details card has a change', () => {
    renderDetail()
    rename('Renamed form')
    expect(unload()).toBe(true)
  })

  it('asks before opening the besigner over a change, and stays when told no', async () => {
    renderDetail()
    fireEvent.click(leadSwitch())
    // `confirm` REJECTS on cancel.
    mockConfirm.mockRejectedValueOnce(undefined)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Edit in besigner/ }))
    })
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockCreateHostVersion).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('opens the besigner when the discard is confirmed', async () => {
    renderDetail()
    fireEvent.click(leadSwitch())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Edit in besigner/ }))
    })
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('opens the besigner without asking from a clean page', async () => {
    renderDetail()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Edit in besigner/ }))
    })
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledTimes(1)
  })
})
