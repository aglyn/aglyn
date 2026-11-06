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

import { fireEvent, render, screen } from '@testing-library/react'
import { ReplyComposer, ReplyThread } from './reply-composer.component'

/** The reply composer the Inbox and a quote share (AGL-4207). */

describe('ReplyComposer', () => {
  const base = { to: 'jane@example.com', message: '', onMessageChange: jest.fn(), messageMax: 10, note: 'Answers go to you.', busy: false, onSend: jest.fn() }

  it('says who it’s to and where answers go, and sends only a message with something in it', () => {
    const { rerender } = render(<ReplyComposer {...base} />)
    expect(screen.getByText('To jane@example.com')).toBeTruthy()
    expect(screen.getByText('Answers go to you.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send reply' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReplyComposer {...base} message="Hi" />)
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))
    expect(base.onSend).toHaveBeenCalledTimes(1)
  })

  it('cuts what is typed at its length, and asks for a subject only when the caller has one', () => {
    const onMessageChange = jest.fn()
    const onSubject = jest.fn()
    render(<ReplyComposer {...base} onMessageChange={onMessageChange} subject={{ value: '', onChange: onSubject, max: 3 }} message="Hi" />)
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'x'.repeat(20) } })
    expect(onMessageChange).toHaveBeenCalledWith('x'.repeat(10))
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'abcdef' } })
    expect(onSubject).toHaveBeenCalledWith('abc')
    // A subject the caller asks for must be filled.
    expect((screen.getByRole('button', { name: 'Send reply' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stays off for someone who may not send, and while sending', () => {
    const { rerender } = render(<ReplyComposer {...base} message="Hi" canSend={false} />)
    expect((screen.getByRole('button', { name: 'Send reply' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<ReplyComposer {...base} message="Hi" busy sendLabel="Send message" />)
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ReplyThread', () => {
  it('lists each message under who said it, and draws nothing when there are none', () => {
    const { container, rerender } = render(<ReplyThread title="Conversation" messages={[]} />)
    expect(container.textContent).toBe('')
    rerender(
      <ReplyThread
        title="Conversation"
        moreNote="Showing the 10 most recent."
        messages={[
          { id: '1', atMs: 1, direction: 'out', label: 'to jane@example.com', body: 'Hello' },
          { id: '2', atMs: 2, direction: 'in', label: 'Jane wrote', body: 'Thanks' },
        ]}
      />,
    )
    expect(screen.getByText('Conversation')).toBeTruthy()
    expect(screen.getByText('Showing the 10 most recent.')).toBeTruthy()
    expect(screen.getByText(/Jane wrote$/).closest('[data-reply-direction]')?.getAttribute('data-reply-direction')).toBe('in')
  })
})
