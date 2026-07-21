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

// The shared seed has no layouts and no reusable components, so this
// harness makes its own — otherwise two of the three kinds would skip and a
// green run would overstate what it covered. Admin SDK, so rules don't
// apply: this is fixture setup, not part of what's under test.
const hostRef = db.collection('hosts').doc(HOST_ID)
const FIXTURE_NODES = {
  'layout-root': { componentId: 'box', childIds: ['layout-slot'] },
  'layout-slot': { componentId: 'layoutSlot' },
}
const layoutRef = hostRef.collection('layouts').doc('e2e-layout')
await layoutRef.set({
  displayName: 'E2E Layout',
  versionId: 'e2e-layout-v1',
  createdAt: new Date(),
  updatedAt: new Date(),
})
await layoutRef.collection('versions').doc('e2e-layout-v1').set({
  layoutId: 'e2e-layout',
  hostId: HOST_ID,
  nodes: FIXTURE_NODES,
  createdAt: new Date(),
})
await hostRef.collection('components').doc('e2e-component').set({
  displayName: 'E2E Component',
  rootId: 'cmp-root',
  nodes: { 'cmp-root': { componentId: 'box' } },
  createdAt: new Date(),
  updatedAt: new Date(),
})

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

  // ── Layouts ────────────────────────────────────────────────────────────
  const layoutName = `${TEMPLATE_NAME} layout`
  await page.goto(`${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/layouts/list`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  const layoutTrigger = page
    .locator('button[aria-label="Save as template"]')
    .first()
  const hasLayoutRow = await layoutTrigger
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (hasLayoutRow) {
    await layoutTrigger.click()
    const layoutDialog = page.locator(
      'div[role="dialog"]:has-text("Save as template")',
    )
    await layoutDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await layoutDialog.locator('input').first().fill(layoutName)
    await layoutDialog.getByRole('button', { name: 'Save template' }).click()
    await layoutDialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
    const layoutSnapshot = await db
      .collection('hosts')
      .doc(HOST_ID)
      .collection('templates')
      .where('displayName', '==', layoutName)
      .get()
    check('layout template written', layoutSnapshot.size === 1)
    if (layoutSnapshot.size === 1) {
      const data = layoutSnapshot.docs[0].data()
      check('layout kind', data.kind === 'layout', `got ${data.kind}`)
      check('layout nodes captured', Object.keys(data.nodes ?? {}).length > 0)
    }
  } else {
    // Reported, not silently skipped — a green run that covered two of
    // three kinds should not read as full coverage.
    console.log('SKIP  layout template — no layout rows in the seed')
  }

  // ── Reusable components ────────────────────────────────────────────────
  const componentName = `${TEMPLATE_NAME} component`
  await page.goto(`${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/components`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  const componentTrigger = page
    .getByRole('button', { name: 'Save as template' })
    .first()
  const hasComponentRow = await componentTrigger
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (hasComponentRow) {
    await componentTrigger.click()
    const componentDialog = page.locator(
      'div[role="dialog"]:has-text("Save as template")',
    )
    await componentDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await componentDialog.locator('input').first().fill(componentName)
    await componentDialog.getByRole('button', { name: 'Save template' }).click()
    await componentDialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
    const componentSnapshot = await db
      .collection('hosts')
      .doc(HOST_ID)
      .collection('templates')
      .where('displayName', '==', componentName)
      .get()
    check('component template written', componentSnapshot.size === 1)
    if (componentSnapshot.size === 1) {
      const data = componentSnapshot.docs[0].data()
      check('component kind', data.kind === 'component', `got ${data.kind}`)
      // rootId is what makes a component tree graftable; without it the
      // template is a bag of nodes with no entry point.
      check('component rootId captured', !!data.rootId, `got ${data.rootId}`)
    }
  } else {
    console.log('SKIP  component template — no component rows in the seed')
  }

  // ── Templates page (AGL-667) ───────────────────────────────────────────
  // Seed a marketplace-sourced template directly so the provenance badge has
  // something to render — the UI cannot create one, by design.
  await hostRef.collection('templates').doc('e2e-installed').set({
    kind: 'page',
    displayName: `${TEMPLATE_NAME} installed`,
    nodes: { root: { componentId: 'box' } },
    source: { type: 'marketplace', listingId: 'listing-1', version: 3 },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await page.goto(`${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/templates`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  const templatesBody = page.locator('body')
  await page
    .getByText('Templates', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const bodyText = await templatesBody.innerText()
  check('page lists the saved page template', bodyText.includes(TEMPLATE_NAME))
  check('page groups by kind', /Pages/.test(bodyText) && /Layouts/.test(bodyText))
  check('marketplace provenance badge shown', bodyText.includes('Marketplace'))
  check('authored provenance badge shown', bodyText.includes('Saved here'))
  const navTab = page.getByRole('tab', { name: 'Templates' })
  check(
    'nav tab present',
    (await navTab.count()) > 0 ||
      (await page.getByRole('link', { name: 'Templates' }).count()) > 0,
  )

  // ── Use a template (AGL-670) ───────────────────────────────────────────
  // Placeholders on purpose: nothing authors them yet, so this is the only
  // coverage that token substitution actually runs on instantiation.
  await hostRef.collection('templates').doc('e2e-usable').set({
    kind: 'page',
    displayName: `${TEMPLATE_NAME} usable`,
    // 'home' is already taken by the seed — proves de-confliction.
    slug: 'home',
    nodes: {
      root: { componentId: 'text', props: { text: 'Hello {{who}}' } },
    },
    placeholders: [{ name: 'who', label: 'Who', defaultValue: 'world' }],
    source: { type: 'authored' },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const useButton = page.locator(
    `button[aria-label="Use ${TEMPLATE_NAME} usable"]`,
  )
  await useButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await useButton.click()
  const useDialog = page.locator('div[role="dialog"]:has-text("Use this template")')
  await useDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  check('use dialog opens', true)

  const placeholderField = useDialog.getByLabel('Who')
  check('placeholder field rendered', (await placeholderField.count()) > 0)
  await placeholderField.fill('Aglyn')
  const createdPageName = `${TEMPLATE_NAME} created`
  await useDialog.locator('input').first().fill(createdPageName)
  await useDialog.getByRole('button', { name: /^Create page$/ }).click()
  await useDialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  const createdScreens = await hostRef
    .collection('screens')
    .where('displayName', '==', createdPageName)
    .get()
  check('screen created from template', createdScreens.size === 1)
  if (createdScreens.size === 1) {
    const screenDoc = createdScreens.docs[0]
    const versionId = screenDoc.get('versionId')
    const versionSnapshot = await screenDoc.ref
      .collection('versions')
      .doc(String(versionId))
      .get()
    const rendered = JSON.stringify(versionSnapshot.get('nodes'))
    check(
      'placeholder substituted',
      rendered.includes('Hello Aglyn') && !rendered.includes('{{who}}'),
      rendered.slice(0, 80),
    )
    const routing = (await hostRef.get()).get('screens') ?? {}
    const publishedSlug = routing[screenDoc.id]
    check('route published', !!publishedSlug, `slug=${publishedSlug}`)
    check(
      'slug de-conflicted against the seeded /home',
      publishedSlug !== 'home',
      `got ${publishedSlug}`,
    )
    // The template itself must survive being used.
    const stillThere = await hostRef.collection('templates').doc('e2e-usable').get()
    check('template not consumed', stillThere.exists && !stillThere.get('deletedAt'))
  }

  // "Could not reach Cloud Firestore backend" fires when the SDK briefly
  // drops its listen channel across a client-side navigation and retries.
  // It is ignorable HERE only because every write in this run is asserted
  // against Firestore directly — if a reconnect had actually eaten one, the
  // document checks above would have failed rather than this line.
  const relevantErrors = consoleErrors.filter(
    (text) =>
      !/network-request-failed|popup-blocked|App Check|Could not reach Cloud Firestore backend/i.test(
        text,
      ),
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
