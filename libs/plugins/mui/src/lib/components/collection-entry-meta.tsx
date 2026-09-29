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

import * as Aglyn from '@aglyn/aglyn'
import { mdiTagOutline } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { forwardRef, useContext } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  UNRESOLVED_TOKEN,
  ENTRY_SAMPLE_PUBLISHED_AT,
  ENTRY_SAMPLE_AUTHOR,
  ENTRY_SAMPLE_CATEGORY,
  ENTRY_SAMPLE_TAGS,
  samplePortraitSx,
  metaValue,
  SAFE_AUTHOR_HREF,
} from './collection-common'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const ENTRY_META_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID

export interface CollectionEntryMetaProps extends StackProps {
  /**
   * Published date. Server-filled from the routed entry on entry templates
   * (`expandCollectionEntryMeta`, AGL-1385); set it — or bind
   * `{{entry.date}}` — only to override.
   */
  date?: string
  /**
   * How {@link date} reads when the server fills it in (AGL-1459) — a
   * COMPOSE-TIME prop, like Related Posts' `limit`: it is answered where the
   * timestamp still exists (`expandCollectionEntryMeta`) and never reaches the
   * DOM. Blank, or `default`, is the locale date the block has always emitted.
   */
  dateFormat?: Aglyn.CollectionEntryDateFormat
  /**
   * Byline (AGL-1459). Server-filled from the entry's own author on entry
   * templates, exactly like {@link date}; set it — or bind `{{entry.author}}`
   * — only to override.
   */
  author?: string
  /** Category; server-filled, or bind `{{entry.category}}` to override. */
  category?: string
  /** Comma-joined tags; server-filled, or bind `{{entry.tags}}`. */
  tags?: string
  /**
   * Round avatar shown before the byline (AGL-1459) — a media-picker target,
   * so it holds a media reference (AGL-1215) as well as any URL form.
   *
   * A block-level pick, deliberately, and NOT a per-author image: entries
   * carry an author NAME (`authorName`) and no portrait field, so a per-author
   * avatar would need a schema decision on the entry model plus an editor
   * field to fill it. Until then this is the site's brand mark, chosen once on
   * the template — which is what the article frame actually asks for. Left
   * unset it renders nothing at all, never a broken image.
   */
  avatarImage?: string
  showDate?: boolean
  showAuthor?: boolean
  /**
   * Where the byline's NAME links — the author's page on this site
   * (AGL-2519). Server-filled from the routed entry's author, like the
   * avatar beside it; blank renders the name as plain text.
   *
   * Distinct from the author's own `url`, which the Entry Author card offers
   * as a link row: this is "everything they wrote here", that is "their
   * site", and a byline that conflated them would send a reader off-site from
   * every article.
   */
  authorPageUrl?: string
  /** Off leaves the byline as plain text even when the author has a page. */
  linkAuthor?: boolean
  showCategory?: boolean
  showTags?: boolean
  showAvatar?: boolean
}

/** Byline avatar, from the article frame (Figma 170:190). */
const ENTRY_AVATAR_SIZE = 36

/**
 * "{{entry.date}} · {{entry.category}}" meta line plus tag chips
 * (AGL-582). Values arrive through entry tokens on entry renders; on other
 * surfaces unresolved tokens collapse to nothing instead of leaking.
 *
 * On an entry template the tenant now also FILLS the three values from the
 * routed entry when nothing is bound (`expandCollectionEntryMeta`, AGL-1385).
 * Before that, a block dragged from the palette rather than dropped as the
 * preset had no values at all — three "Show" switches gating nothing — and
 * rendered as the empty `<Box>` below, at height 0.
 */
const CollectionEntryMeta = forwardRef<
  HTMLDivElement,
  CollectionEntryMetaProps
>((props, ref) => {
  const {
    date,
    // Compose-time (AGL-1459): read by `expandCollectionEntryMeta`, which has
    // the timestamp. Destructured so it never reaches the DOM.
    dateFormat: _dateFormat,
    author,
    authorPageUrl,
    linkAuthor,
    category,
    tags,
    avatarImage,
    showDate,
    showAuthor,
    showCategory,
    showTags,
    showAvatar,
    ...rest
  } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  // The resolver every other surface shares (AGL-1215), so one media
  // reference keeps working across sites. A hook — before any early return.
  const { hostId } = Aglyn.useSite()
  const dateValue = showDate !== false ? metaValue(date, suppressNavigation) : ''
  const authorValue =
    showAuthor !== false ? metaValue(author, suppressNavigation) : ''
  const categoryValue =
    showCategory !== false ? metaValue(category, suppressNavigation) : ''
  const tagsValue = showTags !== false ? metaValue(tags, suppressNavigation) : ''
  const tagList = tagsValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  // An unresolved token empties on EVERY surface here, unlike the text
  // fields: a literal `{{…}}` in a src is a broken image in the canvas, and a
  // byline that renders a broken avatar on every post is worse than no
  // avatar at all.
  const avatarRaw = (avatarImage ?? '').trim()
  const avatarSrc =
    showAvatar !== false && avatarRaw && !UNRESOLVED_TOKEN.test(avatarRaw)
      ? Aglyn.resolveMediaSrc(avatarRaw, { hostId })
      : ''
  // Author leads, so the frame's "The Aglyn Team · Jul 2026" reads in that
  // order. With no author the join is character-for-character what it was.
  const filledLine = [authorValue, dateValue, categoryValue]
    .filter(Boolean)
    .join(' · ')
  /*
    The rest of the line, WITHOUT the author (AGL-2519).

    The row is one string everywhere else, which is what a `·`-joined byline
    wants — but a link is an element, so the author has to come out of the
    join to be one. Split rather than reassembled from parts, so the
    separator, the order and the empty-field collapsing all stay in the one
    expression above: the linked row and the plain row cannot render a
    different sentence.
  */
  const authorHrefRaw = metaValue(authorPageUrl, suppressNavigation)
  const authorHref =
    linkAuthor !== false && SAFE_AUTHOR_HREF.test(authorHrefRaw)
      ? authorHrefRaw
      : ''
  const trailingLine = [dateValue, categoryValue].filter(Boolean).join(' · ')
  // Nothing to show and nothing to route from: an editing surface previews
  // the block's own markup at the author's own settings, and a published page
  // renders nothing at all (AGL-2486). The switches are honoured here exactly
  // as they are below, so a row with Show date off previews without one.
  const sample = !filledLine && !tagList.length && !avatarSrc && suppressNavigation
  const line = sample
    ? [
        showAuthor !== false ? ENTRY_SAMPLE_AUTHOR : '',
        showDate !== false
          ? Aglyn.formatCollectionEntryDate(
              ENTRY_SAMPLE_PUBLISHED_AT,
              Aglyn.normalizeCollectionEntryDateFormat(_dateFormat),
            )
          : '',
        showCategory !== false ? ENTRY_SAMPLE_CATEGORY : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : filledLine
  const chips = sample
    ? showTags !== false
      ? ENTRY_SAMPLE_TAGS.split(',').map((tag) => tag.trim())
      : []
    : tagList
  // The portrait an entry's own author record supplies arrives at compose
  // time, so on the canvas there is none to resolve — the slot is drawn
  // instead, which is what a byline's spacing is actually built around.
  const samplePortrait = sample && showAvatar !== false
  if (!line && !chips.length && !avatarSrc && !samplePortrait) {
    return <Box ref={ref} {...rest} />
  }
  return (
    <MuiStack
      ref={ref}
      direction="row"
      spacing={1}
      {...rest}
      // MERGE, never replace (AGL-1450, same class as AGL-1284). `rest.sx`
      // is the ARRAY `mergeSxProps` builds in leaf.tsx, so spreading it into
      // an object produced `{0: …, 1: …, 2: …}` — numeric keys emotion emits
      // as invalid selectors — and discarded EVERY authored property while
      // these two defaults still applied. The block looked deliberately
      // styled, so nothing suggested the value had been dropped. Defaults
      // go first; the node's slice comes after and can override them.
      sx={[{ alignItems: 'center', flexWrap: 'wrap' }, ...nodeSx]}
    >
      {avatarSrc ? (
        <Box
          component="img"
          src={avatarSrc}
          // Decorative: the byline names the author in text right beside it,
          // so a screen reader announcing the mark again is noise.
          alt=""
          sx={{
            display: 'block',
            width: ENTRY_AVATAR_SIZE,
            height: ENTRY_AVATAR_SIZE,
            borderRadius: '50%',
            objectFit: 'cover',
            // No background plate: a brand mark with a transparent ground
            // would sit on a grey disc nobody asked for.
          }}
          // `lazy` alone, same as Related Posts' rail (AGL-2486). A
          // byline avatar is decorative and tiny; it has no business
          // outranking anything.
          {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
        />
      ) : samplePortrait ? (
        <Box aria-hidden sx={samplePortraitSx(ENTRY_AVATAR_SIZE)} />
      ) : null}
      {line ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {
            // Linked only on the real byline, never on the canvas sample: a
            // preview whose placeholder name navigates is a trap, and the
            // sample author has no page to go to.
            authorHref && authorValue && !sample ? (
              <>
                <AppLink
                  href={authorHref}
                  sx={{ color: 'inherit' }}
                  underline="hover"
                >
                  {authorValue}
                </AppLink>
                {trailingLine ? ` · ${trailingLine}` : ''}
              </>
            ) : (
              line
            )
          }
        </Typography>
      ) : null}
      {chips.map((tag) => (
        <Chip key={tag} label={tag} size="small" variant="outlined" />
      ))}
    </MuiStack>
  )
})
CollectionEntryMeta.displayName = 'AglynCollectionEntryMeta'

export const collectionEntryMetaSchema: Aglyn.ComponentSchema<CollectionEntryMetaProps> =
  {
    $id: ENTRY_META_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Entry Meta',
    description:
      'The byline row for an entry — author, date, category and tags.',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'date',
        label: 'Date',
        description:
          'Blank shows the entry’s own published date on entry templates. ' +
          'Type here (or bind {{entry.date}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'dateFormat',
        label: 'Date format',
        description:
          'How the published date reads. Site default is the format this ' +
          'block has always used; it has no effect on a Date you typed in ' +
          'yourself.',
        component: Aglyn.FieldComponentType.SELECT,
        // The formats the pure layer knows how to produce, so the list cannot
        // offer a shape nothing renders. Every value is REAL — including the
        // do-nothing one (AGL-1451/AGL-1453): `''` cannot survive a save, so
        // an author who tried a format would have no route back.
        options: [...Aglyn.COLLECTION_ENTRY_DATE_FORMAT_OPTIONS],
      },
      {
        name: 'author',
        label: 'Author',
        description:
          'Blank shows the entry’s own author. Type here (or bind ' +
          '{{entry.author}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'category',
        label: 'Category',
        description:
          'Blank shows the entry’s own category. Type here (or bind ' +
          '{{entry.category}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'tags',
        label: 'Tags',
        description:
          'Comma-separated. Blank shows the entry’s own tags; type here (or ' +
          'bind {{entry.tags}}) only to override them.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'avatarImage',
        label: 'Avatar',
        description:
          'Round image before the byline — your brand mark, or any image ' +
          'from the media library. Blank shows no avatar.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'showDate',
        label: 'Show date',
        description:
          'Off hides the published date from the line without clearing what ' +
          'the Date field would have shown.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means SHOWN in the renderer above, so the switch has to
        // OPEN in that position or it lies about the block in front of
        // the author — and the first click, which writes the `true` that
        // was already in effect, changes nothing and reads as a dead
        // control (AGL-2506).
        initialValue: true,
      },
      {
        name: 'showCategory',
        label: 'Show category',
        description:
          'Off drops the category from the line. The entry keeps its ' +
          'category — this is about the byline, not the taxonomy.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means SHOWN in the renderer above, so the switch has to
        // OPEN in that position or it lies about the block in front of
        // the author — and the first click, which writes the `true` that
        // was already in effect, changes nothing and reads as a dead
        // control (AGL-2506).
        initialValue: true,
      },
      {
        name: 'showTags',
        label: 'Show tags',
        description:
          'Off hides the tag chips below the line. Leave it on and the ' +
          'other three off for a tags-only row.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means SHOWN in the renderer above, so the switch has to
        // OPEN in that position or it lies about the block in front of
        // the author — and the first click, which writes the `true` that
        // was already in effect, changes nothing and reads as a dead
        // control (AGL-2506).
        initialValue: true,
      },
      {
        name: 'authorPageUrl',
        label: 'Author links to',
        description:
          'Blank sends the byline to the author’s page on this site. Type ' +
          'here (or bind {{entry.authorPageUrl}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'linkAuthor',
        label: 'Link author',
        description:
          'Off leaves the byline as plain text even when the author has a ' +
          'page. On, the name links there and the date and category beside ' +
          'it do not.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means LINKED in the renderer above, so the switch has to open
        // in that position or it lies about the block in front of the author
        // (AGL-2506).
        initialValue: true,
      },
      {
        name: 'showAuthor',
        label: 'Show author',
        description:
          'Off hides the byline. The avatar follows it: a block with no ' +
          'author shown never fills in the author’s portrait.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means SHOWN in the renderer above, so the switch has to
        // OPEN in that position or it lies about the block in front of
        // the author — and the first click, which writes the `true` that
        // was already in effect, changes nothing and reads as a dead
        // control (AGL-2506).
        initialValue: true,
      },
      {
        name: 'showAvatar',
        label: 'Show avatar',
        description:
          'Off hides the round image in front of the byline, including an ' +
          'author’s own portrait.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means SHOWN in the renderer above, so the switch has to
        // OPEN in that position or it lies about the block in front of
        // the author — and the first click, which writes the `true` that
        // was already in effect, changes nothing and reads as a dead
        // control (AGL-2506).
        initialValue: true,
      },
    ],
  }

export { CollectionEntryMeta }
