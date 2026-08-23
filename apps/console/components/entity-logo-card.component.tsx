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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost } from '@aglyn/tenant-feature-instance'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface EntityLogoCardProps {
  hostId: string
}

/**
 * The PUBLISHER's logo, for structured data (AGL-2486).
 *
 * `seo.entity.logo` is the logo of the organization or person the site
 * belongs to — it is emitted inside the JSON-LD `publisher` block, and it is
 * what a search engine shows beside a rich result. Distinct from
 * `logoUrl`/`LogoCard`, which is the site's own brand mark in the tenant's
 * navigation loader.
 *
 * It had no picker at all: a bare text field in the SEO form, expecting
 * someone to produce a URL for an image that is, nine times out of ten,
 * already in their media library. The favicon two fields above it has had
 * one since AGL-134. So this is that same card, over the same canonical
 * `MediaPickerDialog` (AGL-821) — folders, upload and the org's shared
 * library come for free.
 *
 * The text field in the SEO form STAYS, and is not made read-only: an
 * external logo URL is legitimate schema.org output, and a publisher whose
 * mark is hosted on their corporate site should keep pasting it.
 *
 * ## Why this one does NOT store a `media:` reference
 *
 * Every other picker in the console writes {@link Aglyn.mediaNodeSrc} — a
 * `media:` reference that `resolveMediaSrc` turns back into a site-relative
 * CDN path at render. That is right for anything a PAGE renders, and wrong
 * here, because nothing renders this: the tenant's `WebSite` and `Article`
 * JSON-LD copy `seo.entity.logo` into the document verbatim, with no
 * resolver in front of it. A reference would ship `media:org:…/…` to Google
 * as a logo URL, and a site-relative path would ship a URL with no origin —
 * the same out-of-band problem `og:image` has (AGL-1337), with the same
 * answer: resolve, then absolutize against the site's own public origin
 * ({@link Aglyn.absoluteMediaSrc}).
 *
 * With no public origin to absolutize against — a host with neither a
 * subdomain nor a custom domain — the raw storage URL is used rather than
 * writing a relative one. Never interpolate an unknown origin, and never
 * emit a URL that is well-formed but wrong (AGL-1160).
 */
export function EntityLogoCard(props: EntityLogoCardProps) {
  const { hostId } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  const logo = data?.seo?.entity?.logo
  const entityName = data?.seo?.entity?.name
  /**
   * Resolve before showing. The stored value is an absolute URL for anything
   * picked here, but a value typed into the SEO form — or written before
   * this card existed — can be any of the three generations, and only the
   * resolver knows all three.
   */
  const preview = Aglyn.resolveMediaSrc(logo, { hostId })

  const save = (value: string, message: string) =>
    setDoc({ seo: { entity: { logo: value } } }, { merge: true })
      .then(() =>
        enqueueSnackbar(message, { variant: 'success', persist: false }),
      )
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )

  return (
    <CardDisplay
      header={'Entity logo'}
      help={docsHelp('seo', {
        anchor: '#structured-data',
        excerpt:
          'The logo of the organization or person publishing this site, ' +
          'emitted as JSON-LD so search engines can show it beside a rich ' +
          'result. Pick it from your media library or paste an external URL ' +
          'in the SEO form above.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Shown by search engines beside results for this site, as the ' +
            'logo of whoever publishes it. This is the publisher’s mark — ' +
            'the site’s own logo is set under Details.'}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {preview ? (
            <Box
              component="img"
              src={preview}
              alt="Entity logo"
              sx={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain' }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'No entity logo set'}
            </Typography>
          )}
          <Button
            size="small"
            color="primary"
            onClick={() => setPickerOpen(true)}
          >
            {logo ? 'Replace from media' : 'Choose from media'}
          </Button>
          {logo ? (
            <Button
              size="small"
              color="error"
              // Written straight to the host doc as `''`. Clearing it in the
              // SEO form above cannot work: two layers of that form stack map
              // an empty string to `undefined` (AGL-1191), so a cleared field
              // is dropped from the patch and the OLD logo simply stays.
              onClick={() => void save('', 'Entity logo removed')}
            >
              {'Remove'}
            </Button>
          ) : null}
        </Stack>
        {logo && !entityName ? (
          // Google reads the logo off the `publisher` node, and the tenant
          // only emits that node when the entity has a NAME — so a logo with
          // no name beside it is written, saved, and never published. Say so
          // here rather than letting someone conclude the field is broken.
          <Alert severity="info">
            {'Structured data needs an entity NAME before this logo is ' +
              'published — search engines read the logo off the publisher, ' +
              'and without a name there is no publisher to attach it to.'}
          </Alert>
        ) : null}
      </Stack>
      <MediaPickerDialog
        hostId={hostId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(media) => {
          // ABSOLUTE, not a `media:` reference — see the note above. The
          // reference is still what gets resolved, so the org's `mediaCdn`
          // entitlement keeps deciding whether this is a CDN URL or the raw
          // storage one; only the absolutizing is extra.
          const src =
            Aglyn.absoluteMediaSrc(Aglyn.mediaNodeSrc(media), {
              hostId,
              origin: Aglyn.hostPublicOrigin(data),
            }) ?? media?.url
          if (!src) return
          void save(src, 'Entity logo saved')
        }}
      />
    </CardDisplay>
  )
}
EntityLogoCard.displayName = 'EntityLogoCard'

export default EntityLogoCard
