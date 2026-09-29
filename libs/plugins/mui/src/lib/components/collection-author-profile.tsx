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
export const AUTHOR_PROFILE_ID: Aglyn.ComponentId =
  Aglyn.CONTENT_AUTHOR_PROFILE_COMPONENT_ID

export interface ContentAuthorProfileProps extends StackProps {
  /**
   * The byline. Server-filled from the routed author on their own page
   * (`expandContentAuthorProfile`); set it — or bind `{{author.name}}` —
   * only to override.
   */
  name?: string
  /** The blurb from their record; bind `{{author.bio}}` to override. */
  bio?: string
  /**
   * Portrait or logo — a media reference (AGL-1215) or any URL, filled from
   * the record so the face follows the person rather than the template.
   */
  image?: string
  /** Person only — what they do; blank on an Organization. */
  jobTitle?: string
  /** Person only — who they write for. */
  worksFor?: string
  /**
   * Their OWN site. The name links here; blank renders it as plain text.
   * This block already IS the author's page, so it does not link to itself.
   */
  url?: string
  /** Their profile links, server-filled from the record (AGL-2516). */
  links?: Aglyn.ContentAuthorLink[]
  showBio?: boolean
  showAvatar?: boolean
  showRole?: boolean
  showLinks?: boolean
}

/** The page subject's portrait — a step up from the card's 48px. */
const PROFILE_AVATAR_SIZE = 96

/**
 * Who an author page is about (AGL-2518) — portrait, name, role, bio, links.
 *
 * The Entry Author card renders the same person as a footnote under an
 * article. This renders them as the SUBJECT of a page, which is why it has
 * the two fields that card has no room for: `jobTitle` and `worksFor` are
 * what tell a stranger who they are looking at, and they are already on the
 * record because `schema.org/Person` defines them (AGL-2486).
 *
 * Every field is independently overridable and every one collapses when
 * empty, exactly as the card's do — an author with no portrait renders the
 * text alone rather than a gap where a face would be. On an editing surface
 * the block previews its own shape with sample text, because a template is
 * designed before any author is routed through it.
 */
const ContentAuthorProfile = forwardRef<
  HTMLDivElement,
  ContentAuthorProfileProps
>((props, ref) => {
  // None of these are DOM attributes (`name` least of all), so they are
  // destructured rather than spread — the stack.ts pattern.
  const {
    name,
    bio,
    image,
    jobTitle,
    worksFor,
    url,
    links,
    showBio,
    showAvatar,
    showRole,
    showLinks,
    ...rest
  } = props
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  const { hostId } = Aglyn.useSite()
  const nameValue = metaValue(name, suppressNavigation)
  const bioValue = showBio !== false ? metaValue(bio, suppressNavigation) : ''
  const jobValue = showRole !== false ? metaValue(jobTitle, suppressNavigation) : ''
  const worksForValue =
    showRole !== false ? metaValue(worksFor, suppressNavigation) : ''
  const urlRaw = metaValue(url, suppressNavigation)
  const urlValue = SAFE_AUTHOR_HREF.test(urlRaw) ? urlRaw : ''
  // An unresolved token empties on EVERY surface, as in the byline: a literal
  // `{{…}}` in a src is a broken portrait in the canvas.
  const imageRaw = (image ?? '').trim()
  const imageSrc =
    showAvatar !== false && imageRaw && !UNRESOLVED_TOKEN.test(imageRaw)
      ? Aglyn.resolveMediaSrc(imageRaw, { hostId })
      : ''
  const linkRows = safeAuthorLinks(links, showLinks)
  // Nothing routed and nothing typed: an editing surface previews the block's
  // own markup at its own settings, and a published page renders nothing at
  // all. Every part still answers its own switch, so a block with Show bio
  // off previews as portrait and name.
  const sample =
    !nameValue &&
    !bioValue &&
    !jobValue &&
    !imageSrc &&
    !linkRows.length &&
    Boolean(suppressNavigation)
  const displayName = sample ? ENTRY_SAMPLE_AUTHOR : nameValue
  const displayBio = sample && showBio !== false ? ENTRY_SAMPLE_BIO : bioValue
  const samplePortrait = sample && showAvatar !== false
  /**
   * "Founder at Aglyn" — one line, from two fields, and a middle dot would be
   * wrong here: this is a phrase, not a list of facts like the byline's
   * `name · date`. Either field alone still reads.
   */
  const roleLine = [jobValue, worksForValue].filter(Boolean).join(' at ')
  if (
    !displayName &&
    !displayBio &&
    !roleLine &&
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
      spacing={3}
      {...rest}
      // MERGE, never replace (AGL-1450): `rest.sx` is the array leaf.tsx
      // builds, and spreading it into an object drops every authored value.
      sx={[{ alignItems: 'flex-start' }, ...nodeSx]}
    >
      {imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          // Decorative: the block names the author in text right beside it.
          alt=""
          sx={{
            display: 'block',
            flexShrink: 0,
            width: PROFILE_AVATAR_SIZE,
            height: PROFILE_AVATAR_SIZE,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
          {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
        />
      ) : samplePortrait ? (
        <Box aria-hidden sx={samplePortraitSx(PROFILE_AVATAR_SIZE)} />
      ) : null}
      <MuiStack spacing={1} sx={{ minWidth: 0 }}>
        {displayName ? (
          // `h1` because the author IS this page's subject — the one heading
          // rule a built-in body has to get right, since the template around
          // it cannot know what the block will be handed.
          <Typography component="h1" variant="h4">
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
        {roleLine ? (
          <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
            {roleLine}
          </Typography>
        ) : null}
        {displayBio ? (
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            {displayBio}
          </Typography>
        ) : null}
        <AuthorLinkRows links={linkRows} size={1} />
      </MuiStack>
    </MuiStack>
  )
})
ContentAuthorProfile.displayName = 'AglynContentAuthorProfile'

export { ContentAuthorProfile }

export const contentAuthorProfileSchema: Aglyn.ComponentSchema<ContentAuthorProfileProps> =
  {
    $id: AUTHOR_PROFILE_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Author Profile',
    description:
      'Who an author page is about — portrait, name, role, bio and links.',
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
          'Blank shows the name of the author whose page this is. Type here ' +
          '(or bind {{author.name}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'bio',
        label: 'Bio',
        description:
          'Blank shows the bio from the author’s record. Type here (or bind ' +
          '{{author.bio}}) only to override it.',
        component: Aglyn.FieldComponentType.TEXTAREA,
      },
      {
        name: 'image',
        label: 'Portrait',
        description:
          'Blank shows the portrait of the author whose page this is, at the ' +
          'larger size a profile takes. Pick from your media library only to ' +
          'override it.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'jobTitle',
        label: 'Role',
        description:
          'Blank shows the job title from the author’s record. Only a person ' +
          'has one — an author record set to Organization leaves it empty.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'worksFor',
        label: 'Organization',
        description:
          'Blank shows who the author writes for, from their record. Shown ' +
          'after the role as "Role at Organization".',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'url',
        label: 'Link',
        description:
          'Blank uses the author’s own url. The name links here; with no url ' +
          'it renders as plain text. This block is already the author’s page ' +
          'on this site, so it never links to itself.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'showLinks',
        label: 'Show links',
        description:
          'Off hides the row of profile links under the bio — the place a ' +
          'reader follows this author elsewhere. Turning it off on a page ' +
          'about them is rarely what you want.',
        component: Aglyn.FieldComponentType.SWITCH,
        // Unset means SHOWN in the renderer above, so the switch has to open
        // in that position or it lies about the block in front of the author
        // (AGL-2506).
        initialValue: true,
      },
      {
        name: 'showBio',
        label: 'Show bio',
        description:
          'Off leaves the block as a portrait, a name and a role.',
        component: Aglyn.FieldComponentType.SWITCH,
        initialValue: true,
      },
      {
        name: 'showRole',
        label: 'Show role',
        description:
          'Off hides the "Role at Organization" line under the name.',
        component: Aglyn.FieldComponentType.SWITCH,
        initialValue: true,
      },
      {
        name: 'showAvatar',
        label: 'Show portrait',
        description:
          'Off drops the portrait and lets the name and bio run the full ' +
          'width, with no space held for a picture.',
        component: Aglyn.FieldComponentType.SWITCH,
        initialValue: true,
      },
    ],
  }
