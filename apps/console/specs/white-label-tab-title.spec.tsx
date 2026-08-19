/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
 *
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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { PLATFORM_BRANDING_PROFILE } from '@aglyn/aglyn'
import { render } from '@testing-library/react'

/**
 * A white-label org's browser TAB must not read the platform brand.
 *
 * The console tab title is server-rendered from `page-title.ts`'s
 * `TITLE_TEMPLATE` — `"%s · " + PLATFORM_BRAND_NAME` — and from the root
 * layout's `title.default`. Both are built at BUILD time from the deployment
 * brand, which AGL-2170 correctly made an env var for self-hosters. A per-ORG
 * white-label brand cannot be baked at build time at all, so every tab in an
 * Agency org's console still read "· Aglyn" while `ConsoleBrandingEffects`
 * had already swapped the favicon sitting a few pixels to its left. That is
 * the half-branded state `white-label.md` promises does not exist, on the
 * single most-looked-at piece of chrome in the product.
 *
 * ## Why this spec drives the COMPONENT and not a helper
 *
 * The interesting half of the fix is not the string replacement, it is that
 * the replacement SURVIVES A CLIENT NAVIGATION. Next re-renders `<title>` on
 * every route change, so a one-shot `document.title = …` is correct exactly
 * until the first link click and wrong forever after — and a spec that only
 * called a pure `brandTitle()` helper would pass against that broken version.
 * So the third test below re-writes the title the way Next does and asserts
 * the brand comes back. Deleting the `MutationObserver` and keeping the
 * initial write leaves tests 1 and 2 green and fails only that one.
 *
 * `PLATFORM_BRAND_NAME` is imported rather than spelled "Aglyn": jest leaks
 * the root `.env` into the console project, so a literal here would assert
 * the wrong brand on any machine that sets `NEXT_PUBLIC_PLATFORM_BRAND_NAME`.
 */

const WHITE_LABEL_NAME = 'Northwind'

/**
 * The one hook the component reads. Mocked NARROWLY — the module has a single
 * default export and a single named one, both returned here — rather than as a
 * wholesale closed world over the branding libs, which is the mock shape that
 * has manufactured false reds in this suite before.
 */
let mockBrandingState: {
  branding: typeof PLATFORM_BRANDING_PROFILE
  whiteLabel: boolean
  ready: boolean
}

jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBrandingState,
  default: () => mockBrandingState,
}))

import ConsoleBrandingEffects from '../components/console-branding-effects.component'

/** Lets the MutationObserver's microtask-queued callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Sets the tab title the way Next's head manager does. */
function setTitle(value: string) {
  let element = document.querySelector('title')
  if (!element) {
    element = document.createElement('title')
    document.head.appendChild(element)
  }
  element.textContent = value
}

function asWhiteLabel(productName = WHITE_LABEL_NAME) {
  mockBrandingState = {
    branding: { ...PLATFORM_BRANDING_PROFILE, productName },
    whiteLabel: true,
    ready: true,
  }
}

function asPlatformOrg() {
  mockBrandingState = {
    branding: PLATFORM_BRANDING_PROFILE,
    whiteLabel: false,
    ready: true,
  }
}

describe('white-label console tab title', () => {
  beforeEach(() => {
    asPlatformOrg()
    setTitle(`Billing · ${PLATFORM_BRAND_NAME}`)
  })

  it('states the premise it is testing: the served title names the platform', () => {
    // The instrument, before it is trusted. If the console ever stops
    // server-rendering the brand into the tab, every assertion below would
    // pass vacuously against a title that never contained it.
    const { TITLE_TEMPLATE } = require('../app/page-title')
    expect(TITLE_TEMPLATE).toContain(PLATFORM_BRAND_NAME)
    expect(document.title).toContain(PLATFORM_BRAND_NAME)
  })

  it('rewrites the platform brand to the org product name', async () => {
    asWhiteLabel()
    render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(`Billing · ${WHITE_LABEL_NAME}`)
    // The point is the ABSENCE, not merely the presence of the new name.
    expect(document.title).not.toContain(PLATFORM_BRAND_NAME)
  })

  it('leaves a non-white-label org alone', async () => {
    asPlatformOrg()
    render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(`Billing · ${PLATFORM_BRAND_NAME}`)
  })

  it('re-applies after a client navigation rewrites the title', async () => {
    // THE test. Next replaces the title text on every route change; a
    // one-shot write is undone by the first link click. Removing the
    // MutationObserver fails here and nowhere else.
    asWhiteLabel()
    render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(`Billing · ${WHITE_LABEL_NAME}`)

    setTitle(`Team · ${PLATFORM_BRAND_NAME}`)
    await settle()
    expect(document.title).toBe(`Team · ${WHITE_LABEL_NAME}`)
  })

  it('rebrands the untemplated default title too', async () => {
    // The root layout's `title.default` is a whole marketing string, not the
    // "%s · brand" template — a route that sets no title of its own gets it.
    asWhiteLabel()
    setTitle(`Secure Platform Console – ${PLATFORM_BRAND_NAME}`)
    render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(`Secure Platform Console – ${WHITE_LABEL_NAME}`)
  })

  it('restores the platform title when the branded org unmounts', async () => {
    asWhiteLabel()
    const view = render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(`Billing · ${WHITE_LABEL_NAME}`)

    view.unmount()
    // A downgrade or an org switch must not strand a brand the org no longer
    // has — the same restore contract the favicon effect already keeps.
    expect(document.title).toBe(`Billing · ${PLATFORM_BRAND_NAME}`)
  })

  it('terminates when the product name contains the platform name', async () => {
    // `split().join()` on a name that CONTAINS the needle is the obvious
    // infinite-loop shape. One pass, then the `applied` guard stops it.
    asWhiteLabel(`${PLATFORM_BRAND_NAME} Partners`)
    render(<ConsoleBrandingEffects />)
    await settle()
    await settle()
    expect(document.title).toBe(`Billing · ${PLATFORM_BRAND_NAME} Partners`)
  })

  it('does nothing when the org renamed to the platform name itself', async () => {
    asWhiteLabel(PLATFORM_BRAND_NAME)
    render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(`Billing · ${PLATFORM_BRAND_NAME}`)
  })
})
