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
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { CrmSendEmailDialog } from './crm-send-email-dialog'

/**
 * The send dialog (AGL-2615): what it shows before a message can go, and
 * what it does with the route's answer.
 *
 * Two seams are doubled — the sending-identity read and the CRM API post —
 * as spies answering fixtures, so the claims are about the DIALOG: the From
 * field prints what the identity route resolved and Send waits for it; a
 * refusal names the Sending page and never enables Send; a route refusal
 * stays on screen with the draft; an accepted send closes with a toast.
 */

/*
 * One function per seam, STABLE across renders: the dialog keys its
 * identity effect on the hook's answer, as the real hook is a `useCallback`,
 * so a mock that minted a fresh function each render would re-fire the
 * effect, set state, render, and never settle.
 */
const sendingApi = jest.fn()
const crmApi = jest.fn()
const enqueueSnackbar = jest.fn()
const getDoc = jest.fn()
const setDoc = jest.fn()
const confirm = jest.fn()
const firestoreHandle = {}
/** What the templates listener answers — the rows as stored, with ids (AGL-2658). */
let templateRows: Array<Record<string, unknown>> = []

jest.mock('@aglyn/plugins-email/components/use-sending-identity-api', () => ({
  useSendingApi: () => sendingApi,
}))
// The hub path and the API door, each recording the site they were asked
// for: at the organization level that is the send-from site, not the page's.
let hubPathAskedFor: Array<string | null | undefined> = []
jest.mock('./use-emails-hub-path', () => ({
  useEmailsHubPath: (hostId?: string | null) => {
    hubPathAskedFor.push(hostId)
    return hostId === null ? null : `/acme/hosts/${hostId === 'site-2' ? 'two' : 'site'}/emails`
  },
}))
let crmApiHost: string | null | undefined
jest.mock('./use-crm-api', () => ({
  useCrmApi: (hostId: string | null) => {
    crmApiHost = hostId
    return crmApi
  },
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => firestoreHandle,
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useUser: () => ({ data: { uid: 'u-1', email: 'Rep@Acme.com', displayName: 'Rep Person' } }),
  useFirestoreCollection: () => ({ data: templateRows, status: 'success', fromCache: false }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: (...args: unknown[]) => enqueueSnackbar(...args) }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useConfirmationContext: () => ({ confirm: (...args: unknown[]) => confirm(...args) }),
}))
jest.mock('firebase/firestore', () => ({
  // A path from a handle, or from a collection path already built.
  doc: (base: unknown, ...segments: string[]) =>
    (typeof base === 'string' ? [base, ...segments] : segments).join('/'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => ({ path }),
  where: () => null,
  orderBy: () => null,
  limit: () => null,
  getDoc: (...args: unknown[]) => getDoc(...args),
  setDoc: (...args: unknown[]) => setDoc(...args),
}))
/*
 * The booking door (AGL-2660) has a spec of its own; here it is one control
 * that hands a link to the draft, recording which record and site it was
 * opened for. Its real form reads the site document, which this spec has
 * no interest in.
 */
let bookingDoorProps: Record<string, unknown> | null = null
jest.mock('./book-meeting-action', () => ({
  ...jest.requireActual('./book-meeting-action'),
  BookMeetingButton: (props: Record<string, unknown> & { onInsert: (link: string) => void }) => {
    bookingDoorProps = props
    return (
      <button type="button" onClick={() => props.onInsert('https://acme.aglyn.app/?service=s')}>
        {'Insert booking link'}
      </button>
    )
  },
}))

const READY = {
  response: { ok: true },
  payload: {
    identity: 'Sending as hello@site.mail.aglyn.app.',
    refusal: null,
    canManage: true,
    senders: [{ id: 'default', isDefault: true, from: 'hello@site.mail.aglyn.app' }],
  },
}

const REFUSED = {
  response: { ok: true },
  payload: {
    identity: 'mail.acme.com is not verified.',
    refusal: { code: 'unverified', message: 'Verify mail.acme.com before sending.' },
    canManage: true,
    senders: [],
  },
}

const onClose = jest.fn()

const open = (props: Partial<React.ComponentProps<typeof CrmSendEmailDialog>> = {}) =>
  render(
    <CrmSendEmailDialog
      open
      onClose={onClose}
      hostId="site-1"
      contactId="contact-1"
      email="ada@example.com"
      name="Ada"
      {...props}
    />,
  )

const sendButton = () => screen.getByRole('button', { name: 'Send' })

const draft = () => {
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Hello' } })
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'A note.' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  hubPathAskedFor = []
  bookingDoorProps = null
  crmApiHost = undefined
  templateRows = []
  sendingApi.mockResolvedValue(READY)
  crmApi.mockResolvedValue({ response: { ok: true }, payload: { ok: true, activityId: 'act-1' } })
  setDoc.mockResolvedValue(undefined)
  confirm.mockResolvedValue(undefined)
})

describe('CrmSendEmailDialog', () => {
  it('asks the identity route for THIS site and prints the address it resolved', async () => {
    open()
    expect(sendingApi).toHaveBeenCalledWith({
      path: 'sending-identity',
      method: 'GET',
      query: { hostId: 'site-1' },
    })
    await waitFor(() =>
      expect(screen.getByLabelText('From')).toHaveProperty('value', 'hello@site.mail.aglyn.app'),
    )
    expect(screen.getByLabelText('To')).toHaveProperty('value', 'Ada <ada@example.com>')
    expect(screen.getByLabelText('Reply-to')).toHaveProperty('value', 'rep@acme.com')
  })

  it('cannot send until the identity is known and both fields are written', async () => {
    let resolveIdentity: (value: unknown) => void = () => undefined
    sendingApi.mockReturnValue(new Promise((resolve) => (resolveIdentity = resolve)))
    open()
    draft()
    expect(sendButton()).toHaveProperty('disabled', true)
    resolveIdentity(READY)
    await waitFor(() => expect(sendButton()).toHaveProperty('disabled', false))
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: '   ' } })
    expect(sendButton()).toHaveProperty('disabled', true)
  })

  it('names the Sending page when the site cannot send, and never enables Send', async () => {
    sendingApi.mockResolvedValue(REFUSED)
    open()
    await screen.findByText('Verify mail.acme.com before sending.')
    const link = screen.getByText('Set up sending') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/acme/hosts/site/emails/sending')
    draft()
    expect(sendButton()).toHaveProperty('disabled', true)
    expect(crmApi).not.toHaveBeenCalled()
  })

  it('posts the record and the draft, then closes with a toast', async () => {
    open({ dealId: 'deal-1' })
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveProperty('value', 'hello@site.mail.aglyn.app'))
    draft()
    fireEvent.click(sendButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(crmApi).toHaveBeenCalledWith('email-send', {
      contactId: 'contact-1',
      dealId: 'deal-1',
      subject: 'Hello',
      body: 'A note.',
    })
    expect(enqueueSnackbar).toHaveBeenCalledWith('Email sent', expect.objectContaining({ variant: 'success' }))
  })

  it('keeps a refused send on screen with the draft intact', async () => {
    crmApi.mockResolvedValue({
      response: { ok: false, status: 409 },
      payload: { error: "Today's one-to-one email limit (50) is reached.", reason: 'quota' },
    })
    open()
    await waitFor(() => expect(sendButton()).toBeTruthy())
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveProperty('value', 'hello@site.mail.aglyn.app'))
    draft()
    fireEvent.click(sendButton())
    await screen.findByText("Today's one-to-one email limit (50) is reached.")
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Hello')
    expect(screen.getByLabelText('Message')).toHaveProperty('value', 'A note.')
  })

  it('reads the address off the contact when the page has none', async () => {
    getDoc.mockResolvedValue({ get: (field: string) => (field === 'email' ? 'Deal@Example.com' : undefined) })
    open({ email: undefined, dealId: 'deal-1' })
    expect(getDoc).toHaveBeenCalledWith('orgs/org-1/contacts/contact-1')
    await waitFor(() =>
      expect(screen.getByLabelText('To')).toHaveProperty('value', 'Ada <deal@example.com>'),
    )
  })

  it('drops a booking link into the draft at the caret, for the most specific record', () => {
    open({ dealId: 'deal-1', leadId: 'lead-1' })
    const message = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(message, { target: { value: 'Pick a time.' } })
    message.setSelectionRange(11, 11)
    fireEvent.click(screen.getByText('Insert booking link'))
    expect(message.value).toBe('Pick a time https://acme.aglyn.app/?service=s .')
    expect(bookingDoorProps).toMatchObject({
      variant: 'chip',
      hostId: 'site-1',
      kind: 'deal',
      recordId: 'deal-1',
    })
  })
})

/**
 * A record no site captured, beneath the org hub's mount (AGL-2634): the
 * message leaves from the site the reader picked — the org's only one,
 * silently — and everything a site owns is asked of THAT site.
 */
describe('at the organization level', () => {
  const hosts = (count: 1 | 2) =>
    [
      { id: 'site-2', name: 'Site Two', subdomain: 'two' },
      { id: 'site-3', name: 'Site Three', subdomain: 'three' },
    ].slice(0, count)
  const openWithoutSite = (count: 1 | 2, props: Partial<React.ComponentProps<typeof CrmSendEmailDialog>> = {}) =>
    render(
      <CrmOrgMountProvider
        mount={{ orgId: 'org-1', hosts: hosts(count), hostsReady: true, hostsPath: '/acme/hosts' }}
      >
        <CrmSendEmailDialog
          open
          onClose={onClose}
          hostId={null}
          contactId="contact-1"
          email="ada@example.com"
          name="Ada"
          {...props}
        />
      </CrmOrgMountProvider>,
    )

  it('sends from the org’s only site, asking that site for its identity and linking its Sending page', async () => {
    sendingApi.mockResolvedValue(REFUSED)
    openWithoutSite(1)
    expect(sendingApi).toHaveBeenCalledWith({
      path: 'sending-identity',
      method: 'GET',
      query: { hostId: 'site-2' },
    })
    expect(crmApiHost).toBe('site-2')
    await screen.findByText('Verify mail.acme.com before sending.')
    expect((screen.getByText('Set up sending') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/acme/hosts/two/emails/sending',
    )
    // One site to choose from is no choice: no picker is drawn.
    expect(screen.queryByLabelText(/^Send from/)).toBeNull()
  })

  it('offers the sites and holds Send until one is picked', async () => {
    openWithoutSite(2)
    await screen.findByText('Pick the site the email leaves from.')
    expect(sendingApi).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^Send from/)).toBeTruthy()
    draft()
    expect(sendButton()).toHaveProperty('disabled', true)
  })
})

/**
 * Templates, snippets and merge fields (AGL-2658): a pick fills both
 * fields and asks first when a message is written; a snippet lands at the
 * caret; the draft can be kept as a template stamped for this scope; and
 * the preview runs the resolver the route runs, counting what it could
 * not fill — while the draft itself is posted unrendered, because the
 * route renders.
 */
describe('templates, snippets and merge fields', () => {
  const stamp = { createdByUid: 'u-2', createdAtMs: 1, updatedAtMs: 1, hostId: 'site-1', visibleTo: ['host:site-1'] }
  const ROWS = [
    {
      $id: 't-shared',
      name: 'Follow-up',
      subject: 'Following up, {{contact.firstName}}',
      body: 'Hi {{contact.firstName}},\n\nStill keen?',
      kind: 'template',
      visibility: 'shared',
      ...stamp,
    },
    { $id: 't-mine', name: 'Proposal', subject: 'Proposal', body: 'Attached.', kind: 'template', visibility: 'personal', ownerUid: 'u-1', ...stamp },
    { $id: 't-theirs', name: 'Secret', subject: 'S', body: 'B', kind: 'template', visibility: 'personal', ownerUid: 'u-9', ...stamp },
    { $id: 's-sig', name: 'Signature', subject: '', body: '-- Rep', kind: 'snippet', visibility: 'shared', ...stamp },
  ]
  const picker = () => screen.getByRole('combobox', { name: 'Template' })
  const pickTemplate = async (name: string) => {
    fireEvent.mouseDown(picker())
    fireEvent.click(await screen.findByRole('option', { name }))
  }

  beforeEach(() => {
    templateRows = ROWS
    // A read that finds nothing, unless a test says otherwise: the loader
    // runs the moment a draft names a field.
    getDoc.mockImplementation(async () => ({ exists: () => false, data: () => undefined, get: () => undefined }))
  })

  it('offers the shared templates and my own, never a colleague\'s personal one, and a pick fills both fields', async () => {
    open()
    fireEvent.mouseDown(picker())
    expect(await screen.findByRole('option', { name: 'Follow-up' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Proposal' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Secret' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Signature' })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Follow-up' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Following up, {{contact.firstName}}'),
    )
    expect(screen.getByLabelText('Message')).toHaveProperty('value', 'Hi {{contact.firstName}},\n\nStill keen?')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks before replacing a written message, and keeps it when the rep declines', async () => {
    open()
    draft()
    confirm.mockRejectedValueOnce(new Error('cancelled'))
    await pickTemplate('Proposal')
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Replace the message?' })))
    expect(screen.getByLabelText('Message')).toHaveProperty('value', 'A note.')
    expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Hello')
    await pickTemplate('Proposal')
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveProperty('value', 'Attached.'))
    expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Proposal')
  })

  it('inserts a snippet, or a merge field, at the caret', async () => {
    open()
    draft()
    const message = screen.getByLabelText('Message') as HTMLTextAreaElement
    message.setSelectionRange(2, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Signature' }))
    await waitFor(() => expect(message.value).toBe('A -- Repnote.'))
    // A letter to a contact is not offered a lead's fields, nor a deal's.
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(await screen.findByRole('menuitem', { name: 'Job title' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Deal amount' })).toBeNull()
    message.setSelectionRange(message.value.length, message.value.length)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Site name' }))
    await waitFor(() => expect(message.value).toBe('A -- Repnote.{{site.name}}'))
  })

  it('keeps the draft as a template, stamped for this site, owned when personal', async () => {
    open()
    draft()
    fireEvent.click(screen.getByRole('button', { name: 'Save as template…' }))
    fireEvent.change(await screen.findByLabelText('Template name'), { target: { value: '  Quick note ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [path, data] = setDoc.mock.calls[0]
    expect(String(path)).toMatch(/^orgs\/org-1\/crmEmailTemplates\/[^/]+$/)
    expect(data).toMatchObject({
      name: 'Quick note',
      subject: 'Hello',
      body: 'A note.',
      kind: 'template',
      visibility: 'personal',
      ownerUid: 'u-1',
      createdByUid: 'u-1',
      hostId: 'site-1',
      visibleTo: ['host:site-1'],
    })
    expect(enqueueSnackbar).toHaveBeenCalledWith('Template "Quick note" saved', expect.objectContaining({ variant: 'success' }))

    // The first save's dialog is still leaving; the outer one is reachable
    // again once it has gone.
    fireEvent.click(await screen.findByRole('button', { name: 'Save as template…' }))
    fireEvent.change(await screen.findByLabelText('Template name'), { target: { value: 'Team note' } })
    fireEvent.click(screen.getByLabelText(/^Shared/))
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(2))
    const shared = setDoc.mock.calls[1][1]
    expect(shared).toMatchObject({ name: 'Team note', visibility: 'shared' })
    expect('ownerUid' in shared).toBe(false)
  })

  it('previews the fields off the record, counts the empty ones, and posts the draft unrendered', async () => {
    const snapshot = (data: Record<string, unknown> | null) => ({
      exists: () => data !== null,
      data: () => data,
      get: (field: string) => data?.[field],
    })
    getDoc.mockImplementation(async (path: string) =>
      path === 'orgs/org-1/contacts/contact-1'
        ? snapshot({ name: 'Ada Lovelace', email: 'ada@example.com' })
        : path === 'hosts/site-1'
          ? snapshot({ displayName: 'Site One' })
          : snapshot(null),
    )
    open()
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveProperty('value', 'hello@site.mail.aglyn.app'))
    // No field named, no read made.
    expect(getDoc).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Hi {{contact.firstName}}' } })
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Re {{deal.name}} from {{sender.firstName}} at {{site.name}}' },
    })
    await screen.findByText('1 field has no value: {{deal.name}}')
    const preview = screen.getByTestId('crm-email-preview')
    expect(preview.textContent).toContain('Hi Ada')
    expect(preview.textContent).toContain('Re  from Rep at Site One')
    expect(getDoc).toHaveBeenCalledWith('orgs/org-1/contacts/contact-1')
    expect(getDoc).toHaveBeenCalledWith('hosts/site-1')
    expect(getDoc).toHaveBeenCalledTimes(2)

    fireEvent.click(sendButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(crmApi).toHaveBeenCalledWith('email-send', {
      contactId: 'contact-1',
      subject: 'Hi {{contact.firstName}}',
      body: 'Re {{deal.name}} from {{sender.firstName}} at {{site.name}}',
    })
  })
})
