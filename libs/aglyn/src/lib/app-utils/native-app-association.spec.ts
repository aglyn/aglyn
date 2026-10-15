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

import {
  APPLE_APP_SITE_ASSOCIATION_PATH,
  ASSET_LINKS_PATH,
  appleAppSiteAssociationResponse,
  assetLinksResponse,
  nativeAppAssociationRoute,
  parseAndroidApps,
  parseAppleAppIds,
} from './native-app-association'

/** Fixtures only: no real team id, package or certificate appears in this repo's runtime code. */
const APP = 'ABCDE12345.com.example.app'
const POS = 'ABCDE12345.com.example.pos'
const FP_A = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':')
const FP_B = Array.from({ length: 32 }, (_, i) => (255 - i).toString(16).toUpperCase()).join(':')

const env = {
  NATIVE_APPLE_APP_IDS: `${APP}, ${POS}`,
  NATIVE_ANDROID_APPS: `com.example.app=${FP_A},${FP_B};com.example.pos=${FP_B.toLowerCase()}`,
}

const ask = (overrides: Partial<Parameters<typeof appleAppSiteAssociationResponse>[0]> = {}) => ({
  host: 'console.example.com',
  servedHosts: ['console.example.com'],
  applinks: true,
  env,
  ...overrides,
})

describe('the two public paths (AGL-3817)', () => {
  it('maps exactly the two documents, and nothing near them', () => {
    expect(APPLE_APP_SITE_ASSOCIATION_PATH).toBe('/.well-known/apple-app-site-association')
    expect(ASSET_LINKS_PATH).toBe('/.well-known/assetlinks.json')
    expect(nativeAppAssociationRoute(APPLE_APP_SITE_ASSOCIATION_PATH)).toBe(
      '/api/native-app-association/apple-app-site-association',
    )
    expect(nativeAppAssociationRoute(ASSET_LINKS_PATH)).toBe('/api/native-app-association/assetlinks')
    for (const near of [
      '/.well-known/apple-app-site-association.json',
      '/.well-known/apple-app-site-association/',
      '/.well-known/assetlinks',
      '/.well-known/security.txt',
      '/acme/.well-known/assetlinks.json',
      '/toString',
      '/constructor',
    ]) {
      expect(nativeAppAssociationRoute(near)).toBeNull()
    }
  })
})

describe('reading the environment', () => {
  it('keeps valid Apple app ids in order and drops the rest', () => {
    expect(parseAppleAppIds(`${APP},,not-an-id,abc.com.example.x, ${POS},${APP}`)).toEqual([APP, POS])
    expect(parseAppleAppIds(undefined)).toEqual([])
  })

  it('reads packages with their fingerprints, normalized to upper case', () => {
    expect(parseAndroidApps(env.NATIVE_ANDROID_APPS)).toEqual([
      { packageName: 'com.example.app', sha256Fingerprints: [FP_A, FP_B] },
      { packageName: 'com.example.pos', sha256Fingerprints: [FP_B] },
    ])
  })

  it('drops an entry with no valid fingerprint or no valid package', () => {
    expect(parseAndroidApps(`com.example.app=AA:BB;=${FP_A};bad package=${FP_A};com.example.x`)).toEqual([])
    expect(parseAndroidApps(undefined)).toEqual([])
  })
})

describe('apple-app-site-association', () => {
  it('answers 200, exactly application/json, with a short cache', async () => {
    const response = appleAppSiteAssociationResponse(ask())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('names every app for passkeys and links, one details entry per app in order', async () => {
    const body = await appleAppSiteAssociationResponse(ask()).json()
    expect(body.webcredentials).toEqual({ apps: [APP, POS] })
    expect(body.applinks.apps).toEqual([])
    expect(body.applinks.details.map((d: { appIDs: string[] }) => d.appIDs)).toEqual([[APP], [POS]])
    const components = body.applinks.details[0].components
    expect(components.at(-1)).toMatchObject({ '/': '/*' })
    expect(components.slice(0, -1).every((c: { exclude?: boolean }) => c.exclude === true)).toBe(true)
  })

  it('carries webcredentials alone where the host is not the console', async () => {
    const body = await appleAppSiteAssociationResponse(ask({ applinks: false })).json()
    expect(body).toEqual({ webcredentials: { apps: [APP, POS] } })
  })

  it('answers 404 when no app id is configured', () => {
    expect(appleAppSiteAssociationResponse(ask({ env: {} })).status).toBe(404)
    expect(appleAppSiteAssociationResponse(ask({ env: { NATIVE_APPLE_APP_IDS: ' , ' } })).status).toBe(404)
  })

  it('answers 404 on a host this deployment does not vouch for', () => {
    expect(appleAppSiteAssociationResponse(ask({ host: 'customer.example.net' })).status).toBe(404)
    expect(appleAppSiteAssociationResponse(ask({ host: null })).status).toBe(404)
    expect(appleAppSiteAssociationResponse(ask({ servedHosts: [null] })).status).toBe(404)
  })

  it('matches the host without its port or case', () => {
    expect(appleAppSiteAssociationResponse(ask({ host: 'Console.Example.com:443' })).status).toBe(200)
  })

  it('answers on any host of a preview deployment', () => {
    const preview = { ...env, VERCEL_ENV: 'preview' }
    expect(
      appleAppSiteAssociationResponse(ask({ host: 'x-git-branch.vercel.app', env: preview })).status,
    ).toBe(200)
    expect(
      appleAppSiteAssociationResponse(ask({ host: 'x.vercel.app', env: { VERCEL_ENV: 'preview' } })).status,
    ).toBe(404)
  })
})

describe('assetlinks.json', () => {
  it('answers 200 with both relations for every package', async () => {
    const response = assetLinksResponse(ask())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
        target: { namespace: 'android_app', package_name: 'com.example.app', sha256_cert_fingerprints: [FP_A, FP_B] },
      },
      {
        relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
        target: { namespace: 'android_app', package_name: 'com.example.pos', sha256_cert_fingerprints: [FP_B] },
      },
    ])
  })

  it('answers 404 when no app is configured, or on another host', () => {
    expect(assetLinksResponse(ask({ env: {} })).status).toBe(404)
    expect(assetLinksResponse(ask({ host: 'customer.example.net' })).status).toBe(404)
  })
})
