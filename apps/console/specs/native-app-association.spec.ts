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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AppLinksComponent,
  consoleAppLinksComponents,
  NATIVE_AUTH_LINK_SEGMENTS,
  NATIVE_WEB_ONLY_TOP_LEVEL_SEGMENTS,
} from '@aglyn/aglyn/app-utils/native-app-association'
import { CONSOLE_TOP_LEVEL_SEGMENTS } from '@aglyn/console-ui/console-routes'
import { CONSOLE_HOSTNAME } from '../constants/workspace-domain'
import { GET as getAppleAppSiteAssociation } from '../app/api/native-app-association/apple-app-site-association/route'
import { GET as getAssetLinks } from '../app/api/native-app-association/assetlinks/route'

/**
 * The console's `apple-app-site-association` and `assetlinks.json` (AGL-3817):
 * served from the environment, and claiming exactly the console paths the
 * native deep-link grammar resolves.
 */
const REPO_ROOT = join(__dirname, '../../..')

const APP = 'ABCDE12345.com.example.app'
const POS = 'ABCDE12345.com.example.pos'
const FP = Array.from({ length: 32 }, () => 'AB').join(':')

const saved = { ...process.env }
afterEach(() => {
  for (const key of ['NATIVE_APPLE_APP_IDS', 'NATIVE_ANDROID_APPS', 'VERCEL_ENV']) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const get = (route: (request: Request) => Response, host: string) =>
  route(new Request(`https://${host}/x`, { headers: { host } }))

describe('the console routes', () => {
  it('serve the association file from NATIVE_APPLE_APP_IDS on the console host', async () => {
    process.env['NATIVE_APPLE_APP_IDS'] = `${APP},${POS}`
    const response = get(getAppleAppSiteAssociation, CONSOLE_HOSTNAME)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    const body = await response.json()
    expect(body.webcredentials.apps).toEqual([APP, POS])
    expect(body.applinks.details.map((d: { appIDs: string[] }) => d.appIDs[0])).toEqual([APP, POS])
  })

  it('serve the statement list from NATIVE_ANDROID_APPS on the console host', async () => {
    process.env['NATIVE_ANDROID_APPS'] = `com.example.app=${FP}`
    const response = get(getAssetLinks, CONSOLE_HOSTNAME)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    const [statement] = await response.json()
    expect(statement.target).toEqual({
      namespace: 'android_app',
      package_name: 'com.example.app',
      sha256_cert_fingerprints: [FP],
    })
    expect(statement.relation).toContain('delegate_permission/common.get_login_creds')
    expect(statement.relation).toContain('delegate_permission/common.handle_all_urls')
  })

  it('answer 404 when the variables are unset', () => {
    delete process.env['NATIVE_APPLE_APP_IDS']
    delete process.env['NATIVE_ANDROID_APPS']
    expect(get(getAppleAppSiteAssociation, CONSOLE_HOSTNAME).status).toBe(404)
    expect(get(getAssetLinks, CONSOLE_HOSTNAME).status).toBe(404)
  })

  it('answer 404 on a white-label console domain, which is not ours to vouch for', () => {
    process.env['NATIVE_APPLE_APP_IDS'] = APP
    process.env['NATIVE_ANDROID_APPS'] = `com.example.app=${FP}`
    expect(get(getAppleAppSiteAssociation, 'console.acme-agency.example').status).toBe(404)
    expect(get(getAssetLinks, 'console.acme-agency.example').status).toBe(404)
  })
})

/** Apple's `components` rule: the first pattern that matches decides; `*` is any run, `?` one character. */
function opensInApp(components: AppLinksComponent[], path: string): boolean {
  for (const component of components) {
    const pattern = component['/']
      .split('')
      .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
      .join('')
    if (new RegExp(`^${pattern}$`).test(path)) return !component.exclude
  }
  return false
}

/** Every deep-link path the native screen specs register, core's and every plugin's. */
function nativeLinkPaths(): string[] {
  const files = execFileSync('git', ['ls-files', '*.screens.json'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  const paths = new Set<string>()
  for (const file of files) {
    const spec = JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as {
      screens?: Array<{ links?: string[] }>
    }
    for (const screen of spec.screens ?? []) for (const link of screen.links ?? []) paths.add(link)
  }
  return [...paths]
}

describe('the applinks paths follow the native deep-link grammar', () => {
  const components = consoleAppLinksComponents()
  const links = nativeLinkPaths()
  const nativeTopLevel = new Set(
    links.map((path) => path.split('/')[1]).filter((segment) => CONSOLE_TOP_LEVEL_SEGMENTS.has(segment)),
  )

  it('reads the native link specs', () => {
    expect(links.length).toBeGreaterThan(50)
    expect(nativeTopLevel).toContain('admin')
  })

  it('splits the console top level exactly into native sections and web-only ones', () => {
    // Auth-link sections open their exact page in the app and leave the rest to the web.
    const webOnly = new Set([...NATIVE_WEB_ONLY_TOP_LEVEL_SEGMENTS, ...NATIVE_AUTH_LINK_SEGMENTS])
    expect(NATIVE_AUTH_LINK_SEGMENTS.filter((s) => NATIVE_WEB_ONLY_TOP_LEVEL_SEGMENTS.includes(s))).toEqual([])
    expect([...webOnly].filter((s) => nativeTopLevel.has(s))).toEqual([])
    expect([...CONSOLE_TOP_LEVEL_SEGMENTS].filter((s) => !webOnly.has(s) && !nativeTopLevel.has(s)).sort()).toEqual([])
    expect([...webOnly].filter((s) => !CONSOLE_TOP_LEVEL_SEGMENTS.has(s))).toEqual([])
  })

  it('opens every registered native link, at the top level and under a workspace and site', () => {
    const missed: string[] = []
    for (const link of links) {
      const path = link.replace(/:[A-Za-z]+/g, 'x1')
      const candidates = nativeTopLevel.has(path.split('/')[1])
        ? [path]
        : [`/acme${path}`, `/acme/hosts/main-site${path}`]
      for (const candidate of candidates) if (!opensInApp(components, candidate)) missed.push(candidate)
    }
    expect(missed).toEqual([])
  })

  it.each([
    '/acme',
    '/acme/hosts/main-site/theme',
    '/acme/hosts/main-site/screens/s1/versions/v1/besigner',
    '/admin/emails/e1/versions/v1/besigner',
    '/manage/user/security',
    '/signup',
    '/verify-email',
    '/reset-password',
    '/account-recovery',
  ])('opens %s in the app', (path) => {
    expect(opensInApp(components, path)).toBe(true)
  })

  it.each([
    '/signin',
    '/signup/plan',
    '/verify-email/sent',
    '/reset-password/done',
    '/auth/action',
    '/auth/handoff/continue',
    '/sso/acme',
    '/account-recovery/codes',
    '/signout',
    '/edit-access',
    '/kiosk/commerce/display',
    '/p/AbCdE12345',
    '/api/outreach/l/AbCdE12345',
    '/_missing',
    '/_static/monaco/vs/loader.js',
    '/__/auth/handler',
    '/.well-known/apple-app-site-association',
  ])('leaves %s in the browser', (path) => {
    expect(opensInApp(components, path)).toBe(false)
  })

  it('does not swallow a workspace whose slug starts like a web-only section', () => {
    expect(opensInApp(components, '/authors/crm')).toBe(true)
    expect(opensInApp(components, '/signing-studio')).toBe(true)
  })
})
