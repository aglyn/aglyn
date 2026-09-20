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
 * The markdown editor's link dialog (AGL-3119), shared by the visual surface
 * and the raw-source surface behind the one toolbar.
 *
 * A link in an entry body used to be a typed address, so a post could link
 * another post only as `/blog/old-slug` — which the next rename breaks. Where
 * the page knows the site (a routing map in `ScreenLinkContext`, entries
 * through `LinkTargetSearchContext`), the dialog leads with the same lookup the
 * designer's link pickers use and inserts a REFERENCE — `[text](entry:c/e)`,
 * `screen:`, `collection:`, `feed:` — which renderers resolve to wherever the
 * target lives now. A typed URL stays one choice away. Where the page knows
 * nothing (a marketplace README), it is the URL box it always was.
 */

import {
  formatCollectionLinkValue,
  formatScreenLinkValue,
  isMarkdownLinkReference,
  isSupportedLinkHref,
  useLinkTargetLabel,
  LinkTargetSearchContext,
  linkTargetKind,
  parseFeedLinkValue,
  parseScreenLinkValue,
  resolveScreenHref,
  ScreenLinkContext,
  screenLinkTargetOptions,
} from '@aglyn/aglyn'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'
import { useContext, useMemo, useState } from 'react'
import {
  EXTERNAL_URL_OPTION,
  LinkTargetAutocomplete,
  type LinkTargetChangeDetail,
  type LinkTargetChoice,
} from './link-target-autocomplete.component'

export interface MarkdownLink {
  /** A reference (`entry:…`, `screen:…`) or a URL the dialect accepts. */
  href: string
  text: string
}

export interface MarkdownLinkDialogProps {
  open: boolean
  /** The link being edited; absent when a new one is being inserted. */
  href?: string
  /** Ask for the link's text too, seeded with this (the selection). */
  withText?: boolean
  text?: string
  onClose: () => void
  onConfirm: (link: MarkdownLink) => void
}

const EXTERNAL_CHOICE: readonly LinkTargetChoice[] = [
  { value: EXTERNAL_URL_OPTION, label: 'External URL or path…' },
]

/**
 * Where one link goes, as a sentence: a URL as written, and a reference by
 * its target's readable name (AGL-3119). `entry:Hq3…/9fK…` tells an author
 * nothing about the post they linked, and the name is what they would check.
 *
 * Used by the visual editor's link popover, and lives here because naming a
 * target is the same job this dialog does when it opens on one.
 */
export function MarkdownLinkTargetName({ href }: { href: string }) {
  const reference = isMarkdownLinkReference(href)
    ? parseScreenLinkValue(href)
    : undefined
  const target = useLinkTargetLabel(reference)
  return <>{target ? `Links to ${target.label}` : href}</>
}
MarkdownLinkTargetName.displayName = 'MarkdownLinkTargetName'

/**
 * What a link to a target says when the author wrote nothing: the name the
 * site already gives it, or its address — never its stored reference, which
 * would put `entry:Hq3…/9fK…` in the middle of a sentence.
 */
function targetText(
  key: string,
  screens: Record<string, string> | undefined,
  labels: Record<string, string> | undefined,
  entryTitle: string | undefined,
): string {
  const address = resolveScreenHref(screens, key)
  switch (linkTargetKind(key)) {
    case 'entry':
      return entryTitle?.trim() || 'this entry'
    case 'feed': {
      const collectionId = parseFeedLinkValue(key) ?? ''
      const name =
        labels?.[key] ?? labels?.[formatCollectionLinkValue(collectionId)]
      return name ? `${name} RSS feed` : (address ?? 'this feed')
    }
    default:
      return labels?.[key] ?? address ?? 'this page'
  }
}

/** The dialog's body, mounted per opening so every opening starts fresh. */
function MarkdownLinkForm(props: MarkdownLinkDialogProps) {
  const { href, withText, text: initialText, onClose, onConfirm } = props
  const { screens, labels } = useContext(ScreenLinkContext)
  const search = useContext(LinkTargetSearchContext)
  // A lookup needs something to look in: a routing map or a search provider.
  const lookup = screens !== undefined || search.available
  const editing = href !== undefined
  const initialKey = href ? parseScreenLinkValue(href) : undefined
  const [choice, setChoice] = useState<string | null>(() =>
    initialKey ?? (href || !lookup ? EXTERNAL_URL_OPTION : null),
  )
  const [url, setUrl] = useState(() => (initialKey ? '' : (href ?? '')))
  const [text, setText] = useState(initialText ?? '')
  const [entryTitle, setEntryTitle] = useState<string | undefined>()
  const targets = useMemo(
    () => screenLinkTargetOptions(screens, labels, 'label'),
    [screens, labels],
  )

  const external = choice === EXTERNAL_URL_OPTION
  const nextHref = external
    ? url.trim()
    : choice
      ? formatScreenLinkValue(choice)
      : ''
  const valid = external
    ? isSupportedLinkHref(nextHref)
    : isMarkdownLinkReference(nextHref)

  const confirm = () => {
    if (!valid) return
    const fallback = external
      ? nextHref
      : targetText(choice ?? '', screens, labels, entryTitle)
    onConfirm({ href: nextHref, text: text.trim() || fallback })
  }

  const handleChoice = (next: string, detail: LinkTargetChangeDetail) => {
    setChoice(next)
    if (detail.address !== undefined) setUrl(detail.address)
    setEntryTitle(detail.title)
  }

  return (
    <>
      <DialogTitle>{editing ? 'Edit link' : 'Insert link'}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        {lookup ? (
          <LinkTargetAutocomplete
            label="Link to"
            placeholder="Search pages and entries"
            value={choice}
            onChange={handleChoice}
            targets={targets}
            trailing={EXTERNAL_CHOICE}
            addressOption={EXTERNAL_URL_OPTION}
            autoFocus={!external}
            openOnFocus={!editing}
            helperText={
              external
                ? undefined
                : 'A page or entry picked here keeps working when it is renamed.'
            }
          />
        ) : null}
        {external ? (
          <TextField
            label="URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) {
                event.preventDefault()
                confirm()
              }
            }}
            size="small"
            autoFocus
            sx={lookup ? undefined : { mt: 1 }}
            helperText="https:// or a site path like /pricing"
          />
        ) : null}
        {withText ? (
          <TextField
            label="Text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            size="small"
            helperText={
              external
                ? 'Falls back to the URL when blank'
                : 'Falls back to the page or entry name when blank'
            }
          />
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={!valid}
          onClick={confirm}
        >
          {editing ? 'Save' : 'Insert'}
        </Button>
      </DialogActions>
    </>
  )
}

/**
 * Insert or edit one link. The body mounts when the dialog opens — a Dialog
 * drops its children once closed — so the fields always start from `href`
 * and `text` rather than from whatever the last link left in them.
 */
export function MarkdownLinkDialog(props: MarkdownLinkDialogProps) {
  const { open, onClose } = props
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <MarkdownLinkForm {...props} />
    </Dialog>
  )
}
MarkdownLinkDialog.displayName = 'MarkdownLinkDialog'

export default MarkdownLinkDialog
