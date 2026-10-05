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

import { putMediaDocument } from './media-counter.mjs'
import { displayNameSearchFields } from './name-search-tokens.mjs'
import { datasetFilterFields, effectiveModel } from './record-filter-keys.mjs'

/**
 * A site shaped like a real client's (AGL-3566), for the tenant production
 * smoke.
 *
 * The `demo` host the smoke grew up on has no theme fonts, no favicon, no app
 * icon, no logo and no shared layout, so every branch of the site layout that
 * reads those returned at once. beta.222 put an unbounded wait on exactly one
 * of them — the theme's Google stylesheet (AGL-3485) — and every uncached
 * client page timed out at 60 s in production while the smoke stayed green,
 * because the page it rendered never asked for a font (AGL-3565).
 *
 * So this site carries what a customer's site carries, each of them a read
 * the `[host]/[scheme]` layout or the page beneath makes on a render:
 *
 *  - a theme with two Google families and real weights, the shape
 *    `DEFAULT_SITE_THEME` gives every new site (AGL-3497) — so the layout
 *    fetches a stylesheet;
 *  - a favicon and an app icon that are library PNGs with content hashes, so
 *    the icon links derive every size (AGL-3484) from one projected read;
 *  - a logo, both as the site's brand `logoUrl` and as an image in the header;
 *  - a shared layout (header, slot, footer) the pages render inside;
 *  - a reusable component placed with per-instance values;
 *  - an org dataset repeated into cards;
 *  - a form, and a booking widget against a seeded service.
 *
 * Its own org, not the primary e2e org. The console suites count and list the
 * sites of `e2e-bakery`, and a third site there would move numbers they
 * assert. Nothing signs in to this org: the smoke only renders its pages.
 *
 * `hostIds` seeds the same site under more than one id — the smoke renders
 * one copy against the live font origin and another with that origin hung,
 * and a page cached by the first pass must not answer for the second.
 */
export const CLIENT_SITE_FIXTURE = {
  orgId: 'e2e-client-owner',
  ownerUid: 'e2e-client-owner',
  orgSlug: 'e2e-ridgeline',
  orgName: 'Ridgeline Builders LLC',
  displayName: 'Ridgeline Builders',
  /** The site the smoke renders with the live font origin. */
  hostId: 'ridgeline',
  /** The same site, rendered with the font origin hung (AGL-3566). */
  stalledHostId: 'ridgeline-stalled',
  /** The Google families its theme loads — the smoke asserts they reach the page. */
  fontFamilies: ['Montserrat', 'Open Sans'],
  /** Text the smoke asserts per route. */
  markers: {
    hero: 'Built right the first time',
    layoutFooter: 'Licensed and insured general contractor',
    componentHeadline: 'Request a free estimate',
    projectRow: 'Cedar Ridge Residence',
    formLabel: 'Describe your project',
  },
}

const F = CLIENT_SITE_FIXTURE

const ROOT_ID = '_@_'

/**
 * A flat node map from nested specs, the way `buildStarterNodes` writes a new
 * site's pages (libs/aglyn/src/lib/app-utils/starter-template-nodes.ts).
 */
function buildNodes(children) {
  const map = {
    [ROOT_ID]: {
      $id: ROOT_ID,
      // Production stores the root as its own parent; the smoke has to render
      // that shape, or an ancestor walk that loops on it passes here (AGL-3565).
      parentId: ROOT_ID,
      componentId: 'div',
      nodes: children.map((child) => child.id),
    },
  }
  const walk = (spec, parentId) => {
    map[spec.id] = {
      $id: spec.id,
      componentId: spec.componentId,
      pluginId: spec.pluginId ?? 'mui',
      parentId,
      props: spec.props ?? {},
      ...(spec.sx ? { sx: spec.sx } : {}),
      nodes: (spec.children ?? []).map((child) => child.id),
    }
    for (const child of spec.children ?? []) walk(child, spec.id)
  }
  for (const child of children) walk(child, ROOT_ID)
  return map
}

const text = (id, variant, children, extra) => ({
  id,
  componentId: 'muiTypography',
  props: { variant, children, ...extra },
})

const stack = (id, spacing, children, extra) => ({
  id,
  componentId: 'muiStack',
  props: { spacing, ...extra },
  children,
})

const section = (id, children, sx) => ({
  id,
  componentId: 'section',
  props: {},
  sx: { py: 8, ...sx },
  children: [
    {
      id: `${id}Container`,
      componentId: 'muiContainer',
      props: { maxWidth: 'lg' },
      children,
    },
  ],
})

/** A theme in the shape a real site's is: families, weights, a typography scale. */
const THEME = {
  colorSchemes: {
    light: {
      primary: { main: '#b45309', light: '#d97706', dark: '#92400e', contrastText: '#ffffff' },
      secondary: { main: '#1e3a5f', light: '#2c5282', dark: '#13253d', contrastText: '#ffffff' },
      text: { primary: '#1c1917', secondary: '#57534e' },
      divider: '#e7e5e4',
    },
    dark: {
      primary: { main: '#fbbf24', light: '#fcd34d', dark: '#f59e0b', contrastText: '#1c1917' },
      secondary: { main: '#93c5fd', light: '#bfdbfe', dark: '#60a5fa', contrastText: '#0c1a2b' },
      text: { primary: '#f5f5f4', secondary: '#a8a29e' },
      divider: '#292524',
    },
  },
  fonts: [
    { family: 'Montserrat', weights: [400, 500, 600, 700, 800], source: 'google' },
    { family: 'Open Sans', weights: [400, 600], source: 'google' },
  ],
  typography: {
    fontFamily: '"Open Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    variants: {
      h1: { fontFamily: '"Montserrat", sans-serif', fontSize: '3rem', fontWeight: 800 },
      h2: { fontFamily: '"Montserrat", sans-serif', fontSize: '2.25rem', fontWeight: 700 },
      h3: { fontFamily: '"Montserrat", sans-serif', fontSize: '1.75rem', fontWeight: 700 },
      h5: { fontFamily: '"Montserrat", sans-serif', fontWeight: 600 },
      button: { fontFamily: '"Montserrat", sans-serif', fontWeight: 600, textTransform: 'none' },
    },
  },
  shape: { borderRadius: 8 },
}

/** The library assets the site's chrome reads: id → document. */
const MEDIA = {
  'seed-client-logo': {
    fileName: 'ridgeline-logo.png',
    contentType: 'image/png',
    sizeBytes: 18_400,
    width: 480,
    height: 120,
    contentHash: 'seedlogo01',
    url: 'https://picsum.photos/seed/ridgeline-logo/480/120',
    alt: 'Ridgeline Builders',
  },
  'seed-client-favicon': {
    fileName: 'ridgeline-favicon.png',
    contentType: 'image/png',
    sizeBytes: 9_800,
    width: 512,
    height: 512,
    contentHash: 'seedfav01',
    url: 'https://picsum.photos/seed/ridgeline-favicon/512/512',
    alt: 'Ridgeline Builders mark',
  },
  'seed-client-app-icon': {
    fileName: 'ridgeline-app-icon.png',
    contentType: 'image/png',
    sizeBytes: 24_100,
    width: 1024,
    height: 1024,
    contentHash: 'seedapp01',
    url: 'https://picsum.photos/seed/ridgeline-app-icon/1024/1024',
    alt: 'Ridgeline Builders app icon',
  },
  'seed-client-hero': {
    fileName: 'ridgeline-hero.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 182_000,
    width: 1600,
    height: 900,
    contentHash: 'seedhero01',
    url: 'https://picsum.photos/seed/ridgeline-hero/1600/900',
    alt: 'A finished timber-frame home at dusk',
  },
}

/**
 * A seeded document's first version. Fixed, so a re-seed rewrites the same
 * version instead of stacking a new one.
 */
function seedVersionId(documentId) {
  return `${documentId}-v1`
}

/** A seeded project row, fixed by its place in `PROJECT_ROWS` for the same reason. */
function seedProjectRecordId(index) {
  return `seed-project-${index}`
}

const PROJECTS_DATASET_ID = 'seed-client-projects'
const PROJECT_ROWS = [
  [F.markers.projectRow, 'Custom home', 'Boulder, CO'],
  ['Maple Street Remodel', 'Kitchen and bath', 'Louisville, CO'],
  ['Foothills Office Build-out', 'Commercial', 'Golden, CO'],
]

const COMPONENT_ID = 'seed-client-estimate-cta'
const COMPONENT_VERSION_ID = seedVersionId(COMPONENT_ID)
const COMPONENT_ROOT_ID = 'estimateSection'
const componentProps = [
  { name: 'headline', type: 'text', label: 'Headline', defaultValue: 'Ready to build?' },
  {
    name: 'lede',
    type: 'richText',
    label: 'Lede',
    defaultValue: 'Tell us about the project and we will be in touch within a day.',
  },
]
const componentNodes = {
  [COMPONENT_ROOT_ID]: {
    $id: COMPONENT_ROOT_ID,
    componentId: 'section',
    pluginId: 'mui',
    nodes: ['estimateStack'],
    sx: { py: 6, bgcolor: 'secondary.main', color: 'secondary.contrastText' },
  },
  estimateStack: {
    $id: 'estimateStack',
    componentId: 'muiStack',
    parentId: COMPONENT_ROOT_ID,
    nodes: ['estimateHeadline', 'estimateLede', 'estimateButton'],
    props: { spacing: 2, alignItems: 'center' },
  },
  estimateHeadline: {
    $id: 'estimateHeadline',
    componentId: 'muiTypography',
    parentId: 'estimateStack',
    props: { children: '{{prop.headline}}', variant: 'h2' },
  },
  estimateLede: {
    $id: 'estimateLede',
    componentId: 'muiTypography',
    parentId: 'estimateStack',
    props: { children: '{{prop.lede}}', variant: 'body1' },
  },
  estimateButton: {
    $id: 'estimateButton',
    componentId: 'muiButton',
    parentId: 'estimateStack',
    props: { children: 'Get my estimate', variant: 'contained', href: '/contact' },
  },
}

/** The header, the page slot and the footer every page renders inside. */
function layoutNodes(hostId, homeScreenId) {
  return buildNodes([
    {
      id: 'cl_header',
      componentId: 'muiAppBar',
      props: { position: 'sticky', color: 'inherit', component: 'header', ariaLabel: 'Site header' },
      children: [
        {
          id: 'cl_toolbar',
          componentId: 'muiToolbar',
          props: {},
          sx: { columnGap: 2 },
          children: [
            {
              id: 'cl_logo',
              componentId: 'image',
              props: {
                src: `media:${hostId}/seed-client-logo`,
                alt: F.displayName,
                height: '40px',
                objectFit: 'contain',
                loading: 'eager',
                intrinsicWidth: 480,
                intrinsicHeight: 120,
              },
            },
            {
              id: 'cl_home',
              componentId: 'muiScreenLink',
              props: { children: 'Home', screenId: homeScreenId, renderAs: 'link', color: 'inherit' },
            },
            {
              id: 'cl_contact',
              componentId: 'muiButton',
              props: { variant: 'contained', children: 'Contact us', href: '/contact' },
            },
          ],
        },
      ],
    },
    { id: 'cl_slot', componentId: 'layoutSlot', props: { component: 'main' } },
    {
      id: 'cl_footer',
      componentId: 'section',
      props: { element: 'footer', ariaLabel: 'Site footer' },
      sx: { py: 6, borderTop: 1, borderColor: 'divider' },
      children: [
        text('cl_footerName', 'h6', '{{host.businessName}}', { component: 'p' }),
        text('cl_footerAbout', 'body2', `${F.markers.layoutFooter} serving the Front Range.`),
      ],
    },
  ])
}

function homeNodes(hostId) {
  return buildNodes([
    section('ch_hero', [
      stack('ch_heroStack', 3, [
        text('ch_heroTitle', 'h1', F.markers.hero),
        text(
          'ch_heroLede',
          'body1',
          'Custom homes, remodels and commercial build-outs, on schedule and on budget.',
        ),
        {
          id: 'ch_heroImage',
          componentId: 'image',
          props: {
            src: `media:${hostId}/seed-client-hero`,
            alt: 'A finished timber-frame home at dusk',
            height: '420px',
            objectFit: 'cover',
            radius: 8,
            loading: 'eager',
            intrinsicWidth: 1600,
            intrinsicHeight: 900,
          },
        },
      ]),
    ]),
    section('ch_projects', [
      stack('ch_projectsStack', 3, [
        text('ch_projectsTitle', 'h2', 'Recent projects'),
        {
          // One card per dataset row (AGL-1039: `visibleTo` on the dataset).
          id: 'ch_projectGrid',
          componentId: 'muiStack',
          props: { spacing: 2, repeatDataset: PROJECTS_DATASET_ID },
          children: [
            {
              id: 'ch_projectCard',
              componentId: 'muiCard',
              props: { variant: 'outlined' },
              children: [
                {
                  id: 'ch_projectCardContent',
                  componentId: 'muiCardContent',
                  props: {},
                  children: [
                    text('ch_projectName', 'h5', '{{item.name}}', { component: 'h3' }),
                    text('ch_projectKind', 'body2', '{{item.kind}} · {{item.location}}'),
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ]),
    {
      // The reusable component, with values of its own (AGL-1247).
      id: 'ch_estimate',
      componentId: 'reusableInstance',
      props: {
        refId: COMPONENT_ID,
        name: 'Estimate CTA',
        propValues: { headline: F.markers.componentHeadline },
      },
    },
  ])
}

function contactNodes() {
  return buildNodes([
    section('cc_contact', [
      stack('cc_stack', 4, [
        text('cc_title', 'h1', 'Start your project'),
        {
          id: 'cc_form',
          componentId: 'form',
          props: {
            formName: 'Project inquiry',
            datasetName: 'Project inquiries',
            submitLabel: 'Send inquiry',
            successMessage: 'Thanks — we will call you within one business day.',
          },
          children: [
            {
              id: 'cc_name',
              componentId: 'formField',
              props: { fieldName: 'name', label: 'Your name', fieldType: 'text', required: true },
            },
            {
              id: 'cc_email',
              componentId: 'formField',
              props: { fieldName: 'email', label: 'Email', fieldType: 'email', required: true },
            },
            {
              id: 'cc_details',
              componentId: 'formField',
              props: { fieldName: 'details', label: F.markers.formLabel, fieldType: 'textarea' },
            },
          ],
        },
        text('cc_bookTitle', 'h2', 'Or book a site visit'),
        { id: 'cc_booking', componentId: 'booking', pluginId: 'bookings', props: {} },
      ]),
    ]),
  ])
}

/**
 * Writes the client org, and the client site under each of `hostIds`.
 *
 * @param {object} options
 * @param {any} options.firestore
 * @param {(ref: any, data: Record<string, unknown>) => Promise<void>} options.put
 *   the seed's merge-set writer
 * @param {unknown} options.now the timestamp the seed stamps
 * @param {string[]} [options.hostIds]
 */
export async function seedClientSite({
  firestore,
  put,
  now,
  hostIds = [F.hostId, F.stalledHostId],
}) {
  const orgRef = firestore.collection('orgs').doc(F.orgId)
  await put(orgRef, {
    name: F.orgName,
    ...displayNameSearchFields(F.orgName),
    slug: F.orgSlug,
    ownerUid: F.ownerUid,
    // A paying site: no attribution badge, no limits notice — the page a
    // client's visitor actually gets.
    plan: 'business',
    subscription: { status: 'active' },
    // The primary e2e org's switchboard (seed-e2e.mjs), so the same plugin
    // bundles load for this site's pages as for the demo's.
    enabledPlugins: [
      'mui',
      'bookings',
      'commerce',
      'marketplace',
      'crm',
      'data',
      'email',
      'events-calendar',
      'inbox',
      'logic',
      'marketing',
      'redirects',
      'workflows',
    ],
    createdAt: now,
  })
  await put(firestore.collection('orgSlugs').doc(F.orgSlug), {
    orgId: F.orgId,
    createdAt: now,
  })

  const projects = orgRef.collection('datasets').doc(PROJECTS_DATASET_ID)
  const projectFields = ['name', 'kind', 'location']
  await put(projects, {
    name: 'Projects',
    fields: projectFields,
    visibleTo: ['org'],
    createdAt: now,
  })
  const model = effectiveModel({ fields: projectFields })
  for (const [index, [name, kind, location]] of PROJECT_ROWS.entries()) {
    const values = { name, kind, location }
    await put(projects.collection('records').doc(seedProjectRecordId(index)), {
      values,
      ...datasetFilterFields(model, values),
      order: index,
      createdAt: now,
    })
  }

  for (const hostId of hostIds) {
    await seedClientHost({ firestore, put, now, hostId })
  }
}

async function seedClientHost({ firestore, put, now, hostId }) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const homeScreenId = 'seed-client-home'
  const contactScreenId = 'seed-client-contact'
  const layoutId = 'seed-client-layout'
  const layoutVersionId = seedVersionId(layoutId)

  await put(firestore.collection('hostIndex').doc(hostId), { orgId: F.orgId })
  await put(hostRef, {
    subdomain: hostId,
    displayName: F.displayName,
    orgId: F.orgId,
    memberRoles: { [F.ownerUid]: 'admin' },
    screens: { [homeScreenId]: '/', [contactScreenId]: 'contact' },
    theme: THEME,
    logoUrl: `media:${hostId}/seed-client-logo`,
    seo: {
      title: F.displayName,
      description: 'Custom homes, remodels and commercial build-outs.',
      favicon: `media:${hostId}/seed-client-favicon`,
      appIcon: `media:${hostId}/seed-client-app-icon`,
    },
    suspended: false,
    createdAt: now,
  })

  for (const [mediaId, data] of Object.entries(MEDIA)) {
    await putMediaDocument({
      firestore,
      scopeRef: hostRef,
      mediaId,
      data: {
        ...data,
        tags: ['brand'],
        uploadedBy: F.ownerUid,
        createdAt: now,
        updatedAt: now,
      },
    })
  }

  const layoutRef = hostRef.collection('layouts').doc(layoutId)
  await put(layoutRef, {
    displayName: 'Site header and footer',
    ...displayNameSearchFields('Site header and footer'),
    versionId: layoutVersionId,
    deletedAt: null,
    createdAt: now,
  })
  await put(layoutRef.collection('versions').doc(layoutVersionId), {
    layoutId,
    hostId,
    displayName: 'Initial version',
    nodes: layoutNodes(hostId, homeScreenId),
    createdAt: now,
  })

  const componentRef = hostRef.collection('components').doc(COMPONENT_ID)
  const component = {
    hostId,
    displayName: 'Estimate CTA',
    rootId: COMPONENT_ROOT_ID,
    nodes: componentNodes,
    props: componentProps,
  }
  await put(componentRef, {
    ...component,
    ...displayNameSearchFields('Estimate CTA'),
    kind: 'site',
    versionId: COMPONENT_VERSION_ID,
    deletedAt: null,
    createdAt: now,
  })
  await put(componentRef.collection('versions').doc(COMPONENT_VERSION_ID), {
    ...component,
    componentId: COMPONENT_ID,
    createdAt: now,
  })

  const screens = [
    [homeScreenId, 'Home', '/', homeNodes(hostId)],
    [contactScreenId, 'Contact', 'contact', contactNodes()],
  ]
  for (const [screenId, displayName, slug, nodes] of screens) {
    const screenRef = hostRef.collection('screens').doc(screenId)
    const versionId = seedVersionId(screenId)
    await put(screenRef, {
      displayName,
      ...displayNameSearchFields(displayName),
      deletedAt: null,
      slug,
      versionId,
      layoutId,
      publishedAt: now,
      createdAt: now,
    })
    await put(screenRef.collection('versions').doc(versionId), {
      screenId,
      displayName: 'Initial version',
      layoutId,
      nodes,
      createdAt: now,
    })
  }

  // The booking widget lists the site's services.
  await put(hostRef.collection('services').doc('seed-client-site-visit'), {
    name: 'On-site estimate',
    durationMinutes: 60,
    priceUsd: 0,
    description: 'We walk the site with you and price the job.',
    timezone: 'America/Denver',
    windows: {
      1: [{ start: 8 * 60, end: 16 * 60 }],
      3: [{ start: 8 * 60, end: 16 * 60 }],
    },
    createdAt: now,
  })
}
