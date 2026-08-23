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
 * The tab names WHICH document is open (AGL-2486), and keeps doing so inside a
 * white-label org.
 *
 * ## Why this drives the component and not `renameTitleSubject`
 *
 * The pure swap is pinned in `app/entity-page-title.spec.ts` and passes
 * against a version of this feature that never reaches a browser tab. What
 * cannot be tested there is the constraint that decided the design: there is
 * exactly ONE writer of `document.title`, and it has to perform two
 * independent rewrites — the entity name AND the white-label brand — without
 * either undoing the other, while a `MutationObserver` re-runs the pair after
 * every write it makes.
 *
 * Two components each defending the title with their own observer is not a
 * race that can be won; it is a loop. So the composition is asserted here,
 * against the real component, with the real observer running.
 *
 * `white-label-tab-title.spec.tsx` remains the guard on the brand half alone,
 * and deliberately mounts the same component with NO subject — which is the
 * proof that adding the subject rewrite did not change the untouched path.
 */

const WHITE_LABEL_NAME = 'Northwind'
const SCREEN_ID = '4L_o499p_p'

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
import {
  resetDocumentSubject,
  setDocumentSubject,
} from '../components/document-subject'

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

/** The title the SERVER renders for a screen besigner route. */
const served = (id = SCREEN_ID) =>
  `${id} · Screen besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`

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

describe('the console tab names the open document', () => {
  beforeEach(() => {
    resetDocumentSubject()
    asPlatformOrg()
    setTitle(served())
  })

  afterEach(() => resetDocumentSubject())

  it('states its premise: the served title carries the id, not the name', () => {
    // The instrument before it is trusted. If the layouts stop putting the id
    // in the title, every assertion below would pass against a title that
    // never had a subject to swap.
    expect(document.title).toContain(SCREEN_ID)
    expect(document.title).not.toContain('Home')
  })

  it('replaces the id with the loaded name', async () => {
    render(<ConsoleBrandingEffects />)
    setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
    await settle()
    expect(document.title).toBe(
      `Home · Screen besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`,
    )
    expect(document.title).not.toContain(SCREEN_ID)
  })

  it('leaves the tab on the id when no name has loaded', async () => {
    // The whole point of the id fallback: a name that never arrives — a
    // permission error, a slow read, the preview route that loads no
    // document at all — still leaves four tabs distinguishable.
    render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(served())
  })

  it('never flickers through a WRONG name', async () => {
    // `setDocumentSubject` refuses a half-loaded subject, so the tab goes
    // id → name and never id → someone-else's-name → name. Publishing an
    // empty name must not blank it either.
    render(<ConsoleBrandingEffects />)
    setDocumentSubject({ id: SCREEN_ID, name: '' })
    await settle()
    expect(document.title).toBe(served())
  })

  it('re-applies after a client navigation rewrites the title', async () => {
    // Next replaces the title on every route change. A one-shot write is
    // undone by the first link click — the same failure the white-label half
    // already documents, now for the subject.
    render(<ConsoleBrandingEffects />)
    setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
    await settle()
    expect(document.title).toContain('Home')

    setTitle(served())
    await settle()
    expect(document.title).toBe(
      `Home · Screen besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`,
    )
  })

  it('two screens of one site produce two different tabs', async () => {
    // Stated as the reported bug, end to end through the real component.
    render(<ConsoleBrandingEffects />)
    setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
    await settle()
    const first = document.title

    setTitle(served('9Xk_22bTq'))
    setDocumentSubject({ id: '9Xk_22bTq', name: 'Checkout' })
    await settle()
    expect(document.title).not.toBe(first)
    expect(first).toContain('Home')
    expect(document.title).toContain('Checkout')
  })

  describe('composed with the unread-notification badge', () => {
    /*
     * Found in a browser, not in a spec, and it would have shipped otherwise.
     *
     * `notifications-menu.component.tsx` prepends `(3) ` to the tab under a
     * MutationObserver of its own — so the title reaching the subject rewrite
     * is `(3) 4L_o499p_p · Screen besigner · …`, and a match anchored at
     * position 0 finds nothing. Every unit test here passed while every tab on
     * localhost stayed stuck on the id, because the specs built the title the
     * server sends and the browser had a second writer in front of it.
     *
     * The premise these tests encode: the title is NOT owned by one component.
     */
    const badged = (id = SCREEN_ID) => `(3) ${served(id)}`

    it('renames the subject behind an unread badge', async () => {
      setTitle(badged())
      render(<ConsoleBrandingEffects />)
      setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
      await settle()
      expect(document.title).toBe(
        `(3) Home · Screen besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`,
      )
    })

    it('keeps the badge rather than eating it', async () => {
      // The obvious wrong fix — strip and never restore — silently deletes a
      // feature to fix a different one.
      setTitle(badged())
      render(<ConsoleBrandingEffects />)
      setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
      await settle()
      expect(document.title.startsWith('(3) ')).toBe(true)
    })

    it('handles the truncated badge form too', async () => {
      // `unreadBadge` emits `(9+)` past its cap; the shared strip pattern
      // covers it, which is the reason for sharing it.
      setTitle(`(9+) ${served()}`)
      render(<ConsoleBrandingEffects />)
      setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
      await settle()
      expect(document.title).toBe(
        `(9+) Home · Screen besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`,
      )
    })

    it('does not compound or loop when the badge is re-applied', async () => {
      setTitle(badged())
      render(<ConsoleBrandingEffects />)
      setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
      await settle()
      // The badge writer re-asserting itself over our result must converge.
      setTitle(`(3) ${document.title.replace(/^\(3\) /, '')}`)
      await settle()
      await settle()
      expect(document.title).toBe(
        `(3) Home · Screen besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`,
      )
    })
  })

  describe('composed with white-label branding', () => {
    it('applies BOTH rewrites, in one owner', async () => {
      // The tab must never show a half-transformed state: the platform brand
      // beside the org's own document name would be exactly the "half-branded
      // tab" white-label.md promises does not exist.
      asWhiteLabel()
      render(<ConsoleBrandingEffects />)
      setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
      await settle()
      expect(document.title).toBe(
        `Home · Screen besigner · demo.aglyn.app · ${WHITE_LABEL_NAME}`,
      )
      expect(document.title).not.toContain(PLATFORM_BRAND_NAME)
      expect(document.title).not.toContain(SCREEN_ID)
    })

    it('brands the tab even while the name is still loading', async () => {
      asWhiteLabel()
      render(<ConsoleBrandingEffects />)
      await settle()
      expect(document.title).toBe(
        `${SCREEN_ID} · Screen besigner · demo.aglyn.app · ${WHITE_LABEL_NAME}`,
      )
    })

    it('terminates when the product name contains the platform name', async () => {
      // The obvious infinite-loop shape, now with a second transform in the
      // same pass to make sure the `applied` guard still closes it.
      asWhiteLabel(`${PLATFORM_BRAND_NAME} Partners`)
      render(<ConsoleBrandingEffects />)
      setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
      await settle()
      await settle()
      await settle()
      expect(document.title).toBe(
        `Home · Screen besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME} Partners`,
      )
    })

    it('restores the served title when the page unmounts', async () => {
      // Navigating away must not strand the previous document's name in the
      // tab — the same restore contract the favicon effect keeps.
      asWhiteLabel()
      const view = render(<ConsoleBrandingEffects />)
      setDocumentSubject({ id: SCREEN_ID, name: 'Home' })
      await settle()
      expect(document.title).toContain('Home')

      view.unmount()
      expect(document.title).toBe(served())
    })
  })
})
