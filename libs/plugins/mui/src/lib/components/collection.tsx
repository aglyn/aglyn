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
  mdiNewspaperVariantOutline,
  mdiPostOutline,
  mdiShareVariant,
  mdiTagOutline,
  mdiTextLong,
  mdiTwitter,
} from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import MuiLink from '@mui/material/Link'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { forwardRef, useContext, useMemo, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Persisted component ids (AGL-551/582); the compose pipeline references
// them through @aglyn/aglyn constants. Never rename.
export const ENTRIES_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRIES_COMPONENT_ID
export const ENTRY_BODY_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID
export const RELATED_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_RELATED_COMPONENT_ID
export const SHARE_ID: Aglyn.ComponentId = Aglyn.COLLECTION_SHARE_COMPONENT_ID
export const ENTRY_META_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID

/* ── Collection entries (repeater) ──────────────────────────────────────── */

export interface CollectionEntriesProps extends StackProps {
  /**
   * Collection to repeat over (compose-time, AGL-551). Blank = the
   * collection routed by the current URL on list-template screens.
   */
  collectionSlug?: string
  /** Maximum entries rendered (compose-time; blank = all, capped at 100). */
  entriesLimit?: number | string
  /**
   * Only entries in this category repeat (compose-time, AGL-582).
   * Matches the collection's category by stable id or display name.
   */
  filterCategory?: string
  /** Only entries carrying this tag repeat (compose-time, AGL-582). */
  filterTag?: string
}

/**
 * Repeats its children once per published entry of a content collection
 * (AGL-551) — the collections sibling of the dataset repeatable. The tenant
 * expands it at compose time with `{{entry.*}}` tokens; in the besigner the
 * template renders once with literal tokens, matching the repeatable UX.
 */
const CollectionEntries = forwardRef<HTMLDivElement, CollectionEntriesProps>(
  // collectionSlug/entriesLimit/filter* are compose-time attributes: the
  // tenant expands them before render; strip so they never hit the DOM.
  (
    { collectionSlug, entriesLimit, filterCategory, filterTag, children, ...props },
    ref,
  ) => (
    <MuiStack ref={ref} spacing={4} {...props}>
      {children}
    </MuiStack>
  ),
)
CollectionEntries.displayName = 'AglynCollectionEntries'

export const collectionEntriesSchema: Aglyn.ComponentSchema<CollectionEntriesProps> =
  {
    $id: ENTRIES_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Collection Entries',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiPostOutline.path, sx: { color: '#00796b' } },
    attributes: [
      {
        name: 'collectionSlug',
        label: 'Collection slug',
        description:
          'Content collection whose published entries the children repeat ' +
          'over (e.g. "blog"). Leave blank on a list-template screen to use ' +
          'the collection from the URL.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'entriesLimit',
        label: 'Entries limit',
        description: 'Maximum entries rendered (blank = all, capped at 100).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
      {
        name: 'filterCategory',
        label: 'Filter by category',
        description:
          'Only entries in this category repeat — the category name or its ' +
          'stable id both match (e.g. "Guides"). Blank = no category filter.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'filterTag',
        label: 'Filter by tag',
        description:
          'Only entries carrying this tag repeat (e.g. "nextjs"). Blank = ' +
          'no tag filter.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'spacing',
        label: 'Spacing',
        description: 'Defines the space/gap between entries.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
    ],
  }

/* ── Entry body (markdown) ──────────────────────────────────────────────── */

export interface CollectionEntryBodyProps {
  /**
   * Markdown-lite source. On entry-template screens `{{entry.body}}`
   * resolves to the rendered entry's body at compose time.
   */
  markdown?: string
}

/** A still-unresolved `{{token}}` (no entry context on this render). */
const UNRESOLVED_TOKEN = /^\{\{[^}]+\}\}$/

const renderInlines = (
  inlines: Aglyn.MarkdownInline[],
  suppressNavigation?: boolean,
): ReactNode[] =>
  inlines.map((item, index) =>
    item.type === 'bold' ? (
      <strong key={index}>{item.text}</strong>
    ) : item.type === 'italic' ? (
      <em key={index}>{item.text}</em>
    ) : item.type === 'link' ? (
      // parseMarkdownInlines only emits http(s) or site-relative hrefs.
      // Internal paths route through AppLink for client-side navigation
      // (AGL-582); external links stay plain anchors. Editing surfaces
      // render the link look without an href so clicks never navigate.
      suppressNavigation ? (
        <MuiLink key={index} component="span" sx={{ cursor: 'default' }}>
          {item.text}
        </MuiLink>
      ) : Aglyn.isInternalMarkdownHref(item.href) ? (
        <AppLink key={index} href={item.href}>
          {item.text}
        </AppLink>
      ) : (
        <MuiLink key={index} href={item.href}>
          {item.text}
        </MuiLink>
      )
    ) : (
      <span key={index}>{item.text}</span>
    ),
  )

/**
 * Renders a content entry's markdown-lite body as themed MUI elements
 * (AGL-551): headings, paragraphs, lists, and images pick up the site
 * theme's typography instead of the old unthemed article HTML. Parsing is
 * pure, so the full body server-renders (SEO keeps the article text).
 */
const CollectionEntryBody = forwardRef<
  HTMLDivElement,
  CollectionEntryBodyProps
>((props, ref) => {
  const { markdown, ...rest } = props
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  const source = (markdown ?? '').trim()
  const unresolved = !source || UNRESOLVED_TOKEN.test(source)
  const blocks = useMemo(
    () => (unresolved ? [] : Aglyn.parseMarkdownLite(source)),
    [source, unresolved],
  )
  if (unresolved) {
    // Editing surfaces get an affordance; the published site renders
    // nothing rather than a literal token.
    if (!suppressNavigation) return <Box ref={ref} {...rest} />
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          p: 2,
          border: '1px dashed',
          borderColor: 'divider',
          color: 'text.secondary',
          fontSize: 12,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {'Entry body — the {{entry.body}} markdown renders here'}
      </Box>
    )
  }
  return (
    <Box ref={ref} {...rest}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return block.level === 2 ? (
            <Typography key={index} variant="h4" component="h2" gutterBottom>
              {renderInlines(block.inlines, suppressNavigation)}
            </Typography>
          ) : (
            <Typography key={index} variant="h5" component="h3" gutterBottom>
              {renderInlines(block.inlines, suppressNavigation)}
            </Typography>
          )
        }
        if (block.type === 'image') {
          return (
            <Box
              key={index}
              component="img"
              src={block.src}
              alt={block.alt}
              sx={{ maxWidth: '100%', borderRadius: 1, my: 1 }}
            />
          )
        }
        if (block.type === 'list') {
          return (
            <Box key={index} component="ul" sx={{ lineHeight: 1.7, pl: 3 }}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlines(item, suppressNavigation)}
                </li>
              ))}
            </Box>
          )
        }
        return (
          <Typography
            key={index}
            variant="body1"
            sx={{ lineHeight: 1.7 }}
            gutterBottom
          >
            {renderInlines(block.inlines, suppressNavigation)}
          </Typography>
        )
      })}
    </Box>
  )
})
CollectionEntryBody.displayName = 'AglynCollectionEntryBody'

export const collectionEntryBodySchema: Aglyn.ComponentSchema<CollectionEntryBodyProps> =
  {
    $id: ENTRY_BODY_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Entry Body',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTextLong.path, sx: { color: '#00796b' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'markdown',
        label: 'Markdown',
        description:
          'Markdown-lite content. Keep {{entry.body}} on entry-template ' +
          "screens so each entry's body renders here.",
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
    ],
  }

/* ── Related posts (AGL-582) ────────────────────────────────────────────── */

/** One related post as stamped by the compose pipeline (AGL-582). */
export interface CollectionRelatedProps extends StackProps {
  /** Section heading; empty string hides it. */
  heading?: string
  /** Compose-time: most related posts listed (default 3). */
  limit?: number | string
  /**
   * Server-stamped related posts (`expandCollectionRelated`); never set by
   * hand — the tenant computes it from the current entry's category/tags.
   */
  entries?: Aglyn.CollectionRelatedItem[]
}

/**
 * Lists other entries of the same collection sharing the current entry's
 * category or a tag (AGL-582). The tenant stamps `entries` at compose time
 * on entry renders; without them the besigner shows an affordance and the
 * published site renders nothing.
 */
const CollectionRelated = forwardRef<HTMLDivElement, CollectionRelatedProps>(
  (props, ref) => {
    // `limit` is compose-time: the tenant resolves it while stamping
    // `entries`; strip it so it never hits the DOM.
    const { heading, limit, entries, ...rest } = props
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    if (!entries?.length) {
      if (!suppressNavigation) return <Box ref={ref} {...rest} />
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            p: 2,
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'Related posts — entries sharing this entry’s category or ' +
            'tags render here'}
        </Box>
      )
    }
    const title = heading ?? 'Related articles'
    return (
      <MuiStack ref={ref} spacing={1.5} {...rest}>
        {title ? (
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
        ) : null}
        {entries.map((entry, index) => (
          <MuiStack key={index} spacing={0.25}>
            {suppressNavigation ? (
              <Typography variant="subtitle1">{entry.title}</Typography>
            ) : (
              <AppLink href={entry.url} variant="subtitle1">
                {entry.title}
              </AppLink>
            )}
            {entry.date || entry.category ? (
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary' }}
              >
                {[entry.date, entry.category].filter(Boolean).join(' · ')}
              </Typography>
            ) : null}
          </MuiStack>
        ))}
      </MuiStack>
    )
  },
)
CollectionRelated.displayName = 'AglynCollectionRelated'

export const collectionRelatedSchema: Aglyn.ComponentSchema<CollectionRelatedProps> =
  {
    $id: RELATED_ID,
    pluginId: BUNDLE_ID,
    displayName: 'Related Posts',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiNewspaperVariantOutline.path, sx: { color: '#00796b' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'heading',
        label: 'Heading',
        description: 'Section heading (blank hides it).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'limit',
        label: 'Limit',
        description: 'Most related posts listed (default 3).',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
        type: 'number',
      },
    ],
  }

/* ── Share bar (AGL-582) ────────────────────────────────────────────────── */

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
        sx={{ alignItems: 'center', ...(rest.sx as object) }}
      >
        {title ? (
          <Typography variant="subtitle2" sx={{ mr: 1 }}>
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
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: '#00796b' } },
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

/* ── Entry meta (AGL-582) ───────────────────────────────────────────────── */

export interface CollectionEntryMetaProps extends StackProps {
  /** Published date; keep `{{entry.date}}` on entry templates. */
  date?: string
  /** Category; keep `{{entry.category}}` on entry templates. */
  category?: string
  /** Comma-joined tags; keep `{{entry.tags}}` on entry templates. */
  tags?: string
  showDate?: boolean
  showCategory?: boolean
  showTags?: boolean
}

/** Unresolved tokens render empty on the site, literal in the besigner. */
const metaValue = (
  value: string | undefined,
  suppressNavigation: boolean | undefined,
): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  if (UNRESOLVED_TOKEN.test(trimmed) && !suppressNavigation) return ''
  return trimmed
}

/**
 * "{{entry.date}} · {{entry.category}}" meta line plus tag chips
 * (AGL-582). Values arrive through entry tokens on entry renders; on other
 * surfaces unresolved tokens collapse to nothing instead of leaking.
 */
const CollectionEntryMeta = forwardRef<
  HTMLDivElement,
  CollectionEntryMetaProps
>((props, ref) => {
  const {
    date,
    category,
    tags,
    showDate,
    showCategory,
    showTags,
    ...rest
  } = props
  const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
  const dateValue = showDate !== false ? metaValue(date, suppressNavigation) : ''
  const categoryValue =
    showCategory !== false ? metaValue(category, suppressNavigation) : ''
  const tagsValue = showTags !== false ? metaValue(tags, suppressNavigation) : ''
  const tagList = tagsValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  const line = [dateValue, categoryValue].filter(Boolean).join(' · ')
  if (!line && !tagList.length) {
    if (!suppressNavigation) return <Box ref={ref} {...rest} />
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          p: 1,
          border: '1px dashed',
          borderColor: 'divider',
          color: 'text.secondary',
          fontSize: 12,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {'Entry meta — date · category · tags render here'}
      </Box>
    )
  }
  return (
    <MuiStack
      ref={ref}
      direction="row"
      spacing={1}
      {...rest}
      sx={{ alignItems: 'center', flexWrap: 'wrap', ...(rest.sx as object) }}
    >
      {line ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {line}
        </Typography>
      ) : null}
      {tagList.map((tag) => (
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
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: '#00796b' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'date',
        label: 'Date',
        description:
          'Keep {{entry.date}} on entry templates so each entry’s ' +
          'published date renders.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'category',
        label: 'Category',
        description: 'Keep {{entry.category}} on entry templates.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'tags',
        label: 'Tags',
        description:
          'Comma-separated; keep {{entry.tags}} on entry templates.',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        name: 'showDate',
        label: 'Show date',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showCategory',
        label: 'Show category',
        component: Aglyn.FieldComponentType.SWITCH,
      },
      {
        name: 'showTags',
        label: 'Show tags',
        component: Aglyn.FieldComponentType.SWITCH,
      },
    ],
  }

/* ── Presets ────────────────────────────────────────────────────────────── */

const entryText = (variant: string, children: string, extra?: object) => ({
  $id: null,
  componentId: 'muiTypography',
  pluginId: BUNDLE_ID,
  props: { variant, children, ...extra },
})

export const collectionPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ENTRIES_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Collection Entries',
    pluginId: BUNDLE_ID,
    description:
      'Repeats a card (title, date, excerpt, Read more) per published ' +
      'entry of a content collection',
    category: Aglyn.ComponentCategory.BLOCKS,
    icon: { path: mdiPostOutline.path, sx: { color: '#00796b' } },
    data: {
      $id: null,
      componentId: ENTRIES_ID,
      pluginId: BUNDLE_ID,
      props: { spacing: 4 },
      nodes: [
        {
          $id: null,
          componentId: 'muiStack',
          pluginId: BUNDLE_ID,
          props: { spacing: 0.5 },
          nodes: [
            entryText('h5', '{{entry.title}}', { component: 'h2' }),
            entryText('caption', '{{entry.date}}', {
              sx: { color: 'text.secondary' },
            }),
            entryText('body1', '{{entry.excerpt}}'),
            {
              $id: null,
              componentId: 'muiScreenLink',
              pluginId: BUNDLE_ID,
              props: {
                children: 'Read more',
                href: '{{entry.url}}',
                size: 'small',
                sx: { alignSelf: 'flex-start' },
              },
            },
          ],
        },
      ],
    },
  },
  {
    $id: generatePresetId(ENTRY_BODY_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Body',
    pluginId: BUNDLE_ID,
    description: "Renders the current entry's markdown body, themed",
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTextLong.path, sx: { color: '#00796b' } },
    data: {
      $id: null,
      componentId: ENTRY_BODY_ID,
      pluginId: BUNDLE_ID,
      props: { markdown: '{{entry.body}}' },
    },
  },
  {
    $id: generatePresetId(RELATED_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Related Posts',
    pluginId: BUNDLE_ID,
    description:
      "Other entries sharing the current entry's category or tags",
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiNewspaperVariantOutline.path, sx: { color: '#00796b' } },
    data: {
      $id: null,
      componentId: RELATED_ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Related articles', limit: 3 },
    },
  },
  {
    $id: generatePresetId(SHARE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Share Bar',
    pluginId: BUNDLE_ID,
    description: 'X, LinkedIn, Facebook, and copy-link buttons for the page',
    category: Aglyn.ComponentCategory.NAVIGATION,
    icon: { path: mdiShareVariant.path, sx: { color: '#00796b' } },
    data: {
      $id: null,
      componentId: SHARE_ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Share' },
    },
  },
  {
    $id: generatePresetId(ENTRY_META_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Entry Meta',
    pluginId: BUNDLE_ID,
    description: 'Date · category line with tag chips for the current entry',
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTagOutline.path, sx: { color: '#00796b' } },
    data: {
      $id: null,
      componentId: ENTRY_META_ID,
      pluginId: BUNDLE_ID,
      props: {
        date: '{{entry.date}}',
        category: '{{entry.category}}',
        tags: '{{entry.tags}}',
      },
    },
  },
]

export {
  CollectionEntries,
  CollectionEntryBody,
  CollectionEntryMeta,
  CollectionRelated,
  CollectionShare,
}
export default CollectionEntries
