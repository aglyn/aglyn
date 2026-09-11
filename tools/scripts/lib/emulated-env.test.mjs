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

// Self-test for what an emulated dev server may hold (AGL-2828).
//
// Three cases carry the weight. An inherited '' must stay '' whatever a file
// holds, because the refill is how a blanked key reached the server under
// nx. The preflight must refuse a server whose credential is merely ABSENT,
// because absent is what a server fills from its own env files after `ps`
// has looked. And a credential set anywhere in a process's `ps` line must
// read as set, however an empty occurrence of the same name is placed around
// it. Every value below is a placeholder.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  credentialPreflight,
  emulatedServeEnvironment,
  heldCredentials,
  isOutboundCredential,
  parseProcessEnvironment,
  serveEnvFiles,
  serversHoldNoCredential,
} from './emulated-env.mjs'

const file = (parsed) => ({ path: 'fixture', parsed })

describe('isOutboundCredential', () => {
  it('covers the Stripe, Vercel, Resend and GA4 keys the env files carry', () => {
    for (const name of [
      'STRIPE_SECRET_KEY',
      'STRIPE_SECRET_KEY_TEST',
      'STRIPE_RESTRICTED_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'VERCEL_TOKEN',
      'VERCEL_OIDC_TOKEN',
      'RESEND_API_KEY',
      'RESEND_DOMAINS_API_KEY',
      'RESEND_READ_API_KEY',
      'RESEND_WEBHOOK_SECRET',
      'GA4_API_SECRET',
    ]) {
      assert.equal(isOutboundCredential(name), true, name)
    }
  })

  it('covers a provider nobody has listed yet', () => {
    assert.equal(isOutboundCredential('ACME_API_KEY'), true)
    assert.equal(isOutboundCredential('ACME_CLIENT_SECRET'), true)
  })

  it('leaves the kept secrets and everything that is not a credential', () => {
    for (const name of [
      'FIREBASE_PRIVATE_KEY',
      'FIREBASE_TOKEN_URI',
      'NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY',
      'TOKEN_SIGNING_SECRET',
      'REVALIDATE_SECRET',
      'STRIPE_PRICE_PRO',
      'VERCEL_TEAM_ID',
      'GA4_MEASUREMENT_ID',
      'FIREBASE_STORAGE_EMULATOR_HOST',
    ]) {
      assert.equal(isOutboundCredential(name), false, name)
    }
  })
})

describe('emulatedServeEnvironment', () => {
  it('never refills an inherited empty variable from a file', () => {
    const { env } = emulatedServeEnvironment({ HOST_URL: '' }, [file({ HOST_URL: 'from-file' })])
    assert.equal(env.HOST_URL, '')
  })

  it('fills an undefined variable from the first file that defines it', () => {
    const { env } = emulatedServeEnvironment({}, [
      file({ HOST_URL: 'project' }),
      file({ HOST_URL: 'root', USAGE_EMAIL_FROM: 'root' }),
    ])
    assert.equal(env.HOST_URL, 'project')
    assert.equal(env.USAGE_EMAIL_FROM, 'root')
  })

  it('sets every outbound credential empty, from a file or the shell, and names those that held a value', () => {
    const { env, blanked } = emulatedServeEnvironment(
      { VERCEL_TOKEN: 'placeholder', RESEND_API_KEY: '' },
      [file({ STRIPE_SECRET_KEY: 'placeholder', RESEND_API_KEY: 'placeholder', TOKEN_SIGNING_SECRET: 'placeholder' })],
    )
    assert.equal(env.VERCEL_TOKEN, '')
    assert.equal(env.STRIPE_SECRET_KEY, '')
    assert.equal(env.RESEND_API_KEY, '')
    assert.equal(env.TOKEN_SIGNING_SECRET, 'placeholder')
    assert.deepEqual(blanked, ['STRIPE_SECRET_KEY', 'VERCEL_TOKEN'])
  })
})

describe('serveEnvFiles', () => {
  it("puts the project's files before the workspace root's, in nx's precedence", () => {
    const files = serveEnvFiles('/repo', 'console')
    assert.equal(files[0], '/repo/apps/console/.env.serve.development.local')
    assert.ok(files.indexOf('/repo/apps/console/.env.development.local') < files.indexOf('/repo/apps/console/.env.local'))
    assert.ok(files.indexOf('/repo/apps/console/.env') < files.indexOf('/repo/.env.local'))
    assert.equal(files.at(-1), '/repo/.env')
  })
})

describe('parseProcessEnvironment', () => {
  it('reads set and empty variables after the command line', () => {
    const states = parseProcessEnvironment(
      '/usr/local/bin/node /repo/node_modules/next/dist/bin/next dev --port 4310 PATH=/usr/bin STRIPE_SECRET_KEY= VERCEL_TOKEN=placeholder\n',
    )
    assert.equal(states.get('STRIPE_SECRET_KEY'), 'empty')
    assert.equal(states.get('VERCEL_TOKEN'), 'set')
    assert.equal(states.has('RESEND_API_KEY'), false)
  })

  it('reads a name as set when any occurrence of it is, wherever the empty one sits', () => {
    // A blanked name inside another variable's value (npm_lifecycle_script
    // carries the script's shell text) must not hide the real one.
    const before = 'node x.mjs npm_lifecycle_script=sh -c STRIPE_SECRET_KEY= node STRIPE_SECRET_KEY=placeholder'
    const after = 'node x.mjs STRIPE_SECRET_KEY=placeholder npm_lifecycle_script=sh -c STRIPE_SECRET_KEY= node'
    assert.equal(parseProcessEnvironment(before).get('STRIPE_SECRET_KEY'), 'set')
    assert.equal(parseProcessEnvironment(after).get('STRIPE_SECRET_KEY'), 'set')
  })

  it('finds nothing in a retitled process', () => {
    assert.equal(parseProcessEnvironment('next-server (v16.3.3)  \n').size, 0)
  })
})

describe('heldCredentials', () => {
  it('holds a credential that is set, or absent while an env file defines it', () => {
    const states = new Map([
      ['STRIPE_SECRET_KEY', 'empty'],
      ['VERCEL_TOKEN', 'set'],
      ['TOKEN_SIGNING_SECRET', 'set'],
    ])
    const fromFiles = new Set(['STRIPE_SECRET_KEY', 'RESEND_API_KEY', 'TOKEN_SIGNING_SECRET'])
    assert.deepEqual(heldCredentials(states, fromFiles), ['RESEND_API_KEY', 'VERCEL_TOKEN'])
  })
})

// A retitled Next server on each port, forked by a `next dev` whose own
// environment `ps` can read.
const nextDev = {
  pid: 20,
  ppid: 10,
  command: '/usr/local/bin/node /repo/node_modules/next/dist/bin/next dev --port 4310 PATH=/usr/bin STRIPE_SECRET_KEY= RESEND_API_KEY= ',
}
const nextServer = { pid: 30, ppid: 20, command: 'next-server (v16.3.3)  ' }
const tenantDev = { ...nextDev, pid: 21, command: nextDev.command.replace('4310', '4510') }
const tenantServer = { pid: 31, ppid: 21, command: 'next-server (v16.3.3)  ' }
const processes = (...rows) => (pid) => rows.find((row) => row.pid === pid) ?? null
const holding = (row) => ({ ...row, command: row.command.replace('STRIPE_SECRET_KEY=', 'STRIPE_SECRET_KEY=placeholder') })

describe('credentialPreflight', () => {
  const base = {
    origin: 'http://localhost:4310',
    app: 'console',
    repoRoot: '/repo',
    listen: () => [30],
    fileNames: new Set(['STRIPE_SECRET_KEY', 'RESEND_API_KEY']),
  }

  it('passes a retitled Next server whose next dev parent holds every credential empty', () => {
    assert.deepEqual(credentialPreflight({ ...base, read: processes(nextDev, nextServer) }), {
      ok: true,
      readFrom: [20],
    })
  })

  it('refuses one whose parent holds a credential, and names it', () => {
    const verdict = credentialPreflight({ ...base, read: processes(holding(nextDev), nextServer) })
    assert.equal(verdict.ok, false)
    assert.deepEqual(verdict.held, ['STRIPE_SECRET_KEY'])
    assert.equal(verdict.reason, 'holds STRIPE_SECRET_KEY')
  })

  it('refuses one where a credential an env file defines is absent rather than empty', () => {
    const absent = { ...nextDev, command: nextDev.command.replace(' RESEND_API_KEY= ', ' ') }
    const verdict = credentialPreflight({ ...base, read: processes(absent, nextServer) })
    assert.equal(verdict.ok, false)
    assert.deepEqual(verdict.held, ['RESEND_API_KEY'])
  })

  it('refuses a retitled server whose parent is not next dev, rather than trusting that parent', () => {
    const launcher = { pid: 20, ppid: 10, command: '/usr/local/bin/node smoke.mjs PATH=/usr/bin STRIPE_SECRET_KEY= RESEND_API_KEY= ' }
    const verdict = credentialPreflight({ ...base, read: processes(launcher, nextServer) })
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason, /cannot be read/)
  })

  it('refuses a server it cannot inspect', () => {
    const none = processes()
    assert.equal(credentialPreflight({ ...base, origin: 'https://app.aglyn.com', read: none }).ok, false)
    assert.equal(credentialPreflight({ ...base, listen: () => [], read: none }).ok, false)
    assert.equal(credentialPreflight({ ...base, listen: () => null, read: none }).ok, false)
  })
})

describe('serversHoldNoCredential', () => {
  const servers = { console: 'http://localhost:4310', tenant: 'http://localhost:4510' }
  const options = {
    repoRoot: '/repo',
    listen: (port) => (port === 4310 ? [30] : [31]),
    fileNames: new Set(['STRIPE_SECRET_KEY', 'RESEND_API_KEY']),
  }

  it('passes when every server holds each credential empty, and says where each was read', () => {
    const verdict = serversHoldNoCredential(servers, {
      ...options,
      read: processes(nextDev, nextServer, tenantDev, tenantServer),
    })
    assert.equal(verdict.ok, true)
    assert.equal(verdict.detail, 'environments read: console from pid 20; tenant from pid 21')
  })

  it('refuses the server that holds one, names the variable and the script to start it with, and prints no value', () => {
    const verdict = serversHoldNoCredential(servers, {
      ...options,
      read: processes(nextDev, nextServer, holding(tenantDev), tenantServer),
    })
    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /^the tenant server at http:\/\/localhost:4510 holds STRIPE_SECRET_KEY\. /)
    assert.match(verdict.detail, /npm run serve:tenant:emulated/)
    assert.doesNotMatch(JSON.stringify(verdict), /placeholder/)
  })

  it('refuses a server it cannot inspect, rather than passing it', () => {
    const verdict = serversHoldNoCredential(servers, { ...options, listen: () => [], read: processes() })
    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /^the console server at http:\/\/localhost:4310 has no process listening on port 4310\. /)
  })
})
