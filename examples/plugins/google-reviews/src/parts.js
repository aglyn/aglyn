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
 *
 * Both take their values as ordinary attributes, so the presets bind them to
 * `{{item.stars}}`, `{{item.reviewer}}` and the like. Their root takes every
 * prop the renderer adds (`ref`, `data-aglyn`, `className`, `sx`), and the
 * author's styles come after the element's own, so the Styles panel wins:
 * color, size, background, border and spacing all reach them.
 */

import { createElement as h } from 'react'
import Box from '@mui/material/Box'
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
