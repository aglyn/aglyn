/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import {
  resolveSiteTheme,
  themeOverridePatch,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import { overrideWriteValue } from '@aglyn/aglyn/app-utils/marketplace-overrides'
import * as Aglyn from '@aglyn/aglyn'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container, GridItems, useLoading } from '@aglyn/shared-ui-jsx'
import {
  FieldComponentType,
  FieldValidatorType,
  FormRenderer,
  FormSchema,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { InputAdornment, Stack, Tab } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useAnalytics, useUser } from '@aglyn/tenant-feature-instance'
import HostActivityTable from '../../../../../../components/host-activity-table.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import CardDisplayFormTemplate, {
  FormCardWrapper,
} from '../../../../../../components/card-display-form-template'
import { useFormApi } from '@aglyn/shared-ui-jsx-forms'
import useTabParam from '../../../../../../hooks/use-tab-param'
import { Grid } from '@mui/material'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../../components/plugin-widget-slot.component'
import MainLayout from '../../../../../../components/layouts/main.layout'
import AuthScreensCard from '../../../../../../components/auth-screens-card.component'
import CustomDomainCard from '../../../../../../components/custom-domain-card.component'
import SiteBrandingBadgeCard from '../../../../../../components/site-branding-badge-card.component'
import SiteEmailsCard from '../../../../../../components/site-emails-card.component'
import FaviconCard from '../../../../../../components/favicon-card.component'
import EntityLogoCard from '../../../../../../components/entity-logo-card.component'
import SearchIndexingCard from '../../../../../../components/search-indexing-card.component'
import ConsentBannerCard from '../../../../../../components/consent-banner-card.component'
import SocialImageCard from '../../../../../../components/social-image-card.component'
import BusinessDetailsCard from '../../../../../../components/business-details-card.component'
import LogoCard from '../../../../../../components/logo-card.component'
import ErrorScreensCard from '../../../../../../components/error-screens-card.component'
import ApprovedImageHostsCard from '../../../../../../components/approved-image-hosts-card.component'
import LanguagesCard from '../../../../../../components/languages-card.component'
import SiteBackupCard from '../../../../../../components/site-backup-card.component'
import SiteTemplateCard from '../../../../../../components/site-template-card.component'
import ThemeEditor from '../../../../../../components/theme-editor/theme-editor.component'
import ThemeOverridesCard from '../../../../../../components/theme-editor/theme-overrides-card.component'
import ThemeSourceCard from '../../../../../../components/theme-editor/theme-source-card.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import { docsHelp } from '../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import useHostActivityLogger from '../../../../../../hooks/use-host-activity-logger'

const basicSchema: FormSchema = {
  id: 'hostDetails',
  title: 'Basic details',
  CardDisplayProps: {
    help: docsHelp('gettingStarted', {
      anchor: '#what-a-site-contains',
      excerpt:
        'The site name shown across the console and the subdomain it is ' +
        'served from.',
    }),
  },
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'displayName',
      label: 'Display name',
      type: 'text',
      FormFieldGridProps: {
        size: {
          xs: 12,
          sm: 6,
        },
      },
      isRequired: true,
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a display name',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 30,
          message: 'Please enter shorter display name',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'subdomain',
      label: 'Subdomain',
      type: 'text',
      help: docsHelp('gettingStarted', {
        anchor: '#create-your-first-site',
        excerpt:
          `Your site's address on ${TENANT_APEX} — you can also connect ` +
          'your own domain from the Custom Domain tab.',
      }),
      isRequired: true,
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a subdomain',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 15,
          message: 'Please enter shorter display name',
        },
      ],
    },
  ],
}

/**
 * Tracking (AGL-2486) — its own tab, and not part of SEO.
 *
 * then *"We also need the support for Google tag manager there too not just
 * google analytics, maybe move GA and GTM to its own tracking tab."*
 *
 * He is right about the category. A measurement id is not a search-engine
 * setting; it shares a tab with titles and structured data only because it was
 * the first `analytics.*` field anyone added and the SEO form was the nearest
 * form. Moving it changes no stored data — both fields are still `analytics.*`
 * on the host document, and this tab saves through the same handler.
 *
 * BOTH IDS ARE FORMAT-VALIDATED HERE, not merely hinted. They land inside an
 * inline script on the published site, so the tenant refuses anything that is
 * not the exact shape (`GA_MEASUREMENT_ID_PATTERN`,
 * `GTM_CONTAINER_ID_PATTERN`) — which without this would read as "I saved it
 * and nothing happened". The console rejects it at the field instead, with the
 * same two patterns rather than a second guess at them.
 */
const trackingSchema: FormSchema = {
  id: 'hostTracking',
  title: 'Tracking',
  CardDisplayProps: {
    /*
      The consent statement belongs to the CARD, not to a field — it is true
      of both ids and of anything either of them loads. As a `subheader`
      rather than a `plain-text` field because `simpleComponentMapper` has no
      such component; a schema is not the place to discover that.
    */
    subheader:
      'Both of these load ONLY after a visitor’s consent state allows ' +
      'analytics — set the posture under SEO → Cookie consent. Advertising ' +
      'stays denied unless the visitor grants it, wherever they are.',
    help: docsHelp('analytics', {
      anchor: '#google-analytics',
      excerpt:
        'Send your site’s traffic to Google Analytics or a Tag Manager ' +
        'container. Visitors are asked for consent first.',
    }),
  },
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'analytics.gaMeasurementId',
      label: 'Google Analytics measurement ID',
      helperText:
        'Optional — e.g. G-XXXXXXXXXX; injects gtag on your site. Visitors ' +
        'are asked for consent first.',
      help: docsHelp('analytics', {
        anchor: '#google-analytics',
        excerpt:
          'Track your site in Google Analytics alongside the built-in ' +
          'pageview analytics.',
      }),
      type: 'text',
      validate: [
        {
          type: FieldValidatorType.PATTERN,
          // `.source`, not the RegExp: the form stack's pattern validator
          // takes the expression as a STRING and silently validates nothing
          // when handed the object.
          pattern: Aglyn.GA_MEASUREMENT_ID_PATTERN.source,
          message: 'Looks like G-XXXXXXXXXX — that is the shape GA uses',
        },
      ],
      FormFieldGridProps: { size: { xs: 12, sm: 6 } },
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'analytics.gtmContainerId',
      label: 'Google Tag Manager container ID',
      helperText:
        'Optional — e.g. GTM-XXXXXXX. A container is a LOADER: whatever ' +
        'tags it carries load with it, so it waits for the same consent, and ' +
        'advertising tags stay denied unless the visitor grants advertising.',
      help: docsHelp('analytics', {
        anchor: '#google-analytics',
        excerpt:
          'Load a Google Tag Manager container on your site. Consent Mode ' +
          'signals are set before the container loads.',
      }),
      type: 'text',
      validate: [
        {
          type: FieldValidatorType.PATTERN,
          pattern: Aglyn.GTM_CONTAINER_ID_PATTERN.source,
          message: 'Looks like GTM-XXXXXXX — that is the shape GTM uses',
        },
      ],
      FormFieldGridProps: { size: { xs: 12, sm: 6 } },
    },
  ],
}

const seoSchema: FormSchema = {
  id: 'hostSeo',
  title: 'SEO',
  CardDisplayProps: {
    help: docsHelp('seo', {
      excerpt:
        'Site-wide defaults for titles, descriptions, and structured ' +
        'data — screens can override them in their own SEO editor.',
    }),
  },
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'seo.title',
      label: 'Title',
      type: 'text',
      helperText:
        'Fallback for screens with no SEO title of their own — a screen ' +
        'that sets one publishes it verbatim',
      help: docsHelp('seo', {
        anchor: '#how-a-page-title-is-built',
        excerpt:
          'Default title emitted in the page head and browser tab — ' +
          'screens without their own SEO title fall back to it.',
      }),
      isRequired: true,
      resolveProps: (_, { input: { value } }) => {
        const len = value?.length || 0
        const over = len > 60
        return {
          InputProps: {
            endAdornment: (
              <InputAdornment
                position="end"
                sx={{ color: over ? 'error.light' : undefined }}
              >
                {len}/60
              </InputAdornment>
            ),
          },
        }
      },
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a title',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 60,
          message: 'Please enter a shorter title',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'seo.description',
      label: 'Description',
      type: 'text',
      help: docsHelp('seo', {
        anchor: '#per-screen-seo',
        excerpt:
          'Default meta description shown under your site in search ' +
          'results when a screen sets none of its own.',
      }),
      isRequired: true,
      multiline: true,
      rows: 2,
      resolveProps: (_, { input: { value } }) => {
        const len = value?.length || 0
        const over = len > 155
        return {
          InputProps: {
            endAdornment: (
              <InputAdornment
                position="end"
                sx={{ color: over ? 'error.light' : undefined }}
              >
                {len}/155
              </InputAdornment>
            ),
          },
        }
      },
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a description',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 155,
          message: 'Please enter a shorter description',
        },
      ],
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'seo.separator',
      label: 'Separator',
      type: 'text',
      helperText:
        'Joins a screen’s NAME to the site title above, for screens with ' +
        'no SEO title, e.g. "|" or "·"',
      help: docsHelp('seo', {
        anchor: '#how-a-page-title-is-built',
        excerpt:
          'Character placed between a screen’s name and the site title ' +
          'when the screen sets no SEO title of its own, e.g. "|" or "·".',
      }),
      isRequired: true,
      validate: [
        {
          type: FieldValidatorType.REQUIRED,
          message: 'Please enter a title separator',
        },
        {
          type: FieldValidatorType.MAX_LENGTH,
          threshold: 3,
          message: 'Please enter a shorter title separator',
        },
      ],
    },
    /*
      NO raw favicon box here (AGL-2486). `seo.favicon` is edited by the
      Favicon card further down this tab and by nothing else. A text field for
      it would be a second editor for one value, and it could only show what
      the field literally holds — a `media:org:…` reference, which nobody can
      read or type.

      The card carries the URL box too, so an externally hosted icon is still
      reachable.
    */
    {
      component: FieldComponentType.SUB_FORM,
      name: 'seo.entity',
      title: 'Entity',
      help: docsHelp('seo', {
        anchor: '#structured-data',
        excerpt:
          'Who publishes this site — emitted as JSON-LD structured data ' +
          'so search engines show rich results.',
      }),
      className: false,
      fields: [
        {
          component: FieldComponentType.SELECT,
          name: 'seo.entity.type',
          label: 'Type',
          options: [
            {
              value: `${Aglyn.HostEntityType.ORGANIZATION}`,
              label: 'Organization',
            },
            { value: `${Aglyn.HostEntityType.PERSON}`, label: 'Person' },
          ],
        },
        {
          component: FieldComponentType.TEXT_FIELD,
          name: 'seo.entity.name',
          label: 'Name',
        },
        /*
          Same as the favicon above (AGL-2486). This was a URL box whose own
          helper text told the reader to go and use a different card — two
          controls for `seo.entity.logo`, and the one in front of them had no
          picker. The Entity logo card is the editor, and it takes a URL too,
          so nothing an author could do here is gone.
        */
      ],
    },
  ],
}

/**
 * The SEO card's contents: the form's fields, then the media controls it owns.
 *
 * A separate component because it needs `useFormApi` — the `<form>` element's
 * submit handler comes from the form context, and a template that rendered the
 * fields without it would have a card whose Update button did nothing.
 */
function SeoFormBody(props: {
  hostId: string
  formFields: ReactNode
  formProps: Record<string, unknown>
}) {
  const { hostId, formFields, formProps } = props
  const { handleSubmit } = useFormApi()
  return (
    <>
      <form onSubmit={handleSubmit} noValidate {...formProps}>
        <Grid spacing={2} container>
          {formFields}
        </Grid>
      </form>
      {/*
        Entity logo FIRST: the form ends with the Entity's Type and Name, and
        the logo belongs with them. The favicon sitting between them is what
        made the entity read as separated (AGL-2486).
      */}
      <EntityLogoCard hostId={hostId} embedded />
      <FaviconCard hostId={hostId} embedded />
      <SocialImageCard hostId={hostId} embedded />
    </>
  )
}
SeoFormBody.displayName = 'SeoFormBody'

/** Theme tab id (AGL-114); `/setup?tab=theme` deep links land here. */
const THEME_TAB_ID = 'theme'
/** Custom domain tab id (AGL-122); `/setup?tab=domain` deep links. */
const DOMAIN_TAB_ID = 'domain'
/** Activity tab id (AGL-249); `/setup?tab=activity` deep links. */
const ACTIVITY_TAB_ID = 'activity'
/** Emails reference tab id (AGL-769); `/setup?tab=emails` deep links here. */
const EMAILS_TAB_ID = 'emails'
/**
 * Security tab id (AGL-1152); `/setup?tab=security` deep links here.
 *
 * Home for the owner-controlled halves of this site's Content-Security-Policy.
 * Approved image hosts used to sit under Basic details, which was the right
 * call while it was the only one — a lone card does not earn a tab. It stops
 * being right the moment there are several, because "what may this site load,
 * and from where" is a question an owner comes here to answer deliberately,
 * not something to meet while scrolling past the site title.
 */
const SECURITY_TAB_ID = 'security'

/**
 * Every tab id this page renders, in nav order (AGL-2486).
 *
 * Built from the SAME values the tabs are rendered with — the schema ids and
 * the four constants above — so there is no second spelling to fall out of
 * date. The deep-link resolver reads this list and nothing else.
 *
 * A tab missing from this list is not reachable by deep link: `/setup?tab=<id>`
 * finds no match and falls back to Basic details, with nothing to signal that
 * the link was valid. `setup-tab-deep-links.spec.ts` derives the rendered tabs
 * from this file and fails if the two disagree, so the next tab is either on
 * this list or red — never silently unreachable.
 */
export const SETUP_TAB_IDS = [
  basicSchema.id,
  seoSchema.id,
  trackingSchema.id,
  THEME_TAB_ID,
  DOMAIN_TAB_ID,
  SECURITY_TAB_ID,
  EMAILS_TAB_ID,
  ACTIVITY_TAB_ID,
] as const

const HostSetup: NextPageWithLayout<Record<string, never>> = (props) => {
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const searchParams = useSearchParams()
  /*
    Every tab this page has, DERIVED (AGL-2486).

    The ids come from `SETUP_TAB_IDS`, which is built out of the same schema
    ids and constants the tabs render with, rather than being spelled a second
    time here. A hand-kept copy has to be edited every time a tab is added, and
    the cost of forgetting is silent: the new tab's deep link resolves to
    nothing and drops the visitor on Basic details.

    `SETUP_TAB_IDS` is module scope and `setup-tab-deep-links.spec.ts` derives
    the rendered tabs from this file's source and fails if the two disagree —
    so the next tab is either on the list or red, never silently unreachable.
  */
  const { tab, onTabChange } = useTabParam({
    ids: SETUP_TAB_IDS,
    fallback: basicSchema.id,
    onChange: (value) => {
      const form = forms.find(({ schema }) => schema.id === value)
      // `analytics` is undefined whenever Firebase Analytics failed to
      // initialize (ad blocker, blocked storage, missing measurement id) —
      // `useAnalytics()` is typed as if it never is, and strictNullChecks is
      // off. Unguarded this throws out of a tab-change handler on every
      // switch, for a pageview.
      if (analytics) {
        logEvent(analytics, 'screen_view', {
          firebase_screen: (form?.schema.title as string) ?? 'Theme',
          firebase_screen_class: HostSetup.displayName,
        })
      }
    },
  })
  const analytics = useAnalytics()
  const { data: user } = useUser()
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const router = useRouter()
  const pathname = usePathname()
  const {
    doc: {
      data,
      status,
      /**
       * A snapshot has arrived at least once, from cache or from the server
       * (AGL-1066). The Theme tab gates on this rather than on
       * `status === 'success'`, because a refused listen can now reach
       * `'error'` while `persistentLocalCache` is still serving the host doc
       * — and collapsing the whole tab to `null` mid-session, with the theme
       * right there in memory, is the outcome AGL-1066 decided against. When
       * nothing ever arrived there is genuinely nothing to render and this
       * is false, which is the case the `null` was written for.
       */
      hasEmitted: hostHasEmitted,
      /**
       * The host doc every form on this page is seeded from is unconfirmed
       * by the server (AGL-1358). All three writers below replace whole maps
       * rather than patching fields — the theme, the override patch, and the
       * entire details/SEO form — so a cached seed does not lose one edit,
       * it reverts everything the author did not touch.
       */
      fromCache: hostFromCache,
    },
    setDoc,
  } = useHost({ hostId })
  const [themeSaving, setThemeSaving] = useState(false)
  const logActivity = useHostActivityLogger(hostId)

  /**
   * A site running an INSTALLED theme owns the patch, not the copy (AGL-1021):
   * the editor renders `theme ⊕ override`, so what comes back is the resolved
   * view, and what is stored is its difference from the publisher's version.
   * Editing `theme` directly instead would fork the theme on the first colour
   * change and there would be nothing left to take an update against.
   */
  const themeIsInstalled = Boolean(data?.themeInstalledFrom?.listingId)
  const resolvedTheme = useMemo(() => resolveSiteTheme(data), [data])

  /**
   * Writes `themeOverride` WHOLESALE.
   *
   * `mergeFields` and not `merge: true`: Firestore deep-merges maps, and a
   * patch is a map, so merging a new patch onto the old one takes their union
   * — every path ever overridden stays overridden and a per-field Reset
   * silently does nothing.
   */
  const handleWriteOverride = useCallback(
    async (value: unknown) => {
      /**
       * Refuse a patch computed from an unconfirmed seed (AGL-1358).
       *
       * The caller builds `value` by resolving the STORED patch against the
       * stored theme and re-diffing — both read off `data`, this listener —
       * and `mergeFields` then replaces the patch atomically. So a cached
       * seed does not fail to reset one path: it reinstates every override
       * the author has cleared since that snapshot, on a live site's theme.
       *
       * The verdict is returned rather than swallowed, so the card reports
       * a refusal instead of announcing a reset that never happened.
       */
      return writeGuardedBySeed(
        {
          subject: 'theme overrides',
          unreadable: status === 'error',
          fromCache: hostFromCache,
        },
        async () => {
          await setDoc(
            { themeOverride: value },
            { mergeFields: ['themeOverride'] },
          )
        },
      )
    },
    [setDoc, status, hostFromCache],
  )

  const handleThemeSave = useCallback(
    async (theme: Aglyn.AglynHostTheme) => {
      setThemeSaving(true)
      const dequeueLoading = queueLoading()
      /**
       * Refuse a theme write seeded from an unconfirmed read (AGL-1358).
       *
       * `mergeFields` replaces the field atomically, deliberately, so cleared
       * colours do not linger from a deep merge — and, for the override, so
       * removing one stops overriding rather than unioning with the patch
       * already stored. That is also exactly why a stale seed is dangerous
       * here rather than merely wasteful: the editor is seeded from
       * `resolveSiteTheme(data)`, so `theme` carries EVERY token, not the one
       * that changed. Save a single colour against a cached seed and every
       * other token on a live site reverts to whatever the cache last held.
       *
       * The installed-theme branch is worse still: `themeOverridePatch` diffs
       * against the same stale `data`, so the patch it computes describes
       * differences from a theme that may no longer be the stored one.
       *
       * The guard WRAPS both branches — neither is reachable without a
       * verdict.
       */
      try {
        const verdict = await writeGuardedBySeed(
          {
            subject: 'theme',
            unreadable: status === 'error',
            fromCache: hostFromCache,
          },
          async () => {
            await (themeIsInstalled
              ? setDoc(
                  {
                    themeOverride: overrideWriteValue(
                      themeOverridePatch(data, theme),
                      data?.themeInstalledFrom?.sha256 ?? null,
                    ),
                  },
                  { mergeFields: ['themeOverride'] },
                )
              : setDoc({ theme }, { mergeFields: ['theme'] }))
          },
        )
        // A refusal leaves the editor exactly as the author left it, so the
        // colours they picked survive to be saved once the page reloads.
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'warning' })
        } else {
          enqueueSnackbar(
            themeIsInstalled ? 'Your changes are saved.' : 'Theme saved!',
            { variant: 'success' },
          )
          logActivity('Updated theme', { type: 'theme' })
        }
      } catch (e) {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
      } finally {
        dequeueLoading()
        setThemeSaving(false)
      }
    },
    [
      enqueueSnackbar,
      queueLoading,
      setDoc,
      logActivity,
      themeIsInstalled,
      data,
      status,
      hostFromCache,
    ],
  )

  /** The save itself. Only reachable through the guard above. */
  const runBasicSave = useCallback(
    async (fields: any, dequeueLoading: () => void) => {
      const subdomainChanged =
        typeof fields.subdomain === 'string' &&
        fields.subdomain !== data?.subdomain
      const displayNameChanged =
        typeof fields.displayName === 'string' &&
        fields.displayName !== data?.displayName
      const idToken = await (user as any)?.getIdToken?.()

      // A duplicate display name is allowed, so this check stays advisory.
      if (displayNameChanged) {
        try {
          const response = await fetch('/api/hosts/validate-name', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ hostId, displayName: fields.displayName }),
          })
          const validation = response.ok ? await response.json() : null
          if (validation?.displayNameCollision) {
            enqueueSnackbar(
              'Another of your sites already uses this name — saved ' +
                'anyway, but consider renaming one.',
              { variant: 'info', persist: false },
            )
          }
        } catch {
          // Advisory on network failure; the save proceeds.
        }
      }

      // The subdomain is the site's public address, so the server owns it
      // (AGL-642) — it revalidates and claims uniqueness transactionally
      // with the Admin SDK. This used to be a client write guarded only by
      // an advisory check, which meant the pattern/reserved/uniqueness rules
      // could be skipped entirely. The rules now reject a client write, so a
      // failure here has to abort rather than fall through to setDoc.
      let renamedTo: string | null = null
      if (subdomainChanged) {
        try {
          const response = await fetch('/api/hosts/rename', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ hostId, subdomain: fields.subdomain }),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            dequeueLoading()
            const hint = payload?.suggestions?.length
              ? ` Try: ${payload.suggestions.join(', ')}`
              : ''
            return void enqueueSnackbar(
              (payload?.error ?? 'Could not change the subdomain.') + hint,
              { variant: 'warning', persist: false },
            )
          }
          renamedTo = String(payload?.subdomain ?? fields.subdomain)
        } catch {
          dequeueLoading()
          return void enqueueSnackbar(
            'Could not reach the server to change the subdomain.',
            { variant: 'error' },
          )
        }
      }

      // `subdomain` is server-owned above; the rules reject it from here.
      const clientFields = { ...fields }
      delete clientFields.subdomain
      await setDoc(clientFields, { merge: true })
        .then(() => {
          enqueueSnackbar('Saved!', { variant: 'success' })
          logActivity('Updated host settings', { type: 'host', id: hostId })
          // DisplayName is a client write to the host doc, so it bypasses the
          // membership funnel — ping the server to re-fan the new name into
          // every member's hostMemberships row (AGL-844). Fire-and-forget: a
          // miss self-heals on the next membership change or backfill.
          if (displayNameChanged) {
            void fetch('/api/hosts/sync-memberships', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
              },
              body: JSON.stringify({ hostId }),
            }).catch(() => undefined)
          }
          // The subdomain addresses this page, so a rename leaves the
          // current URL pointing at nothing — the host guard would render
          // the designed 404 on a successful save. Follow it across.
          if (renamedTo && renamedTo !== host) {
            router.replace(
              buildRoute(Route.HOST_SETUP, { orgSlug, host: renamedTo }),
            )
          }
        })
        .catch((e) => {
          enqueueSnackbar(`Error: ${JSON.stringify(e)}`, { variant: 'error' })
        })
        .finally(() => {
          dequeueLoading()
        })
    },
    [
      enqueueSnackbar,
      queueLoading,
      setDoc,
      hostId,
      logActivity,
      data,
      user,
      router,
      orgSlug,
      host,
    ],
  )

  const handleBasicSave = useCallback(
    async (fields: any) => {
      const dequeueLoading = queueLoading()
      /**
       * Refuse the whole save when the seed is unconfirmed (AGL-1358).
       *
       * `FormRenderer` is given `initialValues: data` — this listener — and
       * submits EVERY field it holds, not the ones that changed. So
       * `merge: true` protects nothing: the untouched fields are all in
       * `clientFields`, and a cached seed rewrites the site's details and SEO
       * to whatever the cache last held.
       *
       * The guard wraps the RENAME as well as the document write, and it has
       * to: `subdomainChanged` is decided by comparing the form against
       * `data?.subdomain`, so a stale seed can drive a public address change
       * that nobody asked for. Guarding only the `setDoc` would leave a site
       * renamed with none of the settings that were meant to go with it.
       */
      const verdict = await writeGuardedBySeed(
        {
          subject: 'site settings',
          unreadable: status === 'error',
          fromCache: hostFromCache,
        },
        async () => {
          await runBasicSave(fields, dequeueLoading)
        },
      )
      if (!verdict.ok) {
        dequeueLoading()
        // The form keeps its values, so the author can retry after reloading
        // rather than discovering later that nothing was stored.
        enqueueSnackbar(verdict.message, { variant: 'warning' })
      }
    },
    [queueLoading, runBasicSave, status, hostFromCache, enqueueSnackbar],
  )

  const forms = [
    {
      schema: basicSchema,
      initialValues: data,
      onSubmit: handleBasicSave,
    },
    {
      schema: seoSchema,
      initialValues: data,
      onSubmit: handleBasicSave,
    },
    {
      schema: trackingSchema,
      initialValues: data,
      onSubmit: handleBasicSave,
    },
  ]

  /**
   * The SEO card's own form template (AGL-2486).
   *
   * Same card the shared template draws — `FormCardWrapper` is what carries
   * the Update button and the pristine/invalid states — with the three media
   * controls rendered inside it, after the fields.
   *
   * ORDER IS THE POINT. Entity logo comes FIRST of the three, because the
   * form's last fields are the Entity's Type and Name and the logo belongs
   * with them; putting the favicon between them is what made the entity
   * "look separated" in the first place.
   *
   * Memoised on `hostId`: a FormTemplate identity that changes every render
   * remounts the whole form, which would blow away half-typed input on every
   * keystroke.
   */
  const SeoFormTemplate = useMemo(
    () =>
      function SeoFormTemplateRender(templateProps: any) {
        // `schema` is dropped rather than forwarded: `FormCardWrapper` reads
        // it off the form context itself, and passing it as a prop would
        // spread an unknown attribute onto the Card.
        const { formFields, schema: _schema, ...rest } = templateProps
        return (
          <FormCardWrapper>
            <SeoFormBody
              hostId={hostId}
              formFields={formFields}
              formProps={rest}
            />
          </FormCardWrapper>
        )
      },
    [hostId],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
        },
        {
          children: 'Setup',
          href: buildRoute(Route.HOST_SETUP, { orgSlug, host }),
        },
      ]}
      help="gettingStarted"
      header={{
        children: 'Host Setup',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <TabContext value={tab}>
          <GridItems
            spacing={3}
            items={[
              {
                size: {
                  xs: 12,
                  sm: 3,
                },
                children: (
                  <CardDisplay
                    header="Navigation"
                    help={docsHelp('consoleTour', {
                      excerpt:
                        "Jump between this site's setup sections — " +
                        'details, SEO, theme, custom domain, and activity.',
                    })}
                  >
                    <TabList
                      orientation="vertical"
                      textColor="primary"
                      indicatorColor="primary"
                      sx={{
                        ['.MuiTab-root']: {
                          alignItems: 'start',
                          maxWidth: 'unset',
                        },
                      }}
                      onChange={onTabChange}
                    >
                      {forms.map(({ schema }) => (
                        <Tab
                          key={schema.id}
                          value={schema.id}
                          label={schema.title}
                        />
                      ))}
                      <Tab value={THEME_TAB_ID} label={'Theme'} />
                      <Tab value={DOMAIN_TAB_ID} label={'Custom Domain'} />
                      <Tab value={SECURITY_TAB_ID} label={'Security'} />
                      <Tab value={EMAILS_TAB_ID} label={'Emails'} />
                      <Tab value={ACTIVITY_TAB_ID} label={'Activity'} />
                    </TabList>
                  </CardDisplay>
                ),
              },
              {
                size: {
                  xs: 12,
                  sm: 9,
                },
                children: (
                  <>
                    {forms.map(({ initialValues, onSubmit, schema }) => (
                      <TabPanel
                        key={schema.id}
                        value={schema.id}
                        sx={{ padding: 'unset' }}
                      >
                        <FormRenderer
                          /*
                            The SEO tab renders its media controls INSIDE its
                            own card (AGL-2486), which is why this one tab gets
                            `SeoFormTemplate` instead of the shared
                            `CardDisplayFormTemplate`.

                            The favicon and social image are `seo.*` fields like
                            the rest of the tab. They are separate components
                            only because a media pick needs a picker dialog and
                            because a CLEARED value has to reach Firestore as
                            `''` rather than being dropped by the form stack
                            (AGL-1191). Rendered by the default template those
                            implementation details surface as free-floating
                            cards sitting between the fields they belong to.
                          */
                          FormTemplate={
                            schema.id === 'hostSeo'
                              ? SeoFormTemplate
                              : CardDisplayFormTemplate
                          }
                          componentMapper={simpleComponentMapper}
                          onSubmit={onSubmit}
                          schema={schema}
                          initialValues={initialValues}
                        />

                        {schema.id === 'hostDetails' ? (
                          <>
                            {/* Site brand mark (AGL-594): shown by the
                                tenant's navigation loader. */}
                            <div style={{ marginTop: 24 }}>
                              <LogoCard hostId={hostId} />
                            </div>
                            {/* Contact details `host.*` tokens read from
                                (AGL-1022) — without these the tokens resolve
                                empty forever and teach people the feature
                                does not work. */}
                            <div style={{ marginTop: 24 }}>
                              <BusinessDetailsCard hostId={hostId} />
                            </div>
                            <div style={{ marginTop: 24 }}>
                              <ErrorScreensCard hostId={hostId} />
                            </div>
                            {/* Designable auth screens (AGL-553). */}
                            <div style={{ marginTop: 24 }}>
                              <AuthScreensCard hostId={hostId} />
                            </div>
                            <div style={{ marginTop: 24 }}>
                              <LanguagesCard hostId={hostId} />
                            </div>
                            <div style={{ marginTop: 24 }}>
                              <SiteBackupCard hostId={hostId} />
                            </div>
                            <div style={{ marginTop: 24 }}>
                              <SiteTemplateCard hostId={hostId} />
                            </div>
                            {/* Delete site moved to the host Admin area's
                                Danger zone (AGL-1014) — destructive actions
                                no longer sit in a page collaborators
                                otherwise have reason to visit. */}
                          </>
                        ) : null}
                        {schema.id === 'hostSeo' ? (
                          <>
                            <div style={{ marginTop: 24 }}>
                              <SearchIndexingCard hostId={hostId} />
                            </div>
                            {/* Visitor consent tool (AGL-1498). Beside the
                                GA field it governs: same tab, its own card
                                for the same submit-validation reason as the
                                indexing switch above. */}
                            <div style={{ marginTop: 24 }}>
                              <ConsentBannerCard hostId={hostId} />
                            </div>
                          </>
                        ) : null}
                      </TabPanel>
                    ))}
                    <TabPanel value={THEME_TAB_ID} sx={{ padding: 'unset' }}>
                      {hostHasEmitted ? (
                        <>
                          {/* Where the theme came from, and the ways back
                              (AGL-1020). Above the editor because "am I
                              editing my own theme or a publisher's" changes
                              what every control below it means. */}
                          <div style={{ marginBottom: 24 }}>
                            <ThemeSourceCard
                              hostId={hostId}
                              theme={data?.theme}
                              installedFrom={data?.themeInstalledFrom}
                              replaced={data?.themeReplaced}
                            />
                          </div>
                          {/* "What have I changed?" is a read of the stored
                              patch (AGL-1021), so it cannot disagree with what
                              is applied. Only meaningful for an installed
                              theme — a site's own theme has no publisher's
                              version to differ from. */}
                          <div style={{ marginBottom: 24 }}>
                            <ThemeOverridesCard
                              hostId={hostId}
                              host={data}
                              onWriteOverride={handleWriteOverride}
                            />
                          </div>
                          <ThemeEditor
                            theme={resolvedTheme}
                            saving={themeSaving}
                            onSave={handleThemeSave}
                          />
                        </>
                      ) : null}
                    </TabPanel>
                    <TabPanel value={DOMAIN_TAB_ID} sx={{ padding: 'unset' }}>
                      <Stack spacing={2}>
                        <CustomDomainCard hostId={hostId} />
                        {/* The badge is a fact about the PUBLISHED site, so
                            it belongs beside the domain it is published on
                            (AGL-2081). There is nothing to toggle — the
                            entitlement is the switch — but "do my sites show
                            the Aglyn badge" is a question an owner should be
                            able to answer somewhere, and until now it was
                            answerable nowhere in the console. */}
                        <SiteBrandingBadgeCard />
                      </Stack>
                    </TabPanel>
                    <TabPanel value={SECURITY_TAB_ID} sx={{ padding: 'unset' }}>
                      <Stack spacing={3}>
                        <ApprovedImageHostsCard hostId={hostId} />
                        {/* One card per CSP directive an owner can widen.
                            Each stores its own `host` array and the tenant
                            reads the same names off the lockdown verdict — a
                            control whose field the middleware does not read
                            is a switch wired to nothing. */}
                        <ApprovedImageHostsCard
                          hostId={hostId}
                          field="approvedMediaHosts"
                          header="Approved media hosts"
                          description="Video and audio your pages play from somewhere other than this site. Your own uploads always work — this is only for media you point at by URL."
                          emptyHint="No external hosts approved. Pages can still play every file you upload here."
                          placeholder="videos.example.com"
                          privacyNote="Every host here can see the IP address of anyone who visits your site, because their browser fetches the media directly."
                        />
                        <ApprovedImageHostsCard
                          hostId={hostId}
                          field="approvedFontHosts"
                          header="Approved font hosts"
                          description="Web fonts your pages load from somewhere other than this site. Fonts you upload always work — this is only for fonts served by another host."
                          emptyHint="No external hosts approved. Pages can still use every font you upload here."
                          placeholder="fonts.gstatic.com"
                          privacyNote="Every host here can see the IP address of anyone who visits your site, because their browser fetches the font directly — which is why a self-hosted font is the private option."
                        />
                        <ApprovedImageHostsCard
                          hostId={hostId}
                          field="approvedFormActions"
                          header="Approved form destinations"
                          description="Where your forms may submit to. Forms handled by this site always work — this is only for forms that post to another service."
                          emptyHint="No external destinations approved. Forms can still post to this site."
                          placeholder="forms.example.com"
                          privacyNote="A form posts whatever the visitor typed. Approving a destination sends that data to it directly, so add one only if you intend it to receive submissions."
                        />
                      </Stack>
                    </TabPanel>
                    <TabPanel value={EMAILS_TAB_ID} sx={{ padding: 'unset' }}>
                      <SiteEmailsCard />
                    </TabPanel>
                    <TabPanel value={ACTIVITY_TAB_ID} sx={{ padding: 'unset' }}>
                      <HostActivityTable hostId={hostId} />
                    </TabPanel>
                  </>
                ),
              },
            ]}
          />
        </TabContext>
        {/* Plugin zone (AGL-433): hostSettings widgets. */}
        <PluginWidgetSlot slot="hostSettings" hostId={hostId} />
      </Container>
    </DashboardLayout>
  )
}
HostSetup.displayName = 'Page:HostSetup'

export default HostSetup
