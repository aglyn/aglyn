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

import { isPhoneContactSuppressed } from './contact-suppression'
import { applyInboundSmsKeyword, parseSmsKeyword } from './sms-keywords'
import { fakeFirestore } from './test-firestore'

/**
 * AGL-1592. There is no SMS pipeline yet, so what is testable — and what a
 * provider integration would get wrong on its own — is which words count and
 * what they do to the records.
 */
describe('parseSmsKeyword', () => {
  it('recognizes the CTIA opt-out set, in any case, with punctuation', () => {
    for (const body of ['STOP', 'stop', 'Stop.', ' STOP ', 'stopall', 'UNSUBSCRIBE', 'quit', 'End']) {
      expect(parseSmsKeyword(body)).toBe('stop')
    }
  })

  it('recognizes opt-in and help', () => {
    expect(parseSmsKeyword('START')).toBe('start')
    expect(parseSmsKeyword('unstop')).toBe('start')
    expect(parseSmsKeyword('HELP')).toBe('help')
  })

  it('matches the WHOLE message, never a substring', () => {
    // "please don't stop sending these" is not an opt-out, and reading it as
    // one is how a substring match fails. Carriers apply the same rule.
    expect(parseSmsKeyword("please don't stop sending these")).toBeNull()
    expect(parseSmsKeyword('stop calling me')).toBeNull()
    expect(parseSmsKeyword('yes I want to cancel my account')).toBeNull()
  })

  it('survives the punctuation real handsets send', () => {
    expect(parseSmsKeyword('“STOP”')).toBe('stop')
    expect(parseSmsKeyword('STOP!')).toBe('stop')
  })

  it('answers null for an empty or absent body', () => {
    expect(parseSmsKeyword('')).toBeNull()
    expect(parseSmsKeyword(null)).toBeNull()
    expect(parseSmsKeyword('   ')).toBeNull()
  })
})

describe('applyInboundSmsKeyword', () => {
  it('a STOP suppresses TEXTS only — they replied to a text, not to a call', async () => {
    const firestore = fakeFirestore()
    const result = await applyInboundSmsKeyword({
      from: '+15125550123',
      body: 'STOP',
      firestore,
    })
    expect(result).toEqual({ verdict: 'stop', applied: true })
    expect(await isPhoneContactSuppressed('+15125550123', 'texts', firestore)).toBe(true)
    // Widening it to calls would be recording a request nobody made. §11
    // offers the call opt-out through the other two routes.
    expect(await isPhoneContactSuppressed('+15125550123', 'calls', firestore)).toBe(false)
  })

  it('a START revokes the suppression', async () => {
    const firestore = fakeFirestore()
    await applyInboundSmsKeyword({ from: '+15125550123', body: 'STOP', firestore })
    const result = await applyInboundSmsKeyword({
      from: '+15125550123',
      body: 'START',
      firestore,
    })
    expect(result).toEqual({ verdict: 'start', applied: true })
    expect(await isPhoneContactSuppressed('+15125550123', 'texts', firestore)).toBe(false)
  })

  it('HELP and ordinary replies change no records', async () => {
    const firestore = fakeFirestore()
    expect(await applyInboundSmsKeyword({ from: '+15125550123', body: 'HELP', firestore }))
      .toEqual({ verdict: 'help', applied: false })
    expect(await applyInboundSmsKeyword({ from: '+15125550123', body: 'thanks!', firestore }))
      .toEqual({ verdict: null, applied: false })
    expect(Object.keys(firestore.docs('contactSuppressions'))).toHaveLength(0)
  })
})
