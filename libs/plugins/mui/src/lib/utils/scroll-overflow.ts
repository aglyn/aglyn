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
 * The house treatment for a box that scrolls its own content (AGL-1162,
 * AGL-2568).
 *
 * It lives here rather than in the two components that need it because the
 * Markdown table and the Table element are the same block drawn by different
 * code, and they had already drifted: one carried a fade the other did not,
 * and neither could actually scroll. A shared shape is what keeps the answer
 * to "how wide may this get" from being decided twice.
 */

/** The axis a box scrolls on, named as the `scroll()` timeline names it. */
export type ScrollOverflowAxis = 'block' | 'inline'

/** How much of the trailing edge the fade covers. */
const FADE_EXTENT = '28px'

const FADE_DIRECTION: Record<ScrollOverflowAxis, string> = {
  block: 'to bottom',
  inline: 'to right',
}

const fadeName = (axis: ScrollOverflowAxis) => `aglyn-overflow-fade-${axis}`

/**
 * The fade's animation binding, for the rules of the scrolling box itself.
 *
 * It rides a scroll-driven animation on purpose: a `scroll()` timeline on a
 * box with nothing to scroll is INACTIVE, so its animation applies no styles
 * at all. That is the only way to say "fade only when overflowing" in CSS
 * with no measuring and no JavaScript, and it degrades to plain
 * unfaded-but-scrollable in a browser that lacks it.
 */
export const scrollOverflowFadeTimeline = (axis: ScrollOverflowAxis) => ({
  '@supports (animation-timeline: scroll())': {
    animation: `${fadeName(axis)} linear`,
    animationTimeline: `scroll(self ${axis})`,
  },
})

/**
 * The keyframes {@link scrollOverflowFadeTimeline} names.
 *
 * Held at the fade until the box is all but scrolled out, then dropped, so
 * the last row or column is never the one the affordance obscures. `none`
 * does not interpolate with a gradient, so that last step is a clean switch.
 */
export const scrollOverflowFadeKeyframes = (axis: ScrollOverflowAxis) => ({
  [`@keyframes ${fadeName(axis)}`]: {
    '0%, 92%': {
      maskImage: `linear-gradient(${FADE_DIRECTION[axis]}, #000 calc(100% - ${FADE_EXTENT}), transparent)`,
    },
    '100%': { maskImage: 'none' },
  },
})

/**
 * The widest a table is allowed to grow before it starts wrapping again.
 *
 * 560 rather than the natural width of the content: measured on
 * `/alternatives/alternativeswebflow` at 375px, letting the table take its
 * full `max-content` width came to 1010px — every cell on one line, but two
 * thirds of the table off-screen and the row label lost as soon as the reader
 * moves. Capped at 560 the same table is 658px tall instead of 1022 and its
 * worst cell is 3 lines instead of 6, for 217px of sideways travel. Under the
 * `sm` breakpoint on purpose, so the cap itself can never introduce a
 * scrollbar on a tablet or a desktop.
 */
export const TABLE_SCROLL_MAX_WIDTH = 560

/**
 * The sizing that lets a wide table overflow its wrapper — and leaves a
 * narrow one exactly as it was.
 *
 * `width: 100%` was the bug: a table that can never exceed its wrapper never
 * triggers the wrapper's `overflow-x`, so the browser compresses columns to
 * min-content instead of scrolling. `max-content` asks for the width the
 * content actually wants; `min-width: 100%` still fills the wrapper when the
 * content wants less, which is why a short "Yes / No" grid keeps its present
 * layout and gains no scrollbar. `min-width` beats `max-width` in the CSS
 * used-width rules, so the cap applies only while the wrapper is narrower
 * than it — a desktop table fills its container as before.
 */
export const scrollableTableSx = {
  width: 'max-content',
  minWidth: '100%',
  maxWidth: TABLE_SCROLL_MAX_WIDTH,
} as const

/** The scroll box around such a table: it scrolls, and it says that it does. */
export const scrollableTableWrapperSx = {
  overflowX: 'auto',
  ...scrollOverflowFadeTimeline('inline'),
  ...scrollOverflowFadeKeyframes('inline'),
}

/**
 * What makes the scroll box reachable by keyboard and findable by a screen
 * reader (WCAG 2.1.1).
 *
 * A scrollable region with no focusable descendant cannot be scrolled by
 * keyboard at all — the arrow keys move the page behind it — so the box takes
 * a tab stop of its own. `region` plus a name is what turns that tab stop
 * into something announced rather than a silent landing spot.
 */
export const scrollRegionProps = (label: string) => ({
  tabIndex: 0,
  role: 'region',
  'aria-label': label,
})
