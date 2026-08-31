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

import * as Aglyn from '@aglyn/aglyn'
import { Box, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'

export interface FormDesignPreviewProps {
  formId: string
  /** The form document's PUBLISHED `nodes` — what a visitor is served today. */
  nodes: unknown
  /** Which field the document names as the marketing opt-in. */
  consentFieldName?: string
  /** The document has not arrived yet, as against having no design. */
  loading?: boolean
}

/**
 * The `form` node inside a published design.
 *
 * A form document's tree holds exactly one, because the document IS that form
 * — but the tree is a flat map, so the node has to be found rather than
 * assumed to be the root.
 */
function findFormNodeId(nodes: Record<string, any> | null): string | undefined {
  return Object.keys(nodes ?? {}).find(
    (id) => nodes?.[id]?.componentId === 'form',
  )
}

/** Every character that could close an attribute or open a tag. */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * One field, as the browser will submit it.
 *
 * The `name` attribute is the whole point: it is the key `/api/forms/submit`
 * reads out of the `FormData`, and it is the coupling `checkFormContract`
 * guards. Rendering the control WITH its name is what makes this a preview of
 * the contract rather than a picture of some inputs.
 */
function renderField(field: Aglyn.FormFieldDecl, consentFieldName?: string): string {
  const name = escapeHtml(field.fieldName)
  const label = escapeHtml(field.label || field.fieldName)
  const required = field.required ? ' required' : ''
  const isConsent = Boolean(consentFieldName) && field.fieldName === consentFieldName
  const badge = isConsent
    ? '<span class="badge">marketing consent</span>'
    : field.required
      ? '<span class="badge">required</span>'
      : ''
  const options = (field.options ?? []).map((option) => escapeHtml(option))

  let control: string
  switch (field.fieldType) {
    case 'textarea':
      control = `<textarea name="${name}" rows="3"${required}></textarea>`
      break
    case 'select':
      control = `<select name="${name}"${required}>${options
        .map((option) => `<option value="${option}">${option}</option>`)
        .join('')}</select>`
      break
    case 'radio':
      control = `<div class="choices">${options
        .map(
          (option) =>
            `<label class="choice"><input type="radio" name="${name}" value="${option}"${required}> ${option}</label>`,
        )
        .join('')}</div>`
      break
    case 'checkbox':
      control = `<label class="choice"><input type="checkbox" name="${name}" value="on"${required}> ${label}</label>`
      break
    case 'rating':
      // The runtime submits a number; a range says so without pretending to be
      // the star control the site draws.
      control = `<input type="range" name="${name}" min="1" max="5"${required}>`
      break
    case 'email':
      control = `<input type="email" name="${name}"${required}>`
      break
    default:
      control = `<input type="text" name="${name}"${required}>`
  }

  return [
    '<div class="field">',
    `<div class="label">${label}${badge}</div>`,
    control,
    `<div class="key">name="${name}"</div>`,
    '</div>',
  ].join('')
}

/** The style block, kept out of the builder so the markup reads as markup. */
const PREVIEW_CSS = `
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 16px;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1a1a1a; background: #ffffff;
  }
  form { display: grid; gap: 16px; max-width: 520px; }
  .field { display: grid; gap: 4px; }
  .label { font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .badge {
    font-weight: 500; font-size: 11px; letter-spacing: .04em;
    text-transform: uppercase; padding: 1px 6px; border-radius: 999px;
    background: #eceff4; color: #55606e;
  }
  .key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         font-size: 11px; color: #6b7280; }
  input[type=text], input[type=email], textarea, select {
    width: 100%; box-sizing: border-box; padding: 8px;
    border: 1px solid #c8cdd4; border-radius: 6px; font: inherit;
    background: #ffffff; color: inherit;
  }
  .choices { display: grid; gap: 4px; }
  .choice { font-weight: 400; display: flex; align-items: center; gap: 6px; }
  button {
    justify-self: start; padding: 8px 16px; border-radius: 6px;
    border: 1px solid #c8cdd4; background: #f4f6f8; font: inherit;
  }
  .none { color: #6b7280; }
`

/**
 * Builds the standalone document the frame is given.
 *
 * Exported for the spec: the property that matters — that no author-supplied
 * string can become markup — is a property of this string, and asserting it
 * through a rendered component would be asserting it through React's escaping
 * as well as this function's.
 */
export function buildFormPreviewDocument(options: {
  fields: Aglyn.FormFieldDecl[]
  consentFieldName?: string
}): string {
  const { fields, consentFieldName } = options
  const body = fields.length
    ? fields.map((field) => renderField(field, consentFieldName)).join('')
    : '<p class="none">This design declares no named fields.</p>'
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<style>${PREVIEW_CSS}</style></head><body>`,
    // `action` is deliberately absent and the frame is sandboxed, so this
    // cannot post anywhere even if a reader hits Return in a text field.
    `<form>${body}<button type="button">Submit</button></form>`,
    '</body></html>',
  ].join('')
}

/**
 * THE FORM AS THE SUBMIT ROUTE WILL READ IT, DRAWN SAFELY.
 *
 * ## What is being previewed
 *
 * A form has two halves and they fail differently. The DESIGN — fonts,
 * spacing, the theme the site draws it in — is previewed by
 * `Route.FORM_PREVIEW`, which renders the stored nodes through
 * `AglynNodeRenderer`, the same component tree the published page mounts. That
 * is a whole-page surface and it stays where it is.
 *
 * This is the other half: the CONTRACT. `/api/forms/submit` never sees a
 * pixel. It sees `FormData` keys, and every coupling it depends on — which
 * field is the address a lead is created from, which field is the marketing
 * opt-in — is resolved by NAME. So the question this frame answers is the one
 * an author cannot answer by looking at the canvas: what names will arrive,
 * and which of them carry meaning.
 *
 * The field list is NOT re-derived here. `formFieldDeclsFromNodes` is the same
 * function the publish path calls to write the document's `fields` and the
 * same one adoption uses, including its two rules that are easy to get wrong
 * — an unnamed field is dropped, and a duplicate name keeps its first
 * occurrence — so this frame drops and keeps exactly what a real submission
 * does. A second implementation would be a preview of something else.
 *
 * ## Sandboxed, because every string in it is tenant-authored
 *
 * Labels, option text and field names are typed by a site's own editors, or
 * arrive on a marketplace template. They are escaped on the way into the
 * document AND the document is rendered into an iframe with an EMPTY `sandbox`
 * attribute — the maximally restrictive form: no scripts, no forms, no popups,
 * no top-level navigation and, critically, no same-origin. The frame gets an
 * opaque origin, so nothing inside it can reach the console's cookies, storage
 * or DOM. `srcDoc` rather than a URL keeps the markup from ever being served
 * from the console's own origin, where the sandbox attribute would be the only
 * thing between tenant content and a live session.
 *
 * The escaping and the sandbox are not redundant: the escaping is what keeps
 * the preview a preview of the author's text rather than of their markup, and
 * the sandbox is what makes being wrong about the escaping survivable.
 */
export function FormDesignPreview(props: FormDesignPreviewProps) {
  const { formId, nodes: rawNodes, consentFieldName, loading } = props

  const fields = useMemo(() => {
    const decoded = Aglyn.decodeStoredNodes<Record<string, any>>(rawNodes)
    if (!decoded || !Object.keys(decoded).length) return null
    const formNodeId = findFormNodeId(decoded)
    if (!formNodeId) return null
    return Aglyn.formFieldDeclsFromNodes(
      decoded as never,
      formNodeId as Aglyn.NodeId,
    )
  }, [rawNodes])

  const previewDocument = useMemo(
    () =>
      fields
        ? buildFormPreviewDocument({ fields, consentFieldName })
        : null,
    [fields, consentFieldName],
  )

  if (!previewDocument) {
    return (
      <Typography variant="body2" color="text.secondary">
        {loading
          ? 'Loading this form…'
          : 'Nothing published yet — open this form in the besigner, then ' +
            'publish a version to see what it will collect.'}
      </Typography>
    )
  }

  return (
    <Stack spacing={1}>
      <Box
        component="iframe"
        title={`Preview of form ${formId}`}
        /*
         * EMPTY sandbox — every restriction on, nothing allowed back. The
         * strings below are authored outside this console, so the document is
         * rendered with no scripts, no form submission, no navigation and an
         * opaque origin: it cannot reach the console's session, storage or DOM
         * even though it is drawn inside the console.
         */
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={previewDocument}
        sx={{
          width: '100%',
          // Fixed, with the frame's own scrollbar. A sandbox with no scripts
          // is a frame that cannot measure or report its content height, and
          // an iframe cannot size to its content on its own.
          height: 420,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'common.white',
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {'These are the names a submission arrives under, read off the ' +
          'published design by the same function that writes the form’s ' +
          'declared fields. The site’s own styling is not applied here — ' +
          'use Preview for that.'}
      </Typography>
    </Stack>
  )
}
FormDesignPreview.displayName = 'FormDesignPreview'

export default FormDesignPreview
