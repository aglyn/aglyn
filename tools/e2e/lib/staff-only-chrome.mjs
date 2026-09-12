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

// Keeps STAFF-ONLY console chrome out of published documentation (AGL-1600).
//
// Both capture harnesses sign in as the seeded staff account
// (`e2e@aglyn.test`) because the staff-console pages they shoot need the
// claim. Staff do not see the customer console: a nav tab whose release flag
// is OFF stays visible for them, badged with a ⚑, and every host-scoped
// capture rendered one. `⚑ CONTACTS` — an unlaunched CRM — shipped that way
// in a third of the published images.
//
// The app marks that chrome with `data-staff-only="<release flag key>"`
// (apps/console/components/secondary-nav-bar.component.tsx, locked by
// apps/console/specs/nav-staff-only-marker.spec.ts). This module hides it for
// the whole capture session and then refuses to let a shot through if any of
// it is still on screen.
//
// Hiding it is honest here, not cosmetic: what remains is exactly the strip a
// customer's console renders, because the customer branch of that same gate
// drops the tab outright.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** What the app marks staff-only chrome with. Keep in step with the spec. */
export const STAFF_ONLY_ATTRIBUTE = 'data-staff-only'
export const STAFF_ONLY_SELECTOR = `[${STAFF_ONLY_ATTRIBUTE}]`

const HIDE_RULE = `${STAFF_ONLY_SELECTOR} { display: none !important; }`

const RELEASE_FLAG_REGISTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../libs/aglyn/src/lib/app-utils/release-flags.ts',
)

/**
 * The release flags that gate a console nav tab AND ship off — the only
 * chrome a staff account sees that a customer's console drops.
 *
 * Read from the registry's source because this module runs under plain node
 * and cannot import TypeScript. A text read can drift from the real array, so
 * apps/console/specs/nav-staff-only-marker.spec.ts runs this function and
 * holds its answer to `RELEASE_FLAGS` itself: a registry reshaped past this
 * reader fails there, not halfway through a capture run.
 */
export function flaggedOffNavTabKeys(
  source = readFileSync(RELEASE_FLAG_REGISTRY, 'utf8'),
) {
  const start = source.indexOf('export const RELEASE_FLAGS')
  const end = source.indexOf('export const RELEASE_FLAG_KEYS', start)
  if (start < 0 || end < 0) {
    throw new Error(`cannot find RELEASE_FLAGS in ${RELEASE_FLAG_REGISTRY}`)
  }
  return source
    .slice(start, end)
    .split(/\n {2}\{\n/)
    .slice(1)
    .filter(
      (entry) =>
        /^\s*defaultEnabled: false,/m.test(entry) &&
        /^\s*navTabId: '/m.test(entry),
    )
    .map((entry) => entry.match(/^\s*key: '([a-z_]+)'/m)?.[1])
    .filter(Boolean)
}

/**
 * Hides staff-only chrome from the first paint of every page in the context.
 *
 * A stylesheet rather than a DOM removal on the way to the shutter: the staff
 * claim resolves from a forced token refresh AFTER first paint, so the flagged
 * tabs arrive late and a one-shot removal races them — and React owns that
 * subtree, so anything it re-renders comes straight back. A rule installed
 * before any app code runs covers both.
 *
 * The tab strip re-lays-out around the hidden tab (MUI's indicator and the
 * scroller both watch it resize), so the result is the strip a customer sees.
 */
export async function installStaffOnlyChromeStyles(context) {
  await context.addInitScript((rule) => {
    const install = () => {
      if (document.getElementById('e2e-staff-only-chrome')) return
      const style = document.createElement('style')
      style.id = 'e2e-staff-only-chrome'
      style.textContent = rule
      ;(document.head ?? document.documentElement)?.append(style)
    }
    try {
      install()
    } catch {
      // <head> not built yet on this navigation.
    }
    document.addEventListener('DOMContentLoaded', install)
  }, HIDE_RULE)
}

/** Every staff-only marker on the page, whether or not it is showing. */
async function readStaffOnlyChrome(page) {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll(selector)).map((node) => ({
      key: node.getAttribute('data-staff-only'),
      label: (node.textContent ?? '').trim().slice(0, 40),
      visible: node.getClientRects().length > 0,
    }))
  }, STAFF_ONLY_SELECTOR)
}

/**
 * Refuses the shot when staff-only chrome would be in it.
 *
 * Asserts on what is VISIBLE rather than on the hiding mechanism: a rule that
 * silently stopped applying (a renamed attribute, a shadow root, a tab that
 * paints outside its own element) reads as "nothing matched" to any check
 * written the other way round. The preflight below covers the remaining case
 * — a selector that matches nothing at all.
 */
export async function assertNoStaffOnlyChrome(page, label) {
  const showing = (await readStaffOnlyChrome(page)).filter(
    (node) => node.visible,
  )
  if (!showing.length) return
  const named = showing
    .map((node) => `${node.label || '(no label)'} [${node.key}]`)
    .join(', ')
  throw new Error(
    `staff-only chrome is in frame for ${label}: ${named}. ` +
      'Publishing this would advertise an unreleased feature (AGL-1600).',
  )
}

/**
 * Proves the guard is wired before a run captures anything.
 *
 * `assertNoStaffOnlyChrome` passing means "nothing staff-only is showing",
 * which is also what it says when the marker is gone from the app entirely —
 * the exact failure that lets the leak back in. So while some flag with a nav
 * tab ships off, open a host-scoped page that MUST carry its marker and
 * require a match.
 *
 * While no such flag exists there is no staff-only chrome for a capture to
 * leak, and no page that must carry a marker either, so the browser check
 * stands down and returns no keys. It re-arms itself the moment a flagged tab
 * ships off — nobody has to re-point it — and the declaration side,
 * apps/console/specs/nav-staff-only-marker.spec.ts, keeps proving that the
 * gate marks a flagged-off tab in the meantime.
 */
export async function preflightStaffOnlyChrome(page, { url, waitFor, timeout }) {
  const expected = flaggedOffNavTabKeys()
  if (!expected.length) return []
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForSelector(`text=${waitFor}`, { timeout })
  // The staff claim lands on a forced token refresh, so the flagged tabs are
  // not in the first commit.
  await page.waitForSelector(STAFF_ONLY_SELECTOR, {
    state: 'attached',
    timeout,
  })
  const found = await readStaffOnlyChrome(page)
  if (!found.some((node) => expected.includes(node.key))) {
    throw new Error(
      `staff-only chrome guard found no ${STAFF_ONLY_SELECTOR} for ` +
        `${expected.join(', ')} on ${url}. ` +
        'Either the capture account lost its staff claim, or the marker moved ' +
        '— fix it before capturing, or the run will publish whatever staff ' +
        'see (AGL-1600).',
    )
  }
  const stillVisible = found.filter((node) => node.visible)
  if (stillVisible.length) {
    throw new Error(
      `staff-only chrome is marked but still visible on ${url}: ` +
        `${stillVisible.map((node) => node.key).join(', ')}. ` +
        'The hiding rule is not applying.',
    )
  }
  return found.map((node) => node.key)
}
