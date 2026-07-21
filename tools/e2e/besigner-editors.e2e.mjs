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
// Smoke for the standalone editors (AGL-680/681) and the concurrent-edit
// guard (AGL-674). These are the paths that were shipped typechecked but
// never opened, so this is the harness that actually loads them.
//
// Setup (see docs/E2E_LOCAL.md):
//   cd cloud && npx -y firebase-tools@13 emulators:start \
//     --config firebase.e2e.json --project aglyn-main --only auth,firestore
//   npm run seed:e2e
//   npm run serve:console:emulated
//
// Then:  npm run e2e:besigner

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
const HOST_ID = process.env.E2E_HOST ?? 'demo'
const ORG_SLUG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 60_000)

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8082'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099'

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

if (!getApps().length) initializeApp({ projectId: 'aglyn-main' })
const db = getFirestore()
const hostRef = db.collection('hosts').doc(HOST_ID)

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// ── Fixtures ─────────────────────────────────────────────────────────────
// A component WITHOUT a versionId, so the open flow has to bootstrap v1 —
// that is the path every pre-existing component will take.
await hostRef.collection('components').doc('e2e-editable').set({
  displayName: 'E2E Editable',
  rootId: 'root',
  nodes: { root: { $id: 'root', componentId: 'box', parentId: null } },
  createdAt: new Date(),
  updatedAt: new Date(),
})
await hostRef
  .collection('components')
  .doc('e2e-editable')
  .collection('versions')
  .get()
  .then((snap) => Promise.all(snap.docs.map((d) => d.ref.delete())))
await hostRef.collection('templates').doc('e2e-editable-template').set({
  kind: 'page',
  displayName: 'E2E Editable Template',
  nodes: { root: { $id: 'root', componentId: 'box', parentId: null } },
  source: { type: 'authored' },
  createdAt: new Date(),
  updatedAt: new Date(),
})

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') {
    // Record where it happened — 'Error rendering undefined' says nothing
    // about which editor produced it.
    consoleErrors.push(`[${new URL(page.url()).pathname}] ${message.text()}`)
  }
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

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

  // ── Component editor (AGL-680) ────────────────────────────────────────
  await page.goto(`${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/components`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  // By name, not .first(): components sort by displayName, so an unrelated
  // fixture from another harness would otherwise be the one opened — and
  // the assertions below would silently check the wrong document.
  const openButton = page.locator(
    'button[aria-label="Open E2E Editable in besigner"]',
  )
  await openButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  check('components list offers the editor', true)

  await openButton.click()
  await page.waitForURL(/\/components\/.+\/versions\/.+\/besigner/, {
    timeout: TIMEOUT_MS,
  })
  check('opening navigates into the component besigner', true)

  // The bootstrap: a component with no versionId gets v1 from what is
  // published, rather than needing a migration.
  const afterOpen = await hostRef.collection('components').doc('e2e-editable').get()
  const bootstrapped = afterOpen.get('versionId')
  check('version 1 bootstrapped on first open', !!bootstrapped, `${bootstrapped}`)
  if (bootstrapped) {
    const version = await afterOpen.ref
      .collection('versions')
      .doc(String(bootstrapped))
      .get()
    check(
      'bootstrapped version carries the published tree',
      Object.keys(version.get('nodes') ?? {}).length > 0,
    )
  }

  // The canvas must actually mount — a route that renders an error page
  // would still have passed every check above.
  const canvasUp = await page
    .locator('[data-besigner-canvas], canvas, [class*="Workspace"]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check('component canvas mounts', canvasUp)

  // ── Template editor (AGL-681) ─────────────────────────────────────────
  await page.goto(
    `${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/templates/e2e-editable-template/besigner`,
    { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS },
  )
  const templateCanvas = await page
    .locator('[data-besigner-canvas], canvas, [class*="Workspace"]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check('template editor mounts', templateCanvas)

  // ── Concurrent-edit guard (AGL-674) ───────────────────────────────────
  // Open a seeded screen, then write to its version doc from outside —
  // exactly what a second editor's save looks like.
  const homeScreen = await hostRef.collection('screens').doc('seed-home').get()
  const homeVersionId = homeScreen.get('versionId')
  await page.goto(
    `${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/screens/seed-home/versions/${homeVersionId}/besigner`,
    { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS },
  )
  await page
    .locator('[data-besigner-canvas], canvas, [class*="Workspace"]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
    .catch(() => undefined)
  // Let the editor take its base stamp before the remote write lands.
  await page.waitForTimeout(3000)

  await hostRef
    .collection('screens')
    .doc('seed-home')
    .collection('versions')
    .doc(String(homeVersionId))
    .update({ updatedAt: new Date() })

  const warned = await page
    .getByText('Someone else saved this screen', { exact: false })
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  check('concurrent edit surfaces a warning', warned)

  const relevantErrors = consoleErrors.filter(
    (text) =>
      !/network-request-failed|popup-blocked|App Check|Could not reach Cloud Firestore backend|ResizeObserver/i.test(
        text,
      ),
  )
  check(
    'no unexpected console errors',
    relevantErrors.length === 0,
    relevantErrors.slice(0, 2).join(' | '),
  )
} catch (error) {
  failures += 1
  console.error('FAIL  harness error —', error?.message ?? error)
} finally {
  await browser.close()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
