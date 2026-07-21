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
// Drives "Save as template" (AGL-668) through the real UI against the
// emulators, then asserts what actually landed in Firestore.
//
// Setup is the same as console.e2e.mjs (see docs/E2E_LOCAL.md):
//
//   cd cloud && npx -y firebase-tools@13 emulators:start \
//     --config firebase.e2e.json --project aglyn-main --only auth,firestore
//   npm run seed:e2e
//   npm run serve:console:emulated
//
// Then:  node tools/e2e/save-as-template.e2e.mjs
//
// Auth goes through the app's own sign-in form, deliberately: injecting a
// synthetic localStorage session races connectAuthEmulator and leaves the
// SDK pointed at production (see the note in console.e2e.mjs).

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
const HOST_ID = process.env.E2E_HOST ?? 'demo'
// Must match E2E_ORG_SLUG in tools/scripts/seed-e2e.mjs — the console
// routes by /[orgSlug]/… (AGL-621), and the org id is not the slug.
const ORG_SLUG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 45_000)
const TEMPLATE_NAME = `E2E template ${Date.now()}`

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8082'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099'

function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) {
    return { executablePath: process.env.E2E_CHROME_PATH }
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const executablePath of candidates) {
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

if (!getApps().length) initializeApp({ projectId: 'aglyn-main' })
const db = getFirestore()

const listPath = `/${ORG_SLUG}/hosts/${HOST_ID}/screens/list`
// Warm the dev server so compilation doesn't eat the navigation budget.
await fetch(`${BASE_URL}${listPath}`).catch(() => undefined)

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

try {
  await page.goto(`${BASE_URL}/signin`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  await page.fill('input[type="email"], input[name="email"]', EMAIL, {
    timeout: TIMEOUT_MS,
  })
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"], button:has-text("Next")')
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), {
    timeout: TIMEOUT_MS,
  })

  await page.goto(`${BASE_URL}${listPath}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  const trigger = page.locator('button[aria-label="Save as template"]').first()
  await trigger.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  check('row action renders', true)

  await trigger.click()
  const dialog = page.locator('div[role="dialog"]:has-text("Save as template")')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  check('dialog opens', true)

  // Seeded from the screen's own name — proves the row context arrived.
  const seeded = await dialog.locator('input').first().inputValue()
  check('name is pre-filled from the screen', !!seeded, `got "${seeded}"`)

  await dialog.locator('input').first().fill(TEMPLATE_NAME)
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  check('dialog closes after save', true)

  // What actually landed is the only claim that matters.
  const snapshot = await db
    .collection('hosts')
    .doc(HOST_ID)
    .collection('templates')
    .where('displayName', '==', TEMPLATE_NAME)
    .get()
  check('template document written', snapshot.size === 1, `found ${snapshot.size}`)
  if (snapshot.size === 1) {
    const data = snapshot.docs[0].data()
    check('kind is page', data.kind === 'page', `got ${data.kind}`)
    check(
      'source stamped server-side',
      data.source?.type === 'authored',
      JSON.stringify(data.source),
    )
    const nodeCount = Object.keys(data.nodes ?? {}).length
    check('nodes captured', nodeCount > 0, `${nodeCount} nodes`)
    check('createdAt stamped', !!data.createdAt)
  }

  const relevantErrors = consoleErrors.filter(
    (text) => !/network-request-failed|popup-blocked|App Check/i.test(text),
  )
  check(
    'no unexpected console errors',
    relevantErrors.length === 0,
    relevantErrors.slice(0, 3).join(' | '),
  )
} catch (error) {
  failures += 1
  console.error('FAIL  harness error —', error?.message ?? error)
} finally {
  await browser.close()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
