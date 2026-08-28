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
import { HubSections, useActiveSection } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost, writeGuardedBySeed } from '@aglyn/tenant-feature-instance'
import { InputAdornment, Stack } from '@mui/material'
import { logEvent } from 'firebase/analytics'
import { deleteField } from 'firebase/firestore'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { useAnalytics, useUser } from '@aglyn/tenant-feature-instance'
import HostActivityTable from '../../../../../../../components/host-activity-table.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import CardDisplayFormTemplate, {
  FormCardWrapper,
} from '../../../../../../../components/card-display-form-template'
import { useFormApi } from '@aglyn/shared-ui-jsx-forms'
import useTabParam from '@aglyn/shared-ui-next/hooks/use-tab-param'
import { Grid } from '@mui/material'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../../../components/plugin-widget-slot.component'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import CustomDomainCard from '../../../../../../../components/custom-domain-card.component'
import SiteBrandingBadgeCard from '../../../../../../../components/site-branding-badge-card.component'
import SiteEmailsCard from '../../../../../../../components/site-emails-card.component'
import FaviconCard from '../../../../../../../components/favicon-card.component'
import EntityLogoCard from '../../../../../../../components/entity-logo-card.component'
import SearchIndexingCard from '../../../../../../../components/search-indexing-card.component'
import ConsentBannerCard from '../../../../../../../components/consent-banner-card.component'
import SocialImageCard from '../../../../../../../components/social-image-card.component'
import BusinessDetailsCard from '../../../../../../../components/business-details-card.component'
import LogoCard from '../../../../../../../components/logo-card.component'
import ErrorScreensCard from '../../../../../../../components/error-screens-card.component'
import ApprovedImageHostsCard from '../../../../../../../components/approved-image-hosts-card.component'
import LanguagesCard from '../../../../../../../components/languages-card.component'
import SiteBackupCard from '../../../../../../../components/site-backup-card.component'
import SiteTemplateCard from '../../../../../../../components/site-template-card.component'
import ThemeEditor from '../../../../../../../components/theme-editor/theme-editor.component'
import ThemeOverridesCard from '../../../../../../../components/theme-editor/theme-overrides-card.component'
import ThemeSourceCard from '../../../../../../../components/theme-editor/theme-source-card.component'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { docsHelp } from '../../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import useHostActivityLogger from '../../../../../../../hooks/use-host-activity-logger'
import { setupSections } from '../setup-sections'

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
 * Google Analytics and Google Tag Manager live here, together.
 *
 * A measurement id is not a search-engine setting: it is measurement, and it
 * shares nothing with titles and structured data except a form. Both fields
 * are `analytics.*` on the host document either way, and this tab saves
 * through the same handler, so the tab is presentation only.
 *
 * BOTH IDS ARE FORMAT-VALIDATED HERE, not merely hinted. They land inside an
 * inline script on the published site, so the tenant refuses anything that is
 * not the exact shape (`GA_MEASUREMENT_ID_PATTERN`,
 * `GTM_CONTAINER_ID_PATTERN`) — which without this would read as "I saved it
 * and nothing happened". The console rejects it at the field instead, with the
 * same two patterns rather than a second guess at them.
 */
/**
 * The tracking fields a site owner must be able to turn back OFF (AGL-1608).
 *
 * The form renderer drops an empty text input from its submitted values
 * entirely rather than reporting it as `''`, and the write is
 * `setDoc(..., { merge: true })` — so clearing a field submitted a payload
 * that simply did not mention it, merge left the stored value alone, and the
 * page said "Saved!". Every id here could be switched on and never off.
 *
 * That is not a cosmetic bug on this card. These ids load third-party tags
 * and set third-party cookies, and a control that cannot withdraw them leaves
 * the only way out of a tracker being a database edit.
 *
 * ⚠️ Scoped to the form that OWNS them. `handleBasicSave` serves the details
 * and SEO cards too, and those submit no analytics fields at all — treating
 * their absence as "cleared" would wipe every tracking id the moment somebody
 * saved a page title.
 */
const CLEARABLE_TRACKING_PATHS = [
  'analytics.gaMeasurementId',
  'analytics.gtmContainerId',
  'analytics.adTags.meta',
  'analytics.adTags.google-ads',
  'analytics.adTags.linkedin',
] as const

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
      'These load only where a visitor’s consent state allows them — the ' +
      'posture is the Cookie consent card below. In the UK, EU and EEA, and ' +
      'anywhere the region cannot be determined, nothing loads until the ' +
      'visitor accepts. Elsewhere they load from the first visit and the ' +
      'visitor can turn them off at any time.',
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
        'Optional — e.g. G-XXXXXXXXXX; injects gtag on your site. In the ' +
        'UK, EU and EEA, and anywhere the region cannot be determined, it ' +
        'waits for the visitor to accept; elsewhere it runs from the first ' +
        'visit and the visitor can turn it off at any time.',
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
      /*
       * The warning about double counting is in the helper text, not in a
       * doc somebody reads afterwards.
       *
       * The fields above load Google Analytics and Google Ads directly, and a
       * container carrying its own GA4 or Ads tag loads a SECOND copy of the
       * same measurement — every pageview counted twice, every conversion
       * counted twice, and bidding trained on the doubled figure. Nothing in
       * the page can detect it: the container's contents live in Tag Manager,
       * not here, so the only place this can be said is beside the field that
       * turns the container on.
       */
      helperText:
        'Optional — e.g. GTM-XXXXXXX. A container is a LOADER: whatever ' +
        'tags it carries load with it, on the same terms as the fields ' +
        'beside it — waiting for an accept in the UK, EU and EEA, running ' +
        'from the first visit elsewhere — and advertising tags stay denied ' +
        'until that visitor allows advertising. ' +
        'Do not put an Analytics or Google Ads tag in the container if you ' +
        'have filled in the fields above — that loads the same measurement ' +
        'twice and counts every visit and conversion twice.',
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
    {
      /*
       * The advertising id, which had no control at all (AGL-1152).
       *
       * A site could reach advertising only THROUGH an analytics tool: the two
       * fields above are the whole of this card, and the pixel id they do not
       * carry is what the loader actually mounts on. So an operator who wanted
       * ads and no analytics had no route, and one who wanted a Meta pixel had
       * none at any price — the field existed on the document and nowhere in
       * the product.
       *
       * It also decides the site's CONTENT SECURITY POLICY. `runsMeasurement`
       * is what concatenates the advertising origins into `img-src`, and it
       * reads this field: a pixel configured here is a pixel the policy then
       * permits, and one configured nowhere is a beacon the browser refuses.
       */
      component: FieldComponentType.TEXT_FIELD,
      name: 'analytics.adTags.meta',
      label: 'Meta pixel ID',
      helperText:
        'Optional — the numeric ID from Meta Events Manager. Advertising is ' +
        'a separate choice from analytics: in the UK, EU and EEA it waits ' +
        'for an accept; elsewhere it runs from the first visit. Withdrawing ' +
        'removes the tag and clears its cookies.',
      help: docsHelp('analytics', {
        anchor: '#google-analytics',
        excerpt:
          'Run a Meta pixel on your site for ads and remarketing. It waits ' +
          'for advertising consent, which is a separate choice from ' +
          'analytics.',
      }),
      type: 'text',
      validate: [
        {
          type: FieldValidatorType.PATTERN,
          // The SAME expression the loader tests before it will mount
          // anything, so a saved id is one that will actually load.
          pattern: Aglyn.META_PIXEL_ID_PATTERN.source,
          message: 'A Meta pixel ID is 8–20 digits',
        },
      ],
      FormFieldGridProps: { size: { xs: 12, sm: 6 } },
    },
    {
      /*
       * Google Ads WITHOUT Analytics or Tag Manager (AGL-1152).
       *
       * This vendor used to be sweep-only — its cookies could be cleared and
       * nothing could be mounted — so the only way to run Google Ads was to
       * adopt one of the two products above. `gtag.js` with an `AW-` id is
       * Google's own install for Ads on its own.
       *
       * A separate field from the measurement ID, because they are separate
       * products with separate ids: one field accepting either would load an
       * analytics id into an ads tag and report nothing.
       */
      component: FieldComponentType.TEXT_FIELD,
      name: 'analytics.adTags.google-ads',
      label: 'Google Ads conversion ID',
      helperText:
        'Optional — e.g. AW-123456789, from Google Ads. Runs without ' +
        'Analytics or Tag Manager. Consent works the same way as the pixel ' +
        'above.',
      help: docsHelp('analytics', {
        anchor: '#google-analytics',
        excerpt:
          'Run Google Ads conversion tracking and remarketing on your site ' +
          'without needing Google Analytics or Tag Manager.',
      }),
      type: 'text',
      validate: [
        {
          type: FieldValidatorType.PATTERN,
          pattern: Aglyn.GOOGLE_ADS_ID_PATTERN.source,
          message: 'Looks like AW-123456789 — that is the shape Ads uses',
        },
      ],
      FormFieldGridProps: { size: { xs: 12, sm: 6 } },
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'analytics.adTags.linkedin',
      label: 'LinkedIn partner ID',
      helperText:
        'Optional — the numeric partner ID from LinkedIn Campaign Manager. ' +
        'Consent works the same way. LinkedIn also sets cookies on its own ' +
        'domain, which only LinkedIn can clear.',
      help: docsHelp('analytics', {
        anchor: '#google-analytics',
        excerpt:
          'Run the LinkedIn Insight Tag on your site for ads and ' +
          'remarketing, under the same consent as the other advertising ' +
          'tags.',
      }),
      type: 'text',
      validate: [
        {
          type: FieldValidatorType.PATTERN,
          pattern: Aglyn.LINKEDIN_PARTNER_ID_PATTERN.source,
          message: 'A LinkedIn partner ID is 4–10 digits',
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
/** Emails reference tab id (AGL-769); `/setup?tab=emails` deep links here. */
const EMAILS_TAB_ID = 'emails'


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
  EMAILS_TAB_ID,
] as const

/**
 * Everything a Setup section needs but must not own (AGL-693).
 *
 * Sections are separate routes, so anything two of them share has to live in
 * the layout that survives navigation between them. Three things do, and each
 * would break in its own way if a section held it instead:
 *
 * - the HOST DOCUMENT, one subscription feeding all five. A copy per section
 *   would open a second listener and re-seed the forms on every rail click.
 * - the SAVE HANDLERS, which carry the unconfirmed-seed guard (AGL-1358). A
 *   section rewriting the site's details from its own copy of that logic is
 *   how the guard comes to be applied on four routes and not the fifth.
 * - the DRAFTS, which is the whole point: the ref lives above the route so a
 *   half-typed edit survives moving between sections, exactly as it survives
 *   changing tab. Sections as routes UNMOUNT the previous page, so without
 *   this the conversion would have reintroduced the defect it followed.
 */
export interface SetupScope {
  hostId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  /** A host snapshot has arrived at least once, from cache or server. */
  hostHasEmitted: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedTheme: any
  themeSaving: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleThemeSave: (theme: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleWriteOverride: any
  forms: Array<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialValues: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSubmit: (fields: any) => void
  }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SeoFormTemplate: any
  draftsRef: MutableRefObject<Record<string, Record<string, unknown>>>
}

const SetupScopeContext = createContext<SetupScope | null>(null)

export function useSetupScope(): SetupScope {
  const scope = useContext(SetupScopeContext)
  if (!scope) {
    throw new Error('useSetupScope must be used inside the sections layout')
  }
  return scope
}

/**
 * One Setup form, by schema id.
 *
 * A component rather than three copies of the same `FormRenderer` call: the
 * template choice, the draft wiring and the mapper are one contract with the
 * form stack, and three sections rendering their own version of it is three
 * places for the draft recording to be forgotten on the next one added.
 */
export function SetupForm({ schemaId }: { schemaId: string }) {
  const { forms, SeoFormTemplate, draftsRef } = useSetupScope()
  const form = forms.find((entry) => entry.schema.id === schemaId)

  /**
   * The draft, re-applied as an EDIT rather than as a starting point.
   *
   * A `final-form` decorator runs once with the form instance on mount, and
   * `form.change` is the same call typing makes — so the restored values are
   * dirty, the card says there is something to save, and Save is enabled. A
   * field whose draft equals the stored value changes nothing and stays
   * pristine, which is correct: only the actual edits are restored.
   */
  const restoreDraft = useMemo(() => {
    const draft = draftsRef.current[schemaId]
    if (!draft) return undefined
    return [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (formApi: any) => {
        formApi.batch(() => {
          for (const [key, value] of Object.entries(draft)) {
            formApi.change(key, value)
          }
        })
        return () => undefined
      },
    ]
    // Read once per mount, deliberately: this restores what was typed BEFORE
    // this form existed, and re-running it would fight the reader's cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaId])

  if (!form) return null
  const { schema, initialValues, onSubmit } = form
  return (
    <FormRenderer
      /*
        The SEO section renders its media controls INSIDE its own card
        (AGL-2486), which is why it gets `SeoFormTemplate` instead of the
        shared `CardDisplayFormTemplate`.

        The favicon and social image are `seo.*` fields like the rest of the
        section. They are separate components only because a media pick needs a
        picker dialog and because a CLEARED value has to reach Firestore as `''`
        rather than being dropped by the form stack (AGL-1191). Rendered by the
        default template those implementation details surface as free-floating
        cards sitting between the fields they belong to.
      */
      FormTemplate={
        schema.id === 'hostSeo' ? SeoFormTemplate : CardDisplayFormTemplate
      }
      componentMapper={simpleComponentMapper}
      onSubmit={onSubmit}
      schema={schema}
      initialValues={initialValues}
      decorators={restoreDraft}
      /*
        `react-final-form`'s hook for watching state without subscribing a
        component to it — the renderer forwards unrecognised props to the form.
        Writing to a ref here is why a keystroke does not re-render the page.

        `dirty` gates it so an untouched form never shadows the host doc:
        without that, merely opening a section would pin its pristine values
        and a later snapshot could not seed it.
      */
      debug={(state: { values: Record<string, unknown>; dirty: boolean }) => {
        if (state.dirty) draftsRef.current[schema.id] = state.values
      }}
    />
  )
}

const HostSetupSectionsLayout = ({ children }: { children: ReactNode }) => {
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

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
    async (
      fields: any,
      dequeueLoading: () => void,
      clearable: readonly string[] = [],
    ) => {
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
      /*
       * A CLEARED field has to be deleted, not left unmentioned. See
       * `CLEARABLE_TRACKING_PATHS` for why an omission reads as "unchanged"
       * and what that cost. Only the paths the submitting form owns are
       * considered, and only when the document actually holds a value — so
       * this writes nothing on a form that never carried the field.
       */
      const read = (source: any, path: string) =>
        path.split('.').reduce((value, key) => value?.[key], source)
      /*
       * Written as a NESTED object, not a dotted key. `setDoc` with `merge`
       * treats a dotted key as a literal field name — only `updateDoc` reads
       * it as a path — so `{'analytics.gtmContainerId': deleteField()}` would
       * store nothing and delete nothing, while still reporting success.
       */
      const bury = (target: any, path: string, value: unknown) => {
        const keys = path.split('.')
        const leaf = keys.pop() as string
        let node = target
        for (const key of keys) node = node[key] ??= {}
        node[leaf] = value
      }
      for (const path of clearable) {
        const submitted = read(clientFields, path)
        const blank = submitted == null || String(submitted).trim() === ''
        const stored = read(data, path)
        if (blank && stored != null && String(stored) !== '') {
          bury(clientFields, path, deleteField())
        }
      }
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
    async (fields: any, clearable: readonly string[] = []) => {
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
          await runBasicSave(fields, dequeueLoading, clearable)
        },
      )
      if (!verdict.ok) {
        dequeueLoading()
        // The form keeps its values, so the author can retry after reloading
        // rather than discovering later that nothing was stored.
        enqueueSnackbar(verdict.message, { variant: 'warning' })
        return false
      }
      return true
    },
    [queueLoading, runBasicSave, status, hostFromCache, enqueueSnackbar],
  )

  /**
   * Half-typed values, per tab, so changing tab does not discard them.
   *
   * `TabPanel` renders `(keepMounted || value === context.value) && children`,
   * and this page passes no `keepMounted` — so the inactive panel is UNMOUNTED
   * and takes its form state with it. Typing into Display name, switching to
   * SEO and switching back lost the edit, with the card reading "UP TO DATE"
   * afterwards so that nothing on screen said anything had gone.
   *
   * `keepMounted` is the one-line answer and it is the wrong one: it would
   * mount every tab's cards at once — the logo card, the contact cards, the
   * theme cards — and every read behind them, on a page where four of the five
   * tabs are not being looked at. So the draft is hoisted above the panel
   * instead and the unmount is kept. This costs no reads: a ref holds values
   * that are already in memory, mounts nothing and subscribes nothing.
   *
   * A REF rather than state, and that is load-bearing twice over. It is
   * written on every keystroke, so state would re-render the whole page each
   * time; and a re-render that changed `SeoFormTemplate`'s identity would
   * remount the form and blow away the very input being typed into — the trap
   * its own `useMemo` was added for.
   */
  const draftsRef = useRef<Record<string, Record<string, unknown>>>({})

  /*
   * Seeded from the HOST DOCUMENT, always — never from the draft.
   *
   * Seeding from the draft restores the text and loses the fact that it is
   * unsaved: `initialValues` is what the form compares against to decide it is
   * pristine, so a form seeded with its own draft reports NO changes. The card
   * then reads "Up to date" over an edit nobody has written, which is the same
   * misleading signal as the defect this whole fix is about, and its Save is
   * disabled so the reader cannot even act on it.
   *
   * The draft is applied on top instead, as a real edit — see `restoreDraft`.
   */
  const seedFor = (_schemaId: string) => data

  /**
   * Retire a draft once its values are SAVED. Without this a reader who saved
   * and came back would keep being shown the draft — a stale copy of what they
   * had already committed, indistinguishable from an edit still pending.
   */
  const saveAndClearDraft = async (
    schemaId: string,
    fields: any,
    clearable?: readonly string[],
  ) => {
    const saved = await handleBasicSave(fields, clearable)
    if (saved) delete draftsRef.current[schemaId]
  }

  const forms = [
    {
      schema: basicSchema,
      initialValues: seedFor(basicSchema.id),
      // Wrapped, never passed by reference: the renderer calls
      // `onSubmit(values, formApi, callback)`, and a bare handler would take
      // the form API as its `clearable` argument.
      onSubmit: (fields: any) => saveAndClearDraft(basicSchema.id, fields),
    },
    {
      schema: seoSchema,
      initialValues: seedFor(seoSchema.id),
      onSubmit: (fields: any) => saveAndClearDraft(seoSchema.id, fields),
    },
    {
      schema: trackingSchema,
      initialValues: seedFor(trackingSchema.id),
      // The only form that owns the tracking ids, so the only one entitled to
      // read their absence as "cleared".
      onSubmit: (fields: any) =>
        saveAndClearDraft(trackingSchema.id, fields, CLEARABLE_TRACKING_PATHS),
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

  const sections = useMemo(
    () => setupSections(orgSlug, host),
    [orgSlug, host],
  )
  /*
   * Resolved against the same list the rail draws, so the trail names the
   * section the reader is on instead of ending at "Setup". One resolver, so a
   * section added to the list is in the breadcrumb by construction.
   */
  const active = useActiveSection(sections)

  /*
   * A pageview per SECTION, which the tab strip used to emit from its change
   * handler. Sections are routes now, so it is keyed on the section the URL
   * names — which also means arriving by link or by back button is counted,
   * where the handler only ever saw a click.
   *
   * `analytics` is undefined whenever Firebase Analytics failed to initialise
   * (ad blocker, blocked storage, missing measurement id); `useAnalytics()` is
   * typed as if it never is, and strictNullChecks is off, so the guard is what
   * stops a pageview throwing out of an effect.
   */
  useEffect(() => {
    if (!analytics || !active) return
    logEvent(analytics, 'screen_view', {
      firebase_screen: active.label,
      firebase_screen_class: 'HostSetupSections',
    })
  }, [analytics, active])

  const scope = useMemo<SetupScope>(
    () => ({
      hostId,
      data,
      hostHasEmitted,
      resolvedTheme,
      themeSaving,
      handleThemeSave,
      handleWriteOverride,
      forms,
      SeoFormTemplate,
      draftsRef,
    }),
    [
      hostId,
      data,
      hostHasEmitted,
      resolvedTheme,
      themeSaving,
      handleThemeSave,
      handleWriteOverride,
      forms,
      SeoFormTemplate,
    ],
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
        // The section the reader is actually on. Without it the trail names
        // every level except theirs — the one that says where they are.
        ...(active ? [{ children: active.label }] : []),
      ]}
      help="gettingStarted"
      header={{
        children: 'Host Setup',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <SetupScopeContext.Provider value={scope}>
          <HubSections sections={sections}>{children}</HubSections>
        </SetupScopeContext.Provider>
        {/* Plugin zone (AGL-433): hostSettings widgets. */}
        <PluginWidgetSlot slot="hostSettings" hostId={hostId} />
      </Container>
    </DashboardLayout>
  )
}

HostSetupSectionsLayout.displayName = 'Layout:HostSetupSections'

export default HostSetupSectionsLayout
