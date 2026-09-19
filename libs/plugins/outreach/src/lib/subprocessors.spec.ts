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

import { foldPluginSubprocessors } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import {
  OUTREACH_GMAIL_HOST,
  OUTREACH_GOOGLE_CONSENT_HOST,
  OUTREACH_GOOGLE_TOKEN_USE,
  outreachSubprocessors,
} from './subprocessors'

/**
 * Outreach's hosts, as the subprocessor inventory receives them (AGL-2978).
 *
 * The dispositions are a legal classification: Gmail is the rep's own,
 * customer-chosen mailbox, and Google's consent address is only ever opened
 * by the rep's browser. Pinned here so a change to either reads as a change
 * to that classification, not as a side effect of an edit to the transport.
 */

describe('outreachSubprocessors (AGL-2978)', () => {
  it('declares no recipient of its own, two hosts and one use', () => {
    expect(outreachSubprocessors()).toStrictEqual({
      subprocessors: [],
      hosts: [OUTREACH_GMAIL_HOST, OUTREACH_GOOGLE_CONSENT_HOST],
      uses: [OUTREACH_GOOGLE_TOKEN_USE],
    })
  })

  it('classifies the Gmail API as a customer-chosen destination', () => {
    expect(OUTREACH_GMAIL_HOST.host).toBe('gmail.googleapis.com')
    expect(OUTREACH_GMAIL_HOST.disposition).toBe('not-a-subprocessor')
    expect(OUTREACH_GMAIL_HOST.reason).toMatch(/^Customer-chosen destination\. /)
  })

  it('classifies Google’s consent address as a request no server of ours makes', () => {
    expect(OUTREACH_GOOGLE_CONSENT_HOST.host).toBe('accounts.google.com')
    expect(OUTREACH_GOOGLE_CONSENT_HOST.disposition).toBe('no-request')
    expect(OUTREACH_GOOGLE_CONSENT_HOST.dataReceived).toMatch(/^Nothing from our servers\. /)
  })

  it('adds its use to Google’s token endpoint, carrying the flag for legal', () => {
    expect(OUTREACH_GOOGLE_TOKEN_USE.host).toBe('oauth2.googleapis.com')
    expect(OUTREACH_GOOGLE_TOKEN_USE.dataReceived).toContain(
      '⚑ Legal to confirm the Annex III cell needs no change for the Outreach use.',
    )
  })

  it('folds into a registry that already declares the token endpoint, and into none that lacks it', () => {
    const base = {
      'oauth2.googleapis.com': { disposition: 'subprocessor', reason: 'Service-account token exchange.' },
    }
    const manifest = [{ pluginId: 'outreach', ...outreachSubprocessors() }] as const
    const options = {
      toHostEntry: (declaration: typeof OUTREACH_GMAIL_HOST) => ({
        disposition: declaration.disposition as string,
        reason: declaration.reason,
      }),
      withUse: (entry: { disposition: string; reason: string }, use: typeof OUTREACH_GOOGLE_TOKEN_USE) => ({
        ...entry,
        reason: `${entry.reason} ${use.reason}`,
      }),
    }
    const registry = foldPluginSubprocessors(
      base,
      [{ ...manifest[0], subprocessors: [] }],
      () => ({ disposition: 'subprocessor', reason: '' }),
      options,
    )
    expect(registry['oauth2.googleapis.com']).toEqual({
      disposition: 'subprocessor',
      reason: `Service-account token exchange. ${OUTREACH_GOOGLE_TOKEN_USE.reason}`,
    })
    expect(registry['gmail.googleapis.com'].disposition).toBe('not-a-subprocessor')
    expect(registry['accounts.google.com'].disposition).toBe('no-request')
    expect(() =>
      foldPluginSubprocessors({}, [{ ...manifest[0], subprocessors: [] }], () => ({ disposition: '', reason: '' }), options),
    ).toThrow("plugin 'outreach' declares a use of oauth2.googleapis.com, which nothing declares")
  })
})
