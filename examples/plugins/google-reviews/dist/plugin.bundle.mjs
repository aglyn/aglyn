const host$9 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$9) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("aglyn" in host$9)) throw new Error('this Aglyn host does not provide ' + "aglyn");
const __aglynHostModule$9 = host$9["aglyn"];

const host$8 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$8) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("React" in host$8)) throw new Error('this Aglyn host does not provide ' + "React");
const __aglynHostModule$8 = host$8["React"];
__aglynHostModule$8.default !== undefined ? __aglynHostModule$8.default : __aglynHostModule$8;

const host$7 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$7) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host$7)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule$7 = host$7["mui"];
var Box = __aglynHostModule$7["Box"];

const host$6 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$6) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host$6)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule$6 = host$6["mui"];
var Button = __aglynHostModule$6["Button"];

const host$5 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$5) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host$5)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule$5 = host$5["mui"];
var Card = __aglynHostModule$5["Card"];

const host$4 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$4) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host$4)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule$4 = host$4["mui"];
var CardContent = __aglynHostModule$4["CardContent"];

const host$3 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$3) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host$3)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule$3 = host$3["mui"];
var Link = __aglynHostModule$3["Link"];

const host$2 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$2) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host$2)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule$2 = host$2["mui"];
var Stack = __aglynHostModule$2["Stack"];

const host$1 = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host$1) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host$1)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule$1 = host$1["mui"];
var SvgIcon = __aglynHostModule$1["SvgIcon"];

const host = globalThis.__AGLYN_PLUGIN_HOST__;
if (!host) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');
if (!("mui" in host)) throw new Error('this Aglyn host does not provide ' + "mui");
const __aglynHostModule = host["mui"];
var Typography = __aglynHostModule["Typography"];

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
const CONNECTION_ID = 'google';

/** The hosts `capabilities.imageHosts` admits to a site's `img-src`. */
const IMAGE_HOSTS = ['lh3.googleusercontent.com'];

/** The most reviews the record holds (`items.maxItems` in the manifest). */
const MAX_REVIEWS = 50;

const LAYOUTS = ['grid', 'list', 'carousel'];
const REVIEWER_IMAGES = ['initials', 'photo'];

const DEFAULT_SETTINGS = {
  count: 6,
  minStars: 1,
  layout: 'grid',
  reviewerImage: 'initials',
  showSummary: true,
  showReplies: true,
};

/** A comment longer than this gets a "More" button; shorter ones never need it. */
const CLAMP_CHARACTERS = 280;

const wholeNumberIn = (value, min, max, fallback) => {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
};

const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback);

/** A switch is on unless it was turned off. */
const switchOn = (value, fallback) =>
  value === undefined || value === null || value === '' ? fallback : value !== false && value !== 'false';

/**
 * The element's settings, from whatever the Besigner stored: a number field
 * may hold a string, and an element placed before a setting existed holds
 * nothing for it.
 */
function normalizeSettings(props) {
  const input = props || {};
  return {
    count: wholeNumberIn(input.count, 1, MAX_REVIEWS, DEFAULT_SETTINGS.count),
    minStars: wholeNumberIn(input.minStars, 1, 5, DEFAULT_SETTINGS.minStars),
    layout: oneOf(input.layout, LAYOUTS, DEFAULT_SETTINGS.layout),
    reviewerImage: oneOf(input.reviewerImage, REVIEWER_IMAGES, DEFAULT_SETTINGS.reviewerImage),
    showSummary: switchOn(input.showSummary, DEFAULT_SETTINGS.showSummary),
    showReplies: switchOn(input.showReplies, DEFAULT_SETTINGS.showReplies),
  }
}

const text$1 = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * The reviews to show, in the order Google listed them (newest first): only
 * those with a star rating of `minStars` or more, at most `count` of them.
 * A review whose rating Google did not give as one to five stars is left out,
 * because there is nothing true to draw for it.
 */
function selectReviews(record, settings) {
  const items = record && Array.isArray(record.items) ? record.items : [];
  const out = [];
  for (const item of items) {
    if (out.length >= settings.count) break
    if (!item || typeof item !== 'object') continue
    const stars = number(item.stars);
    if (stars === null || stars < 1 || stars > 5 || stars < settings.minStars) continue
    out.push({
      reviewer: text$1(item.reviewer) || 'A Google user',
      photo: text$1(item.photo),
      anonymous: item.anonymous === true,
      stars,
      comment: text$1(item.comment),
      createdAt: number(item.createdAt),
      reply: text$1(item.reply),
    });
  }
  return out
}

/** The summary line's values, or null when Google gave no rating. */
function summaryOf(record) {
  const fields = (record && record.fields) || {};
  const rating = number(fields.rating);
  const reviewCount = number(fields.reviewCount);
  return {
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    reviewCount: reviewCount !== null && reviewCount >= 0 ? Math.round(reviewCount) : null,
    reviewUrl: text$1(fields.reviewUrl),
  }
}

/** "JL" for "Jordan Lee", "P" for "Pat"; letters only, at most two. */
function initialsOf(name) {
  const words = String(name || '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!words.length) return '?'
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toUpperCase()
}

/**
 * Whether a reviewer's photo may be drawn: the element is set to photos, the
 * reviewer is not anonymous, and the photo is served from a host the manifest
 * admits to the page's `img-src`. Any other photo would be blocked by the
 * page's policy and show as a broken image, so the initials are drawn instead.
 */
function photoAllowed(review, settings) {
  if (settings.reviewerImage !== 'photo' || review.anonymous || !review.photo) return false
  try {
    const url = new URL(review.photo);
    return url.protocol === 'https:' && IMAGE_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

/** "4.6" — one decimal place, as rating summaries are written. */
function formatRating(rating) {
  return rating.toFixed(1)
}

/** "1 review", "44 reviews". */
function formatReviewCount(count) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'review' : 'reviews'}`
}

/**
 * "March 2026". Fixed to one language and UTC so the server's HTML and the
 * browser's first render agree, whatever the visitor's clock says.
 */
function formatReviewDate(epochMs) {
  if (epochMs === null) return null
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return null
  return {
    iso: date.toISOString(),
    label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

/** What a screen reader hears for a star rating: "Rated 4.6 out of 5 stars". */
function starsLabel(value) {
  const shown = Number.isInteger(value) ? String(value) : formatRating(value);
  return `Rated ${shown} out of 5 stars`
}

/** How much of each of the five stars is filled, 0 to 100. */
function starFill(value) {
  const clamped = Math.min(5, Math.max(0, value));
  return [0, 1, 2, 3, 4].map((index) => Math.round(Math.min(1, Math.max(0, clamped - index)) * 100))
}

/** Whether a comment is long enough to clamp behind a "More" button. */
function needsMore(review) {
  return (review.comment || '').length > CLAMP_CHARACTERS || (review.reply || '').length > CLAMP_CHARACTERS
}

/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/** Material Design Icons `star` and `star-outline` (Apache-2.0). */
const STAR$1 = 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z';
const STAR_OUTLINE$1 =
  'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z';

/** Element props the element reads; everything else goes to its root. */
const SETTING_PROPS = ['count', 'minStars', 'layout', 'reviewerImage', 'showSummary', 'showReplies'];

/**
 * Five stars, each filled as far as `value` reaches, read out as one image:
 * "Rated 4.6 out of 5 stars".
 */
function Stars$1({ value, fontSize }) {
  return __aglynHostModule$8.createElement(
    Box,
    {
      role: 'img',
      'aria-label': starsLabel(value),
      sx: { display: 'inline-flex', alignItems: 'center', lineHeight: 0, color: 'warning.main' },
    },
    starFill(value).map((fill, index) =>
      __aglynHostModule$8.createElement(
        Box,
        { key: index, 'aria-hidden': true, sx: { position: 'relative', display: 'inline-flex' } },
        __aglynHostModule$8.createElement(SvgIcon, { fontSize, sx: { color: 'action.disabled' } }, __aglynHostModule$8.createElement('path', { d: STAR_OUTLINE$1 })),
        fill > 0
          ? __aglynHostModule$8.createElement(
              Box,
              {
                'data-star-fill': fill,
                sx: { position: 'absolute', inset: 0, width: `${fill}%`, overflow: 'hidden', display: 'inline-flex' },
              },
              __aglynHostModule$8.createElement(SvgIcon, { fontSize, sx: { color: 'inherit', flex: 'none' } }, __aglynHostModule$8.createElement('path', { d: STAR$1 })),
            )
          : null,
      ),
    ),
  )
}

/** The reviewer's Google photo when allowed, otherwise their initials. */
function ReviewerImage$1({ review, settings }) {
  const size = 40;
  if (photoAllowed(review, settings)) {
    return __aglynHostModule$8.createElement(Box, {
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
  return __aglynHostModule$8.createElement(
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
      };

function ReviewCard({ review, settings, carousel }) {
  const [open, setOpen] = __aglynHostModule$8.useState(false);
  const textId = __aglynHostModule$8.useId();
  const date = formatReviewDate(review.createdAt);
  const more = needsMore(review);
  const reply = settings.showReplies ? review.reply : null;
  return __aglynHostModule$8.createElement(
    Box,
    {
      component: 'li',
      sx: carousel
        ? { flex: '0 0 min(85%, 340px)', scrollSnapAlign: 'start', display: 'flex' }
        : { display: 'flex' },
    },
    __aglynHostModule$8.createElement(
      Card,
      { variant: 'outlined', sx: { width: '100%' } },
      __aglynHostModule$8.createElement(
        CardContent,
        null,
        __aglynHostModule$8.createElement(
          Stack,
          { spacing: 1.25 },
          __aglynHostModule$8.createElement(
            Stack,
            { direction: 'row', spacing: 1.5, sx: { alignItems: 'center' } },
            __aglynHostModule$8.createElement(ReviewerImage$1, { review, settings }),
            __aglynHostModule$8.createElement(
              Box,
              { sx: { minWidth: 0 } },
              __aglynHostModule$8.createElement(Typography, { variant: 'subtitle2', component: 'p', noWrap: true }, review.reviewer),
              date
                ? __aglynHostModule$8.createElement(
                    Typography,
                    { variant: 'caption', color: 'text.secondary', component: 'time', dateTime: date.iso },
                    date.label,
                  )
                : null,
            ),
          ),
          __aglynHostModule$8.createElement(Stars$1, { value: review.stars, fontSize: 'small' }),
          review.comment
            ? __aglynHostModule$8.createElement(
                Typography,
                { id: textId, variant: 'body2', component: 'p', sx: clamp(5, open) },
                review.comment,
              )
            : null,
          reply
            ? __aglynHostModule$8.createElement(
                Box,
                { sx: { borderLeft: 2, borderColor: 'divider', pl: 1.5 } },
                __aglynHostModule$8.createElement(Typography, { variant: 'caption', color: 'text.secondary', component: 'p' }, 'Response from the owner'),
                __aglynHostModule$8.createElement(Typography, { variant: 'body2', component: 'p', sx: clamp(3, open) }, reply),
              )
            : null,
          more
            ? __aglynHostModule$8.createElement(
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
  return __aglynHostModule$8.createElement(
    Stack,
    { direction: 'row', spacing: 1.5, sx: { alignItems: 'center', flexWrap: 'wrap', rowGap: 1 } },
    __aglynHostModule$8.createElement(Typography, { variant: 'h4', component: 'p', 'data-summary-rating': true }, formatRating(summary.rating)),
    __aglynHostModule$8.createElement(Stars$1, { value: summary.rating, fontSize: 'medium' }),
    summary.reviewCount !== null
      ? __aglynHostModule$8.createElement(
          Typography,
          { variant: 'body2', color: 'text.secondary', component: 'p' },
          `${formatReviewCount(summary.reviewCount)} on Google`,
        )
      : null,
  )
}

const LIST_SX$1 = {
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
};

/** A line only the Besigner canvas shows, addressed to the author. */
function AuthorNote({ rest, children }) {
  return __aglynHostModule$8.createElement(
    Box,
    rest,
    __aglynHostModule$8.createElement(Typography, { variant: 'body2', color: 'text.secondary', component: 'p' }, children),
  )
}

/**
 * The element. Every prop that is not one of its settings (the renderer's
 * `ref`, `data-aglyn`, `className`, `sx`) goes to its root, so the canvas can
 * select it and the Besigner's styles reach it; React 19 hands `ref` over as
 * a prop.
 */
function GoogleReviews(props) {
  const rest = {};
  for (const [key, value] of Object.entries(props)) {
    if (!SETTING_PROPS.includes(key)) rest[key] = value;
  }
  const settings = normalizeSettings(props);
  const { editorInert } = __aglynHostModule$8.useContext(__aglynHostModule$9.ScreenLinkContext);
  const record = __aglynHostModule$9.usePluginConnectionRecord(CONNECTION_ID);
  const reviews = record ? selectReviews(record, settings) : [];

  if (!reviews.length) {
    if (!editorInert) return null
    return __aglynHostModule$8.createElement(
      AuthorNote,
      { rest },
      record
        ? 'Google reviews: no review matches these settings yet. Lower the minimum stars to show more.'
        : 'Google reviews: your reviews show here once this site is connected to your Google Business Profile.',
    )
  }

  const summary = summaryOf(record);
  const carousel = settings.layout === 'carousel';
  return __aglynHostModule$8.createElement(
    Box,
    { component: 'section', 'aria-label': 'Google reviews', ...rest },
    __aglynHostModule$8.createElement(
      Stack,
      { spacing: 2.5 },
      settings.showSummary && summary.rating !== null ? __aglynHostModule$8.createElement(Summary, { summary }) : null,
      __aglynHostModule$8.createElement(
        Box,
        {
          component: 'ul',
          'data-layout': settings.layout,
          // A row that scrolls sideways can be scrolled from the keyboard.
          ...(carousel ? { tabIndex: 0, 'aria-label': 'Reviews, scroll sideways for more' } : {}),
          sx: { listStyle: 'none', m: 0, p: 0, ...LIST_SX$1[settings.layout] },
        },
        reviews.map((review, index) => __aglynHostModule$8.createElement(ReviewCard, { key: index, review, settings, carousel })),
      ),
      __aglynHostModule$8.createElement(
        Stack,
        {
          direction: 'row',
          spacing: 2,
          sx: { alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 },
        },
        // Says where the reviews come from.
        __aglynHostModule$8.createElement(Typography, { variant: 'caption', color: 'text.secondary', component: 'p' }, 'Reviews from Google'),
        summary.reviewUrl
          ? __aglynHostModule$8.createElement(
              Link,
              { href: summary.reviewUrl, target: '_blank', rel: 'noopener noreferrer', variant: 'body2' },
              'Review us on Google',
            )
          : null,
      ),
    ),
  )
}
GoogleReviews.displayName = 'AglynGoogleReviews';

/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/** Material Design Icons `star` and `star-outline` (Apache-2.0). */
const STAR = 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z';
const STAR_OUTLINE =
  'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z';

/** The element's own styles first, the author's after them. */
const withAuthorSx = (own, sx) => [own, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])];

/** Splits the element's own attributes from what goes to its root. */
const split = (props, names) => {
  const own = {};
  const rest = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (names.includes(key)) own[key] = value;
    else rest[key] = value;
  }
  return [own, rest]
};

/**
 * A value between 0 and 5 from whatever the attribute holds: a number, the
 * string a token printed, or an unfilled `{{item.stars}}` on the canvas
 * (which draws five empty stars).
 */
function starValue(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return 0
  return Math.min(5, Math.max(0, parsed))
}

const STAR_SIZES = { small: '1.25rem', medium: '1.5rem', large: '2rem' };

/** Five stars, as one image. Persisted id: `aglyn.google-reviews.stars`. */
function Stars(props) {
  const [own, rest] = split(props, ['value', 'size']);
  const value = starValue(own.value);
  const { sx, ...root } = rest;
  return __aglynHostModule$8.createElement(
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
      __aglynHostModule$8.createElement(
        Box,
        { key: index, 'aria-hidden': true, sx: { position: 'relative', display: 'inline-flex' } },
        __aglynHostModule$8.createElement(SvgIcon, { fontSize: 'inherit', sx: { color: 'action.disabled' } }, __aglynHostModule$8.createElement('path', { d: STAR_OUTLINE })),
        fill > 0
          ? __aglynHostModule$8.createElement(
              Box,
              {
                'data-star-fill': fill,
                sx: { position: 'absolute', inset: 0, width: `${fill}%`, overflow: 'hidden', display: 'inline-flex' },
              },
              __aglynHostModule$8.createElement(SvgIcon, { fontSize: 'inherit', sx: { color: 'inherit', flex: 'none' } }, __aglynHostModule$8.createElement('path', { d: STAR })),
            )
          : null,
      ),
    ),
  )
}
Stars.displayName = 'AglynGoogleReviewStars';

/** A switch bound to a token prints `true`/`false` as text. */
const yes = (value) => value === true || value === 'true';

/**
 * The reviewer's photo or initials. Persisted id:
 * `aglyn.google-reviews.reviewer-image`.
 */
function ReviewerImage(props) {
  const [own, rest] = split(props, ['name', 'photo', 'anonymous', 'show']);
  const { sx, ...root } = rest;
  const review = {
    photo: typeof own.photo === 'string' && own.photo.trim() ? own.photo.trim() : null,
    anonymous: yes(own.anonymous),
  };
  const base = { width: 40, height: 40, borderRadius: '50%', flex: 'none' };
  if (photoAllowed(review, { reviewerImage: own.show === 'photo' ? 'photo' : 'initials' })) {
    return __aglynHostModule$8.createElement(Box, {
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
  return __aglynHostModule$8.createElement(
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
ReviewerImage.displayName = 'AglynGoogleReviewerImage';

/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/** Must match `BUNDLE_ID` in index.js. */
const BUNDLE_ID$1 = 'aglyn.google-reviews';
const MUI = 'mui';

const STARS_ID = 'aglyn.google-reviews.stars';
const REVIEWER_IMAGE_ID = 'aglyn.google-reviews.reviewer-image';

/** The connection, as a repeat names it. Persisted in pages; never rename. */
const REVIEWS_SOURCE = `${BUNDLE_ID$1}/google`;
const SUMMARY_SOURCE = `${BUNDLE_ID$1}/google/fields`;

/** Material Design Icons (Apache-2.0) for the Elements panel. */
const ICONS = {
  reviews: 'M8.58,17.25L9.5,13.36L6.5,10.78L10.45,10.41L12,6.8L13.55,10.45L17.5,10.78L14.5,13.36L15.42,17.25L12,15.19L8.58,17.25M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4Z',
  star: 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z',
  cards: 'M3,11H11V3H3M3,21H11V13H3M13,21H21V13H13M13,3V11H21V3',
  list: 'M3,4H21V8H3V4M3,10H21V14H3V10M3,16H21V20H3V16Z',
  carousel: 'M7,19H17V4H7V19M2,17H6V6H2V17M18,6V17H22V6H18Z',
  link: 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z',
  person: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z',
};

const node = (componentId, props, extra = {}) => ({
  $id: null,
  componentId,
  pluginId: MUI,
  props,
  ...extra,
});

const text = (variant, children, extra = {}) => {
  const { sx, ...props } = extra;
  return node('muiTypography', { variant, component: 'p', children, ...props }, sx ? { sx } : {})
};

const stars = (value, size = 'small') => ({
  $id: null,
  componentId: STARS_ID,
  pluginId: BUNDLE_ID$1,
  props: { value, size },
});

const reviewerImage = () => ({
  $id: null,
  componentId: REVIEWER_IMAGE_ID,
  pluginId: BUNDLE_ID$1,
  props: {
    name: '{{item.reviewer}}',
    photo: '{{item.photo}}',
    anonymous: '{{item.anonymous}}',
    show: 'initials',
  },
});

/**
 * The rating summary: "4.8 ★★★★★ 44 reviews on Google". A profile Google
 * gives no rating (no reviews yet) shows no summary at all, never empty stars
 * and "reviews on Google" without a number.
 */
const summaryNode = () =>
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
  );

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
};

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
  );

/** The review cards: the list repeats its card once per review. */
const cardsNode = (layout = 'grid') =>
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
  );

/** "Reviews from Google" and the link a customer leaves a review through. */
const footerNode = () =>
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
  );

const reviewLinkNode = () =>
  node('muiScreenLink', {
    children: 'Review us on Google',
    href: '{{item.reviewUrl}}',
    target: '_blank',
    renderAs: 'link',
  });

const preset = (key, displayName, description, icon, data) => ({
  $id: `${BUNDLE_ID$1}:${key}`,
  type: __aglynHostModule$9.NodeType.PRESET,
  displayName,
  pluginId: BUNDLE_ID$1,
  description,
  category: __aglynHostModule$9.ComponentCategory.DATA_DISPLAY,
  icon: { path: icon },
  data,
});

const presets$1 = [
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
];

/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/**
 * The plugin's identity, `<publisher handle>.<manifest id>`: the `pluginId`
 * every node it places carries, and the namespace of its component ids.
 */
const BUNDLE_ID = 'aglyn.google-reviews';

/** Persisted in screen documents; never rename. */
const COMPONENT_ID = 'aglyn.google-reviews.reviews';

/** Material Design Icons `star-circle-outline` (Apache-2.0), for the Elements panel. */
const ICON = {
  path: 'M8.58,17.25L9.5,13.36L6.5,10.78L10.45,10.41L12,6.8L13.55,10.45L17.5,10.78L14.5,13.36L15.42,17.25L12,15.19L8.58,17.25M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4Z',
};

const DESCRIPTION = 'Your Google rating and reviews, kept up to date from your Google Business Profile.';

const schema = {
  $id: COMPONENT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Google reviews',
  description: DESCRIPTION,
  category: __aglynHostModule$9.ComponentCategory.DATA_DISPLAY,
  icon: ICON,
  // It draws its own content and holds no child elements.
  flags: { selfClosing: __aglynHostModule$9.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'count',
      label: 'How many reviews',
      description: 'The most reviews shown, newest first (1 to 50).',
      component: __aglynHostModule$9.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
    {
      name: 'minStars',
      label: 'Minimum stars',
      description: 'Show only reviews with at least this many stars.',
      component: __aglynHostModule$9.FieldComponentType.SELECT,
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
      component: __aglynHostModule$9.FieldComponentType.SELECT,
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
      component: __aglynHostModule$9.FieldComponentType.SELECT,
      options: [
        { value: 'initials', label: 'Initials' },
        { value: 'photo', label: 'Google photo' },
      ],
    },
    {
      name: 'showSummary',
      label: 'Show the rating summary?',
      description: 'Your average rating and how many reviews you have on Google, above the reviews.',
      component: __aglynHostModule$9.FieldComponentType.SWITCH,
    },
    {
      name: 'showReplies',
      label: 'Show your replies?',
      description: 'Your reply to a review, under it, when you have written one on Google.',
      component: __aglynHostModule$9.FieldComponentType.SWITCH,
    },
  ],
};

/**
 * Stars (AGL-4212): what a composable review card draws its rating with.
 * Persisted id; never rename.
 */
const starsSchema = {
  $id: STARS_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Google stars',
  description: 'Five stars, filled to a rating. Its color and size follow the Styles panel.',
  category: __aglynHostModule$9.ComponentCategory.DATA_DISPLAY,
  icon: { path: 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z' },
  flags: { selfClosing: __aglynHostModule$9.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'value',
      label: 'Rating',
      description: 'The rating to draw, 0 to 5. Inside a review it is the review\'s stars.',
      component: __aglynHostModule$9.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'size',
      label: 'Size',
      component: __aglynHostModule$9.FieldComponentType.SELECT,
      options: [
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ],
    },
  ],
};

/**
 * Reviewer image (AGL-4212): a reviewer's initials or Google photo.
 * Persisted id; never rename.
 */
const reviewerImageSchema = {
  $id: REVIEWER_IMAGE_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Google reviewer image',
  description: "A reviewer's initials, or the photo they use on Google. Anonymous reviewers always show initials.",
  category: __aglynHostModule$9.ComponentCategory.DATA_DISPLAY,
  icon: {
    path: 'M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z',
  },
  flags: { selfClosing: __aglynHostModule$9.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'show',
      label: 'Show',
      description: "The reviewer's initials, or the profile photo they use on Google.",
      component: __aglynHostModule$9.FieldComponentType.SELECT,
      options: [
        { value: 'initials', label: 'Initials' },
        { value: 'photo', label: 'Google photo' },
      ],
    },
    { name: 'name', label: 'Reviewer name', component: __aglynHostModule$9.FieldComponentType.TEXT_FIELD },
    { name: 'photo', label: 'Photo address', component: __aglynHostModule$9.FieldComponentType.TEXT_FIELD },
  ],
};

/**
 * The one-piece element's preset, as v1.0.0 placed it. No longer offered
 * (AGL-4212): the Elements panel offers the composable presets instead, and
 * pages that already place the element keep rendering it.
 */
const legacyPresets = [
  {
    $id: `${BUNDLE_ID}:${COMPONENT_ID}`,
    type: __aglynHostModule$9.NodeType.PRESET,
    displayName: 'Google reviews',
    pluginId: BUNDLE_ID,
    description: DESCRIPTION,
    category: __aglynHostModule$9.ComponentCategory.DATA_DISPLAY,
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
];

/**
 * The bundle's entry. The host runs it once the bundle has verified: in the
 * browser, on the server rendering a page that places the element, and in the
 * Besigner of a site that has the plugin.
 *
 * It registers straight into the component registry, with the id written out,
 * so the publish verifier reads exactly what it registers and holds it to the
 * manifest's `contributes`. A second run registers nothing twice.
 */
const presets = presets$1;

function register() {
  if (__aglynHostModule$9.components.getSchema(COMPONENT_ID)) return
  __aglynHostModule$9.components.registerComponent(GoogleReviews, { ...schema, $id: 'aglyn.google-reviews.reviews' });
  __aglynHostModule$9.components.registerComponent(Stars, { ...starsSchema, $id: 'aglyn.google-reviews.stars' });
  __aglynHostModule$9.components.registerComponent(ReviewerImage, { ...reviewerImageSchema, $id: 'aglyn.google-reviews.reviewer-image' });
  __aglynHostModule$9.components.registerPreset(presets);
}

export { BUNDLE_ID, COMPONENT_ID, legacyPresets, presets, register, reviewerImageSchema, schema, starsSchema };
