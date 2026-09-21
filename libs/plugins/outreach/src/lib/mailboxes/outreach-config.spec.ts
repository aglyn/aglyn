/**
 * @jest-environment node
 *
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

import { randomBytes } from 'node:crypto'
import { OUTREACH_OAUTH_CALLBACK_PATH, outreachOAuthRedirectUri } from './oauth-redirect'
import { OUTREACH_ENV, readOutreachGoogleConfig } from './outreach-config'

/**
 * What a deployment has to set before a rep can connect a mailbox
 * (AGL-2978), and where Google sends the rep back.
 */

const ENV_NAMES = [OUTREACH_ENV.clientId, OUTREACH_ENV.clientSecret, OUTREACH_ENV.tokenKey]
const saved: Record<string, string | undefined> = {}

/** `NODE_ENV` is typed read-only; the redirect's development branch reads it. */
const setNodeEnv = (value: string) => {
  ;(process.env as Record<string, string | undefined>)['NODE_ENV'] = value
}

beforeEach(() => {
  for (const name of [...ENV_NAMES, 'NEXT_PUBLIC_CONSOLE_URL', 'NODE_ENV']) saved[name] = process.env[name]
  process.env[OUTREACH_ENV.clientId] = 'client.apps.googleusercontent.com'
  process.env[OUTREACH_ENV.clientSecret] = 'client-secret'
  process.env[OUTREACH_ENV.tokenKey] = randomBytes(32).toString('base64')
})

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('readOutreachGoogleConfig (AGL-2978)', () => {
  it('reads the client and a keyring from the three variables', () => {
    const result = readOutreachGoogleConfig()
    expect(result.configured).toBe(true)
    if (result.configured) {
      expect(result.config.clientId).toBe('client.apps.googleusercontent.com')
      expect(result.config.clientSecret).toBe('client-secret')
      expect(result.config.keyring.keys).toHaveLength(1)
    }
  })

  it('names every missing variable, and never a value', () => {
    delete process.env[OUTREACH_ENV.clientId]
    process.env[OUTREACH_ENV.clientSecret] = '   '
    delete process.env[OUTREACH_ENV.tokenKey]
    expect(readOutreachGoogleConfig()).toEqual({ configured: false, missing: ENV_NAMES })
  })

  it('counts a token key that is not 32 bytes of base64 as missing', () => {
    process.env[OUTREACH_ENV.tokenKey] = randomBytes(16).toString('base64')
    expect(readOutreachGoogleConfig()).toEqual({ configured: false, missing: [OUTREACH_ENV.tokenKey] })
    process.env[OUTREACH_ENV.tokenKey] = 'correct horse battery staple'
    expect(readOutreachGoogleConfig()).toEqual({ configured: false, missing: [OUTREACH_ENV.tokenKey] })
  })

  it('reads a comma-separated key list as a rotation: the first seals, the rest open', () => {
    const next = randomBytes(32).toString('base64')
    const previous = randomBytes(32).toString('base64')
    process.env[OUTREACH_ENV.tokenKey] = `${next},${previous}`
    const result = readOutreachGoogleConfig()
    expect(result.configured && result.config.keyring.keys.length).toBe(2)
    expect(result.configured && result.config.keyring.current.id).toBe(result.configured && result.config.keyring.keys[0].id)
  })
})

describe('outreachOAuthRedirectUri (AGL-2978)', () => {
  it('is the console origin plus the callback, whatever host the rep opened the console on', () => {
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com/'
    setNodeEnv('production')
    expect(outreachOAuthRedirectUri('https://acme.example.com/api/outreach/mailboxes/connect')).toBe(
      `https://console.example.com${OUTREACH_OAUTH_CALLBACK_PATH}`,
    )
    expect(OUTREACH_OAUTH_CALLBACK_PATH).toBe('/api/outreach/mailboxes/oauth/callback')
  })

  it('sends a local developer back to localhost, and never in production', () => {
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://console.example.com'
    setNodeEnv('development')
    expect(outreachOAuthRedirectUri('http://localhost:4200/api/outreach/mailboxes/connect')).toBe(
      `http://localhost:4200${OUTREACH_OAUTH_CALLBACK_PATH}`,
    )
    setNodeEnv('production')
    expect(outreachOAuthRedirectUri('http://localhost:4200/api/outreach/mailboxes/connect')).toBe(
      `https://console.example.com${OUTREACH_OAUTH_CALLBACK_PATH}`,
    )
  })

  it('falls back to the production console when the deployment names none (AGL-3228)', () => {
    setNodeEnv('production')
    delete process.env.NEXT_PUBLIC_CONSOLE_URL
    expect(outreachOAuthRedirectUri('https://console.example.com/api/x')).toBe(
      `https://app.aglyn.com${OUTREACH_OAUTH_CALLBACK_PATH}`,
    )
    process.env.NEXT_PUBLIC_CONSOLE_URL = '   '
    expect(outreachOAuthRedirectUri('https://console.example.com/api/x')).toBe(
      `https://app.aglyn.com${OUTREACH_OAUTH_CALLBACK_PATH}`,
    )
  })

  it('is null when the deployment names an unusable console origin', () => {
    setNodeEnv('production')
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'javascript:alert(1)'
    expect(outreachOAuthRedirectUri('https://console.example.com/api/x')).toBeNull()
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'not a url'
    expect(outreachOAuthRedirectUri('https://console.example.com/api/x')).toBeNull()
  })
})
