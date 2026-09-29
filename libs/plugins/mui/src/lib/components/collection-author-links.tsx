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
import {
  mdiEmail,
  mdiFacebook,
  mdiGithub,
  mdiInstagram,
  mdiLinkVariant,
  mdiLinkedin,
  mdiMastodon,
  mdiRss,
  mdiTwitter,
  mdiWeb,
  mdiYoutube,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import MuiStack from '@mui/material/Stack'

/**
 * An author's profile links as a row of marks (AGL-2516), shared by the Entry
 * Author card and the Author Profile block, and by nothing else — its own
 * module so the other collection elements do not download ten platform marks
 * (AGL-3401).
 */

/**
 * The mark for each platform the author model knows (AGL-2516).
 *
 * Imported rather than resolved through the icon catalog, because this set is
 * CLOSED and known at build time — the catalog is ~2.9 MB and only picker
 * surfaces load it, so a renderer that reached for it to draw ten glyphs
 * would ship the whole thing to every visitor of every article.
 *
 * Keyed by the registry's `icon`, so adding a platform is one entry there and
 * one import here, and a platform whose mark was never imported falls through
 * to the generic link glyph rather than rendering nothing.
 */
const AUTHOR_LINK_ICON_PATHS: Record<string, string> = {
  twitter: mdiTwitter.path,
  linkedin: mdiLinkedin.path,
  github: mdiGithub.path,
  mastodon: mdiMastodon.path,
  youtube: mdiYoutube.path,
  instagram: mdiInstagram.path,
  facebook: mdiFacebook.path,
  web: mdiWeb.path,
  email: mdiEmail.path,
  rss: mdiRss.path,
}

/**
 * What one link row draws.
 *
 * A known platform takes its mark from the table above. A CUSTOM link takes
 * the path the console stored beside the picked id (AGL-1212) — and falls back
 * to a generic link glyph rather than to nothing, because a row with a label
 * and a url is still a working link whose icon simply failed to resolve.
 */
function authorLinkIconPath(link: Aglyn.ContentAuthorLink): string {
  const platform = Aglyn.authorLinkPlatform(link.platform)
  if (platform) {
    return AUTHOR_LINK_ICON_PATHS[platform.icon] ?? mdiLinkVariant.path
  }
  return (link.iconPath ?? '').trim() || mdiLinkVariant.path
}

/**
 * Schemes a rendered author link may use — the model's own guard, restated at
 * the boundary that produces the `href`.
 *
 * `normalizeContentAuthorLinks` already drops everything else, and this is
 * deliberately not trusting that: the props on this component are authorable,
 * so a link can reach the renderer without ever passing through the store's
 * normalizer. Two checks, because only one of them is on the path an attacker
 * would use.
 */
const SAFE_AUTHOR_LINK_HREF = /^(https:\/\/|mailto:)/i

/**
 * The author's profile links as a row of marks (AGL-2516).
 *
 * Shared by the article's Entry Author card and the Author Profile block on
 * the author's own page (AGL-2518) — the one part of the two that would
 * genuinely drift, since an icon row is where the accessible-name rule and
 * the `rel` on an off-site profile live.
 *
 * Renders nothing for an empty list, so a caller can drop it in
 * unconditionally rather than guarding at every call site.
 */
export function AuthorLinkRows(props: {
  links: readonly Aglyn.ContentAuthorLink[]
  /** Glyph scale; the profile draws them a step larger than the card. */
  size?: number
}) {
  if (!props.links.length) return null
  return (
    <MuiStack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', ml: -1 }}>
      {props.links.map((link, index) => {
        const label = Aglyn.authorLinkLabel(link)
        return (
          <AppLink
            key={index}
            componentVariant="icon-button"
            href={(link.url ?? '').trim()}
            // The name IS the icon here, so it has to be announced — a row of
            // unlabelled icon buttons is a row a screen reader reads as
            // "link, link, link".
            aria-label={label}
            title={label}
            size="small"
            sx={{ color: 'text.secondary' }}
            // A profile lives off this site by definition, and `mailto:` must
            // not replace the article either.
            target="_blank"
            rel="noopener noreferrer me"
          >
            <MdiIcon path={authorLinkIconPath(link)} size={props.size ?? 0.85} />
          </AppLink>
        )
      })}
    </MuiStack>
  )
}

/**
 * The rows a card will actually draw, guarded at the boundary.
 *
 * These arrive as PROPS, so a link can reach a renderer without ever passing
 * through the store's normalizer — the reason the byline's own `url` is
 * checked twice as well.
 */
export function safeAuthorLinks(
  links: readonly Aglyn.ContentAuthorLink[] | undefined,
  show: boolean | undefined,
): Aglyn.ContentAuthorLink[] {
  if (show === false) return []
  return (links ?? []).filter((link) =>
    SAFE_AUTHOR_LINK_HREF.test((link?.url ?? '').trim()),
  )
}
