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

import { render, screen, waitFor } from '@testing-library/react'
import type { StaffEmailDeliveryRow } from '../components/staff-user-email-history-card.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
}))

import StaffEmailMessageDialog from '../components/staff-email-message-dialog.component'

/**
 * THE MESSAGE DIALOG.
 *
 * Written because this component had never been rendered. It was built, its
 * data source was checked against the live API, its adapter was unit-tested —
 * and the thing itself had never been on a screen, in a session where that
 * exact gap had already produced two defects a screenshot would have caught.
 *
 * The assertions here are the ones whose failure is silent or dangerous: a
 * preview frame that is not sandboxed, a followed link rendered as a live
 * anchor, and a text-only message presented as a failure to load rather than
 * as the finding it is.
 */

const ROW: StaffEmailDeliveryRow = {
  messageId: 'msg_1',
  provider: 'resend',
  to: 'william.hymes@hitechproductions.com',
  subject: 'Confirm your email address',
  context: 'email-verification',
  status: 'delivered',
  timestamps: { sent: 1_756_182_526_000, delivered: 1_756_182_527_000 },
  firstSeenAtMs: 1_756_182_526_000,
  openCount: 2,
  clickCount: 3,
  clickedLinks: ['https://app.aglyn.com/verify-email?oobCode=abc'],
  bounceType: null,
  detail: null,
  hostId: null,
  campaignId: null,
}

const MESSAGE = {
  provider: 'resend',
  providerMessageId: 'msg_1',
  to: [ROW.to],
  cc: [],
  bcc: [],
  from: 'Aglyn <noreply@aglyn.com>',
  replyTo: null,
  subject: ROW.subject,
  html: '<p>Confirm this address</p>',
  text: 'Confirm this address',
  sentAt: ROW.firstSeenAtMs,
  status: 'delivered',
}

function respondWith(body: unknown, ok = true, status = 200) {
  ;(globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }))
}

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
})

describe('the message dialog', () => {
  it('shows the envelope, the timeline and the engagement counts', async () => {
    respondWith(MESSAGE)
    render(<StaffEmailMessageDialog row={ROW} onClose={() => undefined} />)

    expect(await screen.findByText('Aglyn <noreply@aglyn.com>')).toBeTruthy()
    expect(screen.getByText(ROW.to)).toBeTruthy()
    expect(screen.getByText('msg_1')).toBeTruthy()
    // Both states the row recorded, each with its own time — the point of
    // keeping a per-state map rather than one "last event". "Delivered"
    // appears twice on purpose: the status chip in the title, and the
    // timeline row that dates it.
    expect(screen.getAllByText('Delivered')).toHaveLength(2)
    expect(screen.getByText('Sent')).toBeTruthy()
    expect(screen.getByText('Opens')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('fetches the body by id, on the staff route', async () => {
    respondWith(MESSAGE)
    render(<StaffEmailMessageDialog row={ROW} onClose={() => undefined} />)
    await waitFor(() =>
      expect((globalThis as any).fetch).toHaveBeenCalledWith(
        '/api/admin/emails/message?id=msg_1',
        expect.objectContaining({
          headers: { Authorization: 'Bearer token' },
        }),
      ),
    )
  })

  /*
   * The security property. An email body is staff-authored markup carrying
   * customer-supplied merge values, rendered inside the console's own
   * document — the worst place in the product to run untrusted HTML. An
   * EMPTY sandbox is an opaque origin with no scripts, no forms and no
   * navigation, which is stronger than sanitising because it does not depend
   * on a filter list being complete.
   */
  it('renders the preview in a frame with an empty sandbox', async () => {
    respondWith(MESSAGE)
    render(<StaffEmailMessageDialog row={ROW} onClose={() => undefined} />)

    const frame = (await waitFor(() => {
      const found = document.querySelector('iframe')
      expect(found).toBeTruthy()
      return found
    })) as HTMLIFrameElement

    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toBe('<p>Confirm this address</p>')
  })

  it('lists a followed link as text, never as a live anchor', async () => {
    respondWith(MESSAGE)
    render(<StaffEmailMessageDialog row={ROW} onClose={() => undefined} />)

    const link = await screen.findByText(ROW.clickedLinks[0])
    // A staffer must not be able to burn a customer's single-use reset link
    // by clicking it out of curiosity. Rendered, not clickable.
    expect(link.closest('a')).toBeNull()
    expect(document.querySelector(`a[href="${ROW.clickedLinks[0]}"]`)).toBeNull()
  })

  /*
   * The row that started this whole arc. A message sent with no HTML part is
   * WHY no click could ever have been recorded for it, and the dialog has to
   * say that rather than show an empty pane the reader takes for a failure.
   */
  it('says a text-only message has no HTML part, and why that matters', async () => {
    respondWith({ ...MESSAGE, html: '' })
    render(<StaffEmailMessageDialog row={ROW} onClose={() => undefined} />)

    const notice = await screen.findByText(/plain text only/)
    expect(notice.textContent).toContain('no click could be recorded')
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('surfaces the endpoint’s own message rather than a generic failure', async () => {
    respondWith(
      { error: 'Set RESEND_READ_API_KEY to a full-access key.' },
      false,
      501,
    )
    render(<StaffEmailMessageDialog row={ROW} onClose={() => undefined} />)

    // "Set the key" and "the provider dropped this message" are different
    // problems with different remedies; a generic error hides which.
    expect(
      (await screen.findByRole('alert')).textContent,
    ).toContain('RESEND_READ_API_KEY')
  })

  it('says plainly when the provider no longer holds the message', async () => {
    respondWith({ error: 'The provider no longer holds this message.' }, false, 404)
    render(<StaffEmailMessageDialog row={ROW} onClose={() => undefined} />)
    expect((await screen.findByRole('alert')).textContent).toContain(
      'no longer holds',
    )
  })

  it('renders nothing at all when no row is open', () => {
    respondWith(MESSAGE)
    const { container } = render(
      <StaffEmailMessageDialog row={null} onClose={() => undefined} />,
    )
    expect(container.textContent).toBe('')
    expect((globalThis as any).fetch).not.toHaveBeenCalled()
  })

  it('explains an imported row that carries no per-state timestamps', async () => {
    respondWith(MESSAGE)
    render(
      <StaffEmailMessageDialog
        row={{ ...ROW, timestamps: {} }}
        onClose={() => undefined}
      />,
    )
    // An import knows the send and nothing else. Saying so beats an empty
    // Timeline section the reader has to interpret.
    expect(
      await screen.findByText(/imported from the provider’s history/),
    ).toBeTruthy()
  })
})
