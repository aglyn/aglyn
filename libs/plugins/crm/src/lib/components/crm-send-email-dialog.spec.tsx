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
const firestoreHandle = {}

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
  useUser: () => ({ data: { uid: 'u-1', email: 'Rep@Acme.com' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: (...args: unknown[]) => enqueueSnackbar(...args) }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: (...args: unknown[]) => getDoc(...args),
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
  crmApiHost = undefined
  sendingApi.mockResolvedValue(READY)
  crmApi.mockResolvedValue({ response: { ok: true }, payload: { ok: true, activityId: 'act-1' } })
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
