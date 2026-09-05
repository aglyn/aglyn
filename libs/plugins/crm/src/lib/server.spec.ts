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
 * The Contacts plugin's server half is WIRED, not merely written (AGL-2595).
 *
 * Three things have to agree for `/api/crm/<route>` to reach a handler
 * in this plugin, and each is a file nothing else reads back:
 *
 *  1. `plugins.config.json` names the register function under `consoleApi`
 *     and lists `contacts` under `apiPrefixes` — the loader activates a
 *     plugin's server bundle for a request only when the first path segment
 *     is one of its prefixes.
 *  2. The generated console server manifest carries the same entry — it is
 *     the ONLY code outside `libs/plugins` that may import this bundle, and
 *     a stale one loads nothing with no error.
 *  3. The register function actually registers a route the dispatcher can
 *     resolve, and that route answers.
 *
 * The first two are read off disk rather than imported: the manifest is a
 * dynamic-import table into every plugin's server bundle, and importing it
 * from a plugin spec would pull the whole estate into one jest worker.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePluginApiRoute } from '@aglyn/aglyn/server'

// The deal-stage route pulls the Admin SDK and the tenant runtime into the
// server entry (AGL-2598); this spec proves the WIRING of the entry, and
// that route has its own spec with those modules doubled. Stubbed here so
// the wiring test loads what it tests and nothing heavier.
jest.mock('./server-deal-stage', () => ({
  crmDealStageHandler: jest.fn(),
}))
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCrmConsoleApi } from './server'

const REPO_ROOT = join(__dirname, '../../../../..')

/** Drives one registered handler and returns what it answered. */
async function call(path: string, method: string) {
  const handler = resolvePluginApiRoute(path)
  expect(handler).toBeDefined()
  let status = 0
  let body: unknown
  const headers: Record<string, unknown> = {}
  const res: any = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      body = value
    },
    send: (value: unknown) => {
      body = value
    },
    setHeader: (name: string, value: unknown) => {
      headers[name] = value
    },
    redirect: () => undefined,
    end: () => undefined,
  }
  await handler?.(
    { method, query: {}, body: undefined, headers: {}, cookies: {}, socket: {} },
    res,
  )
  return { status, body, headers }
}

describe('the CRM server entry', () => {
  it('is named in plugins.config.json with the contacts API prefix', () => {
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, 'plugins.config.json'), 'utf8'),
    ) as { plugins: Array<{ id: string; register: Record<string, string>; apiPrefixes?: string[] }> }
    const entry = config.plugins.find((plugin) => plugin.id === BUNDLE_ID)
    expect(entry?.register['consoleApi']).toBe('registerCrmConsoleApi')
    expect(entry?.apiPrefixes).toEqual(['crm'])
  })

  it('is carried by the generated console server manifest', () => {
    const manifest = readFileSync(
      join(REPO_ROOT, 'apps/console/constants/plugins.server.generated.ts'),
      'utf8',
    )
    expect(manifest).toContain("id: 'crm'")
    expect(manifest).toContain('apiPrefixes: ["crm"]')
    expect(manifest).toContain('registerCrmConsoleApi')
    expect(manifest).toContain("import('@aglyn/plugins-crm/server')")
  })

  it('registers crm/ping, which answers a GET', async () => {
    registerCrmConsoleApi()
    const { status, body } = await call('crm/ping', 'GET')
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, plugin: 'crm' })
  })

  it('refuses any other method on the ping', async () => {
    registerCrmConsoleApi()
    const { status, headers } = await call('crm/ping', 'POST')
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('GET')
  })
})
