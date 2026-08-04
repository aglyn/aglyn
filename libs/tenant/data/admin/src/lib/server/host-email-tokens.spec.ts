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

jest.mock('@aglyn/shared-util-email', () => ({
  renderHostEmail: jest.fn(async () => ({ subject: 'ok' })),
}))
jest.mock('./firebase-admin', () => ({ firebaseAdmin: {} }))

import { renderHostEmail } from '@aglyn/shared-util-email'
import { renderHostEmailWithTokens } from './host-email-tokens'

const renderMock = renderHostEmail as unknown as jest.Mock

/** A Firestore stand-in returning one host document. */
const firestoreWith = (data: unknown, options: { throws?: boolean } = {}) =>
  ({
    collection: () => ({
      doc: () => ({
        get: async () => {
          if (options.throws) throw new Error('unavailable')
          return { exists: data !== null, data: () => data }
        },
      }),
    }),
  }) as never

const mergeArg = () => renderMock.mock.calls[0][3] as Record<string, string>

const site = {
  displayName: 'Northwind Coffee',
  subdomain: 'northwind-coffee',
  business: { supportEmail: 'help@northwind.example' },
}

describe('renderHostEmailWithTokens (AGL-1022)', () => {
  beforeEach(() => renderMock.mockClear())

  it('resolves host.* into the merge map the sender was already passing', async () => {
    await renderHostEmailWithTokens(
      firestoreWith(site),
      'host-1',
      'order-receipt',
      { customerName: 'Ada' },
    )
    const merge = mergeArg()
    expect(merge['host.businessName']).toBe('Northwind Coffee')
    expect(merge['host.supportEmail']).toBe('help@northwind.example')
    expect(merge['host.url']).toBe('https://northwind-coffee.aglyn.app')
    // The caller's own tokens survive untouched.
    expect(merge['customerName']).toBe('Ada')
  })

  it('lets an explicit caller value WIN over the resolved one', async () => {
    // A white-label send, or a preview with sample data, is naming a specific
    // thing on purpose. This is not the place to overrule it.
    await renderHostEmailWithTokens(firestoreWith(site), 'host-1', 'k', {
      'host.businessName': 'Someone Else Ltd',
    })
    expect(mergeArg()['host.businessName']).toBe('Someone Else Ltd')
  })

  it('sends anyway when the host read fails, with tokens empty', async () => {
    // An email with a gap where the address would be beats no email at all.
    await renderHostEmailWithTokens(
      firestoreWith(null, { throws: true }),
      'host-1',
      'k',
      { customerName: 'Ada' },
    )
    expect(renderMock).toHaveBeenCalledTimes(1)
    const merge = mergeArg()
    expect(merge['host.businessName']).toBe('')
    expect(merge['customerName']).toBe('Ada')
  })

  it('sends anyway for a host document that does not exist', async () => {
    await renderHostEmailWithTokens(firestoreWith(null), 'gone', 'k')
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(mergeArg()['host.supportEmail']).toBe('')
  })

  it('never leaves a host token for the template to leak', async () => {
    // Every registered token is present as a key even when unset, so nothing
    // depends on a downstream catch-all to blank the leftovers.
    await renderHostEmailWithTokens(firestoreWith({}), 'host-1', 'k')
    const merge = mergeArg()
    const hostKeys = Object.keys(merge).filter((key) => key.startsWith('host.'))
    expect(hostKeys.length).toBeGreaterThan(0)
    expect(hostKeys.every((key) => merge[key] === '')).toBe(true)
  })

  it('passes the template key and options straight through', async () => {
    await renderHostEmailWithTokens(
      firestoreWith(site),
      'host-1',
      'booking-confirmed',
      {},
      { origin: 'https://example.test' },
    )
    expect(renderMock.mock.calls[0][1]).toBe('host-1')
    expect(renderMock.mock.calls[0][2]).toBe('booking-confirmed')
    expect(renderMock.mock.calls[0][4]).toEqual({
      origin: 'https://example.test',
    })
  })
})
