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

// What every browser-driven console spec needs before its first assertion
// (AGL-2610): the emulator-side Admin SDK, a Chrome, a signed-in context, a
// three-verdict tally, and a shutter.
//
// Lifted out of `console.e2e.mjs` and `global-search.e2e.mjs`, which each
// carried their own copy of the Chrome lookup and the sign-in. The CRM specs
// are five scripts sharing one fixture, and five more copies of the same
// forty lines is five places for the sign-in to drift from the app's own
// emulator wiring — which is the one thing about it that must not drift:
//
//   The sign-in goes through the REAL `/signin` UI. Injecting a synthetic
//   localStorage session races the app's `connectAuthEmulator` call (the SDK
//   throws if auth already began restoring a persisted user; the app swallows
//   it and auth silently points at production), which made Firestore listens
//   run unauthenticated on roughly half the loads. The UI flow exercises the
//   app's own wiring, and the session it persists is valid for every later
//   page in the context.
//
// ## Three verdicts
//
// `pass`, `fail`, and `skip` — the third deliberately. A precondition a
// script could not establish must not be reported as a pass: a check that
// quietly degrades into "nothing to assert" is the shape that keeps a suite
// green while it stops testing anything. `skip` counts separately and prints
// as INCONCLUSIVE, and the exit code is non-zero only for real failures.
//
// ## Screenshots are a deliverable, not only a failure artifact
//
// `E2E_SHOTS_DIR` names a directory the specs drop staged captures into —
// the contacts list with its bulk bar up, the reports page, a lead's convert
// dialog — at the viewport the docs and the press kit use. Each shot strips
// the auth-emulator banner and the Next dev indicator first, the way the
// docs capture harness does. Unset, no shot is taken and nothing else
// changes.

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { chromium } from 'playwright-core'

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
export const ORG_SLUG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
export const ORG_ID = process.env.E2E_ORG_ID ?? 'e2e-owner'
export const HOST_ID = process.env.E2E_HOST ?? 'demo'
/** The seeded staff owner (`seed-e2e.mjs`'s `E2E_UID`), who signs in below. */
export const OWNER_UID = 'e2e-owner'
export const OWNER_NAME = 'E2E Owner'
export const TEAMMATE_UID = process.env.E2E_TEAMMATE_UID ?? 'e2e-teammate'
export const TEAMMATE_NAME = 'E2E Teammate'
export const EMAIL = process.env.E2E_EMAIL ?? 'e2e@aglyn.test'
export const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-1'
export const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 45_000)
export const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? join(repoRoot, 'tmp', 'e2e-artifacts')
export const SHOTS_DIR = process.env.E2E_SHOTS_DIR ?? ''
/**
 * The docs and press-kit frame. Every page a spec captures is laid out for
 * it, so a shot at any other size is a different composition than the one
 * being reviewed.
 */
export const SHOT_VIEWPORT = { width: 1840, height: 1160 }

/** Org-scoped routing (AGL-825): every host page sits under `/[orgSlug]/hosts/[host]`. */
export const HOST_BASE = `/${ORG_SLUG}/hosts/${HOST_ID}`
export const hostUrl = (path = '') => `${BASE_URL}${HOST_BASE}${path}`

const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099'
const FIRESTORE_EMULATOR = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8082'

/**
 * The Admin SDK, pointed at the emulators and at nothing else.
 *
 * The env vars are SET here rather than read, because a spec that reset its
 * fixtures through an Admin SDK inheriting a production credential from the
 * shell would be a spec that could delete a customer's contacts. Pinning
 * both hosts before the first `initializeApp` is what makes that impossible
 * from this module — the same refusal `seed-e2e.mjs` makes by exiting.
 */
export function adminFirestore() {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR
  if (!getApps().length) initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'aglyn-main' })
  return getFirestore(process.env.FIRESTORE_DATABASE_ID)
}

/**
 * A bearer token for a seeded uid, for the routes a spec drives from Node
 * rather than from the page — the same custom-token exchange
 * `listing-reviews.e2e.mjs` runs.
 */
export async function idTokenFor(uid) {
  adminFirestore()
  const customToken = await getAuth().createCustomToken(uid)
  const response = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
  const payload = await response.json()
  if (!payload.idToken) throw new Error(`token exchange failed for ${uid}`)
  return payload.idToken
}

/** One authorized JSON POST to a console API route, as a seeded user. */
export async function postAsUser(uid, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await idTokenFor(uid)}`,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

export function chromeExecutable() {
  if (process.env.E2E_CHROME_PATH) return { executablePath: process.env.E2E_CHROME_PATH }
  if (process.platform === 'darwin') {
    // First installed Chrome flavor wins — a Chrome update/uninstall must
    // not break the suite (it did once: only Beta was installed).
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

/**
 * The tally. `name` is what prints; `detail` is the measurement behind it,
 * so a red line says what was seen rather than only what was expected.
 */
export function verdicts() {
  const state = { failures: 0, inconclusive: 0, passes: 0 }
  return {
    pass(name, detail = '') {
      state.passes += 1
      console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
    },
    fail(name, detail = '') {
      state.failures += 1
      console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
    },
    skip(name, why) {
      state.inconclusive += 1
      console.warn(`INCONCLUSIVE  ${name} — ${why}`)
    },
    /** `pass` or `fail` from a boolean, in one line. */
    check(name, ok, detail = '') {
      if (ok) this.pass(name, detail)
      else this.fail(name, detail)
      return ok
    },
    get failures() {
      return state.failures
    },
    /** Prints the totals and returns the process exit code. */
    finish() {
      console.log(
        `\n${state.failures === 0 ? 'OK' : 'FAILURES'}: ${state.passes} passed, ` +
          `${state.failures} failed, ${state.inconclusive} inconclusive`,
      )
      return state.failures === 0 ? 0 : 1
    },
  }
}

/** Signs in through the real `/signin` UI; resolves once the router has left it. */
export async function signInThroughUi(page) {
  await page.goto(`${BASE_URL}/signin`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.fill('input[type="email"], input[name="email"]', EMAIL, { timeout: TIMEOUT_MS })
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"], button:has-text("Next")')
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: TIMEOUT_MS })
}

/**
 * A headless Chrome with one signed-in context.
 *
 * The notification pre-permission modal (AGL-663) is dismissed before any
 * app code runs, the way the docs capture does it: the key and value mirror
 * `apps/console/components/notification-prompt`, and without it the modal
 * lands over whatever the spec is about to click.
 */
export async function openConsole(options = {}) {
  const viewport = options.viewport ?? SHOT_VIEWPORT
  mkdirSync(ARTIFACTS, { recursive: true })
  if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('aglyn:notification-prompt-dismissed', 'never')
    } catch {
      // Storage unavailable on this navigation — the modal backstop in
      // `stripChrome` still covers the shot.
    }
  })
  const page = await context.newPage()
  // An editor's unsaved-changes prompt would park a navigation forever.
  page.on('dialog', (dialog) => dialog.accept().catch(() => undefined))
  await signInThroughUi(page)
  console.log(`signed in through the UI as ${EMAIL}`)
  return {
    browser,
    context,
    page,
    async close() {
      await browser.close()
    },
  }
}

/**
 * Removes what a published image must never show.
 *
 * The auth-emulator warning banner, Next's dev indicator and the
 * notification modal backstop, as the docs capture strips them. Then the
 * staff-only chrome a release-flagged surface wears for the signed-in staff
 * account: the "Release-flagged feature" alert over the page, and the ⚑ icon
 * on the nav tab the app marks `data-staff-only`. The TAB stays — the CRM's
 * own tab is the one being captured, and a strip with the active tab missing
 * is not what a customer sees once the flag is on — only the flag goes,
 * which leaves the strip a customer sees the day the surface ships.
 */
export async function stripChrome(page) {
  await page.evaluate(() => {
    for (const selector of [
      '.firebase-emulator-warning',
      'nextjs-portal',
      '#__next-build-watcher',
      '[data-nextjs-toast]',
      '[data-staff-only] svg',
    ]) {
      document.querySelectorAll(selector).forEach((el) => el.remove())
    }
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (/enable notifications/i.test(dialog.textContent ?? '')) {
        ;(dialog.closest('.MuiModal-root') ?? dialog).remove()
      }
    }
    for (const alert of document.querySelectorAll('[role="alert"]')) {
      if (/release-flagged feature/i.test(alert.textContent ?? '')) alert.remove()
    }
    // The snackbars of the steps before this one: feedback that belongs to a
    // moment already past, stacked in the corner of a frame about the next.
    document.querySelectorAll('[class*="SnackbarItem-"]').forEach((el) => el.remove())
  })
}

/**
 * One staged capture, when `E2E_SHOTS_DIR` is set.
 *
 * Viewport-sized, not full-page: the frame IS the composition, and a
 * full-page capture of a long list is a different image than the one a
 * reader sees. A settle first, because the shutter must not catch a chip
 * mid-transition or a list one snapshot behind its write; and the page is
 * scrolled back to the top unless the caller says otherwise, because the
 * click that staged the shot usually scrolled its target into view and the
 * frame should open on the page's heading.
 */
export async function shot(page, name, { settleMs = 800, scrollTop = true } = {}) {
  if (!SHOTS_DIR) return null
  if (scrollTop) await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(settleMs)
  await stripChrome(page)
  const path = join(SHOTS_DIR, `${name}.png`)
  await page.screenshot({ path })
  console.log(`SHOT  ${path}`)
  return path
}

/** The full-page capture a failure leaves behind, for the report. */
export async function failureShot(page, name) {
  const path = join(ARTIFACTS, `${name}.png`)
  await page.screenshot({ path, fullPage: true }).catch(() => undefined)
  return path
}

/**
 * Runs one named step, turning a throw into a FAIL with a screenshot rather
 * than into an aborted script — so a spec reports every step it could reach.
 */
export async function step(tally, page, name, body) {
  try {
    await body()
  } catch (error) {
    const path = await failureShot(page, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase())
    tally.fail(name, `${String(error?.message ?? error).split('\n')[0]} (screenshot: ${path})`)
    // A step that failed inside a dialog leaves it open, and the next step's
    // first click lands on its backdrop — one red would read as several.
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  }
  return true
}

/*==========================================
 * MUI GESTURES
 *
 * The console is MUI, and three of its controls take more than one click to
 * drive: a `Select` opens a listbox in a portal, a `Snackbar` is transient,
 * and a `RowActionsMenu` is a menu behind an icon button. Each is written
 * once here so a spec reads as the gesture a person makes.
 *=========================================*/

/**
 * Picks an option from a MUI `Select` by its label.
 *
 * The combobox's accessible name is the label plus the current value, so it
 * is matched as a prefix; the listbox is scoped to the open menu so a
 * matching row elsewhere on the page cannot take the click.
 */
export async function pickSelect(page, label, option, scope = page) {
  const combobox = scope.getByRole('combobox', { name: new RegExp(`^${escapeRegExp(label)}`) })
  await combobox.first().click({ timeout: TIMEOUT_MS })
  const listbox = page.locator('[role="listbox"]').last()
  await listbox.getByRole('option', { name: option, exact: true }).click({ timeout: TIMEOUT_MS })
}

/** Waits for a snackbar carrying `text` and returns once it has been seen. */
export async function expectSnackbar(page, text) {
  await page.waitForSelector(`[role="alert"]:has-text("${text}"), .notistack-Snackbar:has-text("${text}"), [class*="Snackbar"]:has-text("${text}")`, {
    timeout: TIMEOUT_MS,
  })
}

/**
 * The console card whose header reads `header` — a `CardDisplay`, which is
 * a MUI `Card` with a `CardHeader`. Scoping a control to it is what keeps
 * "Save" meaning this card's Save on a page with three.
 */
export function cardNamed(page, header) {
  return page
    .locator('.MuiCard-root', {
      has: page.locator('.MuiCardHeader-root', { hasText: header }),
    })
    .first()
}

/**
 * Opens the `⋮` menu labeled for `subject` and clicks the item named `item`.
 *
 * The label is matched whole: a draggable board card is itself a button
 * whose accessible name is its content, menu label included, so a
 * substring match would resolve the card as well as its menu.
 */
export async function rowAction(page, subject, item) {
  await page
    .getByRole('button', { name: `More actions for ${subject}`, exact: true })
    .click({ timeout: TIMEOUT_MS })
  const menu = page.locator('[role="menu"]').last()
  await menu.getByRole('menuitem', { name: item }).click({ timeout: TIMEOUT_MS })
}

/**
 * Polls a read until it answers `predicate`, for the moment between a click
 * and the write it caused landing — a listener-fed page and an Admin read
 * both lag the click by a round trip, and asserting on the first read is
 * asserting on a race.
 */
export async function waitFor(read, predicate, { timeoutMs = TIMEOUT_MS, everyMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, everyMs))
  }
  throw new Error(`timed out waiting; last value ${JSON.stringify(last)?.slice(0, 300)}`)
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
