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
'use client'

/**
 * Read-only markdown-lite rendering for console surfaces (AGL-989) — the
 * marketplace listing renderer lives behind the `aglyn:addons` boundary and
 * cannot be imported here.
 *
 * The parser only ever emits text / bold / italic / http(s)-or-site links /
 * images / list items / code text / table cells, so publisher-written
 * markdown cannot inject markup or a javascript: URL: no HTML string is
 * built, and every node below is an element this file chose.
 */

import * as Aglyn from '@aglyn/aglyn'
import { Box, Link as MuiLink, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'

const renderInlines = (inlines: Aglyn.MarkdownInline[]) =>
  inlines.map((inline, index) =>
    inline.type === 'bold' ? (
      <strong key={index}>{inline.text}</strong>
    ) : inline.type === 'italic' ? (
      <em key={index}>{inline.text}</em>
    ) : inline.type === 'link' ? (
      <MuiLink
        key={index}
        href={inline.href}
        target="_blank"
        rel="noopener noreferrer"
        underline="hover"
      >
        {inline.text}
      </MuiLink>
    ) : (
      <span key={index}>{inline.text}</span>
    ),
  )

export interface MarkdownLiteViewProps {
  /** Markdown-lite source. */
  source: string
}

export function MarkdownLiteView({ source }: MarkdownLiteViewProps) {
  const blocks = useMemo(() => Aglyn.parseMarkdownLite(source), [source])
  return (
    <Stack spacing={1.5}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <Typography
                key={index}
                variant={block.level === 2 ? 'h6' : 'subtitle1'}
              >
                {renderInlines(block.inlines)}
              </Typography>
            )
          case 'image':
            return (
              <Box
                key={index}
                component="img"
                // Resolved (AGL-1686), so the console preview shows the same
                // picture the published page will. No `hostId`: this renders
                // in the console, which has no site context — the scope the
                // picker baked in is what resolves. The console serves
                // `/api/media/cdn/…` itself, so the relative URL this
                // produces is fetchable from here.
                src={Aglyn.resolveMediaSrc(block.src)}
                alt={block.alt}
                loading="lazy"
                sx={{
                  maxWidth: '100%',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                }}
              />
            )
          case 'list':
            return (
              <Stack key={index} component="ul" spacing={0.5} sx={{ my: 0 }}>
                {block.items.map((item, itemIndex) => (
                  <Typography key={itemIndex} component="li" variant="body2">
                    {renderInlines(item)}
                  </Typography>
                ))}
              </Stack>
            )
          // A numbered list (AGL-1320) — a real `<ol>` with `start`, so the
          // console preview counts the same way the published page does.
          case 'orderedList':
            return (
              <Stack
                key={index}
                component="ol"
                start={block.start}
                spacing={0.5}
                sx={{ my: 0 }}
              >
                {block.items.map((item, itemIndex) => (
                  <Typography key={itemIndex} component="li" variant="body2">
                    {renderInlines(item)}
                  </Typography>
                ))}
              </Stack>
            )
          case 'code':
            return (
              <Box
                key={index}
                component="pre"
                sx={{
                  my: 0,
                  p: 1.5,
                  overflowX: 'auto',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'action.hover',
                  fontFamily: 'monospace',
                  fontSize: 13,
                }}
              >
                <code>{block.text}</code>
              </Box>
            )
          case 'table':
            return (
              <Box key={index} sx={{ overflowX: 'auto' }}>
                <Box
                  component="table"
                  sx={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    '& th, & td': {
                      border: 1,
                      borderColor: 'divider',
                      px: 1,
                      py: 0.5,
                    },
                    '& th': { bgcolor: 'action.hover' },
                  }}
                >
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <Typography
                          key={cellIndex}
                          component="th"
                          variant="body2"
                          sx={{
                            textAlign: block.align[cellIndex] ?? 'left',
                            fontWeight: 600,
                          }}
                        >
                          {renderInlines(cell)}
                        </Typography>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <Typography
                            key={cellIndex}
                            component="td"
                            variant="body2"
                            sx={{ textAlign: block.align[cellIndex] ?? 'left' }}
                          >
                            {renderInlines(cell)}
                          </Typography>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
            )
          // A quote (AGL-1315): italic behind a left accent, the muted
          // console idiom of the tenant's pull-quote.
          case 'quote':
            return (
              <Typography
                key={index}
                component="blockquote"
                variant="body2"
                sx={{
                  my: 0,
                  mx: 0,
                  pl: 1.5,
                  borderLeft: 3,
                  borderColor: 'divider',
                  fontStyle: 'italic',
                  color: 'text.secondary',
                }}
              >
                {renderInlines(block.inlines)}
              </Typography>
            )
          default:
            return (
              <Typography key={index} variant="body2">
                {renderInlines(block.inlines)}
              </Typography>
            )
        }
      })}
    </Stack>
  )
}

export default MarkdownLiteView
