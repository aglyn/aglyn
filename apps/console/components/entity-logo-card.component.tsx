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
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import {
  ENTITY_LOGO_HINT,
  PERSON_IMAGE_HINT,
} from '../constants/media-size-hints'
import MediaFieldSection from './media-field-section.component'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface EntityLogoCardProps {
  hostId: string
  /** Draw as a section inside the SEO card rather than a card of its own. */
  embedded?: boolean
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
  const { hostId, embedded } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Draft for the URL box below; `null` means "show the stored value". */
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  const logo = data?.seo?.entity?.logo
  const entityName = data?.seo?.entity?.name
  /**
   * A PERSON does not have a logo (AGL-2486).
   *
   * Zach: *"it also doesn't reflect copy when the entity is a person."* Every
   * word here said logo, publisher's mark, the organization publishing this
   * site — while the Type select one field up may say Person, and a site run
   * by one человек is the common case for a portfolio or a consultancy.
   *
   * It is not only wording. `schema.org` gives `logo` to an Organization and
   * `image` to a Person, and the tenant emitted `logo` for both until this
   * issue — so for a Person the value was published under a property its own
   * `@type` does not define. `hostSeoEntityImageJsonLd` now picks the right
   * one, and this copy describes what actually gets published.
   */
  const isPerson =
    Aglyn.contentAuthorSchemaType(data?.seo?.entity?.type) === 'Person'
  const entityCopy = isPerson
    ? {
        header: 'Entity photo',
        noun: 'photo',
        description:
          'Shown by search engines beside results for this site, as the ' +
          'picture of the person who publishes it. This is the publisher’s ' +
          'own photo — the site’s logo is set under Details.',
        empty: 'No entity photo set',
        choose: 'Choose photo from media',
        replace: 'Replace photo from media',
        alt: 'Entity photo',
        urlLabel: 'Or paste a photo URL',
        urlHelper:
          'An external photo is a legitimate answer — most sites pick from ' +
          'the library above.',
        hint: PERSON_IMAGE_HINT,
        removed: 'Entity photo removed',
        updated: 'Entity photo updated',
      }
    : {
        header: 'Entity logo',
        noun: 'logo',
        description:
          'Shown by search engines beside results for this site, as the ' +
          'logo of whoever publishes it. This is the publisher’s mark — the ' +
          'site’s own logo is set under Details.',
        empty: 'No entity logo set',
        choose: 'Choose from media',
        replace: 'Replace from media',
        alt: 'Entity logo',
        urlLabel: 'Or paste a logo URL',
        urlHelper:
          'An external logo is a legitimate answer — most sites pick from ' +
          'the library above.',
        hint: ENTITY_LOGO_HINT,
        removed: 'Entity logo removed',
        updated: 'Entity logo updated',
      }
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
    <MediaFieldSection
      embedded={embedded}
      header={entityCopy.header}
      help={docsHelp('seo', {
        anchor: '#structured-data',
        excerpt:
          `The ${entityCopy.noun} of the organization or person publishing ` +
          'this site, emitted as JSON-LD so search engines can show it ' +
          'beside a rich result. Pick it from your media library, or paste ' +
          'an external URL below.',
      })}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {entityCopy.description}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {preview ? (
            <Box
              component="img"
              src={preview}
              alt={entityCopy.alt}
              sx={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain' }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {entityCopy.empty}
            </Typography>
          )}
          <Button
            size="small"
            color="primary"
            onClick={() => setPickerOpen(true)}
          >
            {logo ? entityCopy.replace : entityCopy.choose}
          </Button>
          {logo ? (
            <Button
              size="small"
              color="error"
              // Written straight to the host doc as `''`. Clearing it in the
              // SEO form above cannot work: two layers of that form stack map
              // an empty string to `undefined` (AGL-1191), so a cleared field
              // is dropped from the patch and the OLD logo simply stays.
              onClick={() => void save('', entityCopy.removed)}
            >
              {'Remove'}
            </Button>
          ) : null}
        </Stack>
        {/* Said BEFORE the upload, not about the file already chosen. */}
        <Typography variant="caption" color="text.secondary" component="div">
          {entityCopy.hint}
        </Typography>
        {/*
          The URL box this card absorbed from the SEO form (AGL-2486).

          `seo.entity.logo` had two editors on one tab, and the other one's
          own helper text told the reader to come here — while being the only
          one of the two with no picker. An externally hosted logo is
          legitimate schema.org output, so the capability moved rather than
          disappearing.
        */}
        <TextField
          size="small"
          fullWidth
          label={entityCopy.urlLabel}
          value={urlDraft ?? (typeof logo === 'string' ? logo : '')}
          onChange={(event) => setUrlDraft(event.target.value)}
          onBlur={() => {
            if (urlDraft === null) return
            const next = urlDraft.trim()
            setUrlDraft(null)
            if (next === (logo ?? '')) return
            void save(next, entityCopy.updated)
          }}
          helperText={entityCopy.urlHelper}
        />
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
    </MediaFieldSection>
  )
}
EntityLogoCard.displayName = 'EntityLogoCard'

export default EntityLogoCard
