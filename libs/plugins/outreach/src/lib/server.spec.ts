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
 * Outreach's server half is WIRED, not merely written (AGL-2974).
 *
 * For `/api/outreach/<route>` to reach a handler, three things nothing else
 * reads back have to agree: `plugins.config.json` names the register function
 * and the `outreach` prefix, the generated console server manifest carries the
 * same entry (the only code outside `libs/plugins` that may import this
 * bundle), and the register function actually registers the path. The first
 * two are read off disk rather than imported, because the manifest is a
 * dynamic-import table into every plugin's server bundle.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listPluginPermissions,
  resolvePluginApiMatch,
  resolvePluginApiRoute,
} from '@aglyn/aglyn/server'
import { OUTREACH_API_ROUTES } from './constants/api-routes'
import {
  OUTREACH_PLUGIN_ID,
  OUTREACH_USE_PERMISSION,
} from './constants/bundle-common'
import { registerOutreachConsoleApi } from './server'

const REPO_ROOT = join(__dirname, '../../../../..')

/** Drives one registered handler and returns what it answered. */
async function call(path: string, method: string) {
  const handler = resolvePluginApiRoute(path)
  expect(handler).toBeDefined()
  let status = 0
  let body: unknown
  const headers: Record<string, unknown> = {}
  const res = {
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
    res as never,
  )
  return { status, body, headers }
}

describe('the Outreach server entry', () => {
  it('is named in plugins.config.json with the outreach API prefix, console halves only', () => {
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, 'plugins.config.json'), 'utf8'),
    ) as {
      plugins: Array<{
        id: string
        package: string
        register: Record<string, string>
        apiPrefixes?: string[]
      }>
    }
    const entry = config.plugins.find(
      (plugin) => plugin.id === OUTREACH_PLUGIN_ID,
    )
    expect(entry?.package).toBe('@aglyn/plugins-outreach')
    expect(entry?.register).toEqual({
      console: 'registerOutreachConsole',
      consoleApi: 'registerOutreachConsoleApi',
    })
    expect(entry?.apiPrefixes).toEqual(['outreach'])
  })

  it('is carried by the generated console server manifest', () => {
    const manifest = readFileSync(
      join(REPO_ROOT, 'apps/console/constants/plugins.server.generated.ts'),
      'utf8',
    )
    expect(manifest).toContain("id: 'outreach'")
    expect(manifest).toContain('registerOutreachConsoleApi')
    expect(manifest).toContain("import('@aglyn/plugins-outreach/server')")
  })

  it('never reaches the tenant: no tenant manifest names it', () => {
    for (const file of [
      'apps/tenant/utils/plugins.server.generated.ts',
      'apps/tenant/utils/plugins.client.generated.ts',
    ]) {
      expect(readFileSync(join(REPO_ROOT, file), 'utf8')).not.toContain(
        '@aglyn/plugins-outreach',
      )
    }
  })

  it('registers outreach/ping under the plugin prefix, answering a GET', async () => {
    registerOutreachConsoleApi()
    expect(OUTREACH_API_ROUTES.ping.startsWith('outreach/')).toBe(true)
    const { status, body } = await call(OUTREACH_API_ROUTES.ping, 'GET')
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, plugin: 'outreach' })
  })

  it('registers every route under the outreach prefix, where the dispatcher gates it', () => {
    registerOutreachConsoleApi()
    // The dispatcher refuses a request while `release_outreach` is off for
    // it only when the path's owner is this plugin, which the prefix is.
    for (const route of Object.values(OUTREACH_API_ROUTES)) {
      expect(route.startsWith('outreach/')).toBe(true)
      expect(resolvePluginApiMatch(route)).toBeDefined()
    }
  })

  it('refuses any other method on the ping', async () => {
    registerOutreachConsoleApi()
    const { status, headers } = await call(OUTREACH_API_ROUTES.ping, 'POST')
    expect(status).toBe(405)
    expect(headers['Allow']).toBe('GET')
  })

  it('declares outreach.use on the server too, so a route resolves the same defaults', () => {
    registerOutreachConsoleApi()
    const permission = listPluginPermissions().find(
      (entry) => entry.key === OUTREACH_USE_PERMISSION,
    )
    expect(permission?.pluginId).toBe(OUTREACH_PLUGIN_ID)
    expect(permission?.defaults).toEqual({
      admin: true,
      editor: false,
      viewer: false,
    })
  })
})
