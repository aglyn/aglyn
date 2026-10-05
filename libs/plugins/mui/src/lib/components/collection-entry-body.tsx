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
import { mdiTextLong } from '@aglyn/shared-data-mdi'
import { AppLink } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import MuiLink from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { forwardRef, useContext, useMemo } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { UNRESOLVED_TOKEN } from './collection-common'

// Persisted component id (AGL-551/582); the compose pipeline references it
// through the @aglyn/aglyn constant. Never rename.
export const ENTRY_BODY_ID: Aglyn.ComponentId =
  Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID

export interface CollectionEntryBodyProps {
  /**
   * Markdown-lite source. On entry-template screens `{{entry.body}}`
   * resolves to the rendered entry's body at compose time.
   */
  markdown?: string
  /**
   * The pixel pair of each library image this body names, keyed by the target
   * as the body writes it, stamped by the composition from the assets' DAM
   * records (AGL-3149) — never set by hand, and never on the template, where
   * `markdown` is still the `{{entry.body}}` token and names no asset.
   */
  intrinsicSizes?: Record<
    string,
    { width: number; height: number; version?: string }
  >
}

const renderInlines = (
  inlines: Aglyn.MarkdownInline[],
  links: { suppressNavigation?: boolean; screens?: Aglyn.ScreenRouteMap },
): ReactNode[] =>
  inlines.map((item, index) => {
    if (item.type === 'bold') return <strong key={index}>{item.text}</strong>
    if (item.type === 'italic') return <em key={index}>{item.text}</em>
    if (item.type !== 'link') return <span key={index}>{item.text}</span>
    // Internal paths route through AppLink for client-side navigation
    // (AGL-582); external links stay plain anchors. Editing surfaces render
    // the link look without an href so clicks never navigate. A target named
    // by REFERENCE resolves against the routing map first (AGL-3118), and one
    // whose entry, listing or screen is gone renders as the words alone —
    // never as an anchor holding the stored value.
    const link = Aglyn.resolveMarkdownLink(item.href, links)
    if (link.kind === 'text') return <span key={index}>{item.text}</span>
    if (link.kind === 'inert') {
      return (
        <MuiLink key={index} component="span" sx={{ cursor: 'default' }}>
          {item.text}
        </MuiLink>
      )
    }
    return link.kind === 'internal' ? (
      <AppLink key={index} href={link.href}>
        {item.text}
      </AppLink>
    ) : (
      <MuiLink key={index} href={link.href}>
        {item.text}
      </MuiLink>
    )
  })

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
  // `intrinsicSizes` is destructured out rather than left in `rest`: `rest` is
  // spread onto a Box, and a composition-stamped object would reach the DOM as
  // an attribute React has no idea what to do with.
  const { markdown, intrinsicSizes, ...rest } = props
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const nodeSx = Array.isArray(props['sx']) ? props['sx'] : [props['sx']]
  // The routing map travels with the suppression flag: both decide what a
  // link in this body renders as (AGL-3118).
  const { suppressNavigation, screens } = useContext(Aglyn.ScreenLinkContext)
  const links = useMemo(
    () => ({ suppressNavigation, screens }),
    [suppressNavigation, screens],
  )
  // The site being rendered, for image blocks (AGL-1686) — read once here
  // because hooks cannot run inside the block map below.
  const { hostId } = Aglyn.useSite()
  const source = (markdown ?? '').trim()
  const unresolved = !source || UNRESOLVED_TOKEN.test(source)
  const blocks = useMemo(
    () => (unresolved ? [] : Aglyn.parseMarkdownLite(source)),
    [source, unresolved],
  )
  // Heading anchors, on the same terms as the Markdown element (AGL-1162).
  // Without them a blog article could not carry an "On this page" aside at
  // all: the Table of Contents element emits `#slug` links, and there was
  // nothing on this page for them to land on.
  const slugs = useMemo(() => Aglyn.markdownHeadingSlugs(blocks), [blocks])
  if (unresolved) {
    // Editing surfaces get an affordance; the published site renders
    // nothing rather than a literal token.
    if (!suppressNavigation) return <Box ref={ref} {...rest} />
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          {
            p: 2,
            border: '1px dashed',
            borderColor: 'divider',
            color: 'text.secondary',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
          },
          ...nodeSx,
        ]}
      >
        {'Entry body — the {{entry.body}} markdown renders here'}
      </Box>
    )
  }
  return (
    <Box ref={ref} {...rest}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Typography
              key={index}
              id={slugs[index]}
              variant={block.level === 2 ? 'h4' : 'h5'}
              component={block.level === 2 ? 'h2' : 'h3'}
              gutterBottom
              sx={{
                scrollMarginTop: `${Aglyn.HEADING_ANCHOR_SCROLL_MARGIN}px`,
              }}
            >
              {renderInlines(block.inlines, links)}
            </Typography>
          )
        }
        if (block.type === 'image') {
          return (
            <Box
              key={index}
              component="img"
              // Resolved like the related cover image in collection-related.tsx
              // (AGL-1686): a body image is the same kind of asset and
              // has no reason to be stored in a more fragile form.
              //
              // And sized like one too, as of AGL-3149: the same call gives
              // the Markdown element's body images their candidate list and
              // intrinsic pair, so the two bodies cannot disagree about how a
              // picture in prose is delivered.
              {...Aglyn.mediaBodyImageAttributes({
                src: block.src,
                hostId,
                size: intrinsicSizes?.[block.src],
              })}
              alt={block.alt}
              // Paired with the `width`/`height` above — see the Markdown
              // element's copy of this: without it the height hint outlives
              // the `maxWidth` cap and squashes the picture.
              sx={{ maxWidth: '100%', height: 'auto', borderRadius: 1, my: 1 }}
              // An image inside an entry body is below the fold by
              // construction — the title, byline and opening paragraphs are
              // above it. This one carried no loading hint at all, so it was
              // fetched EAGERLY, at default priority, competing with the
              // entry's own cover (AGL-2486).
              {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
            />
          )
        }
        if (block.type === 'list') {
          return (
            <Box key={index} component="ul" sx={{ lineHeight: 1.7, pl: 3 }}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlines(item, links)}
                </li>
              ))}
            </Box>
          )
        }
        // A numbered list (AGL-1320) — a real `<ol>`, so the markers are the
        // browser's and `start` survives: a notice that resumes at 7 has to
        // read as 7 for the enumeration to mean anything.
        if (block.type === 'orderedList') {
          return (
            <Box
              key={index}
              component="ol"
              start={block.start}
              sx={{ lineHeight: 1.7, pl: 3 }}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInlines(item, links)}
                </li>
              ))}
            </Box>
          )
        }
        // Code blocks and tables (AGL-974). Both scroll rather than wrap:
        // a wrapped code line or a squeezed table column loses the very
        // structure that made the block worth writing.
        if (block.type === 'code') {
          return (
            <Box
              key={index}
              component="pre"
              sx={{
                my: 2,
                p: 2,
                overflowX: 'auto',
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontFamily: 'monospace',
                fontSize: 14,
              }}
            >
              <code>{block.text}</code>
            </Box>
          )
        }
        if (block.type === 'table') {
          return (
            <Box key={index} sx={{ my: 2, overflowX: 'auto' }}>
              <Box
                component="table"
                sx={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  '& th, & td': {
                    border: '1px solid',
                    borderColor: 'divider',
                    px: 1.5,
                    py: 1,
                  },
                  '& th': { bgcolor: 'action.hover' },
                }}
              >
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        style={{ textAlign: block.align[cellIndex] ?? 'left' }}
                      >
                        {renderInlines(cell, links)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          style={{
                            textAlign: block.align[cellIndex] ?? 'left',
                          }}
                        >
                          {renderInlines(cell, links)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
          )
        }
        // The article template's pull-quote (AGL-1315, Figma 170:225):
        // larger italic prose behind a left accent. Palette tokens only, so
        // it follows the site theme in both modes.
        if (block.type === 'quote') {
          return (
            <Typography
              key={index}
              component="blockquote"
              sx={{
                my: 3,
                mx: 0,
                pl: 2.5,
                borderLeft: '3px solid',
                borderColor: 'primary.main',
                fontStyle: 'italic',
                fontSize: '1.25em',
                lineHeight: 1.6,
                color: 'text.primary',
              }}
            >
              {renderInlines(block.inlines, links)}
            </Typography>
          )
        }
        return (
          <Typography
            key={index}
            variant="body1"
            sx={{ lineHeight: 1.7 }}
            gutterBottom
          >
            {renderInlines(block.inlines, links)}
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
    description: "The current entry's markdown body, on an entry template.",
    category: Aglyn.ComponentCategory.TEXT,
    icon: { path: mdiTextLong.path, sx: { color: 'secondary.main' } },
    flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
    attributes: [
      {
        name: 'markdown',
        label: 'Markdown',
        description:
          'Markdown-lite content. Keep {{entry.body}} on entry-template ' +
          "pages so each entry's body renders here.",
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
    ],
  }

export { CollectionEntryBody }
