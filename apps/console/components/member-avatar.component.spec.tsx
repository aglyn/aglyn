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

/**
 * How much room a chip actually OCCUPIES on screen, in px across.
 *
 * `width` plus the ring on both sides. Derived from the CSSOM rather than from
 * `getBoundingClientRect`, and that is the whole point: `outline` does NOT
 * participate in layout, so a ringed and an unringed chip have IDENTICAL
 * bounding boxes — measured in the browser, 28x28 for both while one painted
 * 32px and the other 28px. A test that compared boxes would have been green on
 * the build Zach was looking at when he said they were different sizes.
 */
/** `paintedExtent` for one already-selected chip, for whole-row assertions. */
function paintedExtentOf(chip: HTMLElement): number {
  const classes = [...chip.classList]
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
  const css = rules.join(' ')
  const width = /[;{\s]width:\s*(\d+(?:\.\d+)?)px/.exec(css)
  const ring = /[;{\s]outline:\s*(\d+(?:\.\d+)?)px\s+([a-z]+)/.exec(css)
  const ringWidth = ring && ring[2] !== 'none' ? Number(ring[1]) : 0
  return Number(width?.[1] ?? 0) + 2 * ringWidth
}

function paintedExtent(container: HTMLElement, selector = '.MuiAvatar-root'): number {
  const css = cssFor(container, selector)
  const width = /[;{\s]width:\s*(\d+(?:\.\d+)?)px/.exec(css)
  const ring = /[;{\s]outline:\s*(\d+(?:\.\d+)?)px\s+([a-z]+)/.exec(css)
  const ringWidth = ring && ring[2] !== 'none' ? Number(ring[1]) : 0
  return Number(width?.[1] ?? 0) + 2 * ringWidth
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

  it('rings an INITIALS avatar too, so the row is not lumpy (AGL-2486)', () => {
    // This REPLACES an earlier assertion that an initials chip is left
    // unringed. That reasoning — the background already carries the colour, so
    // a same-colour ring adds no information — was correct and incomplete.
    // Zach: "I know we are using the background color on the avatars with no
    // picture, but it should still have a border, because now they are
    // different sizes." A ring is geometry as well as information.
    const { container } = render(
      <MemberAvatar colour="#9334e6" name="Ada Lovelace" />,
    )
    expect(cssFor(container)).toMatch(/outline-color/)
  })

  it('gives a photo chip and an initials chip the SAME painted size', () => {
    // Zach's acceptance test, stated as he stated it: every chip in the stack
    // occupies the same space. Asserted on painted extent, because the
    // bounding boxes are equal either way — see `paintedExtent`.
    const photo = render(
      <MemberAvatar
        photoURL="https://lh3.googleusercontent.com/a/ada"
        colour="#9334e6"
        name="Ada Lovelace"
      />,
    )
    const initials = render(
      <MemberAvatar colour="#188038" name="Grace Hopper" />,
    )
    expect(paintedExtent(initials.container)).toBe(
      paintedExtent(photo.container),
    )
    // And neither is zero, or the assertion above would hold vacuously if the
    // stylesheet were never read.
    expect(paintedExtent(photo.container)).toBeGreaterThan(0)
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
 * TWO signals mark your own session, and that is deliberate (AGL-2486).
 *
 * A self chip carries BOTH a dashed ring in its session colour AND the monitor
 * badge in the corner. That looks like redundancy to remove, and it was
 * removed once — this docblock exists so the next person does not remove it
 * again.
 *
 * The ring is dashed because the CANVAS is. `collaborator-overlays` draws a
 * dashed outline around whatever your other session has selected, from the
 * same `entry.colour`. Zach: "go ahead and go back to the dashed border on the
 * avatars when it is you in the other tabs so it matches what appears in the
 * canvas." So the two signals are not redundant with each other — they are one
 * statement made consistently across two SURFACES. Making the chip solid did
 * not delete a duplicate; it made the app contradict itself.
 *
 * The badge stays because the ring cannot always be read: on an initials chip
 * the ring is the same colour as the fill, so dashed-versus-solid is not
 * legible there and the badge is the only signal left.
 *
 * Both are therefore asserted. Dropping either one fails here.
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

  it('gives EVERY chip in a stack the same painted size, overflow included', () => {
    // Zach's acceptance test in his own terms: "they are different sizes".
    // Over the whole rendered row, not one component in isolation — the `+N`
    // overflow chip is not a `MemberAvatar`, so fixing that component left it
    // 4px smaller than everything beside it. That gap was found by measuring
    // the live stack, and this is what would have found it here.
    const many = Array.from({ length: 9 }, (unused, index) =>
      entry({
        uid: `u${index}`,
        sessionId: `s${index}`,
        key: `u${index}:s${index}`,
        colour: index % 2 ? '#188038' : '#9334e6',
        // A mixed row: some sessions have a picture, some do not — and some
        // are YOURS, so they ring dashed. Dashed is included here rather than
        // exempted, because the form must not change the painted extent: both
        // are 2px, and `outline` takes no layout room either way.
        isSelf: index % 4 === 0,
        photoURL: index % 3 === 0 ? 'https://lh3.googleusercontent.com/a/x' : undefined,
      }),
    )
    const { container } = render(<PresenceAvatars presence={state(many)} />)
    const chips = [...container.querySelectorAll('.MuiAvatar-root')]
    // The row must actually have overflowed, or this asserts nothing.
    expect(
      container.querySelectorAll('[data-aglyn-presence-overflow]'),
    ).toHaveLength(1)
    expect(chips.length).toBeGreaterThan(2)
    const sizes = new Set(
      chips.map((chip) => paintedExtentOf(chip as HTMLElement)),
    )
    expect([...sizes]).toHaveLength(1)
    expect([...sizes][0]).toBeGreaterThan(0)
  })

  it('draws your own session DASHED, matching the canvas outline', () => {
    // Asserted against the CSSOM — the markup carries only the generated
    // class name, so an `innerHTML` check passes against a build that is
    // drawing something else entirely.
    const { container } = render(
      <PresenceAvatars
        presence={state([
          entry({ isSelf: true, key: 'u1:mine', photoURL: 'https://x/y.png' }),
        ])}
      />,
    )
    expect(cssFor(container)).toMatch(/outline:\s*2px dashed/)
  })

  it('draws a colleague SOLID, so dashed keeps meaning one thing', () => {
    const { container } = render(
      <PresenceAvatars
        presence={state([
          entry({ isSelf: false, key: 'u2:s2', photoURL: 'https://x/z.png' }),
        ])}
      />,
    )
    expect(cssFor(container)).toMatch(/outline:\s*2px solid/)
    expect(cssFor(container)).not.toMatch(/dashed/)
  })

  it('keeps the ring in the SESSION colour, dashed or solid', () => {
    // The form varies; the colour never does. A dashed ring in some other
    // colour is the first version of this that Zach rejected.
    const mine = render(
      <PresenceAvatars
        presence={state([entry({ isSelf: true, colour: '#9334e6' })])}
      />,
    )
    expect(cssFor(mine.container)).toMatch(/outline-color:\s*#9334e6/)
  })
})
