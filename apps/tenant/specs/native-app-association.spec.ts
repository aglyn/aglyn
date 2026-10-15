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

import { NextRequest } from 'next/server'
import {
  APPLE_APP_SITE_ASSOCIATION_PATH,
  ASSET_LINKS_PATH,
  hostnameOfUrl,
} from '@aglyn/aglyn/app-utils/native-app-association'
import { PLATFORM_HOME_URL } from '@aglyn/aglyn/app-utils/platform-brand'
import { config, middleware } from '../middleware'
import { GET as getAppleAppSiteAssociation } from '../app/api/native-app-association/apple-app-site-association/route'
import { GET as getAssetLinks } from '../app/api/native-app-association/assetlinks/route'

/**
 * The platform home site's `apple-app-site-association` and
 * `assetlinks.json` (AGL-3817). That host is the passkey relying party; every
 * other host this app serves is a customer's site and must vouch for nothing.
 */
const HOME = hostnameOfUrl(PLATFORM_HOME_URL) as string
const APP = 'ABCDE12345.com.example.app'
const FP = Array.from({ length: 32 }, () => 'CD').join(':')

const saved = { ...process.env }
beforeEach(() => {
  process.env['NATIVE_APPLE_APP_IDS'] = APP
  process.env['NATIVE_ANDROID_APPS'] = `com.example.app=${FP}`
})
afterEach(() => {
  for (const key of ['NATIVE_APPLE_APP_IDS', 'NATIVE_ANDROID_APPS', 'VERCEL_ENV']) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const get = (route: (request: Request) => Response, host: string) =>
  route(new Request(`https://${host}/x`, { headers: { host } }))

describe('the routes', () => {
  it('has a platform home host to answer on', () => {
    expect(HOME).toBeTruthy()
  })

  it('serves webcredentials only on the home host: its paths are site pages, not console links', async () => {
    const response = get(getAppleAppSiteAssociation, HOME)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ webcredentials: { apps: [APP] } })
  })

  it('serves both relations on the home host', async () => {
    const response = get(getAssetLinks, HOME)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    const [statement] = await response.json()
    expect(statement.relation).toEqual([
      'delegate_permission/common.handle_all_urls',
      'delegate_permission/common.get_login_creds',
    ])
    expect(statement.target.package_name).toBe('com.example.app')
    expect(statement.target.sha256_cert_fingerprints).toEqual([FP])
  })

  it('answers 404 on a customer domain', () => {
    expect(get(getAppleAppSiteAssociation, 'shop.customer.example').status).toBe(404)
    expect(get(getAssetLinks, 'shop.customer.example').status).toBe(404)
  })

  it('answers 404 when the variables are unset', () => {
    delete process.env['NATIVE_APPLE_APP_IDS']
    delete process.env['NATIVE_ANDROID_APPS']
    expect(get(getAppleAppSiteAssociation, HOME).status).toBe(404)
    expect(get(getAssetLinks, HOME).status).toBe(404)
  })
})

describe('the middleware', () => {
  it.each([
    [APPLE_APP_SITE_ASSOCIATION_PATH, '/api/native-app-association/apple-app-site-association'],
    [ASSET_LINKS_PATH, '/api/native-app-association/assetlinks'],
  ])('rewrites %s to its route before resolving any host', async (path, route) => {
    const response = (await middleware(
      new NextRequest(new Request(`https://${HOME}${path}`, { headers: { host: HOME } })),
      {} as never,
    )) as Response
    expect(response.status).toBe(200)
    expect(new URL(String(response.headers.get('x-middleware-rewrite'))).pathname).toBe(route)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
  })

  it('is reached by the matcher', () => {
    expect(config.matcher).toContain(APPLE_APP_SITE_ASSOCIATION_PATH)
    expect(config.matcher).toContain(ASSET_LINKS_PATH)
  })
})
