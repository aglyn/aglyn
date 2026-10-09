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

import {
  orderEmailDataBlockHtml,
  registerPluginOrderEmailCopies,
  resolvePluginOrderEmailCopies,
  withOrderEmailDataBlocks,
} from './plugin-order-email-copies'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The order-email copies seam (AGL-3699): providers asked together, their
 * blind copies joined and checked, their data blocks escaped, a slow or
 * failing provider adding nothing, and every provider told the outcome.
 */

const REQUEST = {
  hostId: 'host-1',
  recordId: 'order-1',
  emailKey: 'order-shipped',
  moment: 'shipped',
  recipient: 'Buyer@Example.com',
  order: { id: 'order-1' },
}

describe('plugin order-email copies', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('adds nothing when no plugin asks', async () => {
    const copies = await resolvePluginOrderEmailCopies(REQUEST, { timeoutMs: 100 })
    expect(copies.bcc).toEqual([])
    expect(copies.html).toBe('')
    await expect(copies.settle(true)).resolves.toBeUndefined()
  })

  it('joins blind copies, drops bad addresses and the recipient, and escapes data blocks', async () => {
    const settled: boolean[] = []
    registerPluginOrderEmailCopies(
      async (request) => {
        expect(request.emailKey).toBe('order-shipped')
        return {
          bcc: ['shop.com+abc@invite.trustpilot.com', 'not an address', 'buyer@example.com'],
          dataBlocks: [
            { type: 'application/json+trustpilot', json: { recipientName: '</script><img src=x>' } },
            { type: 'text/javascript', json: { evil: true } },
          ],
          settle: async (sent) => {
            settled.push(sent)
          },
        }
      },
      { pluginId: 'review-platforms' },
    )
    registerPluginOrderEmailCopies(async () => ({ bcc: ['shop.com+abc@invite.trustpilot.com'] }), { pluginId: 'other' })

    const copies = await resolvePluginOrderEmailCopies(REQUEST, { timeoutMs: 500 })
    expect(copies.bcc).toEqual(['shop.com+abc@invite.trustpilot.com'])
    expect(copies.html).toContain('<script type="application/json+trustpilot">')
    expect(copies.html).not.toContain('</script><img')
    expect(copies.html).toContain('\\u003c/script\\u003e')
    expect(copies.html).not.toContain('text/javascript')
    await copies.settle(true)
    expect(settled).toEqual([true])
  })

  it('a throwing provider adds nothing; a late one adds nothing and is told the message went without it', async () => {
    const lateSettled: boolean[] = []
    registerPluginOrderEmailCopies(
      async () => {
        throw new Error('down')
      },
      { pluginId: 'broken' },
    )
    registerPluginOrderEmailCopies(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                bcc: ['late@invite.example.com'],
                settle: async (sent) => {
                  lateSettled.push(sent)
                },
              }),
            60,
          ),
        ),
      { pluginId: 'slow' },
    )
    const copies = await resolvePluginOrderEmailCopies(REQUEST, { timeoutMs: 10 })
    expect(copies.bcc).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lateSettled).toEqual([false])
  })

  it('asks nobody for a message with no usable recipient', async () => {
    const provider = jest.fn(async () => ({ bcc: ['x@invite.example.com'] }))
    registerPluginOrderEmailCopies(provider, { pluginId: 'review-platforms' })
    const copies = await resolvePluginOrderEmailCopies({ ...REQUEST, recipient: '' }, { timeoutMs: 50 })
    expect(copies.bcc).toEqual([])
    expect(provider).not.toHaveBeenCalled()
  })

  it('places data blocks before </body>, or at the end of a fragment', () => {
    const block = orderEmailDataBlockHtml({ type: 'application/json', json: { a: 1 } })
    expect(withOrderEmailDataBlocks('<html><body><p>Hi</p></body></html>', block)).toBe(
      `<html><body><p>Hi</p>${block}</body></html>`,
    )
    expect(withOrderEmailDataBlocks('<p>Hi</p>', block)).toBe(`<p>Hi</p>${block}`)
    expect(withOrderEmailDataBlocks('<p>Hi</p>', '')).toBe('<p>Hi</p>')
  })
})
