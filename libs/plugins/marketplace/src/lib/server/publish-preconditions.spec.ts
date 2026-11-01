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
 *
 * @jest-environment node
 */

/**
 * The payouts precondition, and the one seller it does not apply to
 * (AGL-4049 decision 8): the platform's own org at the staff waiver has nobody
 * to pay, so a priced publish needs no payout account. Every other refusal
 * holds for it, and every other publisher keeps the gate.
 */

import {
  PUBLISHER_AGREEMENT_VERSION,
} from '../model/publisher-agreement'
import type { ResolvedPublisher } from './publisher-profile'
import { publishPreconditionRefusal } from './publish-preconditions'

const CONSENT = { version: PUBLISHER_AGREEMENT_VERSION, accepted: true }
const OPTIONS = { priceUsd: 9, sells: 'starters', agreement: CONSENT }
const NO_ACCOUNT: ResolvedPublisher = { orgId: 'org-1', handle: 'someone' }

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_spec'
})

describe('the payouts precondition', () => {
  it('holds for a publisher with no payout account', () => {
    const refusal = publishPreconditionRefusal(NO_ACCOUNT, OPTIONS)
    expect(refusal?.status).toBe(412)
    expect(String(refusal?.body['error'])).toContain('Set up payouts first')
  })

  it('does not ask a free listing for one', () => {
    expect(publishPreconditionRefusal(NO_ACCOUNT, { ...OPTIONS, priceUsd: 0 })).toBeNull()
  })

  it('is skipped for the platform org at the waiver', () => {
    expect(
      publishPreconditionRefusal({ ...NO_ACCOUNT, sellsAsPlatform: true }, OPTIONS),
    ).toBeNull()
  })

  it('every other precondition still holds for the platform org', () => {
    const platform = { ...NO_ACCOUNT, sellsAsPlatform: true }
    expect(publishPreconditionRefusal(platform, { ...OPTIONS, priceUsd: 0.5 })?.status).toBe(400)
    expect(publishPreconditionRefusal(platform, { ...OPTIONS, agreement: undefined })?.status).toBe(
      428,
    )
  })
})
