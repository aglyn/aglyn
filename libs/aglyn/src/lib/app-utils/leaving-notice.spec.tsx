/**
 * @jest-environment jsdom
 *
 * Pragma first: behind the license header jest ignores it, and this
 * project's default environment has no `document`.
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

/**
 * The client half of the leaving notice (AGL-3452): which hrefs leave, what
 * they become, and the two places a published page applies it — the
 * `useLinkTarget` seam every linking element resolves through, and the
 * document interceptor for every other anchor.
 */

import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  installLeavingNoticeInterceptor,
  isLeavingNoticeExempt,
  LEAVING_NOTICE_PATH,
  type LeavingNoticeConfig,
  leavingDestination,
  normalizeLeavingDestination,
  rerouteLeavingAnchor,
  routeThroughLeavingNotice,
} from './leaving-notice'
import { useLinkTarget } from './screen-link-context'
import {
  ScreenLinkContext,
  type ScreenLinkContextValue,
} from './screen-link-context-value'

const HARVESTER = 'https://secure-docs.example.net/login?next=%2Fview'

/** A young free site: its subdomain, its custom domain, the platform. */
const CONFIG: LeavingNoticeConfig = {
  until: Date.UTC(2026, 9, 15),
  hosts: [
    'juenes.aglyn.app',
    'juenes.example.com',
    'www.juenes.example.com',
    'aglyn.app',
    '.aglyn.com',
  ],
  sigs: { [HARVESTER]: 'signed-for-juenes' },
}

const noticeFor = (href: string) => {
  const url = new URL(href, 'https://juenes.aglyn.app')
  return {
    path: url.pathname,
    to: url.searchParams.get('to'),
    sig: url.searchParams.get('sig'),
  }
}

describe('which hrefs leave the site', () => {
  it('reads an absolute or protocol-relative address the way a browser does', () => {
    expect(normalizeLeavingDestination('https://Evil.Example/x')).toBe(
      'https://evil.example/x',
    )
    expect(normalizeLeavingDestination('http://evil.example')).toBe(
      'http://evil.example/',
    )
    // Both read as site paths to a `^/` test, and both leave in a browser.
    expect(normalizeLeavingDestination('//evil.example/x')).toBe(
      'https://evil.example/x',
    )
    expect(normalizeLeavingDestination('/\\evil.example/x')).toBe(
      'https://evil.example/x',
    )
  })

  it('treats mailto:, tel: and sms: as hand-offs, not navigations', () => {
    expect(normalizeLeavingDestination('mailto:owner@example.com')).toBeNull()
    expect(normalizeLeavingDestination('tel:+15125550100')).toBeNull()
    expect(normalizeLeavingDestination('sms:+15125550100')).toBeNull()
    expect(routeThroughLeavingNotice('mailto:owner@example.com', CONFIG)).toBeUndefined()
    expect(routeThroughLeavingNotice('tel:+15125550100', CONFIG)).toBeUndefined()
  })

  it('leaves site paths, fragments and other schemes alone', () => {
    for (const href of ['/', '/about', '#pricing', '?q=1', 'about', 'javascript:alert(1)']) {
      expect(`${href} → ${normalizeLeavingDestination(href)}`).toBe(`${href} → null`)
    }
  })

  it('exempts the site’s own subdomain', () => {
    expect(leavingDestination('https://juenes.aglyn.app/contact', CONFIG.hosts)).toBeNull()
  })

  it('exempts the site’s custom domain and its www.', () => {
    expect(leavingDestination('https://juenes.example.com/', CONFIG.hosts)).toBeNull()
    expect(leavingDestination('https://www.juenes.example.com/a', CONFIG.hosts)).toBeNull()
  })

  it('exempts the platform’s own domains, every name under a `.domain` entry', () => {
    expect(leavingDestination('https://aglyn.com/pricing', CONFIG.hosts)).toBeNull()
    expect(leavingDestination('https://app.aglyn.com/', CONFIG.hosts)).toBeNull()
    expect(leavingDestination('https://docs.aglyn.com/x', CONFIG.hosts)).toBeNull()
    expect(leavingDestination('https://aglyn.app/', CONFIG.hosts)).toBeNull()
  })

  it('does NOT exempt another customer’s site on the same apex, or a lookalike', () => {
    expect(leavingDestination('https://review.aglyn.app/reviewfile', CONFIG.hosts)).toBe(
      'https://review.aglyn.app/reviewfile',
    )
    expect(leavingDestination('https://aglyn.com.evil.example/', CONFIG.hosts)).toBe(
      'https://aglyn.com.evil.example/',
    )
    expect(isLeavingNoticeExempt('notaglyn.com', CONFIG.hosts)).toBe(false)
  })

  it('exempts a development machine’s localhost', () => {
    expect(isLeavingNoticeExempt('localhost', [])).toBe(true)
    expect(isLeavingNoticeExempt('juenes.localhost', [])).toBe(true)
  })
})

describe('what a leaving href becomes', () => {
  it('is the notice on the site’s own host, carrying the destination and its signature', () => {
    const notice = noticeFor(routeThroughLeavingNotice(HARVESTER, CONFIG) as string)
    expect(notice).toEqual({
      path: LEAVING_NOTICE_PATH,
      to: HARVESTER,
      sig: 'signed-for-juenes',
    })
  })

  it('still goes through the notice when the server signed nothing for it', () => {
    // The notice refuses it — which is the safe failure. Around is not.
    const notice = noticeFor(
      routeThroughLeavingNotice('https://unseen.example/', CONFIG) as string,
    )
    expect(notice).toEqual({
      path: LEAVING_NOTICE_PATH,
      to: 'https://unseen.example/',
      sig: null,
    })
  })

  it('is unchanged with no config — a paid or older site', () => {
    expect(routeThroughLeavingNotice(HARVESTER, undefined)).toBeUndefined()
    expect(routeThroughLeavingNotice(HARVESTER, null)).toBeUndefined()
  })
})

describe('useLinkTarget — the seam every linking element resolves through', () => {
  const wrapper =
    (value: ScreenLinkContextValue) =>
    ({ children }: { children: ReactNode }) => (
      <ScreenLinkContext.Provider value={value}>{children}</ScreenLinkContext.Provider>
    )

  it('renders a leaving link as the notice, and no longer as leaving the site', () => {
    const { result } = renderHook(() => useLinkTarget(undefined, HARVESTER), {
      wrapper: wrapper({ screens: {}, leavingNotice: CONFIG }),
    })
    expect(noticeFor(result.current.href as string).to).toBe(HARVESTER)
    expect(result.current.leavesSite).toBe(false)
    expect(result.current.externalHref).toBe(HARVESTER)
  })

  it('leaves the same link alone without a config', () => {
    const { result } = renderHook(() => useLinkTarget(undefined, HARVESTER), {
      wrapper: wrapper({ screens: {} }),
    })
    expect(result.current.href).toBe(HARVESTER)
    expect(result.current.leavesSite).toBe(true)
  })

  it('never touches a screen link, a mailto:, or the site’s own domain', () => {
    const value = { screens: { s1: 'about' }, leavingNotice: CONFIG }
    const screen = renderHook(() => useLinkTarget('s1', undefined), {
      wrapper: wrapper(value),
    })
    expect(screen.result.current.href).toBe('/about')
    const mail = renderHook(() => useLinkTarget(undefined, 'mailto:a@example.com'), {
      wrapper: wrapper(value),
    })
    expect(mail.result.current.href).toBe('mailto:a@example.com')
    const own = renderHook(
      () => useLinkTarget(undefined, 'https://juenes.example.com/shop'),
      { wrapper: wrapper(value) },
    )
    expect(own.result.current.href).toBe('https://juenes.example.com/shop')
  })
})

describe('the interceptor — every anchor useLinkTarget never saw', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('points a Markdown-style anchor at the notice before the click lands', () => {
    document.body.innerHTML = `<p><a id="out" href="${HARVESTER}"><span id="label">Open the document</span></a></p>`
    const uninstall = installLeavingNoticeInterceptor(document, CONFIG)
    document.getElementById('label')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const href = document.getElementById('out')?.getAttribute('href') as string
    expect(noticeFor(href)).toEqual({
      path: LEAVING_NOTICE_PATH,
      to: HARVESTER,
      sig: 'signed-for-juenes',
    })
    uninstall()
  })

  it('catches a middle click and a context menu too', () => {
    document.body.innerHTML = `<a id="a" href="https://a.example/">a</a><a id="b" href="https://b.example/">b</a>`
    const uninstall = installLeavingNoticeInterceptor(document, CONFIG)
    document.getElementById('a')?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true }))
    document.getElementById('b')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(noticeFor(document.getElementById('a')?.getAttribute('href') as string).to).toBe(
      'https://a.example/',
    )
    expect(noticeFor(document.getElementById('b')?.getAttribute('href') as string).to).toBe(
      'https://b.example/',
    )
    uninstall()
  })

  it('leaves own-site, mailto: and tel: anchors as they are', () => {
    document.body.innerHTML = [
      '<a id="own" href="/pricing">p</a>',
      '<a id="mail" href="mailto:a@example.com">m</a>',
      '<a id="tel" href="tel:+15125550100">t</a>',
      '<a id="custom" href="https://juenes.example.com/x">c</a>',
    ].join('')
    for (const id of ['own', 'mail', 'tel', 'custom']) {
      const anchor = document.getElementById(id) as HTMLAnchorElement
      const before = anchor.getAttribute('href')
      expect(rerouteLeavingAnchor(anchor, CONFIG)).toBe(false)
      expect(anchor.getAttribute('href')).toBe(before)
    }
  })

  it('stops after it is uninstalled', () => {
    document.body.innerHTML = `<a id="out" href="${HARVESTER}">x</a>`
    installLeavingNoticeInterceptor(document, CONFIG)()
    document.getElementById('out')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.getElementById('out')?.getAttribute('href')).toBe(HARVESTER)
  })
})
