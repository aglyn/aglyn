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

/**
 * The linking elements on a new free site send outside links through the
 * leaving notice (AGL-3452).
 *
 * The phishing pages that started this were one Button each. The elements
 * themselves know nothing about the notice — they resolve through
 * `useLinkTarget`, and the published page's context carries the config — so
 * what is asserted here is the MARKUP a visitor gets: the notice's address in
 * the served `href`, with no JavaScript needed to follow it.
 */

import * as Aglyn from '@aglyn/aglyn'
import { render } from '@testing-library/react'
import LinkableButton from './button'
import LinkBox from './link-box'
import ScreenLink from './screen-link'

const HARVESTER = 'https://secure-docs.example.net/login'

const NOTICE: Aglyn.ScreenLinkContextValue['leavingNotice'] = {
  until: Date.UTC(2026, 9, 15),
  hosts: ['juenes.aglyn.app', 'juenes.example.com', 'aglyn.app', '.aglyn.com'],
  sigs: { [HARVESTER]: 'signed' },
}

const renderOn = (ui: React.ReactElement, inWindow = true) =>
  render(
    <Aglyn.ScreenLinkContext.Provider
      value={{
        screens: { pricing: 'pricing' },
        ...(inWindow ? { leavingNotice: NOTICE } : {}),
      }}
    >
      {ui}
    </Aglyn.ScreenLinkContext.Provider>,
  )

const hrefOf = (container: HTMLElement) =>
  container.querySelector('a')?.getAttribute('href') ?? null

const notice = (href: string | null) => {
  const url = new URL(href ?? '', 'https://juenes.aglyn.app')
  return `${url.pathname} to=${url.searchParams.get('to')} sig=${url.searchParams.get('sig')}`
}

describe('a young free site’s outside links go through the notice', () => {
  it('Button — the element both phishing pages were built from', () => {
    const { container } = renderOn(
      <LinkableButton href={HARVESTER}>{'Open the document'}</LinkableButton>,
    )
    expect(notice(hrefOf(container))).toBe(
      `/_aglyn/leaving to=${HARVESTER} sig=signed`,
    )
  })

  it('Screen Link, opening in a new tab, keeps the referrer the notice reads', () => {
    const { container } = renderOn(
      <ScreenLink target="_blank" href={HARVESTER}>
        {'Docs'}
      </ScreenLink>,
    )
    const anchor = container.querySelector('a') as HTMLElement
    expect(notice(anchor.getAttribute('href'))).toBe(
      `/_aglyn/leaving to=${HARVESTER} sig=signed`,
    )
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener')
  })

  it('Link Box', () => {
    const { container } = renderOn(
      <LinkBox href={HARVESTER}>{'Card'}</LinkBox>,
    )
    expect(notice(hrefOf(container))).toBe(
      `/_aglyn/leaving to=${HARVESTER} sig=signed`,
    )
  })
})

describe('what the notice never touches', () => {
  it('a link to one of the site’s own pages', () => {
    const { container } = renderOn(
      <ScreenLink screenId="pricing">{'Pricing'}</ScreenLink>,
    )
    expect(hrefOf(container)).toBe('/pricing')
  })

  it('a link to the site’s custom domain, or to the platform', () => {
    const own = renderOn(
      <ScreenLink href="https://juenes.example.com/shop">{'Shop'}</ScreenLink>,
    )
    expect(hrefOf(own.container)).toBe('https://juenes.example.com/shop')
    const platform = renderOn(
      <ScreenLink href="https://docs.aglyn.com/x">{'Docs'}</ScreenLink>,
    )
    expect(hrefOf(platform.container)).toBe('https://docs.aglyn.com/x')
  })

  it('mailto: and tel:', () => {
    const mail = renderOn(<ScreenLink href="mailto:a@example.org">{'Mail'}</ScreenLink>)
    expect(hrefOf(mail.container)).toBe('mailto:a@example.org')
    const phone = renderOn(<LinkableButton href="tel:+15125550100">{'Call'}</LinkableButton>)
    expect(hrefOf(phone.container)).toBe('tel:+15125550100')
  })

  it('anything at all on a paid or older site, which carries no config', () => {
    const { container } = renderOn(
      <LinkableButton href={HARVESTER}>{'Open'}</LinkableButton>,
      false,
    )
    expect(hrefOf(container)).toBe(HARVESTER)
  })
})
