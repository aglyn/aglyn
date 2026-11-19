/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two small elements the composable Google reviews presets are built
 * around (AGL-4212). Everything else in those presets is the site's own
 * elements (Stack, Card, Typography, Screen Link) repeating over the
 * connection's record, so an author selects and styles each part like any
 * other element. These two exist only because the site has no element that
 * draws them:
 *
 * - Stars: five stars, each filled as far as the value reaches, read out as
 *   one image ("Rated 4.6 out of 5 stars").
 * - Reviewer image: the reviewer's Google photo when the author chose photos
 *   and the page may load it, otherwise their initials.
 * - Review text: what the reviewer wrote, cut to a few lines with an ellipsis
 *   and a "Continue reading" link only when it was cut, so every card in a
 *   row is the same height.
 *
 * Both take their values as ordinary attributes, so the presets bind them to
 * `{{item.stars}}`, `{{item.reviewer}}` and the like. Their root takes every
 * prop the renderer adds (`ref`, `data-aglyn`, `className`, `sx`), and the
 * author's styles come after the element's own, so the Styles panel wins:
 * color, size, background, border and spacing all reach them.
 */

import { createElement as h, useEffect, useId, useLayoutEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import SvgIcon from '@mui/material/SvgIcon'
import { initialsOf, photoAllowed, starFill, starsLabel } from './reviews.js'

/** Material Design Icons `star` and `star-outline` (Apache-2.0). */
const STAR = 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z'
const STAR_OUTLINE =
  'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z'

/** The element's own styles first, the author's after them. */
export const withAuthorSx = (own, sx) => [own, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]

/** Splits the element's own attributes from what goes to its root. */
const split = (props, names) => {
  const own = {}
  const rest = {}
  for (const [key, value] of Object.entries(props || {})) {
    if (names.includes(key)) own[key] = value
    else rest[key] = value
  }
  return [own, rest]
}

/**
 * A value between 0 and 5 from whatever the attribute holds: a number, the
 * string a token printed, or an unfilled `{{item.stars}}` on the canvas
 * (which draws five empty stars).
 */
export function starValue(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) return 0
  return Math.min(5, Math.max(0, parsed))
}

const STAR_SIZES = { small: '1.25rem', medium: '1.5rem', large: '2rem' }

/** Five stars, as one image. Persisted id: `aglyn.google-reviews.stars`. */
export function Stars(props) {
  const [own, rest] = split(props, ['value', 'size'])
  const value = starValue(own.value)
  const { sx, ...root } = rest
  return h(
    Box,
    {
      role: 'img',
      'aria-label': starsLabel(value),
      ...root,
      sx: withAuthorSx(
        {
          display: 'inline-flex',
          alignItems: 'center',
          lineHeight: 0,
          color: 'warning.main',
          fontSize: STAR_SIZES[own.size] || STAR_SIZES.small,
        },
        sx,
      ),
    },
    starFill(value).map((fill, index) =>
      h(
        Box,
        { key: index, 'aria-hidden': true, sx: { position: 'relative', display: 'inline-flex' } },
        h(SvgIcon, { fontSize: 'inherit', sx: { color: 'action.disabled' } }, h('path', { d: STAR_OUTLINE })),
        fill > 0
          ? h(
              Box,
              {
                'data-star-fill': fill,
                sx: { position: 'absolute', inset: 0, width: `${fill}%`, overflow: 'hidden', display: 'inline-flex' },
              },
              h(SvgIcon, { fontSize: 'inherit', sx: { color: 'inherit', flex: 'none' } }, h('path', { d: STAR })),
            )
          : null,
      ),
    ),
  )
}
Stars.displayName = 'AglynGoogleReviewStars'

/** A switch bound to a token prints `true`/`false` as text. */
const yes = (value) => value === true || value === 'true'

/**
 * The reviewer's photo or initials. Persisted id:
 * `aglyn.google-reviews.reviewer-image`.
 */
export function ReviewerImage(props) {
  const [own, rest] = split(props, ['name', 'photo', 'anonymous', 'show'])
  const { sx, ...root } = rest
  const review = {
    photo: typeof own.photo === 'string' && own.photo.trim() ? own.photo.trim() : null,
    anonymous: yes(own.anonymous),
  }
  const base = { width: 40, height: 40, borderRadius: '50%', flex: 'none' }
  if (photoAllowed(review, { reviewerImage: own.show === 'photo' ? 'photo' : 'initials' })) {
    return h(Box, {
      component: 'img',
      src: review.photo,
      alt: '',
      loading: 'lazy',
      referrerPolicy: 'no-referrer',
      'data-reviewer-image': 'photo',
      ...root,
      sx: withAuthorSx({ ...base, objectFit: 'cover', display: 'block' }, sx),
    })
  }
  return h(
    Box,
    {
      'aria-hidden': true,
      'data-reviewer-image': 'initials',
      ...root,
      sx: withAuthorSx(
        {
          ...base,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          typography: 'subtitle2',
        },
        sx,
      ),
    },
    initialsOf(own.name),
  )
}
ReviewerImage.displayName = 'AglynGoogleReviewerImage'

/* ------------------------------------------------------------------ */
/* Review text                                                         */
/* ------------------------------------------------------------------ */

export const REVIEW_TEXT_DEFAULTS = Object.freeze({
  lines: 6,
  moreLabel: 'Continue reading',
  lessLabel: 'Show less',
})

/**
 * A whole number of lines, 1 to 20, from what the attribute holds (a number,
 * the text the Besigner stored, or nothing); anything else is the default.
 */
export function reviewTextLines(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed) || String(value ?? '').trim() === '') return REVIEW_TEXT_DEFAULTS.lines
  return Math.min(20, Math.max(1, Math.round(parsed)))
}

/** About how many characters a line of a review card holds. */
const CHARACTERS_PER_LINE = 45

/**
 * Whether `text` probably runs past `lines` lines. The page is drawn on the
 * server, where nothing can be measured, so this guess decides whether the
 * HTML carries the "Continue reading" link; the browser measures the real
 * text once it is on screen and corrects it.
 */
export function probablyCut(text, lines) {
  let used = 0
  for (const paragraph of String(text).split('\n')) {
    used += Math.max(1, Math.ceil(paragraph.length / CHARACTERS_PER_LINE))
    if (used > lines) return true
  }
  return false
}

/** A layout effect in the browser, where it runs before paint; none on the server. */
const useBrowserLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

const label = (value, fallback) => (typeof value === 'string' && value.trim() ? value : fallback)

/**
 * What a reviewer wrote, cut to `lines` lines with an ellipsis. "Continue
 * reading" shows only when the text was cut and opens it in place; it then
 * reads "Show less". The whole text is always in the HTML, for visitors'
 * screen readers and for search engines. Persisted id:
 * `aglyn.google-reviews.review-text`.
 */
export function ReviewText(props) {
  const [own, rest] = split(props, ['text', 'lines', 'moreLabel', 'lessLabel'])
  const { sx, ...root } = rest
  const text = typeof own.text === 'string' ? own.text.trim() : own.text == null ? '' : String(own.text).trim()
  const lines = reviewTextLines(own.lines)
  const textId = useId()
  // The paragraph, once it is on screen (a callback ref, so no ref is read while rendering).
  const [element, setElement] = useState(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(() => probablyCut(text, lines))

  // Measure the clamped text whenever it or its width changes. While it is
  // open there is nothing to measure, and the last answer stands.
  useBrowserLayoutEffect(() => {
    if (!element || open) return undefined
    const measure = () => setCut(element.scrollHeight - element.clientHeight > 1)
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, text, lines, open])

  // A review with nothing written draws nothing, not an empty line.
  if (!text) return null

  return h(
    Box,
    {
      'data-review-text': open ? 'open' : 'clamped',
      ...root,
      sx: withAuthorSx(
        { typography: 'body2', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 },
        sx,
      ),
    },
    h(
      Box,
      {
        component: 'p',
        id: textId,
        ref: setElement,
        sx: {
          m: 0,
          width: '100%',
          whiteSpace: 'pre-line',
          overflowWrap: 'anywhere',
          ...(open
            ? {}
            : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: String(lines), overflow: 'hidden' }),
        },
      },
      text,
    ),
    cut || open
      ? h(
          Link,
          {
            component: 'button',
            type: 'button',
            underline: 'hover',
            color: 'primary',
            'aria-expanded': open,
            'aria-controls': textId,
            onClick: () => setOpen((value) => !value),
            sx: { font: 'inherit', fontWeight: 600, textAlign: 'left', p: 0 },
          },
          open ? label(own.lessLabel, REVIEW_TEXT_DEFAULTS.lessLabel) : label(own.moreLabel, REVIEW_TEXT_DEFAULTS.moreLabel),
        )
      : null,
  )
}
ReviewText.displayName = 'AglynGoogleReviewText'
