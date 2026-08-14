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
 * `apps/www` ships NO third-party trackers (AGL-1672).
 *
 * This app used to mount HubSpot (`js.hs-scripts.com`, portal 20566719) and
 * Visitor Queue (`t.visitorqueue.com`) — a B2B reverse-IP service that resolves
 * a visitor's IP to an identified COMPANY — from `pages/_app.tsx`, behind a
 * guard that read `IS_PRODUCTION`.
 *
 * That guard was the whole problem. `IS_PRODUCTION` is
 * `process.env['NODE_ENV'] === 'production'` — not a domain check, not a
 * deployment check. Any production-mode serve of this app armed both trackers.
 * The only thing keeping them off real traffic was that no domain pointed at
 * the retired `www-aglyn-io` Vercel project, which is a DNS fact, not a code
 * one, and is reversible by anyone with the Vercel dashboard and no diff.
 *
 * Reverse-IP de-anonymization is also precisely the processing the published
 * Privacy Policy disclaims (no ad networks, no pixels, nothing building
 * cross-context profiles). Neither vendor appears in any privacy, cookie or
 * subprocessor disclosure — correct today only because the code is dead.
 *
 * So this is a SOURCE scan rather than a render assertion. A render test would
 * only prove the trackers are absent from the tree it happens to render; the
 * failure mode here is someone re-adding a snippet to any file in the app, and
 * a dead app is exactly where that goes unnoticed. Red condition: paste any of
 * the banned hosts into any file under `apps/www`.
 */
import { LINK_PREF, LINK_PRIORITY } from '@aglyn/shared-data-enums'
import { readdirSync, readFileSync, statSync } from 'fs'
import { extname, join, relative } from 'path'

const APP_ROOT = join(__dirname, '..')

/** This file necessarily contains the banned strings it scans for. */
const SELF = 'no-third-party-trackers.spec.ts'

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage'])
const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.txt',
])

/**
 * Host fragments, not vendor names — a comment mentioning HubSpot is fine, a
 * loader that fetches from it is not.
 */
const BANNED_HOSTS = [
  'hs-scripts.com',
  'hs-analytics.net',
  'hsforms.net',
  'hubspot.com/',
  'visitorqueue.com',
  'doubleclick.net',
  'adservice.google.com',
  'google-analytics.com',
  'googletagmanager.com',
  'connect.facebook.net',
  'snap.licdn.com',
  'static.hotjar.com',
  'cdn.segment.com',
  'cdn.mxpnl.com',
]

function collectSourceFiles(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)

    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      found.push(...collectSourceFiles(full))
      continue
    }

    if (entry === SELF) continue
    if (!SCAN_EXTENSIONS.has(extname(entry))) continue

    found.push(full)
  }

  return found
}

describe('apps/www third-party trackers', () => {
  it('loads no tracker or ad-tech host from any source file', () => {
    const offenders: string[] = []

    for (const file of collectSourceFiles(APP_ROOT)) {
      const contents = readFileSync(file, 'utf8')

      for (const host of BANNED_HOSTS) {
        if (contents.includes(host)) {
          offenders.push(`${relative(APP_ROOT, file)} references ${host}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('scans a non-trivial number of files', () => {
    // Guards the guard: a broken walk would pass the case above vacuously.
    expect(collectSourceFiles(APP_ROOT).length).toBeGreaterThan(20)
  })
})

describe('shared html-head link config', () => {
  // `_emotion-document.component` renders these, and `apps/www/pages/_document`
  // is its only consumer — but it lives in a shared lib, so the blast radius is
  // any future Pages-Router surface, not just this app.
  const hrefs = [...LINK_PRIORITY, ...LINK_PREF]
    .map(([, href]) => href)
    .filter((href): href is string => Boolean(href))

  it('preconnects to no ad-tech or analytics origin', () => {
    const adTech = hrefs.filter((href) =>
      [
        'doubleclick.net',
        'adservice.google.com',
        'google-analytics.com',
        'googletagmanager.com',
      ].some((host) => href.includes(host)),
    )

    expect(adTech).toEqual([])
  })

  it('still preconnects to the font origins it actually fetches from', () => {
    // Not decoration: it pins WHY the two surviving Google origins are allowed,
    // so a later sweep of "google" hosts does not take the fonts with it.
    expect(hrefs).toEqual(
      expect.arrayContaining([
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
      ]),
    )
  })
})
