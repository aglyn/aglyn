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

import { BUSINESS_SOCIAL_LINKS_MAX } from '@aglyn/aglyn/app-utils/business-details'
import { describeHostTokens } from '@aglyn/aglyn/app-utils/host-tokens'
import { AppLink } from '@aglyn/shared-ui-jsx'
import {
  FormFieldGrid,
  type FormFieldGridProps,
  FormSpy,
  useFieldApi,
} from '@aglyn/shared-ui-jsx-forms'
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useHostSubdomain } from './host-id-provider'

/**
 * The pieces of Setup → Business profile's Business details card that are not plain
 * text fields (AGL-4136): the social links editor, the list of what pages can
 * use, and the line that points at SEO → Local business.
 *
 * The card itself is a host settings form (`hostBusinessDetails`), saved by
 * the same guarded save as every other settings card. These are registered
 * in that form's component mapper under the types below.
 */

/** The field type the social links editor is registered under. */
export const SOCIAL_LINKS_FIELD = 'social-links'

/** The field type the token list is registered under. It holds no value. */
export const HOST_TOKEN_PREVIEW_FIELD = 'host-token-preview'

export interface SocialLink {
  label: string
  url: string
}

const asLinks = (value: unknown): SocialLink[] =>
  (Array.isArray(value) ? value : []).map((link) => ({
    label: String((link as { label?: unknown } | null)?.label ?? ''),
    url: String((link as { url?: unknown } | null)?.url ?? ''),
  }))

export interface SocialLinksEditorProps {
  links: SocialLink[]
  onChange: (links: SocialLink[]) => void
  disabled?: boolean
}

/**
 * The site's social links, a label and an address per row, up to
 * {@link BUSINESS_SOCIAL_LINKS_MAX}. Moved here from the Business details
 * card Setup → Basic details used to draw, unchanged: a row without an
 * address is kept while it is being typed and dropped on save.
 */
export function SocialLinksEditor(props: SocialLinksEditorProps) {
  const { links, onChange, disabled } = props
  const update = (index: number, patch: Partial<SocialLink>) =>
    onChange(
      links.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    )
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        {'Social links'}
      </Typography>
      <Stack spacing={1}>
        {links.map((link, index) => (
          <Stack key={index} direction="row" spacing={1}>
            <TextField
              size="small"
              label="Label"
              value={link.label}
              disabled={disabled}
              sx={{ width: 160 }}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <TextField
              size="small"
              label="URL"
              fullWidth
              value={link.url}
              disabled={disabled}
              onChange={(event) => update(index, { url: event.target.value })}
            />
            <Tooltip title="Remove">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Remove ${link.label || link.url || 'this link'}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(links.filter((_, position) => position !== index))
                  }
                >
                  {'×'}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ))}
        <Box>
          <Button
            size="small"
            disabled={disabled || links.length >= BUSINESS_SOCIAL_LINKS_MAX}
            onClick={() => onChange([...links, { label: '', url: '' }])}
          >
            {'Add a link'}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary">
          {'Your pages can link each profile with the Facebook, Instagram, X, ' +
            'LinkedIn, YouTube and TikTok link variables, matched by its address.'}
        </Typography>
      </Stack>
    </Box>
  )
}

interface FieldProps {
  name: string
  FormFieldGridProps?: FormFieldGridProps
  [key: string]: unknown
}

/** {@link SocialLinksEditor} as a form field: its value is `business.socialLinks`. */
export function SocialLinksField(props: FieldProps) {
  const { input, isDisabled, isReadOnly, help, FormFieldGridProps = {} } =
    useFieldApi(props)
  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <SocialLinksEditor
        links={asLinks(input.value)}
        onChange={(links) => input.onChange(links)}
        disabled={Boolean(isDisabled || isReadOnly)}
      />
    </FormFieldGrid>
  )
}

/**
 * What a page, a template or an email can use from this card, each with the
 * value it would produce on this site, read from what is on screen rather
 * than what is saved, so it answers "what would this produce" while the
 * owner is still deciding. Closed until asked for: it is a reference, not a
 * field. Images are left out, as the variable picker leaves them out of text.
 */
export function HostTokenPreviewField(props: FieldProps) {
  const { FormFieldGridProps = {} } = props
  const [open, setOpen] = useState(false)
  return (
    <FormFieldGrid {...FormFieldGridProps}>
      <Button
        size="small"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide what your pages can use' : 'Show what your pages can use'}
      </Button>
      <Collapse in={open} unmountOnExit>
        <FormSpy subscription={{ values: true }}>
          {({ values }: { values: Record<string, unknown> }) => (
            <Stack spacing={0.5} sx={{ pt: 1 }} data-testid="host-token-preview">
              {describeHostTokens(values as never)
                .filter((token) => token.type !== 'image')
                .map((token) => (
                  <Stack
                    useFlexGap
                    key={token.key}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      label={token.token}
                      sx={{ fontFamily: 'monospace' }}
                    />
                    <Typography
                      variant="body2"
                      color={token.set ? 'text.primary' : 'text.secondary'}
                      sx={{ wordBreak: 'break-all' }}
                    >
                      {token.set ? token.value : 'not set on this site'}
                    </Typography>
                  </Stack>
                ))}
            </Stack>
          )}
        </FormSpy>
      </Collapse>
    </FormFieldGrid>
  )
}

/**
 * The card's subheader: what the card is for, and where the rest of the
 * business's facts are kept, with a link there.
 */
export function BusinessDetailsNote() {
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const href =
    orgSlug && host ? buildRoute(Route.HOST_SETUP_SEO, { orgSlug, host }) : null
  return (
    <>
      {'Your business’s name and how to reach it. Your pages, emails, ' +
        'documents and search listings all use what you enter here. The ' +
        'business type, opening hours and areas served are under '}
      {href ? <AppLink href={href}>{'SEO → Local business'}</AppLink> : 'SEO → Local business'}
      {'.'}
    </>
  )
}

export const FIELD_MAP_SOCIAL_LINKS = { component: SocialLinksField }
export const FIELD_MAP_HOST_TOKEN_PREVIEW = { component: HostTokenPreviewField }
