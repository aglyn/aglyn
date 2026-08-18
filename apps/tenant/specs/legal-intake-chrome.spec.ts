/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where `Request`/`Response` do
 * not exist and every test here fails on construction.
 */

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
 * THE TWO PUBLIC LEGAL INTAKES MUST NOT DRIFT APART (AGL-2026).
 *
 * `/api/report-abuse` (AGL-1964) and `/api/counter-notice` (AGL-1983) are the
 * two sides of one §512 conversation: a subscriber whose site was taken down
 * reads the abuse report that caused it and then files the counter-notice that
 * answers it. They shipped a week apart, each with its own inline copy of the
 * same chrome, and the copies had ALREADY diverged before anyone merged them —
 * the abuse form's stylesheet was missing `input[type=tel]`, so the phone
 * number §512(g)(3)(D) requires would have rendered unstyled next to every
 * other field on the counter-notice form.
 *
 * That divergence is why deduplicating into `_legal-intake/chrome.ts` is not
 * enough on its own. Nothing about a shared module stops a later edit from
 * pasting a local `PAGE_STYLE` back into one route, and the failure is silent:
 * both pages still render, both still pass their own suites, and the drift is
 * only visible to someone who opens the two forms side by side.
 *
 * So this suite asserts the shared stylesheet REACHES BOTH RENDERED FORMS,
 * byte for byte, and that neither route declares chrome of its own. It is
 * deliberately about the rendered bytes rather than the import graph: an
 * import that is present but unused would satisfy a grep and still ship two
 * different-looking forms.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

/**
 * Neither GET touches Firestore or the rate limiter — these exist only so the
 * route modules can be imported. Anything reached anyway throws rather than
 * returning a plausible value, so a future GET that quietly grows a read
 * fails here instead of being covered by an obliging fake.
 */
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  notifyStaff: async () => {
    throw new Error('a GET must not notify staff')
  },
  firebaseAdmin: {
    app: () => {
      throw new Error('a GET must not reach Firestore')
    },
  },
  consumeRateLimit: async () => {
    throw new Error('a GET must not consume the rate limit')
  },
}))

jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: async () => ({ host: null, nextPageToken: '', error: null }),
  default: async () => ({ host: null, nextPageToken: '', error: null }),
}))

import { PAGE_STYLE } from '../app/api/_legal-intake/chrome'
import { GET as abuseGet } from '../app/api/report-abuse/route'
import { GET as counterNoticeGet } from '../app/api/counter-notice/route'

/** The contents of the single `<style>` block in a rendered document. */
const stylesheetOf = (document: string): string => {
  const blocks = [...document.matchAll(/<style>([\s\S]*?)<\/style>/g)]
  // Exactly one: a second block is its own kind of drift, and would let a
  // local override sit after the shared sheet and win on cascade order while
  // the shared bytes were still technically "present".
  expect(blocks).toHaveLength(1)
  return blocks[0][1]
}

const render = async (get: (request: Request) => Promise<Response>, url: string) => {
  const response = await get(new Request(url))
  expect(response.status).toBe(200)
  return response.text()
}

const abuseForm = () =>
  render(abuseGet, 'https://acme.aglyn.app/api/report-abuse')
const counterNoticeForm = () =>
  render(counterNoticeGet, 'https://acme.aglyn.app/api/counter-notice')

const routeSource = (route: string): string =>
  readFileSync(join(__dirname, '..', 'app', 'api', route, 'route.ts'), 'utf8')

describe('the shared chrome reaches both rendered forms', () => {
  it('serves the abuse form with the shared stylesheet, byte for byte', async () => {
    expect(stylesheetOf(await abuseForm())).toBe(PAGE_STYLE)
  })

  it('serves the counter-notice form with the shared stylesheet, byte for byte', async () => {
    expect(stylesheetOf(await counterNoticeForm())).toBe(PAGE_STYLE)
  })

  it('serves the two forms the SAME stylesheet', async () => {
    // The assertion the pair exists for, stated directly rather than left as
    // a consequence of the two above: whatever the shared sheet becomes, the
    // subscriber sees one visual language across both halves of the exchange.
    expect(stylesheetOf(await abuseForm())).toBe(
      stylesheetOf(await counterNoticeForm()),
    )
  })

  it('styles the phone field the counter-notice form is required to collect', async () => {
    // The concrete divergence that existed before the merge. §512(g)(3)(D)
    // makes name, address AND telephone number mandatory on a counter-notice,
    // so `input[type=tel]` is not decoration — and it was in exactly one of
    // the two copies.
    expect(PAGE_STYLE).toContain('input[type=tel]')
    expect(await counterNoticeForm()).toContain('type="tel"')
    // Both selector lists, light and dark. A tel input styled in one scheme
    // and not the other is the same bug seen by half the users.
    expect(PAGE_STYLE.match(/input\[type=tel\]/g)).toHaveLength(2)
  })
})

describe('neither intake may grow chrome of its own', () => {
  // Source-level, and deliberately stricter than the rendered comparison: a
  // reintroduced local copy that happens to be identical TODAY passes every
  // byte assertion above and is a drift that has not happened yet. The point
  // is that there is one definition, not that there are two matching ones.
  it.each([['report-abuse'], ['counter-notice']])(
    '%s declares no local PAGE_STYLE',
    (route) => {
      expect(routeSource(route)).not.toMatch(/(const|let|var)\s+PAGE_STYLE\b/)
    },
  )

  it.each([['report-abuse'], ['counter-notice']])(
    '%s imports its chrome from the shared module',
    (route) => {
      expect(routeSource(route)).toContain("from '../_legal-intake/chrome'")
    },
  )

  it.each([['report-abuse'], ['counter-notice']])(
    '%s builds no document shell of its own',
    (route) => {
      // `documentHtml` owns the doctype, the viewport meta and the `noindex`
      // that keeps sworn statements and takedown receipts out of search
      // results. A route that hand-rolls the shell can omit any of them.
      expect(routeSource(route)).not.toContain('<!doctype html>')
    },
  )
})
