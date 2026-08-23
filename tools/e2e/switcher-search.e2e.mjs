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

// The besigner's document switcher finds what it lists (AGL-2486).
//
// Companion to `global-search.e2e.mjs`. Global search and both switchers ran
// the same Firestore name-prefix query, so they shared the same two defects —
// a document lacking `nameLower` was omitted outright, and a name could only
// be matched from its first character. `switcher-search-window.emulator.spec`
// proves that at the query level; this proves it on the control a person
// actually types into.
//
// The fixture is the point: `tools/scripts/seed-e2e.mjs` writes its screens
// WITHOUT `nameLower`, exactly as every pre-AGL-835 screen in production was
// written. So "Home" is a real document the switcher could not see.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators + `npm run seed:e2e`, and a
// console dev server carrying the emulator flags. Point it with E2E_BASE_URL.
//
//   node tools/e2e/switcher-search.e2e.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
const ORG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
const HOST = process.env.E2E_HOST ?? 'demo'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 90_000)

const BESIGNER = `/${ORG}/hosts/${HOST}/screens/seed-scoped/versions/seed-scoped-v1/besigner`

let failures = 0
let inconclusive = 0
const pass = (name, detail = '') =>
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
const fail = (name, detail) => {
  failures += 1
  console.error(`FAIL  ${name} — ${detail}`)
}
/** Never report an unestablished precondition as a pass. */
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
page.on('dialog', (dialog) => dialog.accept().catch(() => undefined))

await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
await page.fill('input[type="email"], input[name="email"]', EMAIL, { timeout: TIMEOUT_MS })
await page.fill('input[type="password"], input[name="password"]', PASSWORD)
await page.click('button[type="submit"], button:has-text("Next")')
await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: TIMEOUT_MS })

await page.goto(`${BASE_URL}${BESIGNER}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
await page.waitForTimeout(15_000)

// The notifications prompt shares the modal layer and would eat the clicks.
for (let attempt = 0; attempt < 4; attempt += 1) {
  const prompt = await page.$('.MuiDialog-root:has-text("Enable notifications")')
  if (!prompt) break
  const dismiss = await prompt.$(
    'button:has-text("Not now"), button:has-text("Later"), button:has-text("No thanks"), button:has-text("Maybe"), button:has-text("Dismiss")',
  )
  if (!dismiss) break
  await dismiss.click()
  await page.waitForTimeout(1200)
}

const openSwitcher = async () => {
  const trigger = await page.waitForSelector(
    'button[aria-label="Switch edited document"]',
    { timeout: TIMEOUT_MS },
  )
  await trigger.click()
  await page.waitForSelector('input[placeholder="Find screen or layout…"]', {
    timeout: TIMEOUT_MS,
  })
}

const rowsFor = async (text) => {
  await page.fill('input[placeholder="Find screen or layout…"]', text)
  await page.waitForTimeout(2500)
  return page.$$eval('[role="menu"] [role="menuitem"], [role="menu"] li', (nodes) =>
    nodes.map((node) => (node.textContent ?? '').trim()).filter(Boolean),
  )
}

try {
  await openSwitcher()
} catch {
  skip('the document switcher opens', 'the trigger never appeared')
}

// ── The named document the switcher could not see ─────────────────────────
{
  // `seed-home` is written by the seeder with no `nameLower`, which is what
  // every screen created before AGL-835 looks like.
  const rows = await rowsFor('home')
  if (rows.some((row) => row.includes('Home'))) {
    pass('a screen with no nameLower is findable', `"home" → ${rows.find((r) => r.includes('Home'))}`)
  } else {
    fail(
      'a screen with no nameLower is findable',
      `"home" returned ${JSON.stringify(rows)}`,
    )
  }
}

// ── A word that is not the start of the name ──────────────────────────────
{
  const rows = await rowsFor('survey')
  if (rows.some((row) => row.includes('Survey'))) {
    pass('a name is matched by a word inside it', `"survey" → ${rows.find((r) => r.includes('Survey'))}`)
  } else {
    fail('a name is matched by a word inside it', `"survey" returned ${JSON.stringify(rows)}`)
  }
}

// ── And the switcher still navigates ──────────────────────────────────────
{
  const rows = await rowsFor('home')
  if (rows.length === 0) {
    skip('the switcher navigates', 'no row to click')
  } else {
    const before = page.url()
    const item = await page.$('[role="menu"] [role="menuitem"]:has-text("Home"), [role="menu"] li:has-text("Home")')
    if (!item) {
      skip('the switcher navigates', 'the Home row could not be addressed')
    } else {
      await item.click({ timeout: 20_000 }).catch((error) =>
        fail('the switcher navigates', `click refused: ${String(error.message).split('\n')[0]}`),
      )
      await page.waitForTimeout(8000)
      if (page.url() !== before) pass('the switcher navigates', new URL(page.url()).pathname)
      else fail('the switcher navigates', `still on ${before}`)
    }
  }
}

await browser.close()
console.log(
  `\n${failures === 0 ? 'OK' : 'FAILURES'}: ${failures} failed, ${inconclusive} inconclusive`,
)
process.exit(failures === 0 ? 0 : 1)
