/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The "Google reviews" site element.
 *
 * It draws the site's own Google Business Profile reviews from the record the
 * platform syncs for the `google` connection, and nothing else: no record, or
 * no review that passes the element's settings, and a published page gets no
 * element at all. Only the Besigner canvas draws a line in its place, so the
 * author can still see and select what they placed.
 *
 * Everything is drawn with the site's MUI from the host, so the cards, type,
 * colors and dark mode are the site theme's. Colors are theme tokens only.
 * The page renders it on the server (the record arrives with the page), so it
 * reads no clock, no locale and no window while rendering.
 */

import { createElement as h, useContext, useId, useState } from 'react'
import { ScreenLinkContext, usePluginConnectionRecord } from '@aglyn/aglyn'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import SvgIcon from '@mui/material/SvgIcon'
import Typography from '@mui/material/Typography'
import {
  CONNECTION_ID,
  formatRating,
  formatReviewCount,
  formatReviewDate,
  initialsOf,
  needsMore,
  normalizeSettings,
  photoAllowed,
  selectReviews,
  starFill,
  starsLabel,
  summaryOf,
} from './reviews.js'

/** Material Design Icons `star` and `star-outline` (Apache-2.0). */
const STAR = 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z'
const STAR_OUTLINE =
  'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z'

/** Element props the element reads; everything else goes to its root. */
const SETTING_PROPS = ['count', 'minStars', 'layout', 'reviewerImage', 'showSummary', 'showReplies']

/**
 * Five stars, each filled as far as `value` reaches, read out as one image:
 * "Rated 4.6 out of 5 stars".
 */
function Stars({ value, fontSize }) {
  return h(
    Box,
    {
      role: 'img',
      'aria-label': starsLabel(value),
      sx: { display: 'inline-flex', alignItems: 'center', lineHeight: 0, color: 'warning.main' },
    },
    starFill(value).map((fill, index) =>
      h(
        Box,
        { key: index, 'aria-hidden': true, sx: { position: 'relative', display: 'inline-flex' } },
        h(SvgIcon, { fontSize, sx: { color: 'action.disabled' } }, h('path', { d: STAR_OUTLINE })),
        fill > 0
          ? h(
              Box,
              {
                'data-star-fill': fill,
                sx: { position: 'absolute', inset: 0, width: `${fill}%`, overflow: 'hidden', display: 'inline-flex' },
              },
              h(SvgIcon, { fontSize, sx: { color: 'inherit', flex: 'none' } }, h('path', { d: STAR })),
            )
          : null,
      ),
    ),
  )
}

/** The reviewer's Google photo when allowed, otherwise their initials. */
function ReviewerImage({ review, settings }) {
  const size = 40
  if (photoAllowed(review, settings)) {
    return h(Box, {
      component: 'img',
      src: review.photo,
      alt: '',
      width: size,
      height: size,
      loading: 'lazy',
      referrerPolicy: 'no-referrer',
      'data-reviewer-image': 'photo',
      sx: { width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' },
    })
  }
  return h(
    Box,
    {
      'aria-hidden': true,
      'data-reviewer-image': 'initials',
      sx: {
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        typography: 'subtitle2',
      },
    },
    initialsOf(review.reviewer),
  )
}

/** Clamped to `lines` until "More" opens it; the whole text is always in the HTML. */
const clamp = (lines, open) =>
  open
    ? { whiteSpace: 'pre-line', overflowWrap: 'anywhere' }
    : {
        whiteSpace: 'pre-line',
        overflowWrap: 'anywhere',
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: String(lines),
        overflow: 'hidden',
      }

function ReviewCard({ review, settings, carousel }) {
  const [open, setOpen] = useState(false)
  const textId = useId()
  const date = formatReviewDate(review.createdAt)
  const more = needsMore(review)
  const reply = settings.showReplies ? review.reply : null
  return h(
    Box,
    {
      component: 'li',
      sx: carousel
        ? { flex: '0 0 min(85%, 340px)', scrollSnapAlign: 'start', display: 'flex' }
        : { display: 'flex' },
    },
    h(
      Card,
      { variant: 'outlined', sx: { width: '100%' } },
      h(
        CardContent,
        null,
        h(
          Stack,
          { spacing: 1.25 },
          h(
            Stack,
            { direction: 'row', spacing: 1.5, sx: { alignItems: 'center' } },
            h(ReviewerImage, { review, settings }),
            h(
              Box,
              { sx: { minWidth: 0 } },
              h(Typography, { variant: 'subtitle2', component: 'p', noWrap: true }, review.reviewer),
              date
                ? h(
                    Typography,
                    { variant: 'caption', color: 'text.secondary', component: 'time', dateTime: date.iso },
                    date.label,
                  )
                : null,
            ),
          ),
          h(Stars, { value: review.stars, fontSize: 'small' }),
          review.comment
            ? h(
                Typography,
                { id: textId, variant: 'body2', component: 'p', sx: clamp(5, open) },
                review.comment,
              )
            : null,
          reply
            ? h(
                Box,
                { sx: { borderLeft: 2, borderColor: 'divider', pl: 1.5 } },
                h(Typography, { variant: 'caption', color: 'text.secondary', component: 'p' }, 'Response from the owner'),
                h(Typography, { variant: 'body2', component: 'p', sx: clamp(3, open) }, reply),
              )
            : null,
          more
            ? h(
                Button,
                {
                  size: 'small',
                  variant: 'text',
                  'aria-expanded': open,
                  'aria-controls': review.comment ? textId : undefined,
                  onClick: () => setOpen((value) => !value),
                  sx: { alignSelf: 'flex-start', px: 0, minWidth: 0 },
                },
                open ? 'Less' : 'More',
              )
            : null,
        ),
      ),
    ),
  )
}

function Summary({ summary }) {
  return h(
    Stack,
    { direction: 'row', spacing: 1.5, sx: { alignItems: 'center', flexWrap: 'wrap', rowGap: 1 } },
    h(Typography, { variant: 'h4', component: 'p', 'data-summary-rating': true }, formatRating(summary.rating)),
    h(Stars, { value: summary.rating, fontSize: 'medium' }),
    summary.reviewCount !== null
      ? h(
          Typography,
          { variant: 'body2', color: 'text.secondary', component: 'p' },
          `${formatReviewCount(summary.reviewCount)} on Google`,
        )
      : null,
  )
}

const LIST_SX = {
  grid: {
    display: 'grid',
    gap: 2,
    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
  },
  list: { display: 'flex', flexDirection: 'column', gap: 2 },
  carousel: {
    display: 'flex',
    gap: 2,
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
    overscrollBehaviorX: 'contain',
    pb: 1,
  },
}

/** A line only the Besigner canvas shows, addressed to the author. */
function AuthorNote({ rest, children }) {
  return h(
    Box,
    rest,
    h(Typography, { variant: 'body2', color: 'text.secondary', component: 'p' }, children),
  )
}

/**
 * The element. Every prop that is not one of its settings (the renderer's
 * `ref`, `data-aglyn`, `className`, `sx`) goes to its root, so the canvas can
 * select it and the Besigner's styles reach it; React 19 hands `ref` over as
 * a prop.
 */
function GoogleReviews(props) {
  const rest = {}
  for (const [key, value] of Object.entries(props)) {
    if (!SETTING_PROPS.includes(key)) rest[key] = value
  }
  const settings = normalizeSettings(props)
  const { editorInert } = useContext(ScreenLinkContext)
  const record = usePluginConnectionRecord(CONNECTION_ID)
  const reviews = record ? selectReviews(record, settings) : []

  if (!reviews.length) {
    if (!editorInert) return null
    return h(
      AuthorNote,
      { rest },
      record
        ? 'Google reviews: no review matches these settings yet. Lower the minimum stars to show more.'
        : 'Google reviews: your reviews show here once this site is connected to your Google Business Profile.',
    )
  }

  const summary = summaryOf(record)
  const carousel = settings.layout === 'carousel'
  return h(
    Box,
    { component: 'section', 'aria-label': 'Google reviews', ...rest },
    h(
      Stack,
      { spacing: 2.5 },
      settings.showSummary && summary.rating !== null ? h(Summary, { summary }) : null,
      h(
        Box,
        {
          component: 'ul',
          'data-layout': settings.layout,
          // A row that scrolls sideways can be scrolled from the keyboard.
          ...(carousel ? { tabIndex: 0, 'aria-label': 'Reviews, scroll sideways for more' } : {}),
          sx: { listStyle: 'none', m: 0, p: 0, ...LIST_SX[settings.layout] },
        },
        reviews.map((review, index) => h(ReviewCard, { key: index, review, settings, carousel })),
      ),
      h(
        Stack,
        {
          direction: 'row',
          spacing: 2,
          sx: { alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 },
        },
        // Says where the reviews come from.
        h(Typography, { variant: 'caption', color: 'text.secondary', component: 'p' }, 'Reviews from Google'),
        summary.reviewUrl
          ? h(
              Link,
              { href: summary.reviewUrl, target: '_blank', rel: 'noopener noreferrer', variant: 'body2' },
              'Review us on Google',
            )
          : null,
      ),
    ),
  )
}
GoogleReviews.displayName = 'AglynGoogleReviews'

export default GoogleReviews
