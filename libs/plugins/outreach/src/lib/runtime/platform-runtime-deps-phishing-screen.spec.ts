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
 * Outreach sends through a member's connected mailbox, a transport
 * `sendEmail` never sees — so the platform's reach hands the send job the
 * SAME phishing screen every other tenant message passes (AGL-3362), not a
 * copy of it. The screen and tiers are real; the review store is a fake.
 */

import {
  resetOutboundScreenGateForTests,
  setOutboundScreenGate,
  type OutboundScreenGateRequest,
} from '@aglyn/shared-util-email/outbound-screen-gate'
import { platformOutreachRuntimeDeps } from './platform-runtime-deps'

const DAY = 24 * 60 * 60 * 1000

describe('the Outreach send job’s phishing screen (AGL-3362)', () => {
  let asked: OutboundScreenGateRequest[] = []

  beforeEach(() => {
    asked = []
    setOutboundScreenGate(async (request) => {
      asked.push(request)
      return { outcome: 'held', reference: 'HS-OUT' }
    })
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    resetOutboundScreenGateForTests()
    jest.restoreAllMocks()
  })

  const screen = (text: string, createdAt: number) =>
    platformOutreachRuntimeDeps().screenMessage?.({
      orgId: 'org-1',
      org: { name: 'Acme', createdAt },
      hostId: 'host-1',
      host: { name: 'Acme', subdomain: 'acme' },
      subject: 'Quick question',
      text,
      fromName: 'Dana at Acme',
    })

  it('holds a lookalike link, for an established workspace too', async () => {
    const held = await screen(
      'Your Poshmark item sold: https://poshmark.id63835663.shop/o/1',
      Date.now() - 400 * DAY,
    )
    expect(held).toContain('HS-OUT')
    expect(asked[0]).toMatchObject({ workspace: { hostId: 'host-1' }, context: 'outreach sequence' })
  })

  it('lets an ordinary sales email go without asking the store', async () => {
    const held = await screen(
      'Saw your team is hiring — worth a call? https://acme.example.com/demo',
      Date.now() - 2 * DAY,
    )
    expect(held).toBeNull()
    expect(asked).toHaveLength(0)
  })
})
