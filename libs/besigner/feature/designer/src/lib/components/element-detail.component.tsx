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

import { Box, Chip, Link, Stack, Typography } from '@mui/material'
import type { ElementDetail } from '../utils/describe-element'
import ElementPreview from './element-preview.component'
import { besignerDocsUrl, type BesignerDocsAnchor } from '../utils/docs-help'

/**
 * Element category → its section of the element catalog page.
 *
 * The catalog's H2s ARE the drawer's categories, so the deep link is derived
 * rather than mapped by hand per element — 45+ hand-written anchors would be
 * 45+ things to get wrong. A category with no section (plugin-registered
 * labels, "Your components") lands on the page itself, which is correct
 * rather than broken.
 */
const CATALOG_ANCHORS: Record<string, BesignerDocsAnchor<'elementCatalog'>> = {
  Layout: '#layout',
  Surface: '#surface',
  Navigation: '#navigation',
  Text: '#text',
  'Data Display': '#data-display',
  Media: '#media',
  Forms: '#forms-input-commerce-members',
  Input: '#forms-input-commerce-members',
  Commerce: '#forms-input-commerce-members',
  Members: '#forms-input-commerce-members',
}

export interface ElementDetailViewProps {
  detail: ElementDetail | null
  /**
   * Narrow presentation for the docked Elements column. Same CONTENT either
   * way — the content is designed once and the two surfaces present it
   * differently, rather than there being two detail views to keep in step.
   */
  dense?: boolean
  /**
   * The picker item itself, when the surface wants a rendered preview above
   * the text. Only ever the one selected or hovered element — the detail
   * region is single-tenant by construction, so the preview is too.
   */
  node?: any
}

/**
 * What a selected element actually is, shown before you commit to it
 * (AGL-2486).
 *
 * Deliberately a DOCKED REGION rather than a hover popup. A popup over the
 * grid would have to solve three problems this does not have: it can swallow
 * the click meant for the card beneath it, it can cover the very item you
 * are pointing at, and several can open at once. A region that lives outside
 * the grid cannot do any of those by construction.
 *
 * Everything under the description is DERIVED from the schema, so it cannot
 * go stale and third-party elements get it for free.
 */
export function ElementDetailView(props: ElementDetailViewProps) {
  const { detail, dense, node } = props
  if (!detail) return null

  return (
    <Stack
      spacing={dense ? 0.5 : 0.75}
      sx={{ minWidth: 0, width: 1 }}
      aria-live="polite"
      data-testid="element-detail"
    >
      {node ? <ElementPreview node={node} height={dense ? 116 : 168} /> : null}

      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', minWidth: 0 }}
      >
        <Typography
          variant={dense ? 'subtitle2' : 'subtitle1'}
          noWrap
          sx={{ textOverflow: 'ellipsis', fontWeight: 'fontWeightMedium' }}
        >
          {detail.name}
        </Typography>
        {detail.category ? (
          <Chip
            size="small"
            variant="outlined"
            label={detail.category}
            sx={{ textTransform: 'capitalize', flex: '0 0 auto' }}
          />
        ) : null}
      </Stack>

      {detail.description ? (
        <Typography variant="caption" color="textSecondary">
          {detail.description}
        </Typography>
      ) : null}

      {/* Derived facts. No heading — in a narrow column a heading costs a
          line and explains nothing the list does not. */}
      <Box component="ul" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
        {detail.facts.map((fact) => (
          <Stack
            key={fact.id}
            component="li"
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'flex-start' }}
          >
            <Box
              aria-hidden
              sx={{
                flex: '0 0 auto',
                width: 4,
                height: 4,
                mt: '0.45em',
                borderRadius: '50%',
                backgroundColor: 'text.disabled',
              }}
            />
            <Typography variant="caption" color="textSecondary">
              {fact.label}
            </Typography>
          </Stack>
        ))}
      </Box>

      {detail.attributes.length ? (
        <Typography variant="caption" color="textSecondary" sx={{ mt: 0.25 }}>
          <Box component="span" sx={{ fontWeight: 'fontWeightMedium' }}>
            {'Attributes: '}
          </Box>
          {detail.attributes.slice(0, dense ? 4 : 8).join(', ')}
          {detail.attributes.length > (dense ? 4 : 8) ? '…' : ''}
        </Typography>
      ) : null}

      {/* Links to the catalog rather than restating it. Duplicated
          documentation drifts, and the docs page is the thing that is
          actually maintained. */}
      <Link
        href={besignerDocsUrl(
          'elementCatalog',
          CATALOG_ANCHORS[detail.category ?? ''],
        )}
        target="_blank"
        rel="noopener noreferrer"
        variant="caption"
        sx={{ fontWeight: 600 }}
      >
        {'Learn more'}
      </Link>
    </Stack>
  )
}
ElementDetailView.displayName = 'ElementDetailView'

export default ElementDetailView
