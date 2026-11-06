/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the Google reviews element shows, worked out from the connection's
 * record and the element's settings. Pure: no React, no host, so the same
 * answer comes out on the server and in the browser, and a test can read it
 * without a page.
 *
 * The record is the one `manifest.json` declares for the `google` connection:
 *
 *   fields: { rating, reviewCount, reviewUrl }
 *   items:  [{ reviewer, photo, anonymous, stars, comment, createdAt, reply }]
 *
 * The platform has already typed and bounded every value (a `datetime` is
 * epoch milliseconds, a `url` is https or null, an unknown star rating is
 * null), so this module only chooses and formats.
 */

/** The connection id in `manifest.json`. Persisted; never rename. */
export const CONNECTION_ID = 'google'

/** The hosts `capabilities.imageHosts` admits to a site's `img-src`. */
export const IMAGE_HOSTS = ['lh3.googleusercontent.com']

/** The most reviews the record holds (`items.maxItems` in the manifest). */
export const MAX_REVIEWS = 50

export const LAYOUTS = ['grid', 'list', 'carousel']
export const REVIEWER_IMAGES = ['initials', 'photo']

export const DEFAULT_SETTINGS = {
  count: 6,
  minStars: 1,
  layout: 'grid',
  reviewerImage: 'initials',
  showSummary: true,
  showReplies: true,
}

/** A comment longer than this gets a "More" button; shorter ones never need it. */
export const CLAMP_CHARACTERS = 280

const wholeNumberIn = (value, min, max, fallback) => {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback)

/** A switch is on unless it was turned off. */
const switchOn = (value, fallback) =>
  value === undefined || value === null || value === '' ? fallback : value !== false && value !== 'false'

/**
 * The element's settings, from whatever the Besigner stored: a number field
 * may hold a string, and an element placed before a setting existed holds
 * nothing for it.
 */
export function normalizeSettings(props) {
  const input = props || {}
  return {
    count: wholeNumberIn(input.count, 1, MAX_REVIEWS, DEFAULT_SETTINGS.count),
    minStars: wholeNumberIn(input.minStars, 1, 5, DEFAULT_SETTINGS.minStars),
    layout: oneOf(input.layout, LAYOUTS, DEFAULT_SETTINGS.layout),
    reviewerImage: oneOf(input.reviewerImage, REVIEWER_IMAGES, DEFAULT_SETTINGS.reviewerImage),
    showSummary: switchOn(input.showSummary, DEFAULT_SETTINGS.showSummary),
    showReplies: switchOn(input.showReplies, DEFAULT_SETTINGS.showReplies),
  }
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * The reviews to show, in the order Google listed them (newest first): only
 * those with a star rating of `minStars` or more, at most `count` of them.
 * A review whose rating Google did not give as one to five stars is left out,
 * because there is nothing true to draw for it.
 */
export function selectReviews(record, settings) {
  const items = record && Array.isArray(record.items) ? record.items : []
  const out = []
  for (const item of items) {
    if (out.length >= settings.count) break
    if (!item || typeof item !== 'object') continue
    const stars = number(item.stars)
    if (stars === null || stars < 1 || stars > 5 || stars < settings.minStars) continue
    out.push({
      reviewer: text(item.reviewer) || 'A Google user',
      photo: text(item.photo),
      anonymous: item.anonymous === true,
      stars,
      comment: text(item.comment),
      createdAt: number(item.createdAt),
      reply: text(item.reply),
    })
  }
  return out
}

/** The summary line's values, or null when Google gave no rating. */
export function summaryOf(record) {
  const fields = (record && record.fields) || {}
  const rating = number(fields.rating)
  const reviewCount = number(fields.reviewCount)
  return {
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount: reviewCount !== null && reviewCount >= 0 ? Math.round(reviewCount) : null,
    reviewUrl: text(fields.reviewUrl),
  }
}

/** "JL" for "Jordan Lee", "P" for "Pat"; letters only, at most two. */
export function initialsOf(name) {
  const words = String(name || '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (!words.length) return '?'
  const first = Array.from(words[0])[0]
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : ''
  return (first + last).toUpperCase()
}

/**
 * Whether a reviewer's photo may be drawn: the element is set to photos, the
 * reviewer is not anonymous, and the photo is served from a host the manifest
 * admits to the page's `img-src`. Any other photo would be blocked by the
 * page's policy and show as a broken image, so the initials are drawn instead.
 */
export function photoAllowed(review, settings) {
  if (settings.reviewerImage !== 'photo' || review.anonymous || !review.photo) return false
  try {
    const url = new URL(review.photo)
    return url.protocol === 'https:' && IMAGE_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

/** "4.6" — one decimal place, as rating summaries are written. */
export function formatRating(rating) {
  return rating.toFixed(1)
}

/** "1 review", "44 reviews". */
export function formatReviewCount(count) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'review' : 'reviews'}`
}

/**
 * "March 2026". Fixed to one language and UTC so the server's HTML and the
 * browser's first render agree, whatever the visitor's clock says.
 */
export function formatReviewDate(epochMs) {
  if (epochMs === null) return null
  const date = new Date(epochMs)
  if (Number.isNaN(date.getTime())) return null
  return {
    iso: date.toISOString(),
    label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

/** What a screen reader hears for a star rating: "Rated 4.6 out of 5 stars". */
export function starsLabel(value) {
  const shown = Number.isInteger(value) ? String(value) : formatRating(value)
  return `Rated ${shown} out of 5 stars`
}

/** How much of each of the five stars is filled, 0 to 100. */
export function starFill(value) {
  const clamped = Math.min(5, Math.max(0, value))
  return [0, 1, 2, 3, 4].map((index) => Math.round(Math.min(1, Math.max(0, clamped - index)) * 100))
}

/** Whether a comment is long enough to clamp behind a "More" button. */
export function needsMore(review) {
  return (review.comment || '').length > CLAMP_CHARACTERS || (review.reply || '').length > CLAMP_CHARACTERS
}
