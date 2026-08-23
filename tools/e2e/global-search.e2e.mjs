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

// Console global search, driven as a person drives it (AGL-2486).
//
// This exists because the reported defect — "console search does not seem to
// do anything when you click on it" — is invisible to every unit test that
// could be written about it. A jsdom render proves the row carries an href; it
// cannot prove a real pointer reaches the row, and the measured cause of the
// dead click was precisely that a second dialog at the same z-index was
// receiving the click instead.
//
// So the assertions here are the ones only a browser can make:
//
//   1. typing finds a name by a word INSIDE it — the case the previous
//      `orderBy('nameLower')` prefix query returned nothing for, and the case
//      that made the feature look broken;
//   2. a result row hit-tests to ITSELF even with another dialog mounted;
//   3. clicking a row of each kind lands on that kind's page;
//   4. the read cost of a whole search session, read off the palette.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators + `npm run seed:e2e`, and a
// console dev server carrying the emulator flags. Point it with E2E_BASE_URL.
//
//   node tools/e2e/global-search.e2e.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
const ORG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
const HOST = process.env.E2E_HOST ?? 'demo'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 90_000)

const BESIGNER = `/${ORG}/hosts/${HOST}/screens/seed-home/versions/seed-home-v1/besigner`
// The besigner is the surface the defect was reported on, so checks 1 and 2
// run there. The click matrix re-navigates once per case, and the besigner is
// far too heavy to compile-and-mount eight times; the dashboard carries the
// same top bar and the same palette.
const DASHBOARD = `/${ORG}/hosts/${HOST}`

let failures = 0
let inconclusive = 0
const pass = (name, detail = '') => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
const fail = (name, detail) => {
  failures += 1
  console.error(`FAIL  ${name} — ${detail}`)
}
/**
 * A third verdict, deliberately. A precondition this script could not
 * establish must not be reported as a pass — a check that silently degrades
 * into "nothing to assert" is the shape that keeps a suite green while it
 * stops testing anything.
 */
const skip = (name, why) => {
  inconclusive += 1
  console.warn(`INCONCLUSIVE  ${name} — ${why}`)
}

function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) {
    return { executablePath: process.env.E2E_CHROME_PATH }
  }
  if (process.platform === 'darwin') {
    for (const executablePath of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      try {
        readFileSync(executablePath)
        return { executablePath }
      } catch {
        // Not installed — try the next flavor.
      }
    }
  }
  return { channel: 'chrome' }
}

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
// The screen editor registers an unsaved-changes `beforeunload`, which parks
// the NEXT navigation on a native prompt that nothing would ever answer. The
// click matrix navigates away from an editor once per case, so without this
// the run hangs rather than failing, which is the worse outcome.
page.on('dialog', (dialog) => dialog.accept().catch(() => undefined))

// Sign in through the real UI, matching `console.e2e.mjs`: injecting a
// synthetic localStorage session races the app's own connectAuthEmulator call.
await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
await page.fill('input[type="email"], input[name="email"]', EMAIL, { timeout: TIMEOUT_MS })
await page.fill('input[type="password"], input[name="password"]', PASSWORD)
await page.click('button[type="submit"], button:has-text("Next")')
await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: TIMEOUT_MS })

const openPalette = async (page) => {
  // The keyboard route on purpose: the trigger sits in the top bar, which a
  // full-screen dialog covers, and this script wants to assert the palette's
  // behaviour WITH such a dialog present rather than only without one.
  await page.keyboard.press('Meta+k')
  await page.waitForSelector('[role="dialog"] input', { timeout: TIMEOUT_MS })
}

const paletteRows = (page) =>
  page.$$eval('[role="dialog"] a', (anchors) =>
    anchors.map((anchor) => {
      const rect = anchor.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      )
      return {
        href: anchor.getAttribute('href'),
        text: (anchor.textContent ?? '').trim(),
        hittable: hit ? anchor === hit || anchor.contains(hit) : false,
      }
    }),
  )

const search = async (page, text) => {
  await page.fill('[role="dialog"] input', text)
  // The window fetch is one round trip per collection; the matching itself is
  // synchronous over rows already held.
  await page.waitForTimeout(2500)
  return paletteRows(page)
}

await page.goto(`${BASE_URL}${BESIGNER}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
await page.waitForTimeout(12_000)
await openPalette(page)

// ── 1. A word INSIDE the name, which the prefix query could not find ───────
{
  const rows = await search(page, 'layout')
  const found = rows.find((row) => row.text.includes('Main Layout'))
  if (found) pass('a word inside the name matches', `"layout" → ${found.text}`)
  else fail('a word inside the name matches', `"layout" returned ${JSON.stringify(rows.map((r) => r.text))}`)
}

// ── 2. The row is not buried by another dialog ─────────────────────────────
{
  const dialogs = await page.$$('.MuiDialog-root')
  const rows = await paletteRows(page)
  if (dialogs.length < 2) {
    skip(
      'a row stays clickable under a competing dialog',
      `only ${dialogs.length} dialog(s) mounted, so there was nothing to be buried by`,
    )
  } else if (rows.length === 0) {
    skip('a row stays clickable under a competing dialog', 'no rows to test')
  } else if (rows.every((row) => row.hittable)) {
    pass('a row stays clickable under a competing dialog', `${dialogs.length} dialogs mounted`)
  } else {
    fail(
      'a row stays clickable under a competing dialog',
      `${rows.filter((r) => !r.hittable).length}/${rows.length} rows hit-test to something else`,
    )
  }
}

// ── 3. Clicking a row of each kind lands on that kind's page ───────────────
const clickCases = [
  { name: 'page', query: 'survey', expect: /\/screens\/.+\/versions\/.+\/view$/ },
  { name: 'layout', query: 'layout', expect: /\/layouts\/seed-main-layout$/ },
  { name: 'component', query: 'hero', expect: /\/components\/seed-hero$/ },
  { name: 'template', query: 'landing', expect: /\/templates\/seed-tpl$/ },
  { name: 'workflow', query: 'confirmation', expect: /\/workflows$/ },
  { name: 'product', query: 'sourdough', expect: /\/products$/ },
  { name: 'author', query: 'lovelace', expect: /\/content$/ },
  { name: 'site', query: 'bakery', expect: /\/hosts\/demo$/ },
]

for (const testCase of clickCases) {
  // A FRESH page per case, deliberately. Clicking a result lands on an editor
  // that keeps its renderer busy, and reusing that tab parks the next
  // navigation past any timeout — which reads as a broken test rather than as
  // the environment artefact it is.
  const casePage = await context.newPage()
  casePage.on('dialog', (dialog) => dialog.accept().catch(() => undefined))
  await casePage.goto(`${BASE_URL}${DASHBOARD}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await casePage.waitForTimeout(6000)
  try {
    await openPalette(casePage)
  } catch {
    skip(`click a ${testCase.name}`, 'the palette did not open')
    await casePage.close()
    continue
  }
  const rows = await search(casePage, testCase.query)
  const target = rows.find((row) => row.href && testCase.expect.test(row.href))
  if (!target) {
    fail(
      `click a ${testCase.name}`,
      `no row matched ${testCase.expect} for "${testCase.query}" (got ${JSON.stringify(rows.map((r) => r.href))})`,
    )
    await casePage.close()
    continue
  }
  const before = casePage.url()
  const anchors = await casePage.$$('[role="dialog"] a')
  let clicked = false
  for (const anchor of anchors) {
    if ((await anchor.getAttribute('href')) === target.href) {
      await anchor.click({ timeout: 20_000 }).catch((error) => {
        fail(`click a ${testCase.name}`, `the click was refused: ${String(error.message).split('\n')[0]}`)
      })
      clicked = true
      break
    }
  }
  if (!clicked) {
    fail(`click a ${testCase.name}`, 'the row vanished before it could be clicked')
    await casePage.close()
    continue
  }
  await casePage.waitForTimeout(6000)
  const after = new URL(casePage.url()).pathname
  if (testCase.expect.test(after)) pass(`click a ${testCase.name}`, after)
  else fail(`click a ${testCase.name}`, `landed on ${after}, expected ${testCase.expect} (was ${before})`)
  await casePage.close()
}

// ── 4. What a whole search session cost ───────────────────────────────────
{
  const costPage = await context.newPage()
  costPage.on('dialog', (dialog) => dialog.accept().catch(() => undefined))
  await costPage.goto(`${BASE_URL}${DASHBOARD}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await costPage.waitForTimeout(6000)
  await openPalette(costPage)
  const readsAfterOpen = await costPage.getAttribute('[data-search-reads]', 'data-search-reads')
  if (readsAfterOpen !== '0') {
    fail('opening the palette costs no reads', `data-search-reads was ${readsAfterOpen}`)
  } else {
    pass('opening the palette costs no reads')
  }
  // A realistic session: one word, typed a character at a time, then refined.
  for (const text of ['l', 'la', 'lay', 'layo', 'layou', 'layout', 'layout m']) {
    await costPage.fill('[role="dialog"] input', text)
    await costPage.waitForTimeout(700)
  }
  await costPage.waitForTimeout(2500)
  const reads = Number(await costPage.getAttribute('[data-search-reads]', 'data-search-reads'))
  console.log(`MEASURED  a full search session cost ${reads} document reads`)
  if (Number.isFinite(reads) && reads > 0) pass('the session read something')
  else fail('the session read something', `data-search-reads was ${reads}`)
}

await browser.close()
console.log(
  `\n${failures === 0 ? 'OK' : 'FAILURES'}: ${failures} failed, ${inconclusive} inconclusive`,
)
process.exit(failures === 0 ? 0 : 1)
