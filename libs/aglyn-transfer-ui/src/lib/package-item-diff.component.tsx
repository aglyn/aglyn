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
 * One package item against this site's copy (AGL-3534): rendered side by
 * side, when the surface can render the kind, and as a before → after list
 * of every value that differs. A merged item lists its keys instead, each
 * with whose value it keeps.
 *
 * The kit does not know where a design renders. The surface hands it
 * `previewHref`, which answers a URL for one side of one item — the
 * console's is its document preview route, fed the design as a snapshot —
 * or `null` for a kind with nothing to render.
 */

import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Box,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'

import type {
  PackageItemDecision,
  SitePackageComparison,
  SitePackageMergeChoice,
  SitePackagePlanItem,
} from './site-package-client'
import {
  PACKAGE_DECISION_WORDS,
  packageItemTitle,
  packageJsonDiff,
  packageMergeKeys,
} from './site-package-import-state'
import { TransferChoiceSelect } from './transfer-choice-select.component'
import { TransferDiffTable } from './transfer-diff-table.component'
import { displayTransferValue } from './transfer-words'

/** One side of one item, for the surface to render. */
export interface PackagePreviewInput {
  side: 'site' | 'file'
  key: string
  kind: string
  /** The document the side is: the site's item, or the id the file's would land under. */
  id: string
  /** The item as an import would write it. */
  content: unknown
}

export type PackagePreviewHref = (input: PackagePreviewInput) => string | null

export interface PackageItemDiffProps {
  item: SitePackagePlanItem
  comparison: SitePackageComparison
  decision: PackageItemDecision | null
  previewHref?: PackagePreviewHref
  mergeChoices?: Readonly<Record<string, SitePackageMergeChoice>>
  onMergeChoice?(key: string, choice: SitePackageMergeChoice): void
}

const PREVIEW_HEIGHT = 360

function PreviewPane(props: { title: string; heading: string; href: string | null; empty: string }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" gutterBottom>
        {props.heading}
      </Typography>
      {props.href ? (
        <Box
          component="iframe"
          title={props.title}
          src={props.href}
          sx={{
            width: '100%',
            height: PREVIEW_HEIGHT,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper',
          }}
        />
      ) : (
        <Box
          sx={{
            height: PREVIEW_HEIGHT,
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: 2,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {props.empty}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

export function PackageItemDiff({
  item,
  comparison,
  decision,
  previewHref,
  mergeChoices = {},
  onMergeChoice,
}: PackageItemDiffProps) {
  const title = packageItemTitle(item)
  // A side's URL is answered once per comparison. The console's answer
  // writes the design it renders as it answers, which is idempotent, so a
  // second call (a strict-mode render) writes the same snapshot again.
  const hrefs = useMemo(() => {
    if (!previewHref) return { site: null, file: null }
    const existing = comparison.existing
    return {
      site: existing
        ? previewHref({ side: 'site', key: item.key, kind: item.kind, id: existing.id, content: existing.content })
        : null,
      file: previewHref({
        side: 'file',
        key: item.key,
        kind: item.kind,
        id: existing?.id ?? item.id,
        content: comparison.incoming,
      }),
    }
  }, [previewHref, comparison, item.key, item.kind, item.id])

  const before = useMemo(() => comparison.existing?.content ?? {}, [comparison])
  const diff = useMemo(() => packageJsonDiff(before, comparison.incoming), [before, comparison.incoming])
  const mergeKeys = useMemo(
    () => (decision === 'merge' ? packageMergeKeys(before, comparison.incoming) : []),
    [decision, before, comparison.incoming],
  )
  const rendered = Boolean(hrefs.site || hrefs.file)

  return (
    <Stack spacing={2}>
      {rendered ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <PreviewPane
            heading="On this site"
            title={`${title} on this site`}
            href={hrefs.site}
            empty="This site has no copy of it."
          />
          <PreviewPane
            heading="In the file"
            title={`${title} in the file`}
            href={hrefs.file}
            empty="Nothing to render."
          />
        </Stack>
      ) : null}
      {decision === 'merge' ? (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Key by key</Typography>
          <ScrollTable size="small" aria-label={`Keys of ${title}`}>
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>On this site</TableCell>
                <TableCell>In the file</TableCell>
                <TableCell>Keep</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mergeKeys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary">
                      Every key the file sets matches this site.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
              {mergeKeys.map((key) => (
                <TableRow key={key.key}>
                  <TableCell>{key.key}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                      {displayTransferValue(key.site)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                      {displayTransferValue(key.file)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TransferChoiceSelect<SitePackageMergeChoice>
                      label={`Keep for ${key.key}`}
                      hideLabel
                      value={mergeChoices[key.key] ?? key.merged}
                      disabled={!onMergeChoice}
                      onChange={(choice) => onMergeChoice?.(key.key, choice)}
                      options={[
                        { value: 'site', label: 'This site’s' },
                        { value: 'package', label: 'The file’s' },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        </Stack>
      ) : (
        <Stack spacing={1}>
          <TransferDiffTable
            label={`Changes to ${title}`}
            headings={{ row: 'Item', field: 'Value', before: 'On this site', after: 'In the file' }}
            rows={[
              {
                key: item.key,
                title,
                ...(comparison.existing && comparison.existing.id !== item.id
                  ? { subtitle: `Matched to ${comparison.existing.id}` }
                  : {}),
                status: decision ?? 'undecided',
                statusLabel: decision ? PACKAGE_DECISION_WORDS[decision].label : 'Not chosen',
                changes: diff.changes,
                note: 'The file’s copy matches this site’s.',
              },
            ]}
          />
          {diff.more ? (
            <Typography variant="caption" color="text.secondary">
              {`And ${diff.more.toLocaleString()} more values that differ.`}
            </Typography>
          ) : null}
        </Stack>
      )}
    </Stack>
  )
}

export default PackageItemDiff
