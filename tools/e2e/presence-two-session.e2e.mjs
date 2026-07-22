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
// Presence with two real editors in one document (AGL-675).
//
// The pieces were covered separately — RTDB rules, the token broker — but
// the assembled behaviour was not, and presence is exactly the kind of
// feature where every piece can pass and the whole thing still show
// nothing. So this drives two browser sessions at the same screen.
//
// Requires the DATABASE emulator too:
//   cd cloud && npx -y firebase-tools@13 emulators:start \
//     --config firebase.e2e.json --project aglyn-main \
//     --only auth,firestore,database
//   npm run seed:e2e
//   npm run serve:console:emulated
//
// Then:  npm run e2e:presence
//
// This was red at "first session sees the second arrive" and the fault was
// the harness, not presence. Org membership is a PAIR of writes —
// `orgs/{orgId}/members/{uid}` (what the token broker checks) and
// `users/{uid}/orgs/{orgId}` (what useOrgScope resolves `/[orgSlug]/…`
// against). Only the first was written, so the second account was bounced
// off the editor route before presence mounted, while the unconditional
// `check('second editor opens', true)` reported PASS. Both are asserted now.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4200'
const HOST_ID = process.env.E2E_HOST ?? 'demo'
const ORG_SLUG = process.env.E2E_ORG_SLUG ?? 'e2e-bakery'
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 60_000)

// The seed makes two accounts; presence needs both to be members of the
// SAME org, so the second is added to the first's org here.
const PRIMARY = {
  email: process.env.E2E_EMAIL ?? 'e2e@aglyn.test',
  password: process.env.E2E_PASSWORD ?? 'E2e-Password-1',
  uid: 'e2e-owner',
}
const SECOND = {
  email: 'owner@aglyn.test',
  password: process.env.E2E_PASSWORD ?? 'E2e-Password-1',
  uid: 'e2e-nonstaff-owner',
}

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

let failures = 0
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const host = await db.collection('hosts').doc(HOST_ID).get()
const orgId = host.get('orgId')
const versionId = (
  await db.collection('hosts').doc(HOST_ID).collection('screens').doc('seed-home').get()
).get('versionId')

// Make the second account a member of the same org, and give it a display
// name so the avatar has something to render.
await db
  .collection('orgs')
  .doc(orgId)
  .collection('members')
  .doc(SECOND.uid)
  .set({ role: 'editor', allHosts: true }, { merge: true })
await db
  .collection('hosts')
  .doc(HOST_ID)
  .set({ memberRoles: { [SECOND.uid]: 'editor' } }, { merge: true })
// The MIRROR, not just the membership. `orgs/{orgId}/members/{uid}` is what
// the token broker checks, but the console resolves the `/[orgSlug]/…` in
// the URL against `users/{uid}/orgs` (useOrgScope) — with only the former,
// the second account signs in fine, gets a 200 from the broker if asked,
// and never asks, because the editor route bounces it to "This page isn't
// here" before presence ever mounts. Writing one side of the pair made a
// routing failure look exactly like a presence failure.
const org = await db.collection('orgs').doc(orgId).get()
await db
  .collection('users')
  .doc(SECOND.uid)
  .collection('orgs')
  .doc(orgId)
  .set(
    {
      orgName: org.get('name') ?? org.get('orgName') ?? 'E2E Bakery Co',
      slug: org.get('slug'),
      role: 'editor',
    },
    { merge: true },
  )

const editorUrl = `${BASE_URL}/${ORG_SLUG}/hosts/${HOST_ID}/screens/seed-home/versions/${versionId}/besigner`

const browser = await chromium.launch({ headless: true, ...chromeExecutable() })

async function openEditorAs(account) {
  // Separate context per account: shared cookies would make the second
  // sign-in replace the first, and both tabs would be the same person.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  // Surface the hook's own warnings — a silent presence failure looks
  // exactly like an empty room.
  page.on('console', (message) => {
    if (message.text().includes('[presence]')) {
      console.log(`  ${account.email}:`, message.text())
    }
  })
  await page.goto(`${BASE_URL}/signin`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  await page.fill('input[type="email"], input[name="email"]', account.email, {
    timeout: TIMEOUT_MS,
  })
  await page.fill('input[type="password"], input[name="password"]', account.password)
  await page.click('button[type="submit"], button:has-text("Next")')
  await page.waitForURL((url) => !url.pathname.startsWith('/signin'), {
    timeout: TIMEOUT_MS,
  })
  await page.goto(editorUrl, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  })
  return { context, page }
}

let first
let second
try {
  first = await openEditorAs(PRIMARY)
  check('first editor opens', true)

  // Alone: the avatar stack must render nothing at all.
  await first.page.waitForTimeout(5000)
  const aloneAvatars = await first.page.locator('.MuiAvatarGroup-root').count()
  check('no avatar stack when alone', aloneAvatars === 0, `${aloneAvatars} found`)

  const roomBefore = await db.collection('hosts').doc(HOST_ID).get()
  void roomBefore

  second = await openEditorAs(SECOND)
  // Assert it, don't assume it. `check(..., true)` was unconditional, so a
  // second session that never reached the editor reported PASS and the
  // blame landed on presence.
  const secondInEditor = await second.page
    .getByText(/hierarchy/i)
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check(
    'second editor opens',
    secondInEditor,
    secondInEditor ? undefined : `landed on ${second.page.url()}`,
  )

  // The real assertion: the FIRST session must learn about the second.
  const sawOther = await first.page
    .locator('.MuiAvatarGroup-root')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check('first session sees the second arrive', sawOther)

  if (sawOther) {
    const count = await first.page
      .locator('.MuiAvatarGroup-root .MuiAvatar-root')
      .count()
    // Yourself is excluded, so one other editor means exactly one avatar.
    check('shows exactly the other editor', count === 1, `${count} avatars`)
  }

  // onDisconnect is the whole reason this is RTDB: closing the tab must
  // clear the entry server-side, with no heartbeat and no reaper.
  await second.context.close()
  second = null
  const cleared = await first.page
    .locator('.MuiAvatarGroup-root')
    .first()
    .waitFor({ state: 'detached', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check('entry clears when the other tab closes', cleared)
} catch (error) {
  failures += 1
  console.error('FAIL  harness error —', error?.message ?? error)
} finally {
  await first?.context.close().catch(() => undefined)
  await second?.context.close().catch(() => undefined)
  await browser.close()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
