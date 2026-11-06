/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Google reviews: a marketplace plugin the Aglyn org publishes (AGL-4197).
 *
 * The site owner connects their Google Business Profile through the
 * manifest's declared `google` connection. The platform runs the OAuth grant,
 * the account and location picker and the six-hourly sync, and keeps the
 * record this bundle's one element draws. The bundle never sees a token and
 * never calls Google: it has no network access at all.
 *
 * It is a realm bundle (`tools/plugin-loader/realm/template`): staff-signed,
 * so its element renders in the page's HTML on the server. `react`,
 * `@aglyn/aglyn` and `@mui/material` are the host's own copies; build with
 * `rollup.config.mjs` beside this folder.
 */

import { ComponentCategory, components, FEATURE_FLAG, FieldComponentType, NodeType } from '@aglyn/aglyn'
import GoogleReviews from './element.js'
import { DEFAULT_SETTINGS } from './reviews.js'

/**
 * The plugin's identity, `<publisher handle>.<manifest id>`: the `pluginId`
 * every node it places carries, and the namespace of its component ids.
 */
export const BUNDLE_ID = 'aglyn.google-reviews'

/** Persisted in screen documents; never rename. */
export const COMPONENT_ID = 'aglyn.google-reviews.reviews'

/** Material Design Icons `star-circle-outline` (Apache-2.0), for the Elements panel. */
const ICON = {
  path: 'M8.58,17.25L9.5,13.36L6.5,10.78L10.45,10.41L12,6.8L13.55,10.45L17.5,10.78L14.5,13.36L15.42,17.25L12,15.19L8.58,17.25M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4Z',
}

const DESCRIPTION = 'Your Google rating and reviews, kept up to date from your Google Business Profile.'

export const schema = {
  $id: COMPONENT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Google reviews',
  description: DESCRIPTION,
  category: ComponentCategory.DATA_DISPLAY,
  icon: ICON,
  // It draws its own content and holds no child elements.
  flags: { selfClosing: FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'count',
      label: 'How many reviews',
      description: 'The most reviews shown, newest first (1 to 50).',
      component: FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'minStars',
      label: 'Minimum stars',
      description: 'Show only reviews with at least this many stars.',
      component: FieldComponentType.SELECT,
      options: [
        { value: '1', label: 'Any rating' },
        { value: '2', label: '2 stars and up' },
        { value: '3', label: '3 stars and up' },
        { value: '4', label: '4 stars and up' },
        { value: '5', label: '5 stars only' },
      ],
    },
    {
      name: 'layout',
      label: 'Layout',
      description: 'A grid of cards, one card under another, or a row visitors swipe or scroll sideways.',
      component: FieldComponentType.SELECT,
      options: [
        { value: 'grid', label: 'Grid' },
        { value: 'list', label: 'List' },
        { value: 'carousel', label: 'Carousel' },
      ],
    },
    {
      name: 'reviewerImage',
      label: 'Reviewer image',
      description:
        "The reviewer's initials, or the profile photo they use on Google. Anonymous reviewers always show initials.",
      component: FieldComponentType.SELECT,
      options: [
        { value: 'initials', label: 'Initials' },
        { value: 'photo', label: 'Google photo' },
      ],
    },
    {
      name: 'showSummary',
      label: 'Show the rating summary?',
      description: 'Your average rating and how many reviews you have on Google, above the reviews.',
      component: FieldComponentType.SWITCH,
    },
    {
      name: 'showReplies',
      label: 'Show your replies?',
      description: 'Your reply to a review, under it, when you have written one on Google.',
      component: FieldComponentType.SWITCH,
    },
  ],
}

export const presets = [
  {
    $id: `${BUNDLE_ID}:${COMPONENT_ID}`,
    type: NodeType.PRESET,
    displayName: 'Google reviews',
    pluginId: BUNDLE_ID,
    description: DESCRIPTION,
    category: ComponentCategory.DATA_DISPLAY,
    icon: ICON,
    data: {
      $id: null,
      componentId: COMPONENT_ID,
      pluginId: BUNDLE_ID,
      props: {
        count: DEFAULT_SETTINGS.count,
        minStars: String(DEFAULT_SETTINGS.minStars),
        layout: DEFAULT_SETTINGS.layout,
        reviewerImage: DEFAULT_SETTINGS.reviewerImage,
        showSummary: DEFAULT_SETTINGS.showSummary,
        showReplies: DEFAULT_SETTINGS.showReplies,
      },
    },
  },
]

/**
 * The bundle's entry. The host runs it once the bundle has verified: in the
 * browser, on the server rendering a page that places the element, and in the
 * Besigner of a site that has the plugin.
 *
 * It registers straight into the component registry, with the id written out,
 * so the publish verifier reads exactly what it registers and holds it to the
 * manifest's `contributes`. A second run registers nothing twice.
 */
export function register() {
  if (components.getSchema(COMPONENT_ID)) return
  components.registerComponent(GoogleReviews, { ...schema, $id: 'aglyn.google-reviews.reviews' })
  components.registerPreset(presets)
}
