/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the Elements panel places for Google reviews (AGL-4212): trees of the
 * site's own elements that repeat over this plugin's `google` connection, so
 * every part is an element the author selects, restyles, moves or deletes.
 *
 * - `repeatConnection: 'aglyn.google-reviews/google'` repeats over the
 *   reviews, newest first, with the usual limit and filter.
 * - `repeatConnection: 'aglyn.google-reviews/google/fields'` repeats once over
 *   the rating, review count and review link, or not at all before the first
 *   sync, so a summary never shows empty.
 *
 * Inside a repeat, `{{item.<field>}}` is the field the manifest's record
 * declares. A text or image whose whole value is an empty field drops out of
 * that copy, and `hideUnless` drops a whole block (the owner's reply).
 *
 * Styles go in each node's own `sx`, never `props.sx`: only `node.sx` is the
 * record the Styles panel edits. The built-in elements belong to the `mui`
 * plugin; Stars and Reviewer image are this bundle's.
 */

import { ComponentCategory, NodeType } from '@aglyn/aglyn'

/** Must match `BUNDLE_ID` in index.js. */
const BUNDLE_ID = 'aglyn.google-reviews'
const MUI = 'mui'

export const STARS_ID = 'aglyn.google-reviews.stars'
export const REVIEWER_IMAGE_ID = 'aglyn.google-reviews.reviewer-image'

/** The connection, as a repeat names it. Persisted in pages; never rename. */
export const REVIEWS_SOURCE = `${BUNDLE_ID}/google`
export const SUMMARY_SOURCE = `${BUNDLE_ID}/google/fields`

/** Material Design Icons (Apache-2.0) for the Elements panel. */
const ICONS = {
  reviews: 'M8.58,17.25L9.5,13.36L6.5,10.78L10.45,10.41L12,6.8L13.55,10.45L17.5,10.78L14.5,13.36L15.42,17.25L12,15.19L8.58,17.25M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4Z',
  star: 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z',
  cards: 'M3,11H11V3H3M3,21H11V13H3M13,21H21V13H13M13,3V11H21V3',
  list: 'M3,4H21V8H3V4M3,10H21V14H3V10M3,16H21V20H3V16Z',
  carousel: 'M7,19H17V4H7V19M2,17H6V6H2V17M18,6V17H22V6H18Z',
  link: 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z',
  person: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z',
}

const node = (componentId, props, extra = {}) => ({
  $id: null,
  componentId,
  pluginId: MUI,
  props,
  ...extra,
})

const text = (variant, children, extra = {}) => {
  const { sx, ...props } = extra
  return node('muiTypography', { variant, component: 'p', children, ...props }, sx ? { sx } : {})
}

const stars = (value, size = 'small') => ({
  $id: null,
  componentId: STARS_ID,
  pluginId: BUNDLE_ID,
  props: { value, size },
})

const reviewerImage = () => ({
  $id: null,
  componentId: REVIEWER_IMAGE_ID,
  pluginId: BUNDLE_ID,
  props: {
    name: '{{item.reviewer}}',
    photo: '{{item.photo}}',
    anonymous: '{{item.anonymous}}',
    show: 'initials',
  },
})

/**
 * The rating summary: "4.8 ★★★★★ 44 reviews on Google". A profile Google
 * gives no rating (no reviews yet) shows no summary at all, never empty stars
 * and "reviews on Google" without a number.
 */
export const summaryNode = () =>
  node(
    'muiStack',
    {
      direction: 'row',
      spacing: 1.5,
      repeatConnection: SUMMARY_SOURCE,
      repeatSelf: true,
      hideUnless: '{{item.rating}}',
    },
    {
      sx: { alignItems: 'center', flexWrap: 'wrap', rowGap: 1 },
      nodes: [
        text('h4', '{{item.rating}}'),
        stars('{{item.rating}}', 'medium'),
        text('body2', '{{item.reviewCount}} reviews on Google', { sx: { color: 'text.secondary' } }),
      ],
    },
  )

/** How the cards are laid out, as the list's own styles. */
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

/** One review: who, when, stars, what they wrote, and the owner's reply. */
const reviewCard = (layout) =>
  node(
    'muiCard',
    { variant: 'outlined', component: 'article' },
    {
      sx: layout === 'carousel' ? { flex: '0 0 min(85%, 340px)', scrollSnapAlign: 'start' } : { height: '100%' },
      nodes: [
        node(
          'muiCardContent',
          {},
          {
            nodes: [
              node(
                'muiStack',
                { spacing: 1.25 },
                {
                  nodes: [
                    node(
                      'muiStack',
                      { direction: 'row', spacing: 1.5 },
                      {
                        sx: { alignItems: 'center' },
                        nodes: [
                          reviewerImage(),
                          node(
                            'muiStack',
                            { spacing: 0 },
                            {
                              sx: { minWidth: 0 },
                              nodes: [
                                text('subtitle2', '{{item.reviewer}}'),
                                text('caption', '{{item.createdAt}}', { sx: { color: 'text.secondary' } }),
                              ],
                            },
                          ),
                        ],
                      },
                    ),
                    stars('{{item.stars}}'),
                    text('body2', '{{item.comment}}', { sx: { whiteSpace: 'pre-line', overflowWrap: 'anywhere' } }),
                    node(
                      'muiStack',
                      { spacing: 0.5, hideUnless: '{{item.reply}}' },
                      {
                        sx: { borderLeft: 2, borderColor: 'divider', pl: 1.5 },
                        nodes: [
                          text('caption', 'Response from the owner', { sx: { color: 'text.secondary' } }),
                          text('body2', '{{item.reply}}', { sx: { whiteSpace: 'pre-line', overflowWrap: 'anywhere' } }),
                        ],
                      },
                    ),
                  ],
                },
              ),
            ],
          },
        ),
      ],
    },
  )

/** The review cards: the list repeats its card once per review. */
export const cardsNode = (layout = 'grid') =>
  node(
    'muiBox',
    {
      repeatConnection: REVIEWS_SOURCE,
      repeatSelf: false,
      repeatLimit: 6,
      repeatFilter: 'stars >= 1',
      // A row that scrolls sideways can be scrolled from the keyboard.
      ...(layout === 'carousel'
        ? { tabIndex: 0, role: 'region', 'aria-label': 'Reviews, scroll sideways for more' }
        : {}),
    },
    {
      sx: LIST_SX[layout],
      nodes: [reviewCard(layout)],
    },
  )

/** "Reviews from Google" and the link a customer leaves a review through. */
export const footerNode = () =>
  node(
    'muiStack',
    { direction: 'row', spacing: 2, repeatConnection: SUMMARY_SOURCE, repeatSelf: true },
    {
      sx: { alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 },
      nodes: [
        // Says where the reviews come from, so only when there are some. The
        // link stays: it is how a profile with none gets its first.
        text('caption', 'Reviews from Google', { sx: { color: 'text.secondary' }, hideUnless: '{{item.reviewCount}}' }),
        reviewLinkNode(),
      ],
    },
  )

const reviewLinkNode = () =>
  node('muiScreenLink', {
    children: 'Review us on Google',
    href: '{{item.reviewUrl}}',
    target: '_blank',
    renderAs: 'link',
  })

const preset = (key, displayName, description, icon, data) => ({
  $id: `${BUNDLE_ID}:${key}`,
  type: NodeType.PRESET,
  displayName,
  pluginId: BUNDLE_ID,
  description,
  category: ComponentCategory.DATA_DISPLAY,
  icon: { path: icon },
  data,
})

export const presets = [
  preset(
    'section',
    'Google reviews',
    'Your Google rating, review cards and a "Review us on Google" link, each part yours to style.',
    ICONS.reviews,
    node(
      'muiStack',
      { spacing: 2.5, component: 'section', 'aria-label': 'Google reviews' },
      { nodes: [summaryNode(), cardsNode('grid'), footerNode()] },
    ),
  ),
  preset(
    'summary',
    'Google rating',
    'Your average Google rating, in stars, and how many reviews you have.',
    ICONS.star,
    summaryNode(),
  ),
  preset('cards', 'Google review cards', 'Your newest Google reviews as a grid of cards.', ICONS.cards, cardsNode('grid')),
  preset('list', 'Google review list', 'Your newest Google reviews, one card under another.', ICONS.list, cardsNode('list')),
  preset(
    'carousel',
    'Google review carousel',
    'Your newest Google reviews in a row visitors swipe or scroll sideways.',
    ICONS.carousel,
    cardsNode('carousel'),
  ),
  preset(
    'review-link',
    'Review us on Google',
    'A link to the page where a customer leaves you a Google review.',
    ICONS.link,
    node(
      'muiStack',
      { direction: 'row', repeatConnection: SUMMARY_SOURCE, repeatSelf: true },
      { nodes: [reviewLinkNode()] },
    ),
  ),
  preset('stars', 'Google stars', 'Five stars, filled to a rating.', ICONS.star, {
    ...stars('5', 'medium'),
  }),
  preset(
    'reviewer-image',
    'Google reviewer image',
    "A reviewer's initials or Google photo. Place it inside a review card.",
    ICONS.person,
    reviewerImage(),
  ),
]
