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
import { mdiAccountCircleOutline } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { forwardRef, useContext } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  UNRESOLVED_TOKEN,
  ENTRY_SAMPLE_AUTHOR,
  ENTRY_SAMPLE_BIO,
  samplePortraitSx,
  metaValue,
  SAFE_AUTHOR_HREF,
  EXTERNAL_AUTHOR_HREF,
} from './collection-common'
import { AuthorLinkRows, safeAuthorLinks } from './collection-author-links'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const ENTRY_AUTHOR_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_AUTHOR_COMPONENT_ID

export interface CollectionEntryAuthorProps extends StackProps {
  /**
   * The byline. Server-filled from the routed entry's author record on entry
   * templates (`expandCollectionEntryAuthor`), exactly like Entry Meta's
   * fields; set it — or bind `{{entry.author}}` — only to override.
   */
  name?: string
  /**
   * The author's blurb, from their record's `bio`; bind
   * `{{entry.authorBio}}` to override.
   */
  bio?: string
  /**
   * Portrait or logo — a media reference (AGL-1215) or any URL. Server-filled
   * from the author record, so the face changes with the byline instead of
   * being picked once on the template the way Entry Meta's avatar is.
   */
  image?: string
  /** The author's own site; offered as a link row beside the profile ones. */
  url?: string
  /**
   * The author's page on THIS site (AGL-2519), server-filled from the routed
   * entry. The name links here.
   *
   * It wins over {@link url} for the NAME, and the ordering is the point: a
   * reader who clicks a byline at the end of an article is asking "what else
   * has this person written here", not "take me off this site". Their own
   * url is still reachable — it is one of the link rows — so nothing is lost
   * by giving the name the destination that answers the question asked.
   */
  pageUrl?: string
  /**
   * The author's profile links, server-filled from their record (AGL-2516).
   *
   * Not authorable as text: each row carries a platform or a picked icon, and
   * the console's author editor is where those are chosen. `Show links` is
   * the template's control over them.
   */
  links?: Aglyn.ContentAuthorLink[]
  showBio?: boolean
  showAvatar?: boolean
  showLinks?: boolean
}

/** The card's portrait, larger than the byline's 36px mark (Figma 170:190). */
const AUTHOR_AVATAR_SIZE = 48

/**
 * The author card that closes an article (AGL-2486) — portrait, byline, bio.
 *
 * Entry Meta prints a NAME beside a date, which is all an entry carried when
 * it was written: one free-typed string. Custom authors made the byline a
 * record with a portrait, a bio and a url, and a template that wanted the
 * card the article frame draws still had to type the name and the blurb in as
 * literal text — text that keeps saying whatever it said under posts somebody
 * else wrote, and that no edit to the author record can ever reach. This is
 * that card, filled from the record.
 *
 * Every field is independently overridable and every one of them collapses
 * when empty: an author with no portrait renders the text alone rather than a
 * gap where a face would be, and an entry with no author at all renders
 * nothing — never an empty bordered box.
 */
const CollectionEntryAuthor = forwardRef<
  HTMLDivElement,
  CollectionEntryAuthorProps
>((props, ref) => {
  // None of these are DOM attributes (`name` least of all), so they are
  // destructured rather than spread — the stack.ts pattern.
  const {
    name,
    bio,
    image,
    url,
    pageUrl,
    links,
    showBio,
    showAvatar,
    showLinks,
    ...rest
  } = props
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  const { hostId } = Aglyn.useSite()
  const nameValue = metaValue(name, suppressNavigation)
  const bioValue = showBio !== false ? metaValue(bio, suppressNavigation) : ''
  // Their page here first, their own site second (AGL-2519) — see `pageUrl`.
  const hrefRaw = metaValue(pageUrl, suppressNavigation) ||
    metaValue(url, suppressNavigation)
  const urlValue = SAFE_AUTHOR_HREF.test(hrefRaw) ? hrefRaw : ''
  // An unresolved token empties on EVERY surface, as in the byline: a literal
  // `{{…}}` in a src is a broken portrait in the canvas.
  const imageRaw = (image ?? '').trim()
  const imageSrc =
    showAvatar !== false && imageRaw && !UNRESOLVED_TOKEN.test(imageRaw)
      ? Aglyn.resolveMediaSrc(imageRaw, { hostId })
      : ''
  // Nothing to show and nothing to route from: an editing surface previews
  // the card's own markup at the author's own settings, and a published page
  // renders nothing at all (AGL-2486). Every part still answers its own
  // switch, so a card with Show bio off previews as portrait and name.
  const sample = !nameValue && !bioValue && !imageSrc && Boolean(suppressNavigation)
  const displayName = sample ? ENTRY_SAMPLE_AUTHOR : nameValue
  const displayBio = sample && showBio !== false ? ENTRY_SAMPLE_BIO : bioValue
  // The record's portrait arrives at compose time, so there is none to
  // resolve on the canvas — the card draws its slot, which is the thing its
  // spacing is built around.
  const samplePortrait = sample && showAvatar !== false
  /**
   * The rows this card will actually draw (AGL-2516).
   *
   * Guarded here rather than trusted from the store: these arrive as PROPS,
   * so a link can reach the renderer without passing the record normalizer,
   * and `javascript:` has to be unreachable rather than merely unlikely — the
   * same reason the byline's own `url` is checked twice.
   */
  const linkRows = safeAuthorLinks(links, showLinks)
  if (
    !displayName &&
    !displayBio &&
    !imageSrc &&
    !samplePortrait &&
    !linkRows.length
  ) {
    return <Box ref={ref} {...rest} />
  }
  return (
    <MuiStack
      ref={ref}
      direction="row"
      spacing={2}
      {...rest}
      // MERGE, never replace (AGL-1450): `rest.sx` is the array leaf.tsx
      // builds, and spreading it into an object drops every authored value.
      sx={[
        {
          alignItems: 'flex-start',
          p: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        },
        ...nodeSx,
      ]}
    >
      {imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          // Decorative: the card names the author in text right beside it.
          alt=""
          sx={{
            display: 'block',
            flexShrink: 0,
            width: AUTHOR_AVATAR_SIZE,
            height: AUTHOR_AVATAR_SIZE,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
          {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
        />
      ) : samplePortrait ? (
        <Box aria-hidden sx={samplePortraitSx(AUTHOR_AVATAR_SIZE)} />
      ) : null}
      <MuiStack spacing={0.5} sx={{ minWidth: 0 }}>
        {displayName ? (
          <Typography component="p" variant="subtitle2">
            {urlValue ? (
              <AppLink
                href={urlValue}
                sx={{ color: 'inherit' }}
                underline="hover"
                {...(EXTERNAL_AUTHOR_HREF.test(urlValue)
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {displayName}
              </AppLink>
            ) : (
              displayName
            )}
          </Typography>
        ) : null}
        {displayBio ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {displayBio}
          </Typography>
        ) : null}
        <AuthorLinkRows links={linkRows} />
      </MuiStack>
    </MuiStack>
  )
})
CollectionEntryAuthor.displayName = 'AglynCollectionEntryAuthor'

export const collectionEntryAuthorSchema: Aglyn.ComponentSchema<CollectionEntryAuthorProps> =
  {
    $id: ENTRY_AUTHOR_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Entry Author',
    description: 'The author card for an entry — portrait, byline and bio.',
    category: Aglyn.ComponentCategory.TEXT,
    icon: {
      path: mdiAccountCircleOutline.path,
      sx: { color: 'secondary.main' },
    },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'name',
        label: 'Name',
        description:
          'Blank shows the name from the entry’s author record. Type here ' +
          '(or bind {{entry.author}}) to sign this card differently from ' +
          'the byline above the article.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'bio',
        label: 'Bio',
        description:
          'Blank shows the bio from the author’s record. Type here (or bind ' +
          '{{entry.authorBio}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXTAREA,
      },
      {
        name: 'image',
        label: 'Portrait',
        description:
          'Blank shows the portrait from the author’s record. Pick from your ' +
          'media library with "Browse media" only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'pageUrl',
        label: 'Name links to',
        description:
          'Blank sends the name to the author’s page on this site — ' +
          'everything they wrote. Falls back to their own url when they have ' +
          'no page; type here to override both.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'url',
        label: 'Their own site',
        description:
          'Blank uses the url on the author’s record. Used only when they ' +
          'have no page on this site for the name to link to.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'showLinks',
        label: 'Show links',
        description:
          'Off hides the author’s profile links. They come from the author ' +
          'record — a known platform brings its own mark, and a custom link ' +
          'brings the icon and label chosen there.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means SHOWN in the renderer above, so the switch has to open
        // in that position or it lies about the card in front of the author
        // (AGL-2506).
        initialValue: true,
      },
      {
        name: 'showBio',
        label: 'Show bio',
        description:
          'Off leaves the card as a portrait and a name — for a masthead ' +
          'where the blurb would repeat what the page already says.',
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
        label: 'Show portrait',
        description:
          'Off leaves the text alone, with no space held for a picture.',
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

export { CollectionEntryAuthor }
