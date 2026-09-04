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
 * THE CONFIRMATION LINK'S SUBJECT — the fourth form of one signature scheme.
 *
 * Pure: `crypto` and nothing else, so there are no doubles at all. What is
 * under test is the property that makes a purpose-prefixed subject safe — that
 * no confirmation subject is byte-identical to an unsubscribe subject over
 * different values, because a signature that verifies two different tuples is
 * a signature that means whichever one an attacker prefers.
 */

import {
  buildConfirmUrl,
  confirmSignature,
  confirmSignatureSubject,
  unsubscribeSignatureSubject,
  CONFIRM_SUBJECT_PREFIX,
} from './email-unsubscribe-link'

const HOST = 'host-1'
const ADDRESS = 'dana@example.com'
const TOPIC = 'newsletter'
const SECRET = 'test-secret'
const BASE = 'https://shop.example.com'

describe('confirmSignatureSubject', () => {
  it('names the purpose, the host, the address and the topic', () => {
    expect(confirmSignatureSubject(HOST, ADDRESS, TOPIC)).toBe(
      `${CONFIRM_SUBJECT_PREFIX}:${HOST}:${ADDRESS}:${TOPIC}`,
    )
  })

  it('lowercases the address, the way the URL will carry it', () => {
    // The property that makes one derivation work rather than two that agree
    // by luck: a subject over the lowercase form and a URL carrying the
    // mixed-case form is a 403 for the recipient pressing the button.
    expect(confirmSignatureSubject(HOST, 'Dana@Example.com', TOPIC)).toBe(
      confirmSignatureSubject(HOST, ADDRESS, TOPIC),
    )
  })

  /**
   * `confirm:H:E:T` is byte-identical to the four-part unsubscribe subject
   * `A:B:C:D` when the site's id is literally `confirm`, which would let one
   * signature verify as both. Refused rather than reasoned about.
   */
  it('refuses a host whose id would collide with the prefix', () => {
    expect(confirmSignatureSubject(CONFIRM_SUBJECT_PREFIX, ADDRESS, TOPIC)).toBe(
      '',
    )
    expect(confirmSignature(CONFIRM_SUBJECT_PREFIX, ADDRESS, TOPIC, SECRET)).toBe(
      '',
    )
  })

  it('refuses a colon in either id, like the other three forms', () => {
    expect(confirmSignatureSubject('a:b', ADDRESS, TOPIC)).toBe('')
    expect(confirmSignatureSubject(HOST, ADDRESS, 'a:b')).toBe('')
  })

  it('refuses a missing component rather than signing a partial subject', () => {
    expect(confirmSignatureSubject('', ADDRESS, TOPIC)).toBe('')
    expect(confirmSignatureSubject(HOST, '', TOPIC)).toBe('')
    expect(confirmSignatureSubject(HOST, ADDRESS, '')).toBe('')
  })

  /**
   * The reason the prefix exists at all: the unsubscribe forms cannot express
   * a topic with no campaign, and forcing one would produce an empty middle
   * component that reads two ways.
   */
  it('is not any of the three unsubscribe forms', () => {
    const confirm = confirmSignatureSubject(HOST, ADDRESS, TOPIC)
    for (const other of [
      unsubscribeSignatureSubject(HOST, ADDRESS),
      unsubscribeSignatureSubject(HOST, ADDRESS, TOPIC),
      unsubscribeSignatureSubject(HOST, ADDRESS, 'camp-1', TOPIC),
    ]) {
      expect(confirm).not.toBe(other)
    }
  })
})

describe('confirmSignature', () => {
  it('differs from the unsubscribe signature over the same values', () => {
    expect(confirmSignature(HOST, ADDRESS, TOPIC, SECRET)).not.toBe(
      confirmSignature(HOST, ADDRESS, 'marketing', SECRET),
    )
  })

  it('yields nothing without a secret, rather than a digest of nothing', () => {
    expect(confirmSignature(HOST, ADDRESS, TOPIC, '')).toBe('')
  })
})

describe('buildConfirmUrl', () => {
  it('points at the confirm route and carries every signed component', () => {
    const url = buildConfirmUrl({
      siteBase: BASE,
      hostId: HOST,
      email: ADDRESS,
      topicId: TOPIC,
      secret: SECRET,
    })
    expect(url).toContain(`${BASE}/api/email/confirm`)
    expect(url).toContain(`hostId=${HOST}`)
    expect(url).toContain(`email=${encodeURIComponent(ADDRESS)}`)
    expect(url).toContain(`tid=${TOPIC}`)
    expect(url).toContain(
      `sig=${confirmSignature(HOST, ADDRESS, TOPIC, SECRET)}`,
    )
  })

  it('carries the LOWERCASED address, matching what it signed', () => {
    const url = buildConfirmUrl({
      siteBase: BASE,
      hostId: HOST,
      email: 'Dana@Example.com',
      topicId: TOPIC,
      secret: SECRET,
    })
    expect(url).toContain(`email=${encodeURIComponent(ADDRESS)}`)
  })

  /**
   * Empty rather than a half-built URL. A link pointing at nothing is worse
   * than no link, because the person believes they have confirmed.
   */
  it('is empty with no origin, no secret, or nothing to sign', () => {
    const base = {
      siteBase: BASE,
      hostId: HOST,
      email: ADDRESS,
      topicId: TOPIC,
      secret: SECRET,
    }
    expect(buildConfirmUrl({ ...base, siteBase: '' })).toBe('')
    expect(buildConfirmUrl({ ...base, secret: '' })).toBe('')
    expect(buildConfirmUrl({ ...base, topicId: '' })).toBe('')
    expect(buildConfirmUrl({ ...base, email: '' })).toBe('')
  })

  it('does not double a trailing slash on the site origin', () => {
    expect(
      buildConfirmUrl({
        siteBase: `${BASE}/`,
        hostId: HOST,
        email: ADDRESS,
        topicId: TOPIC,
        secret: SECRET,
      }),
    ).toContain(`${BASE}/api/email/confirm`)
  })
})
