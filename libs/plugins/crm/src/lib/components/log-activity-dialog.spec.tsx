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
 * THE KIND A NEW ACTIVITY OPENS ON (AGL-2661).
 *
 * Click-to-call's "Log a call" is only one tap if the dialog it opens is
 * already a call. The preset is a prop rather than the default it happens
 * to share, so a surface that wants a different kind gets one and neither
 * reading depends on the other; and a reader who opens as a call and means
 * a note can still say so. An EDIT ignores the preset — the kind of an
 * activity already logged is the activity's own.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LogActivityDialog } from './log-activity-dialog'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1' } }),
  useUserName: () => 'Ada Admin',
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
const mockRecords = new Map<string, Record<string, unknown>>()
const mockGetCount = jest.fn(async (..._args: unknown[]) => ({ data: () => ({ count: 0 }) }))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (name: string) => name,
  where: (...args: unknown[]) => args,
  deleteField: () => 'DELETE',
  getCountFromServer: (...args: unknown[]) => mockGetCount(...args),
  getDoc: async (path: string) => ({
    exists: () => mockRecords.has(path),
    data: () => mockRecords.get(path),
  }),
  addDoc: jest.fn().mockResolvedValue({ id: 'act-1' }),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('./crm-site-picker', () => ({ CrmSitePicker: () => null }))
/** The two fields, as what they hand the dialog: the pickers have their own specs. */
jest.mock('./activity-link-fields', () => ({
  ActivityLinkFields: (props: {
    picks: { contactId: string | null; related: { kind: string; id: string } | null }
    onChange: (picks: unknown) => void
  }) => (
    <div>
      <output data-testid="name">{props.picks.contactId ?? ''}</output>
      <output data-testid="related">
        {props.picks.related ? `${props.picks.related.kind}:${props.picks.related.id}` : ''}
      </output>
      <button onClick={() => props.onChange({ ...props.picks, contactId: 'c-picked' })}>pick name</button>
      <button onClick={() => props.onChange({ ...props.picks, contactId: null })}>clear name</button>
      <button
        onClick={() => props.onChange({ ...props.picks, related: { kind: 'deal', id: 'd-picked' } })}
      >
        pick deal
      </button>
      <button onClick={() => props.onChange({ ...props.picks, related: null })}>clear related</button>
    </div>
  ),
}))

const scope = {
  firestore: {},
  dataScope: ['orgs', 'org-1'] as const,
  orgId: 'org-1',
  hostId: 'host-1',
  mountedHostId: 'host-1',
  consentGroup: null,
  readTokens: ['host:host-1'],
  writeTokens: ['host:host-1'],
} as unknown as Parameters<typeof LogActivityDialog>[0]['scope']

const kind = () => screen.getByRole('combobox', { name: 'Kind' }).textContent

describe('the kind a new activity opens on (AGL-2661)', () => {
  it('opens on the kind the caller preset, and on a call when none is named', () => {
    const { unmount } = render(
      <LogActivityDialog
        open
        onClose={() => undefined}
        scope={scope}
        link={{ contactId: 'c-1' }}
        kind="note"
      />,
    )
    expect(kind()).toBe('Note')
    unmount()

    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} />,
    )
    expect(kind()).toBe('Call')
  })

  it('lets the reader change it — the preset is a start, not a lock', () => {
    render(
      <LogActivityDialog
        open
        onClose={() => undefined}
        scope={scope}
        link={{ contactId: 'c-1' }}
        kind="call"
      />,
    )
    expect(kind()).toBe('Call')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kind' }))
    fireEvent.click(screen.getByRole('option', { name: 'Meeting' }))
    expect(kind()).toBe('Meeting')
  })
})

/**
 * WHICH WAY A CALL WENT (AGL-3517) — Salesforce's Call Type. A call takes
 * inbound, outbound or internal and an email inbound or outbound, outbound
 * to start; no other kind shows the field, and none writes one.
 */
describe('a call’s and an email’s direction (AGL-3517)', () => {
  const { addDoc } = jest.requireMock('firebase/firestore') as { addDoc: jest.Mock }
  const direction = () => screen.queryByRole('combobox', { name: 'Direction' })
  const options = () => {
    fireEvent.mouseDown(direction() as HTMLElement)
    return screen.getAllByRole('option').map((option) => option.textContent)
  }
  beforeEach(() => addDoc.mockClear())

  it('offers a call three directions and an email two, outbound to start, and a note none', () => {
    const { unmount } = render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} />,
    )
    expect(direction()?.textContent).toBe('Outbound')
    expect(options()).toEqual(['Not said', 'Outbound', 'Inbound', 'Internal'])
    unmount()
    const email = render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} kind="email" />,
    )
    expect(options()).toEqual(['Not said', 'Outbound', 'Inbound'])
    email.unmount()
    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} kind="note" />,
    )
    expect(direction()).toBeNull()
  })

  it('writes the direction picked on a call, and none on a note', async () => {
    const { unmount } = render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} />,
    )
    fireEvent.mouseDown(direction() as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: 'Inbound' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), {
      target: { value: 'They called about the quote' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    expect(addDoc.mock.calls[0][1]).toMatchObject({ kind: 'call', direction: 'inbound' })
    unmount()

    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} kind="note" />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), {
      target: { value: 'Prefers mornings' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(2))
    expect('direction' in addDoc.mock.calls[1][1]).toBe(false)
  })

  it('offers every messaging channel as a kind, and logs a message with its direction', async () => {
    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{ contactId: 'c-1' }} />,
    )
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kind' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Call',
      'Email',
      'Text message',
      'WhatsApp',
      'Facebook Messenger',
      'Instagram',
      'LinkedIn',
      'Meeting',
      'Note',
      'Other',
    ])
    fireEvent.click(screen.getByRole('option', { name: 'Facebook Messenger' }))
    expect(options()).toEqual(['Not said', 'Outbound', 'Inbound'])
    fireEvent.click(screen.getByRole('option', { name: 'Inbound' }))
    expect(screen.queryByRole('textbox', { name: 'Outcome' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), {
      target: { value: 'Ready for the Starter plan' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    expect(addDoc.mock.calls[0][1]).toMatchObject({ kind: 'messenger', direction: 'inbound' })
  })
})

/**
 * WHO, WHAT AND WHICH ACCOUNT (AGL-4123). The fields open on the record the
 * dialog was opened from, and what is saved carries the Who, the What and the
 * company it rolls up to, so one entry reads on all three pages.
 */
describe('Name, Related To and the company it rolls up to (AGL-4123)', () => {
  const { addDoc, updateDoc } = jest.requireMock('firebase/firestore') as {
    addDoc: jest.Mock
    updateDoc: jest.Mock
  }
  const shows = (testId: string) => screen.getByTestId(testId).textContent
  const say = (text: string) =>
    fireEvent.change(screen.getByRole('textbox', { name: 'What happened' }), {
      target: { value: text },
    })
  const logged = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() => expect(addDoc).toHaveBeenCalledTimes(1))
    return addDoc.mock.calls[0][1] as Record<string, unknown>
  }
  const dialog = (props: Partial<Parameters<typeof LogActivityDialog>[0]>) =>
    render(
      <LogActivityDialog open onClose={() => undefined} scope={scope} link={{}} {...props} />,
    )

  beforeEach(() => {
    addDoc.mockClear()
    updateDoc.mockClear()
    mockGetCount.mockClear()
    mockRecords.clear()
    mockRecords.set('orgs/org-1/deals/d-1', { companyId: 'co-deal' })
    mockRecords.set('orgs/org-1/deals/d-picked', { companyId: 'co-picked' })
    mockRecords.set('orgs/org-1/contacts/c-1', { facets: { 'host-1': { companyId: 'co-contact' } } })
  })

  const siteScope = {
    ...scope,
    consentGroup: { groupId: 'host-1', hostIds: ['host-1'] },
  } as typeof scope

  it('from a deal: Related To is the deal, Name its Primary, and it rolls up to the deal’s company', async () => {
    dialog({
      scope: siteScope,
      link: { dealId: 'd-1' },
      deal: { contactId: 'c-1', contactRoles: [{ contactId: 'c-1', primary: true }] },
    })
    expect(shows('name')).toBe('c-1')
    expect(shows('related')).toBe('deal:d-1')
    say('Walked through the proposal')
    expect(await logged()).toMatchObject({ contactId: 'c-1', dealId: 'd-1', companyId: 'co-deal' })
  })

  it('from a deal: Name is the reader’s to change', async () => {
    dialog({ scope: siteScope, link: { dealId: 'd-1' }, deal: { contactId: 'c-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'pick name' }))
    say('Spoke to their buyer instead')
    expect(await logged()).toMatchObject({ contactId: 'c-picked', dealId: 'd-1', companyId: 'co-deal' })
  })

  it('from a contact: rolls up to their company with nothing else named', async () => {
    dialog({ scope: siteScope, link: { contactId: 'c-1' } })
    expect(shows('related')).toBe('')
    say('Called back')
    const row = await logged()
    expect(row).toMatchObject({ contactId: 'c-1', companyId: 'co-contact' })
    expect('dealId' in row).toBe(false)
  })

  it('from a contact: naming a deal files it on the deal, and the deal’s company wins', async () => {
    dialog({ scope: siteScope, link: { contactId: 'c-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'pick deal' }))
    say('About the renewal')
    expect(await logged()).toMatchObject({
      contactId: 'c-1',
      dealId: 'd-picked',
      companyId: 'co-picked',
    })
  })

  it('from a company: Related To is the company, and a deal named there replaces it as the What', async () => {
    dialog({ link: { companyId: 'co-1' } })
    expect(shows('related')).toBe('company:co-1')
    say('Met the whole team')
    expect(await logged()).toMatchObject({ companyId: 'co-1' })
    addDoc.mockClear()
    cleanup()

    dialog({ link: { companyId: 'co-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'pick deal' }))
    say('Met about the renewal')
    expect(await logged()).toMatchObject({ dealId: 'd-picked', companyId: 'co-picked' })
  })

  it('counts the ceiling on the Who, not on the company the entry rolls up to', async () => {
    dialog({ scope: siteScope, link: { contactId: 'c-1' } })
    say('Called back')
    await logged()
    expect(JSON.stringify(mockGetCount.mock.calls[0])).toContain('crmActivities')
  })

  it('will not log an entry attached to nothing', async () => {
    dialog({ link: { contactId: 'c-1' } })
    say('Who was this with?')
    fireEvent.click(screen.getByRole('button', { name: 'clear name' }))
    expect((screen.getByRole('button', { name: 'Log' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a lead’s own log offers neither field and files on the lead alone', async () => {
    dialog({ link: { leadId: 'l-1' } })
    expect(screen.queryByTestId('name')).toBeNull()
    say('Left a message')
    const row = await logged()
    expect(row).toMatchObject({ leadId: 'l-1' })
    expect('contactId' in row).toBe(false)
    expect('companyId' in row).toBe(false)
  })

  describe('editing', () => {
    const row = {
      $id: 'act-9',
      kind: 'note',
      body: 'Noted',
      atMs: 1_750_000_000_000,
      byUid: 'u-1',
      contactId: 'c-1',
      companyId: 'co-contact',
    } as Parameters<typeof LogActivityDialog>[0]['activity']
    const save = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
      return updateDoc.mock.calls[0][1] as Record<string, unknown>
    }

    it('opens on what the entry names, and an edit of the words leaves its links alone', async () => {
      dialog({ scope: siteScope, link: { contactId: 'c-1' }, activity: row })
      expect(shows('name')).toBe('c-1')
      expect(shows('related')).toBe('company:co-contact')
      say('Noted, and corrected')
      const written = await save()
      expect(written).toMatchObject({ body: 'Noted, and corrected' })
      expect('contactId' in written).toBe(false)
      expect('companyId' in written).toBe(false)
    })

    it('moves an entry onto a deal, and works the company out again', async () => {
      dialog({ scope: siteScope, link: { contactId: 'c-1' }, activity: row })
      fireEvent.click(screen.getByRole('button', { name: 'pick deal' }))
      expect(await save()).toMatchObject({
        contactId: 'c-1',
        dealId: 'd-picked',
        companyId: 'co-picked',
      })
    })

    it('clears a link taken off, so the entry leaves that timeline', async () => {
      dialog({
        scope: siteScope,
        link: { dealId: 'd-1' },
        activity: { ...row, dealId: 'd-1' } as typeof row,
      })
      fireEvent.click(screen.getByRole('button', { name: 'clear related' }))
      expect(await save()).toMatchObject({
        contactId: 'c-1',
        dealId: 'DELETE',
        companyId: 'co-contact',
      })
    })
  })
})
