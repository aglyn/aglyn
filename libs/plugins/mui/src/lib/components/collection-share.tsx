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
  mdiContentCopy,
  mdiFacebook,
  mdiLinkedin,
  mdiShareVariant,
  mdiTwitter,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import IconButton from '@mui/material/IconButton'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { forwardRef, useContext, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const SHARE_ID: Aglyn.ComponentId = Aglyn.COLLECTION_SHARE_COMPONENT_ID

export interface CollectionShareProps extends StackProps {
  /** Heading before the buttons; empty string hides it. */
  heading?: string
}

const SHARE_TARGETS = [
  {
    label: 'Share on X',
    path: mdiTwitter.path,
    href: (url: string) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}`,
  },
  {
    label: 'Share on LinkedIn',
    path: mdiLinkedin.path,
    href: (url: string) =>
      'https://www.linkedin.com/sharing/share-offsite/?url=' +
      encodeURIComponent(url),
  },
  {
    label: 'Share on Facebook',
    path: mdiFacebook.path,
    href: (url: string) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
]

/**
 * Share buttons for the CURRENT page URL (AGL-582): X, LinkedIn, Facebook,
 * and copy-link. Pure client behavior — the URL is read at click time so
 * SSR and besigner renders stay markup-identical; editing surfaces no-op.
 */
const CollectionShare = forwardRef<HTMLDivElement, CollectionShareProps>(
  (props, ref) => {
    const { heading, ...rest } = props
    // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
    const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const [copied, setCopied] = useState(false)
    const title = heading ?? 'Share'
    const open = (buildHref: (url: string) => string) => () => {
      if (suppressNavigation || typeof window === 'undefined') return
      window.open(
        buildHref(window.location.href),
        '_blank',
        'noopener,noreferrer',
      )
    }
    const copy = async () => {
      if (suppressNavigation || typeof window === 'undefined') return
      try {
        await navigator.clipboard.writeText(window.location.href)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Clipboard unavailable (permissions, http) — silently skip.
      }
    }
    return (
      <MuiStack
        ref={ref}
        direction="row"
        spacing={0.5}
        {...rest}
        // MERGE, never replace (AGL-1450) — see collection-entry-meta.tsx.
        sx={[{ alignItems: 'center' }, ...nodeSx]}
      >
        {title ? (
          // `component="p"` because this labels a row of buttons; it is not a
          // section heading (AGL-2486). MUI's `defaultVariantMapping` sends
          // `subtitle2` to `<h6>`, so without this the Share Bar puts a level-6
          // heading into the document outline of every page carrying it. On a
          // blog post the nearest preceding heading is an `h2`, which makes it
          // a skipped level and a `heading-order` failure.
          //
          // Said here rather than as a theme-wide `variantMapping` override: a
          // default would silently change the element under every `subtitle2`
          // in the codebase, including surfaces where an `h6` is correct.
          <Typography component="p" variant="subtitle2" sx={{ mr: 1 }}>
            {title}
          </Typography>
        ) : null}
        {SHARE_TARGETS.map((target) => (
          <IconButton
            key={target.label}
            aria-label={target.label}
            size="small"
            onClick={open(target.href)}
          >
            <MdiIcon path={target.path} />
          </IconButton>
        ))}
        <IconButton
          aria-label={copied ? 'Link copied' : 'Copy link'}
          size="small"
          color={copied ? 'success' : 'default'}
          onClick={copy}
        >
          <MdiIcon path={mdiContentCopy.path} />
        </IconButton>
      </MuiStack>
    )
  },
)
CollectionShare.displayName = 'AglynCollectionShare'

export const collectionShareSchema: Aglyn.ComponentSchema<CollectionShareProps> =
  {
    $id: SHARE_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Share Bar',
    description: 'Share buttons for the current page, plus a copy link.',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'heading',
        label: 'Heading',
        description: 'Text before the buttons (blank hides it).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
    ],
  }

export { CollectionShare }
