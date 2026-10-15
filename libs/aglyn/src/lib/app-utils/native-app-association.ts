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

/*==========================================
 * THE DOCUMENTS THAT TIE THE NATIVE APPS TO A DOMAIN (AGL-3817).
 *
 * Apple's `apple-app-site-association` and Google's `assetlinks.json` are how
 * a domain says which apps may use its passkeys (`webcredentials`,
 * `get_login_creds`) and open its links (`applinks`, `handle_all_urls`). Both
 * are fetched by the platform's verifier, not by a person, so each has to be
 * exactly `application/json`, a 200, no redirect and no cookie.
 *
 * Everything that names an app comes from the environment, never from here:
 *
 *  - `NATIVE_APPLE_APP_IDS`: comma-separated `<team id>.<bundle id>` values,
 *    in the order the system should prefer them;
 *  - `NATIVE_ANDROID_APPS`: `;`-separated `<package>=<sha256>,<sha256>`
 *    entries, each fingerprint the colon-separated hex Play Console prints.
 *
 * Unset (or nothing valid in it), the document answers 404: a deployment
 * with no apps of its own vouches for none.
 *
 * A leaf with no imports, because both middlewares read the paths below.
 *=========================================*/

/** Where Apple's verifier reads the association file: no `.json` suffix. */
export const APPLE_APP_SITE_ASSOCIATION_PATH = '/.well-known/apple-app-site-association'

/** Where Google's verifier reads the statement list. */
export const ASSET_LINKS_PATH = '/.well-known/assetlinks.json'

/**
 * The route handlers each middleware rewrites the two public paths to. They
 * live under `/api` because both apps keep their route handlers there, and
 * neither middleware runs again on `/api`.
 */
export const NATIVE_APP_ASSOCIATION_ROUTES: Readonly<Record<string, string>> = {
  [APPLE_APP_SITE_ASSOCIATION_PATH]: '/api/native-app-association/apple-app-site-association',
  [ASSET_LINKS_PATH]: '/api/native-app-association/assetlinks',
}

/** The route handler a public association path is served by, or null. */
export function nativeAppAssociationRoute(pathname: string): string | null {
  return Object.prototype.hasOwnProperty.call(NATIVE_APP_ASSOCIATION_ROUTES, pathname)
    ? NATIVE_APP_ASSOCIATION_ROUTES[pathname]
    : null
}

/**
 * The console's top-level sections the native apps have no screen for, so a
 * link to one stays in the browser. They are the sign-in and verification
 * flows (an emailed verify or reset link opened by an app that cannot finish
 * it would strand the person), the sign-out page, the site admin bar's
 * connect page and a plugin's public device pages.
 *
 * The rest of the console's top-level sections (`admin`, `billing`,
 * `manage`, `support`) and every workspace path are what the native
 * deep-link grammar resolves (`DeepLinks.swift`, `DeepLinks.kt`): a
 * registered screen, the Besigner in the app's own web view, or the nearest
 * native screen. `apps/console/specs/native-app-association.spec.ts` holds
 * this list to the console's route set and the native link specs.
 */
export const NATIVE_WEB_ONLY_TOP_LEVEL_SEGMENTS: readonly string[] = [
  'account-recovery',
  'auth',
  'edit-access',
  'kiosk',
  'reset-password',
  'signin',
  'signout',
  'signup',
  'sso',
  'verify-email',
]

/** One `applinks` component: a URL path pattern, optionally excluded. */
export interface AppLinksComponent {
  '/': string
  exclude?: true
  comment?: string
}

/**
 * The console paths the apps open, as `applinks` components. Apple reads
 * them in order and the first match wins, so every exclusion comes ahead of
 * the closing catch-all.
 */
export function consoleAppLinksComponents(): AppLinksComponent[] {
  const excluded: AppLinksComponent[] = [
    { '/': '/_*', exclude: true, comment: 'framework and internal paths' },
    { '/': '/api', exclude: true },
    { '/': '/api/*', exclude: true, comment: 'route handlers' },
    { '/': '/.well-known/*', exclude: true },
  ]
  for (const segment of NATIVE_WEB_ONLY_TOP_LEVEL_SEGMENTS) {
    excluded.push({ '/': `/${segment}`, exclude: true }, { '/': `/${segment}/*`, exclude: true })
  }
  return [
    ...excluded,
    { '/': '/*', comment: 'workspace, site, account, billing, support and staff pages' },
  ]
}

/** `TEAMID1234.com.example.app`: a 10-character team id, then a bundle id. */
const APPLE_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/

/** A Java package name: dot-separated identifiers, at least two. */
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

/** A SHA-256 certificate fingerprint as 32 colon-separated hex pairs. */
const SHA256_FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

/** The Apple app ids in `NATIVE_APPLE_APP_IDS`, in order; invalid ones dropped. */
export function parseAppleAppIds(raw: string | undefined): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => APPLE_APP_ID.test(value))
  return [...new Set(ids)]
}

/** One Android app and the signing certificates it may be verified by. */
export interface AndroidAppAssociation {
  packageName: string
  sha256Fingerprints: string[]
}

/**
 * The Android apps in `NATIVE_ANDROID_APPS`. An entry without a valid package
 * or without one valid fingerprint is dropped whole: a statement with no
 * certificate verifies nothing.
 */
export function parseAndroidApps(raw: string | undefined): AndroidAppAssociation[] {
  const apps: AndroidAppAssociation[] = []
  for (const entry of (raw ?? '').split(';')) {
    const at = entry.indexOf('=')
    if (at < 0) continue
    const packageName = entry.slice(0, at).trim()
    if (!ANDROID_PACKAGE.test(packageName)) continue
    if (apps.some((app) => app.packageName === packageName)) continue
    const fingerprints = entry
      .slice(at + 1)
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => SHA256_FINGERPRINT.test(value))
    if (fingerprints.length === 0) continue
    apps.push({ packageName, sha256Fingerprints: [...new Set(fingerprints)] })
  }
  return apps
}

/** The `apple-app-site-association` document Apple's CDN reads. */
export interface AppleAppSiteAssociation {
  applinks?: {
    apps: []
    details: Array<{ appIDs: string[]; components: AppLinksComponent[] }>
  }
  webcredentials: { apps: string[] }
}

/**
 * The association file for these app ids. `applinks` is only for a host
 * whose paths the native deep-link grammar resolves: the console. A host
 * that serves the passkey relying party alone gets `webcredentials` only.
 *
 * One `details` entry per app, in the configured order, because when two
 * installed apps claim the same path the system takes the first.
 */
export function appleAppSiteAssociation(
  appIds: string[],
  options: { applinks: boolean },
): AppleAppSiteAssociation {
  const document: AppleAppSiteAssociation = { webcredentials: { apps: [...appIds] } }
  if (options.applinks) {
    const components = consoleAppLinksComponents()
    document.applinks = {
      apps: [],
      details: appIds.map((appId) => ({ appIDs: [appId], components })),
    }
  }
  return document
}

/** One Digital Asset Links statement. */
export interface AssetLinkStatement {
  relation: string[]
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] }
}

/** Passkeys and app links, for every configured app. */
export const ASSET_LINK_RELATIONS = [
  'delegate_permission/common.handle_all_urls',
  'delegate_permission/common.get_login_creds',
] as const

/** The `assetlinks.json` statement list Google's verifier reads. */
export function assetLinks(apps: AndroidAppAssociation[]): AssetLinkStatement[] {
  return apps.map((app) => ({
    relation: [...ASSET_LINK_RELATIONS],
    target: {
      namespace: 'android_app',
      package_name: app.packageName,
      sha256_cert_fingerprints: [...app.sha256Fingerprints],
    },
  }))
}

/** The request's hostname: lowercase, no port. */
export function requestHostname(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '')
}

/** A URL's hostname, or null when it is not one. */
export function hostnameOfUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** What a route handler needs to answer one of the two documents. */
export interface NativeAppAssociationRequest {
  /** The request's `Host` header. */
  host: string | null
  /**
   * The hostnames this deployment vouches for. Every other host an app
   * serves (a customer's custom domain, a workspace subdomain, a white-label
   * console) answers 404, because the apps are this deployment's and not
   * theirs.
   */
  servedHosts: ReadonlyArray<string | null | undefined>
  /** Whether this host's paths are console links the apps resolve. */
  applinks: boolean
  /** The environment; `process.env` in the routes, a fixture in specs. */
  env: Readonly<Record<string, string | undefined>>
}

/** Short on purpose: Apple's CDN caches on top, and a fix must land within minutes. */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=300'

/**
 * Whether this host may answer. A Vercel preview deployment is reachable only
 * at the platform's own generated hostnames, so it answers on any host, which
 * is what lets a preview be checked before it is promoted.
 */
function servesHost(request: NativeAppAssociationRequest): boolean {
  if (request.env['VERCEL_ENV'] === 'preview') return true
  const hostname = requestHostname(request.host)
  if (!hostname) return false
  return request.servedHosts.some((served) => requestHostname(served) === hostname)
}

function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': CACHE_CONTROL },
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': CACHE_CONTROL },
  })
}

/** `GET /.well-known/apple-app-site-association`. */
export function appleAppSiteAssociationResponse(request: NativeAppAssociationRequest): Response {
  const appIds = parseAppleAppIds(request.env['NATIVE_APPLE_APP_IDS'])
  if (appIds.length === 0 || !servesHost(request)) return notFound()
  return json(appleAppSiteAssociation(appIds, { applinks: request.applinks }))
}

/** `GET /.well-known/assetlinks.json`. */
export function assetLinksResponse(request: NativeAppAssociationRequest): Response {
  const apps = parseAndroidApps(request.env['NATIVE_ANDROID_APPS'])
  if (apps.length === 0 || !servesHost(request)) return notFound()
  return json(assetLinks(apps))
}
