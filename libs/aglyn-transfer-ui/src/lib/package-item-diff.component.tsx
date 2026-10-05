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
 * One package item against this site's copy (AGL-3534, AGL-3545): rendered
 * side by side, when the surface can render the kind, its records as a table
 * when it carries records, and below either as a before → after list of
 * every other value that differs. A merged item lists its keys instead, each
 * with whose value it keeps.
 *
 * The kit does not know how a kind renders. The surface hands it two ways:
 *
 * - `renderers`, a component per kind that draws one side in place — the
 *   console's are the widgets plugins register for the kinds they own (a
 *   form through the form's own preview, a site email through the email
 *   preview), so the kit never imports a plugin;
 * - `previewHref`, which answers a URL for one side of one item — the
 *   console's is its document preview route, fed the design as a snapshot —
 *   or `null` for a kind with nothing to render.
 *
 * A kind with a renderer is drawn by it; any other asks `previewHref`.
 *
 * Records are found by shape, not by kind: the one list of documents with
 * their own `$id` (see `packageRecordField`). They are diffed record by
 * record in {@link PackageRecordDiffTable} and left out of the value list,
 * which would otherwise compare the whole list as one value.
 */

import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Box,
  CircularProgress,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { type ComponentType, type ReactNode, Suspense, useMemo } from 'react'

import type {
  PackageItemDecision,
  SitePackageComparison,
  SitePackageMergeChoice,
  SitePackagePlanItem,
} from './site-package-client'
import { PackageRecordDiffTable } from './package-record-diff.component'
import {
  PACKAGE_DECISION_WORDS,
  packageItemTitle,
  packageJsonDiff,
  packageMergeKeys,
  packageRecordField,
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

/**
 * What a renderer is handed: one side of one item, and what to call it. The
 * item's key is `itemKey`, since React keeps a `key` prop for itself.
 */
export interface PackageItemRenderProps extends Omit<PackagePreviewInput, 'key'> {
  itemKey: string
  /** The item's title, for the frame a renderer draws. */
  title: string
}

/** Draws one side of an item of the kind it is registered for. */
export type PackageItemRenderer = ComponentType<PackageItemRenderProps>

/** A renderer per kind; a kind it does not name falls back to `previewHref`. */
export type PackageItemRenderers = Readonly<Record<string, PackageItemRenderer>>

export interface PackageItemDiffProps {
  item: SitePackagePlanItem
  comparison: SitePackageComparison
  decision: PackageItemDecision | null
  previewHref?: PackagePreviewHref
  renderers?: PackageItemRenderers
  mergeChoices?: Readonly<Record<string, SitePackageMergeChoice>>
  onMergeChoice?(key: string, choice: SitePackageMergeChoice): void
}

const PREVIEW_HEIGHT = 360

function EmptyPane(props: { text: string }) {
  return (
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
        {props.text}
      </Typography>
    </Box>
  )
}

function Pane(props: { heading: string; label: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={props.label} sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" gutterBottom>
        {props.heading}
      </Typography>
      {props.children}
    </Box>
  )
}

function FramePane(props: { title: string; heading: string; href: string | null; empty: string }) {
  return (
    <Pane heading={props.heading} label={props.title}>
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
        <EmptyPane text={props.empty} />
      )}
    </Pane>
  )
}

function RenderedPane(props: {
  heading: string
  label: string
  Renderer: PackageItemRenderer
  input: PackageItemRenderProps | null
  empty: string
}) {
  const { Renderer, input } = props
  return (
    <Pane heading={props.heading} label={props.label}>
      {input ? (
        // A plugin's renderer is usually loaded on first use.
        <Suspense fallback={<CircularProgress size={24} aria-label={`Loading ${props.label}`} />}>
          <Renderer {...input} />
        </Suspense>
      ) : (
        <EmptyPane text={props.empty} />
      )}
    </Pane>
  )
}

const isDoc = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The content without its records, which the record table shows instead. */
function withoutRecords(content: unknown, field: string | null): unknown {
  if (!field || !isDoc(content)) return content
  const { [field]: _records, ...rest } = content
  return rest
}

const recordsIn = (content: unknown, field: string): unknown => (isDoc(content) ? content[field] : undefined)

export function PackageItemDiff({
  item,
  comparison,
  decision,
  previewHref,
  renderers,
  mergeChoices = {},
  onMergeChoice,
}: PackageItemDiffProps) {
  const title = packageItemTitle(item)
  const Renderer = renderers?.[item.kind]
  // A side's URL is answered once per comparison. The console's answer
  // writes the design it renders as it answers, which is idempotent, so a
  // second call (a strict-mode render) writes the same snapshot again.
  const hrefs = useMemo(() => {
    if (!previewHref || Renderer) return { site: null, file: null }
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
  }, [previewHref, Renderer, comparison, item.key, item.kind, item.id])
  const inputs = useMemo(() => {
    if (!Renderer) return null
    const existing = comparison.existing
    return {
      site: existing
        ? { side: 'site' as const, itemKey: item.key, kind: item.kind, id: existing.id, content: existing.content, title }
        : null,
      file: {
        side: 'file' as const,
        itemKey: item.key,
        kind: item.kind,
        id: existing?.id ?? item.id,
        content: comparison.incoming,
        title,
      },
    }
  }, [Renderer, comparison, item.key, item.kind, item.id, title])

  const before = useMemo(() => comparison.existing?.content ?? {}, [comparison])
  const recordField = useMemo(
    () => packageRecordField(before, comparison.incoming),
    [before, comparison.incoming],
  )
  const diff = useMemo(
    () => packageJsonDiff(withoutRecords(before, recordField), withoutRecords(comparison.incoming, recordField)),
    [before, comparison.incoming, recordField],
  )
  const mergeKeys = useMemo(
    () => (decision === 'merge' ? packageMergeKeys(before, comparison.incoming) : []),
    [decision, before, comparison.incoming],
  )
  const framed = Boolean(hrefs.site || hrefs.file)

  return (
    <Stack spacing={2}>
      {Renderer && inputs ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <RenderedPane
            heading="On this site"
            label={`${title} on this site`}
            Renderer={Renderer}
            input={inputs.site}
            empty="This site has no copy of it."
          />
          <RenderedPane
            heading="In the file"
            label={`${title} in the file`}
            Renderer={Renderer}
            input={inputs.file}
            empty="Nothing to render."
          />
        </Stack>
      ) : framed ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <FramePane
            heading="On this site"
            title={`${title} on this site`}
            href={hrefs.site}
            empty="This site has no copy of it."
          />
          <FramePane
            heading="In the file"
            title={`${title} in the file`}
            href={hrefs.file}
            empty="Nothing to render."
          />
        </Stack>
      ) : null}
      {recordField ? (
        <PackageRecordDiffTable
          label={`Records of ${title}`}
          site={recordsIn(before, recordField)}
          file={recordsIn(comparison.incoming, recordField)}
        />
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
                note: recordField
                  ? 'Every value but the records matches this site’s.'
                  : 'The file’s copy matches this site’s.',
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
