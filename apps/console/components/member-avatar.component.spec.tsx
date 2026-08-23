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
import PresenceAvatars from './presence-avatars.component'
import type { PresenceEntry, PresenceState } from '../hooks/use-presence'

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

/**
 * Emotion inserts its rules with `insertRule` under jest, so reading a
 * `<style>` element's `textContent` returns `''` and every style assertion
 * would pass for the wrong reason. Read the CSSOM instead.
 *
 * Module scope, and shared, because that trap caught this file twice: an
 * assertion written against `container.innerHTML` went green against the very
 * build it was meant to fail, since the markup holds only the generated class
 * NAME and the declaration lives in the sheet.
 */
const cssFor = (container: HTMLElement, selector = '.MuiAvatar-root'): string => {
  const el = container.querySelector(selector) as HTMLElement
  if (!el) return ''
  const classes = [...el.classList]
  const rules: string[] = []
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList
    try {
      list = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of [...(list as any)] as CSSStyleRule[]) {
      if (classes.some((c) => rule.selectorText?.includes(`.${c}`))) {
        rules.push(rule.cssText)
      }
    }
  }
  return rules.join(' ')
}

describe('MemberAvatar (AGL-1683)', () => {
  it('makes no request at all for a member with only an email', () => {
    const { container } = render(
      <MemberAvatar email="ada@example.com" name="Ada Lovelace" />,
    )
    expect(fetchedUrls(container)).toEqual([])
  })

  it('never puts the email — or a hash of it — anywhere in the markup', () => {
    const { container } = render(
      <MemberAvatar email="ada@example.com" name="Ada Lovelace" />,
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
      <MemberAvatar email="ada@example.com" name="Ada Lovelace" />,
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
        name="Ada Lovelace"
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

  it('rings a PHOTO avatar in the identity colour (AGL-2486)', () => {
    // A photo covers the background completely, so on exactly the sessions
    // that have a picture the one signal tying the avatar to its cursor and
    // its selection box was invisible. Zach: "right now only those without an
    // image can you tell because it uses the background."
    const { container } = render(
      <MemberAvatar
        photoURL="https://lh3.googleusercontent.com/a/ada"
        colour="#9334e6"
        name="Ada Lovelace"
      />,
    )
    const css = cssFor(container)
    expect(css).toContain('#9334e6')
    expect(css).toMatch(/outline/)
  })

  it('leaves an INITIALS avatar unringed — the background already says it', () => {
    // Two indicators of one fact is noise, and the ring is drawn outside the
    // circle where it costs layout room in an overlapping stack.
    const { container } = render(
      <MemberAvatar colour="#9334e6" name="Ada Lovelace" />,
    )
    expect(cssFor(container)).not.toMatch(/outline-color/)
  })

  it('does not ring a photo whose colour was only SEEDED', () => {
    // A member list seeds a colour off the email purely so two rows differ.
    // Ringing those asserts a correspondence to something not on screen —
    // only an explicitly passed `colour` means "this matches the cursor".
    const { container } = render(
      <MemberAvatar
        photoURL="https://lh3.googleusercontent.com/a/ada"
        email="ada@example.com"
        name="Ada Lovelace"
      />,
    )
    expect(cssFor(container)).not.toMatch(/outline-color/)
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

/**
 * ONE ring style, and the badge is what says "this is you" (AGL-2486).
 *
 * Zach objected to the self chip's dashed border three times: first when it
 * was dashed and warning-orange, then when it was dashed in the session's own
 * colour. Both were the same mistake — a second visual language for something
 * the monitor badge in the corner already carries by itself, and the only
 * thing making one chip look unlike its neighbours.
 *
 * The property worth pinning is not "the ring is solid" for its own sake; it
 * is that a self chip is still DISTINGUISHABLE. That job moved to the badge,
 * so the badge is what these assert. A future change that drops the badge and
 * leans on the ring again fails here.
 */
describe('a presence chip distinguishes your own session (AGL-2486)', () => {
  const entry = (over: Partial<PresenceEntry> = {}): PresenceEntry =>
    ({
      uid: 'u1',
      sessionId: 's1',
      key: 'u1:s1',
      displayName: 'Zach Gover',
      colour: '#1a73e8',
      lastSeenAt: Date.now(),
      ...over,
    }) as PresenceEntry

  const state = (entries: PresenceEntry[]) =>
    ({
      entries,
      people: [],
      status: 'live',
      fault: null,
      ownOtherSessions: 0,
      session: null,
    }) as unknown as PresenceState

  it('marks your own session with the badge', () => {
    const { container } = render(
      <PresenceAvatars presence={state([entry({ isSelf: true })])} />,
    )
    expect(
      container.querySelectorAll('[data-aglyn-presence-self-badge]'),
    ).toHaveLength(1)
  })

  it('gives a colleague no badge', () => {
    const { container } = render(
      <PresenceAvatars presence={state([entry({ isSelf: false })])} />,
    )
    expect(
      container.querySelectorAll('[data-aglyn-presence-self-badge]'),
    ).toHaveLength(0)
  })

  it('draws NO dashed ring on any chip, your own included', () => {
    // The literal thing Zach kept seeing, asserted against the CSSOM — the
    // markup carries only the generated class name, so an `innerHTML` check
    // passes against a build that is still drawing it.
    const { container } = render(
      <PresenceAvatars
        presence={state([
          entry({ isSelf: true, key: 'u1:mine', photoURL: 'https://x/y.png' }),
        ])}
      />,
    )
    expect(cssFor(container)).toMatch(/outline:\s*2px solid/)
    expect(cssFor(container)).not.toMatch(/dashed/)
  })
})
