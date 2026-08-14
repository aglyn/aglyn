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
 * AGL-1683: a member's avatar must not tell anybody outside Aglyn who is on
 * the team.
 *
 * `MemberAvatar` used to fall back to `gravatarUrlFromEmail(email)`, so an
 * org admin opening the members list emitted one gravatar.com request per
 * colleague — an MD5 of each person's email address, plus the admin's IP and
 * a `Referer` naming the console. An email MD5 is a lookup key, not an
 * anonymisation, and the people whose addresses left are third parties who
 * were never asked.
 *
 * The assertion is deliberately about the DOM rather than about the absence
 * of one host string: the guard has to hold for the next vendor too, so what
 * it forbids is any element in a member row that makes the browser fetch from
 * somewhere that is not the member's own stored photo. `d=404` on the old URL
 * meant the response was a 404 — the REQUEST is the finding, which is why
 * this looks at `src` and not at whether an image rendered.
 */

import { render } from '@testing-library/react'
import MemberAvatar, { memberInitials } from './member-avatar.component'

/** Everything the browser would go and fetch, whatever the element. */
function fetchedUrls(container: HTMLElement): string[] {
  const urls: string[] = []
  container
    .querySelectorAll('[src], [srcset], [href], [data-src], [style*="url("]')
    .forEach((element) => {
      const el = element as HTMLElement
      for (const attribute of ['src', 'srcset', 'href', 'data-src']) {
        const value = el.getAttribute(attribute)
        if (value) urls.push(value)
      }
      const background = el.style?.backgroundImage
      if (background && background !== 'none') urls.push(background)
    })
  return urls
}

const isRemote = (url: string) => /^(https?:)?\/\//i.test(url)

describe('MemberAvatar (AGL-1683)', () => {
  it('makes no request at all for a member with only an email', () => {
    const { container } = render(
      <MemberAvatar email="ada@example.com" displayName="Ada Lovelace" />,
    )
    expect(fetchedUrls(container)).toEqual([])
  })

  it('never puts the email — or a hash of it — anywhere in the markup', () => {
    const { container } = render(
      <MemberAvatar email="ada@example.com" displayName="Ada Lovelace" />,
    )
    const markup = container.innerHTML
    expect(markup).not.toContain('gravatar')
    // The MD5 the old code sent for this address. Present in no form.
    expect(markup.toLowerCase()).not.toContain(
      '3e3417d7ef77d5932a6734b916515ed5',
    )
    expect(markup).not.toMatch(/[0-9a-f]{32}/i)
  })

  it('draws the member initials instead', () => {
    const { container } = render(
      <MemberAvatar email="ada@example.com" displayName="Ada Lovelace" />,
    )
    expect(container.textContent).toBe('AL')
  })

  it('falls back to the email local part for an invited row', () => {
    // An invite has no account and therefore no display name; "@" is not an
    // initial, so the letter has to come from before it.
    const { container } = render(<MemberAvatar email="ada@example.com" />)
    expect(container.textContent).toBe('A')
    expect(fetchedUrls(container)).toEqual([])
  })

  it('still renders the stored photo, which is the whole point of having one', () => {
    const photo = 'https://lh3.googleusercontent.com/a/ada=s96-c'
    const { container } = render(
      <MemberAvatar
        photoURL={photo}
        email="ada@example.com"
        displayName="Ada Lovelace"
      />,
    )
    const fetched = fetchedUrls(container)
    expect(fetched).toEqual([photo])
    // The one remote URL in the row is the one the member chose to publish.
    expect(fetched.filter(isRemote)).toEqual([photo])
  })

  it('sends no referrer with the photo it does load', () => {
    // Google's CDN 403s a request that leaks the console referrer, and the
    // console URL names the org either way.
    const { container } = render(
      <MemberAvatar photoURL="https://lh3.googleusercontent.com/a/ada" />,
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('treats a blank photoURL as no photo rather than as an empty src', () => {
    const { container } = render(
      <MemberAvatar photoURL="   " email="ada@example.com" />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(fetchedUrls(container)).toEqual([])
  })
})

describe('memberInitials', () => {
  it('takes one letter from each of the two name fields', () => {
    expect(memberInitials('Ada Lovelace', 'ada@example.com')).toBe('AL')
  })

  it('gives a single-word name one letter rather than guessing a second', () => {
    expect(memberInitials('Prince', 'p@example.com')).toBe('P')
  })

  it('follows splitDisplayName, so a multi-word family name is one initial', () => {
    expect(memberInitials('Ada Lovelace King', null)).toBe('AL')
  })

  it('reads the local part of an email when there is no name', () => {
    expect(memberInitials(null, 'ada@example.com')).toBe('A')
  })

  it('has something to draw even with nothing to draw it from', () => {
    expect(memberInitials(null, null)).toBe('?')
    expect(memberInitials('   ', '   ')).toBe('?')
  })
})
