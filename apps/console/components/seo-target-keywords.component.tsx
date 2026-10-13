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

import { readSeoKeywordLines, seoNormalizePath } from '@aglyn/aglyn/app-utils/seo-audit'
import { SEO_MAX_KEYWORDS } from '@aglyn/aglyn/app-utils/seo-keywords'
import { mdiClose, mdiPlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

/** A page the keywords can be for. */
export interface SeoKeywordPage {
  path: string
  name: string
}

/** One page and the keywords it is checked for. */
export interface SeoTargetKeywordRow {
  path: string
  keywords: string[]
}

/** Stored keyword lines → rows, one per page, in the order they were written. */
export function seoKeywordRowsFromLines(lines: string): SeoTargetKeywordRow[] {
  const { keywords, unchecked } = readSeoKeywordLines(lines)
  return Object.keys(keywords).map((path) => ({
    path,
    keywords: [...keywords[path], ...(unchecked[path] ?? [])],
  }))
}

/**
 * Rows → the keyword lines the check reads (`/pricing: pricing, plans`). A
 * row with no page or no keywords says nothing and is left out.
 */
export function seoKeywordLinesFromRows(rows: readonly SeoTargetKeywordRow[]): string {
  return rows
    .filter((row) => row.path && row.keywords.length)
    .map((row) => `${seoNormalizePath(row.path)}: ${row.keywords.join(', ')}`)
    .join('\n')
}

/** A typed keyword can hold no comma: the lines separate keywords with one. */
const keywordsFrom = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values.flatMap((entry) => entry.split(','))) {
    const keyword = value.trim().replace(/\s+/g, ' ')
    if (!keyword || seen.has(keyword.toLowerCase())) continue
    seen.add(keyword.toLowerCase())
    out.push(keyword)
  }
  return out
}

export interface SeoTargetKeywordsProps {
  rows: SeoTargetKeywordRow[]
  onChange: (rows: SeoTargetKeywordRow[]) => void
  /** The site's pages, to pick from. */
  pages: readonly SeoKeywordPage[]
  disabled?: boolean
}

/**
 * Target keywords by page: pick a page from the site's own list, then add
 * its keywords as chips. Each page is checked for at most
 * {@link SEO_MAX_KEYWORDS}; a chip past that is shown and marked unchecked.
 */
export function SeoTargetKeywords(props: SeoTargetKeywordsProps) {
  const { rows, onChange, pages, disabled } = props
  const update = (index: number, next: Partial<SeoTargetKeywordRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)))
  const nameOf = (path: string) => pages.find((page) => seoNormalizePath(page.path) === path)?.name

  return (
    <Box role="group" aria-label="Target keywords by page">
      <Typography variant="subtitle2">{'Target keywords by page (optional)'}</Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        {`Pick a page and add up to ${SEO_MAX_KEYWORDS} keywords for it. The check says where each page already uses its keywords.`}
      </Typography>
      <Stack spacing={1.5}>
        {rows.map((row, index) => {
          const taken = new Set(rows.filter((_, i) => i !== index).map((other) => other.path))
          const options = pages.filter((page) => !taken.has(seoNormalizePath(page.path)))
          const known = !row.path || options.some((page) => seoNormalizePath(page.path) === row.path)
          return (
            <Stack
              key={index}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}
            >
              <TextField
                select
                size="small"
                label="Page"
                value={row.path}
                disabled={disabled}
                onChange={(event) => update(index, { path: event.target.value })}
                sx={{ minWidth: 200 }}
              >
                {options.map((page) => (
                  <MenuItem key={page.path} value={seoNormalizePath(page.path)}>
                    {`${page.name} (${seoNormalizePath(page.path)})`}
                  </MenuItem>
                ))}
                {known ? null : (
                  <MenuItem value={row.path}>{`${nameOf(row.path) ?? row.path} (not published)`}</MenuItem>
                )}
              </TextField>
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={row.keywords}
                disabled={disabled}
                onChange={(_, values) => update(index, { keywords: keywordsFrom(values as string[]) })}
                renderValue={(values, getItemProps) =>
                  values.map((keyword, position) => {
                    const { key, ...itemProps } = getItemProps({ index: position })
                    return (
                      <Chip
                        key={key}
                        size="small"
                        label={keyword}
                        variant={position < SEO_MAX_KEYWORDS ? 'filled' : 'outlined'}
                        title={position < SEO_MAX_KEYWORDS ? undefined : 'Past the first five: not checked'}
                        {...itemProps}
                      />
                    )
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Keywords"
                    placeholder={row.keywords.length ? '' : 'Type a keyword, then press Enter'}
                    slotProps={{
                      ...params.slotProps,
                      htmlInput: { ...params.slotProps.htmlInput, 'aria-label': `Keywords ${index + 1}` },
                    }}
                  />
                )}
                sx={{ flex: 1 }}
              />
              <Tooltip title="Remove this page">
                <span>
                  <IconButton
                    size="small"
                    disabled={disabled}
                    aria-label={`Remove page ${index + 1}`}
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    <MdiIcon path={mdiClose.path} fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          )
        })}
        <Box>
          <Button
            size="small"
            disabled={disabled || rows.length >= pages.length}
            startIcon={<MdiIcon path={mdiPlus.path} fontSize="small" />}
            onClick={() => onChange([...rows, { path: '', keywords: [] }])}
          >
            {'Add a page'}
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}

export default SeoTargetKeywords
