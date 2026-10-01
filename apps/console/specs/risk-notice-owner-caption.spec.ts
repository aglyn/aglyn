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

import { ownerNoticeCaption } from '../utils/risk-notice-owner-caption'

/**
 * The abuse queue's "were the owners told" line (AGL-3441).
 *
 * The row's stamp is written when a notice is RAISED, so it reads the same
 * for a delivered email and for a banned owner whose send was refused. These
 * cases hold the caption to the notice's own delivery record instead.
 */
const RAISED_AT = Date.UTC(2026, 9, 1, 3, 53)
const delivery = (patch: Record<string, unknown> = {}) => ({
  recipients: 1,
  emailed: 0,
  emailFailed: 0,
  inApp: 1,
  emailSkipped: null,
  digested: false,
  ...patch,
})

describe('ownerNoticeCaption', () => {
  it('says a banned owner was NOT emailed when the one send was refused', () => {
    const caption = ownerNoticeCaption({
      ownersNotifiedAtMs: RAISED_AT,
      ownersDelivery: delivery({ emailFailed: 1 }),
    })
    expect(caption).toMatch(/^No email reached the workspace's owners or admins/)
    expect(caption).toContain('the one send was refused')
    expect(caption).toContain('Only the in-app copy was written.')
    expect(caption).not.toMatch(/were (told|emailed)/)
  })

  it('CONTROL: says they were emailed when a send went out, counting any refusal', () => {
    expect(
      ownerNoticeCaption({
        ownersNotifiedAtMs: RAISED_AT,
        ownersDelivery: delivery({ recipients: 2, emailed: 1, emailFailed: 1 }),
      }),
    ).toMatch(/were emailed on .* \(1 sent, 1 refused\)/)
  })

  it('never reads a missing delivery record as delivered', () => {
    const caption = ownerNoticeCaption({ ownersNotifiedAtMs: RAISED_AT, ownersDelivery: null })
    expect(caption).toContain('could not be read from the notice')
    expect(caption).not.toMatch(/were (told|emailed)/)
  })

  it('names a skipped email by the reason the notice recorded', () => {
    expect(
      ownerNoticeCaption({
        ownersNotifiedAtMs: RAISED_AT,
        ownersDelivery: delivery({ inApp: 0, emailSkipped: 'This kind is not emailed.' }),
      }),
    ).toMatch(/not emailed on .*: This kind is not emailed\.$/)
  })

  it('says a folded notice went out in the hourly summary', () => {
    expect(
      ownerNoticeCaption({
        ownersNotifiedAtMs: RAISED_AT,
        ownersDelivery: delivery({ digested: true }),
      }),
    ).toContain("folded into the owners' hourly summary")
  })

  it('keeps the pre-notice wording for a row with no stamp', () => {
    expect(ownerNoticeCaption({ ownersNotifiedAtMs: null, ownersDelivery: null })).toMatch(
      /^Filed before owner notices existed/,
    )
  })
})
