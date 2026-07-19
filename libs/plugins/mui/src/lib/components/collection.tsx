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
import { mdiPostOutline, mdiTextLong } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import MuiLink from '@mui/material/Link'
import MuiStack, { type StackProps } from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { forwardRef, useContext, useMemo } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Persisted component ids (AGL-551); the compose pipeline references them
// through @aglyn/aglyn constants. Never rename.
export const ENTRIES_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRIES_COMPONENT_ID
export const ENTRY_BODY_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID

/* ── Collection entries (repeater) ──────────────────────────────────────── */

export interface CollectionEntriesProps extends StackProps {
  /**
   * Collection to repeat over (compose-time, AGL-551). Blank = the
   * collection routed by the current URL on list-template screens.
   */
  collectionSlug?: string
  /** Maximum entries rendered (compose-time; blank = all, capped at 100). */
  entriesLimit?: number | string
}

/**
 * Repeats its children once per published entry of a content collection
 * (AGL-551) — the collections sibling of the dataset repeatable. The tenant
 * expands it at compose time with `{{entry.*}}` tokens; in the besigner the
 * template renders once with literal tokens, matching the repeatable UX.
 */
const CollectionEntries = forwardRef<HTMLDivElement, CollectionEntriesProps>(
  // collectionSlug/entriesLimit are compose-time attributes: the tenant
  // expands them before render; strip so they never hit the DOM.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ collectionSlug, entriesLimit, children, ...props }, ref) => (
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

const renderInlines = (inlines: Aglyn.MarkdownInline[]): ReactNode[] =>
  inlines.map((item, index) =>
    item.type === 'bold' ? (
      <strong key={index}>{item.text}</strong>
    ) : item.type === 'italic' ? (
      <em key={index}>{item.text}</em>
    ) : item.type === 'link' ? (
      // parseMarkdownInlines only ever emits http(s) hrefs (safeUrl).
      <MuiLink key={index} href={item.href}>
        {item.text}
      </MuiLink>
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
              {renderInlines(block.inlines)}
            </Typography>
          ) : (
            <Typography key={index} variant="h5" component="h3" gutterBottom>
              {renderInlines(block.inlines)}
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
                <li key={itemIndex}>{renderInlines(item)}</li>
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
            {renderInlines(block.inlines)}
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
]

export { CollectionEntries, CollectionEntryBody }
export default CollectionEntries
