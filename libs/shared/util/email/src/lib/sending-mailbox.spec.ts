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
 * The mailbox half of a sending identity.
 *
 * The load-bearing assertions here are the ones in "a mailbox name cannot
 * carry a second header". Everything else protects a sentence a merchant
 * reads; those protect the `From:` line itself, which the stored value
 * reaches directly.
 */

import {
  DEFAULT_SENDING_LOCAL_PART,
  headerSafeText,
  RESERVED_SENDING_LOCAL_PARTS,
  sentAsStamp,
  SENDING_FROM_NAME_MAX,
  validateSendingLocalPart,
} from './sending-mailbox'

describe('a mailbox name cannot carry a second header', () => {
  /*
   * The values are assembled from `String.fromCharCode` rather than written
   * as escapes so the intent survives a copy-paste: every one of them is a
   * real control byte in the string under test, which is the thing a header
   * guard has to be proved against.
   */
  const CR = String.fromCharCode(13)
  const LF = String.fromCharCode(10)

  it.each([
    ['a newline', `sales${LF}Bcc: attacker@evil.test`],
    ['a carriage return', `sales${CR}${LF}Subject: hijacked`],
    ['a bare CR', `sales${CR}x`],
    ['a tab', 'sales\tops'],
    ['a null byte', `sales${String.fromCharCode(0)}x`],
    ['a second address', 'sales@acme.com'],
    ['an angle bracket', 'sales<x'],
    ['a quote', 'sales"x'],
    ['a comma', 'sales,ops'],
    ['a space', 'sales team'],
  ])('refuses %s', (_label, input) => {
    const check = validateSendingLocalPart(input)
    expect(check.localPart).toBeNull()
    expect(check.error).toBeTruthy()
  })

  it('refuses a local part longer than an SMTP mailbox may be', () => {
    expect(validateSendingLocalPart('a'.repeat(65)).localPart).toBeNull()
    expect(validateSendingLocalPart('a'.repeat(64)).localPart).toBe(
      'a'.repeat(64),
    )
  })

  it('accepts the shapes a merchant actually wants', () => {
    expect(validateSendingLocalPart('hello').localPart).toBe('hello')
    expect(validateSendingLocalPart('sales').localPart).toBe('sales')
    expect(validateSendingLocalPart('jamie.lee').localPart).toBe('jamie.lee')
    expect(validateSendingLocalPart('team+news').localPart).toBe('team+news')
    // Trimmed and lowered, because an address is case-insensitive and a
    // trailing space is a typo rather than a different mailbox.
    expect(validateSendingLocalPart('  Sales  ').localPart).toBe('sales')
  })
})

describe('a refusal names the rule instead of correcting in silence', () => {
  it('does not answer a malformed name with the default mailbox', () => {
    const check = validateSendingLocalPart('sales team!')
    expect(check.localPart).toBeNull()
    expect(check.localPart).not.toBe(DEFAULT_SENDING_LOCAL_PART)
    expect(check.error).toContain('letters, numbers')
  })

  it('tells somebody who pasted a whole address what to enter', () => {
    expect(validateSendingLocalPart('jamie@acme.com').error).toContain(
      'only the part before the @',
    )
  })

  it('names the empty case as its own', () => {
    expect(validateSendingLocalPart('').error).toContain('mailbox name')
    expect(validateSendingLocalPart(null).error).toBeTruthy()
    expect(validateSendingLocalPart(undefined).error).toBeTruthy()
  })

  it.each(RESERVED_SENDING_LOCAL_PARTS)(
    'refuses the operational mailbox %s',
    (reserved) => {
      const check = validateSendingLocalPart(reserved)
      expect(check.localPart).toBeNull()
      expect(check.error).toContain('reserved')
    },
  )

  it('does not refuse a name that merely contains a reserved one', () => {
    expect(validateSendingLocalPart('postmaster-team').localPart).toBe(
      'postmaster-team',
    )
  })
})

describe('headerSafeText', () => {
  it('collapses control characters rather than dropping the value', () => {
    const value = `Jamie${String.fromCharCode(13)}${String.fromCharCode(
      10,
    )}Bcc: attacker@evil.test`
    const safe = headerSafeText(value, SENDING_FROM_NAME_MAX)
    expect(safe).toBe('Jamie Bcc: attacker@evil.test')
    expect(safe).not.toContain(String.fromCharCode(10))
    expect(safe).not.toContain(String.fromCharCode(13))
  })

  it('measures its ceiling over what survives', () => {
    expect(headerSafeText('  Jamie   Lee  ', 9)).toBe('Jamie Lee')
    expect(headerSafeText('Jamie Lee', 5)).toBe('Jamie')
  })

  it('answers the empty string for nothing at all', () => {
    expect(headerSafeText(null, 10)).toBe('')
    expect(headerSafeText(undefined, 10)).toBe('')
  })
})

describe('what a send records about its sender', () => {
  it('writes nothing at all when there is no address', () => {
    expect(sentAsStamp({ from: '' })).toEqual({})
    expect(sentAsStamp({ from: null, fromName: 'Jamie' })).toEqual({})
    // A value that is not an address is not half a record either: a stamp
    // carrying a display name and no `from` would read as recorded.
    expect(sentAsStamp({ from: 'not-an-address' })).toEqual({})
  })

  it('records the address, the name and the reply target', () => {
    expect(
      sentAsStamp({
        from: 'Jamie@Acme.com',
        fromName: 'Jamie at Acme',
        replyTo: 'Jamie@Acme-Corp.com',
      }),
    ).toEqual({
      sentAs: {
        from: 'jamie@acme.com',
        fromName: 'Jamie at Acme',
        replyTo: 'jamie@acme-corp.com',
      },
    })
  })

  it('omits the optional halves rather than storing them empty', () => {
    expect(sentAsStamp({ from: 'hello@acme.com' })).toEqual({
      sentAs: { from: 'hello@acme.com' },
    })
    expect(
      sentAsStamp({ from: 'hello@acme.com', fromName: '  ', replyTo: '' }),
    ).toEqual({ sentAs: { from: 'hello@acme.com' } })
  })

  it('cannot smuggle a header through the display name', () => {
    const stamp = sentAsStamp({
      from: 'hello@acme.com',
      fromName: `Acme${String.fromCharCode(10)}Bcc: attacker@evil.test`,
    })
    expect(stamp.sentAs?.fromName).toBe('Acme Bcc: attacker@evil.test')
  })
})
