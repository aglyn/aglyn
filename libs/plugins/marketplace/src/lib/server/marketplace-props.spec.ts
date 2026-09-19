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
 *
 * @jest-environment node
 */

/**
 * A component or layout published to the marketplace keeps the properties it
 * declares, through publish, install and update (AGL-2933).
 *
 * The handlers run against one in-memory Firestore, so what install reads is
 * exactly what publish wrote. The properties cover every kind in
 * `REUSABLE_PROP_KINDS` with the options, settings and condition the kind is
 * configured with, and a default each kind's rule admits.
 */

import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { REUSABLE_PROP_KINDS } from '@aglyn/aglyn/foundation/definitions/property-kinds'
import type {
  ReusableComponentProp,
  ReusableComponentPropType,
} from '@aglyn/aglyn/foundation/definitions/platform.types'
import { sanitizeMarketplaceProps } from '../model/marketplace-props'

const ROOT = '_@_'

jest.mock('@aglyn/aglyn/server', () => {
  let uid = 0
  return {
    ...jest.requireActual('@aglyn/aglyn/server'),
    checkEntitlement: () => true,
    checkQuota: () => ({ allowed: true, limit: 100 }),
    createResourceUid: () => `uid-${++uid}`,
  }
})

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    permissions: { publishToMarketplace: true, installPlugins: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  resolvePublisherProfile: async () => ({ orgId: 'org-1' }),
  canActAsPublisher: async () => true,
}))

jest.mock('./publish-preconditions', () => ({
  publishPreconditionRefusal: () => null,
}))

jest.mock('./purchase-entitlement', () => ({
  requirePurchase: async () => null,
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

/**
 * Records each install's base where the update route reads it, keyed by a
 * counter. Divergence is not under test, so nothing reads as edited.
 */
jest.mock('./provenance', () => {
  let sha = 0
  return {
    hasDivergedFromBase: async () => false,
    recordInstallProvenance: async (input: {
      firestore: any
      version: unknown
      content: unknown
    }) => {
      const key = `sha-${++sha}`
      const { ARTIFACT_BASE_COLLECTION } = jest.requireActual(
        '@aglyn/aglyn/app-utils/marketplace-provenance',
      ) as { ARTIFACT_BASE_COLLECTION: string }
      await input.firestore
        .collection(ARTIFACT_BASE_COLLECTION)
        .doc(key)
        .set({ content: input.content })
      return {
        installedFrom: { sha256: key, version: input.version },
        baseStored: true,
      }
    },
  }
})

jest.mock('@aglyn/tenant-data-admin', () => {
  const DELETE = { __delete: true }
  const state = { store: {} as Record<string, Record<string, any>> }
  const read = (data: any, field: string) =>
    field.split('.').reduce((value, key) => value?.[key], data)
  const snapshotFor = (path: string) => {
    const data = state.store[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      ref: docRef(path),
      data: () => data,
      get: (field: string) => read(data, field),
    }
  }
  const write = (path: string, data: Record<string, any>, merge: boolean) => {
    const next: Record<string, any> = merge ? { ...(state.store[path] ?? {}) } : {}
    for (const [key, value] of Object.entries(data)) {
      if (value === DELETE) delete next[key]
      else next[key] = value
    }
    state.store[path] = next
  }
  const docRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get parent() {
      return collectionRef(path.split('/').slice(0, -1).join('/'))
    },
    get: async () => snapshotFor(path),
    set: async (data: Record<string, any>, options?: { merge?: boolean }) =>
      write(path, data, Boolean(options?.merge)),
    update: async (data: Record<string, any>) => write(path, data, true),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => {
    const build = (filters: Array<[string, unknown]>, limit?: number): any => {
      const run = () => {
        const docs = Object.keys(state.store)
          .filter(
            (key) =>
              key.startsWith(`${path}/`) &&
              !key.slice(path.length + 1).includes('/'),
          )
          .map((key) => snapshotFor(key))
          .filter((snapshot) =>
            filters.every(([field, value]) => snapshot.get(field) === value),
          )
          .slice(0, limit ?? Infinity)
        return { empty: docs.length === 0, docs }
      }
      return {
        where: (field: string, _op: string, value: unknown) =>
          build([...filters, [field, value]], limit),
        limit: (count: number) => build(filters, count),
        get: async () => run(),
        __run: run,
      }
    }
    return { ...build([]), path, doc: (id: string) => docRef(`${path}/${id}`) }
  }
  const firestore = {
    collection: (name: string) => collectionRef(name),
    runTransaction: async (body: (tx: any) => Promise<unknown>) =>
      body({
        get: async (query: any) => query.__run(),
        set: (ref: any, data: any) => write(ref.path, data, false),
        update: (ref: any, data: any) => write(ref.path, data, true),
      }),
    batch: () => {
      const ops: Array<() => void> = []
      return {
        set: (ref: any, data: any, options?: { merge?: boolean }) =>
          ops.push(() => write(ref.path, data, Boolean(options?.merge))),
        commit: async () => ops.forEach((op) => op()),
      }
    },
  }
  return {
    __state: state,
    getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'uid-admin' }) }),
        firestore: () => firestore,
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          arrayUnion: (...items: unknown[]) => items,
          increment: (by: number) => by,
          delete: () => DELETE,
        },
        Timestamp: { now: () => 'TS' },
      },
    },
  }
})

import { installHandler } from './install'
import { installLayoutHandler } from './install-layout'
import { publishHandler } from './publish'
import { publishLayoutHandler } from './publish-layout'
import { updateArtifactHandler } from './update-artifact'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: { store: Record<string, Record<string, any>> }
  }
).__state

/* ------------------------------------------------------------------------ */
/* Every property kind                                                       */
/* ------------------------------------------------------------------------ */

const OPTIONS = [
  { value: 'a', label: 'First' },
  { value: 'b', label: 'Second' },
  { value: 'c' },
]

/**
 * One declaration per kind. Keyed by `ReusableComponentPropType`, so a kind
 * added to the union does not compile until the round trip covers it.
 */
const KIND_DECLARATIONS: Record<
  ReusableComponentPropType,
  Omit<ReusableComponentProp, 'name' | 'type'>
> = {
  text: { defaultValue: 'Hello there' },
  richText: { defaultValue: 'Line one\nLine two & more' },
  markdown: {
    defaultValue:
      '# Title\n\nSee [the docs](https://example.com/docs) or [home](/).\n\n' +
      '![Logo](https://cdn.example.com/logo.png)\n\n**Bold** <em>and</em> more',
  },
  'data-table': { defaultValue: '| Plan | Price |\n| --- | --- |\n| Pro | $29 |' },
  image: { defaultValue: 'https://cdn.example.com/hero.png' },
  href: { defaultValue: 'https://example.com/pricing' },
  icon: { defaultValue: 'mdiRocket', defaultIconPath: 'M13,22L11,18 Z' },
  number: { defaultValue: 28 },
  slider: { defaultValue: 40, settings: { min: 0, max: 100, step: 5 } },
  boolean: { defaultValue: true },
  checkbox: { defaultValue: ['a', 'c'], options: OPTIONS },
  choice: { defaultValue: 'b', options: OPTIONS, settings: { isMulti: false } },
  radio: { defaultValue: 'a', options: OPTIONS },
  'toggle-button': { defaultValue: 'c', options: OPTIONS },
  'dual-list-select': { defaultValue: ['a', 'b'], options: OPTIONS },
  'color-picker': { defaultValue: 'primary.main' },
  'css-dimension': { defaultValue: '12px' },
  'css-border': { defaultValue: '1px solid #e0e0e0' },
  'css-gradient': {
    defaultValue: 'linear-gradient(90deg, #ffffff 0%, #000000 100%)',
  },
  'breakpoint-span': { defaultValue: 6 },
  'preset-choice': { defaultValue: 'md', settings: { presets: 'shadow' } },
  'theme-scale': { defaultValue: 'h4', settings: { scale: 'fontSize' } },
  'date-picker': { defaultValue: '2026-09-14' },
  'time-picker': { defaultValue: '09:30' },
  'node-select': { defaultValue: 'node-1' },
  'product-select': { defaultValue: 'prod_1' },
  'collection-select': { defaultValue: 'collection-1' },
  'category-select': { defaultValue: 'category-1' },
  'dataset-select': { defaultValue: 'dataset-1' },
  'dataset-field-select': {
    defaultValue: 'title',
    settings: { datasetId: 'dataset-1' },
  },
  'form-select': { defaultValue: 'form-1' },
  'plugin-select': { defaultValue: 'plugin-1' },
  'plugin-settings': {
    defaultValue: ['secondary', 3],
    settings: { pluginProperty: 'p_plugin_select' },
  },
}

/** Conditions in every shape a declaration stores, rotated over the kinds. */
const CONDITIONS: ReadonlyArray<ReusableComponentProp['condition']> = [
  { when: 'p_boolean', is: true },
  [
    { when: 'p_number', greaterThan: 3 },
    { when: 'p_text', isNotEmpty: true },
  ],
  {
    and: [
      { when: 'p_choice', is: ['a', 'b'] },
      { when: 'p_text', pattern: '^he', flags: 'i' },
    ],
  },
  {
    or: [
      { when: 'p_radio', is: 'a', notMatch: true },
      { when: 'p_slider', lessThanOrEqualTo: 50 },
    ],
  },
  { not: { when: 'p_href', isEmpty: true } },
]

const EVERY_KIND_PROPS: ReusableComponentProp[] = (
  Object.keys(KIND_DECLARATIONS) as ReusableComponentPropType[]
).map((type, index) => ({
  name: `p_${type.replace(/-/g, '_')}`,
  type,
  label: `The ${type} property`,
  description: `Help for the ${type} property.`,
  ...KIND_DECLARATIONS[type],
  // Every sixth property has no condition, which must stay absent.
  ...(index % 6 === 5 ? {} : { condition: CONDITIONS[index % CONDITIONS.length] }),
}))

/** Defaults a publisher could write that the marketplace sanitizer refuses. */
const DISALLOWED_DEFAULT_PROPS: ReusableComponentProp[] = [
  {
    name: 'ctaLink',
    type: 'href',
    label: 'Button link',
    description: 'Where the button goes.',
    defaultValue: 'javascript:alert(document.cookie)',
    condition: { when: 'showCta', is: true },
  },
  { name: 'tabbedLink', type: 'href', defaultValue: 'java\tscript:alert(1)' },
  { name: 'heroImage', type: 'image', defaultValue: 'javascript:alert(1)' },
  { name: 'plainImage', type: 'image', defaultValue: 'http://tracker.example.com/p.gif' },
  {
    name: 'body',
    type: 'markdown',
    label: 'Body',
    defaultValue: '# Hi\n\n<script>alert(1)</script>',
  },
  {
    name: 'linkedBody',
    type: 'markdown',
    defaultValue: 'Click [here](javascript:alert(1))',
  },
  {
    name: 'blurb',
    type: 'richText',
    defaultValue: '<img src=x onerror="alert(1)">',
  },
  {
    name: 'accent',
    type: 'color-picker',
    defaultValue: 'red; background: url(https://tracker.example.com/p.gif)',
  },
  { name: 'glyph', type: 'icon', defaultValue: 'mdiRocket', defaultIconPath: '<svg onload=alert(1)>' },
  { name: 'showCta', type: 'boolean', defaultValue: true },
]

/* ------------------------------------------------------------------------ */
/* Harness                                                                   */
/* ------------------------------------------------------------------------ */

async function call(handler: any, body: Record<string, unknown>) {
  const result: { status: number; body: any } = { status: 0, body: null }
  const res: any = {
    status(code: number) {
      result.status = code
      return res
    },
    json(payload: unknown) {
      result.body = payload
      return res
    },
  }
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer token' }, body },
    res,
  )
  return result
}

const COMPONENT_NODES = {
  [ROOT]: { componentId: 'div', nodes: ['title'] },
  title: {
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: '{{prop.p_text}}' },
  },
}

const LAYOUT_NODES = {
  [ROOT]: { componentId: 'div', nodes: ['bar', 'slot'] },
  bar: { componentId: 'muiAppBar', parentId: ROOT, nodes: [] },
  slot: { componentId: 'layoutSlot', parentId: ROOT },
}

function seedSource(
  props: unknown,
  trees: {
    component?: Record<string, unknown>
    layout?: Record<string, unknown>
  } = {},
) {
  for (const key of Object.keys(state.store)) delete state.store[key]
  const admins = { memberRoles: { 'uid-admin': 'admin' } }
  state.store['hosts/source'] = { ...admins }
  state.store['hosts/target'] = { ...admins }
  state.store['hosts/source/components/cmp-1'] = {
    displayName: 'Hero',
    rootId: ROOT,
    nodes: trees.component ?? COMPONENT_NODES,
    ...(props === undefined ? {} : { props }),
  }
  state.store['hosts/source/layouts/layout-1'] = { versionId: 'v1' }
  state.store['hosts/source/layouts/layout-1/versions/v1'] = {
    nodes: trees.layout ?? LAYOUT_NODES,
    ...(props === undefined ? {} : { props }),
  }
}

async function publishComponent() {
  const result = await call(publishHandler, {
    hostId: 'source',
    componentId: 'cmp-1',
    displayName: 'Hero',
  })
  expect(result.status).toBe(200)
  return result.body.listingId as string
}

async function publishLayout() {
  const result = await call(publishLayoutHandler, {
    hostId: 'source',
    layoutId: 'layout-1',
    displayName: 'Shell',
  })
  expect(result.status).toBe(200)
  return result.body.listingId as string
}

const docsUnder = (collection: string) =>
  Object.entries(state.store)
    .filter(
      ([key]) =>
        key.startsWith(`${collection}/`) &&
        !key.slice(collection.length + 1).includes('/'),
    )
    .map(([, data]) => data)

const installedComponents = () => docsUnder('hosts/target/components')
const installedLayouts = () =>
  docsUnder('hosts/target/templates').filter((doc) => !doc.deletedAt)

/** Publishes the next version of a listing by hand, as a later publish would. */
function publishNextVersion(
  listingId: string,
  version: Record<string, unknown>,
) {
  const listing = state.store[`marketplaceListings/${listingId}`]
  const next = Number(listing.latestVersion) + 1
  listing.latestVersion = next
  state.store[`marketplaceListings/${listingId}/versions/${next}`] = version
}

beforeEach(() => seedSource(undefined))

/* ------------------------------------------------------------------------ */
/* Specs                                                                     */
/* ------------------------------------------------------------------------ */

describe('the every-kind fixture', () => {
  it('declares every property kind', () => {
    expect(EVERY_KIND_PROPS.map((prop) => prop.type).sort()).toEqual(
      Object.keys(REUSABLE_PROP_KINDS).sort(),
    )
  })

  it('is admitted by the sanitizer unchanged', () => {
    const result = sanitizeMarketplaceProps(EVERY_KIND_PROPS)
    expect(result).toEqual({
      ok: true,
      props: EVERY_KIND_PROPS,
      clearedDefaults: [],
    })
  })
})

describe('a published component keeps its properties (AGL-2933)', () => {
  it('carries every kind, its options, settings and condition, through publish and install', async () => {
    seedSource(EVERY_KIND_PROPS)
    const listingId = await publishComponent()

    expect(state.store[`marketplaceListings/${listingId}/versions/1`].props).toEqual(
      EVERY_KIND_PROPS,
    )

    const result = await call(installHandler, { listingId, hostId: 'target' })
    expect(result.status).toBe(200)
    const [installed] = installedComponents()
    expect(installed.props).toEqual(EVERY_KIND_PROPS)
  })

  it('takes the next version’s properties on update, in merge and copy mode', async () => {
    seedSource(EVERY_KIND_PROPS)
    const listingId = await publishComponent()
    await call(installHandler, { listingId, hostId: 'target' })
    const nextProps: ReusableComponentProp[] = [
      { name: 'p_text', type: 'text', label: 'Headline', defaultValue: 'New' },
    ]
    publishNextVersion(listingId, {
      rootId: ROOT,
      nodes: COMPONENT_NODES,
      props: nextProps,
    })

    const merged = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'merge',
    })
    expect(merged.status).toBe(200)
    expect(installedComponents()[0].props).toEqual(nextProps)

    publishNextVersion(listingId, {
      rootId: ROOT,
      nodes: COMPONENT_NODES,
      props: EVERY_KIND_PROPS,
    })
    const copied = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'copy',
    })
    expect(copied.status).toBe(200)
    const fresh = state.store[`hosts/target/components/${copied.body.newId}`]
    expect(fresh.props).toEqual(EVERY_KIND_PROPS)
  })

  it('clears a disallowed default and keeps the property', async () => {
    seedSource(DISALLOWED_DEFAULT_PROPS)
    const listingId = await publishComponent()
    await call(installHandler, { listingId, hostId: 'target' })

    const installed: ReusableComponentProp[] = installedComponents()[0].props
    // No property is lost to its default.
    expect(installed.map((prop) => prop.name)).toEqual(
      DISALLOWED_DEFAULT_PROPS.map((prop) => prop.name),
    )
    for (const prop of installed) {
      if (prop.name === 'showCta') continue
      expect(prop).not.toHaveProperty('defaultValue')
      expect(prop).not.toHaveProperty('defaultIconPath')
    }
    // Everything else about a cleared property is as the publisher wrote it.
    expect(installed[0]).toEqual({
      name: 'ctaLink',
      type: 'href',
      label: 'Button link',
      description: 'Where the button goes.',
      condition: { when: 'showCta', is: true },
    })
    expect(installed.at(-1)).toEqual(DISALLOWED_DEFAULT_PROPS.at(-1))
  })

  it('installs a version published before properties were carried', async () => {
    seedSource(undefined)
    const listingId = await publishComponent()
    delete state.store[`marketplaceListings/${listingId}/versions/1`].props

    const result = await call(installHandler, { listingId, hostId: 'target' })

    expect(result.status).toBe(200)
    const [installed] = installedComponents()
    expect(installed.rootId).toBe(ROOT)
    expect(installed).not.toHaveProperty('props')
  })

  it('leaves an installed copy’s properties alone when an update carries none', async () => {
    seedSource(EVERY_KIND_PROPS)
    const listingId = await publishComponent()
    await call(installHandler, { listingId, hostId: 'target' })
    publishNextVersion(listingId, { rootId: ROOT, nodes: COMPONENT_NODES })

    const result = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'merge',
    })

    expect(result.status).toBe(200)
    expect(installedComponents()[0].props).toEqual(EVERY_KIND_PROPS)
  })
})

describe('a published layout keeps its properties (AGL-2933)', () => {
  it('carries every kind, its options, settings and condition, through publish and install', async () => {
    seedSource(EVERY_KIND_PROPS)
    const listingId = await publishLayout()

    expect(
      state.store[`marketplaceListings/${listingId}/versions/1`].layout.props,
    ).toEqual(EVERY_KIND_PROPS)

    const result = await call(installLayoutHandler, { listingId, hostId: 'target' })
    expect(result.status).toBe(200)
    const [installed] = installedLayouts()
    expect(installed.kind).toBe('layout')
    expect(installed.props).toEqual(EVERY_KIND_PROPS)
  })

  it('takes the next version’s properties on update', async () => {
    seedSource(EVERY_KIND_PROPS)
    const listingId = await publishLayout()
    await call(installLayoutHandler, { listingId, hostId: 'target' })
    const nextProps: ReusableComponentProp[] = [
      { name: 'navTone', type: 'choice', options: OPTIONS, defaultValue: 'a' },
    ]
    publishNextVersion(listingId, {
      layout: { rootId: ROOT, nodes: LAYOUT_NODES, props: nextProps },
    })

    const result = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'merge',
    })

    expect(result.status).toBe(200)
    expect(installedLayouts()[0].props).toEqual(nextProps)
  })

  it('clears a disallowed default and keeps the property', async () => {
    seedSource(DISALLOWED_DEFAULT_PROPS)
    const listingId = await publishLayout()
    await call(installLayoutHandler, { listingId, hostId: 'target' })

    const installed: ReusableComponentProp[] = installedLayouts()[0].props
    expect(installed.map((prop) => prop.name)).toEqual(
      DISALLOWED_DEFAULT_PROPS.map((prop) => prop.name),
    )
    expect(installed.find((prop) => prop.name === 'body')).toEqual({
      name: 'body',
      type: 'markdown',
      label: 'Body',
    })
  })

  it('installs a version published before properties were carried', async () => {
    seedSource(undefined)
    const listingId = await publishLayout()
    delete state.store[`marketplaceListings/${listingId}/versions/1`].layout.props

    const result = await call(installLayoutHandler, { listingId, hostId: 'target' })

    expect(result.status).toBe(200)
    expect(installedLayouts()[0]).not.toHaveProperty('props')
  })
})

/* ------------------------------------------------------------------------ */
/* Links and images a property feeds                                         */
/* ------------------------------------------------------------------------ */

/** The Link and Image properties a published design feeds its URLs from. */
const URL_PROPS: ReusableComponentProp[] = [
  {
    name: 'ctaLink',
    type: 'href',
    label: 'Button link',
    defaultValue: 'https://example.com/pricing',
  },
  {
    name: 'heroImage',
    type: 'image',
    label: 'Hero image',
    defaultValue: 'https://cdn.example.com/hero.png',
  },
  { name: 'ctaLabel', type: 'text', defaultValue: 'See pricing' },
]

/**
 * A component whose button, image and link take their `href` and `src` from
 * those properties — and, beside them, the bindings the rule still refuses.
 */
const URL_BOUND_COMPONENT_NODES = {
  [ROOT]: {
    componentId: 'div',
    nodes: ['cta', 'hero', 'spaced', 'textFed', 'ghost', 'crossed', 'spliced', 'script'],
  },
  cta: {
    componentId: 'muiButton',
    parentId: ROOT,
    props: { href: '{{prop.ctaLink}}', children: '{{prop.ctaLabel}}' },
  },
  hero: {
    componentId: 'image',
    parentId: ROOT,
    props: { src: '{{prop.heroImage}}', href: '{{prop.ctaLink}}', alt: 'Hero' },
  },
  spaced: {
    componentId: 'muiScreenLink',
    parentId: ROOT,
    props: { href: '  {{ prop.ctaLink }}  ', children: 'Pricing' },
  },
  // A Text property's default is held to no URL rule, so it cannot feed one.
  textFed: {
    componentId: 'muiScreenLink',
    parentId: ROOT,
    props: { href: '{{prop.ctaLabel}}' },
  },
  // Undeclared: nothing substitutes it, so nothing holds it to a rule.
  ghost: {
    componentId: 'muiButton',
    parentId: ROOT,
    props: { href: '{{prop.nowhere}}' },
  },
  // A Link default is held to the link rule, which is not the image rule.
  crossed: {
    componentId: 'image',
    parentId: ROOT,
    props: { src: '{{prop.ctaLink}}' },
  },
  // A binding that is only part of the value leaves the rest to the publisher.
  spliced: {
    componentId: 'muiButton',
    parentId: ROOT,
    props: { href: 'javascript:{{prop.ctaLink}}' },
  },
  script: {
    componentId: 'muiButton',
    parentId: ROOT,
    props: { href: 'javascript:alert(1)' },
  },
}

/** A layout whose header links home and draws its logo from properties. */
const URL_BOUND_LAYOUT_NODES = {
  [ROOT]: { componentId: 'div', nodes: ['bar', 'slot'] },
  bar: { componentId: 'muiAppBar', parentId: ROOT, nodes: ['home', 'logo'] },
  home: {
    componentId: 'muiScreenLink',
    parentId: 'bar',
    props: { href: '{{prop.ctaLink}}', children: 'Home' },
  },
  logo: {
    componentId: 'image',
    parentId: 'bar',
    props: { src: '{{prop.heroImage}}', alt: 'Logo' },
  },
  slot: { componentId: 'layoutSlot', parentId: ROOT },
}

/** A node map as the listing, or the installed copy, stores it. */
const nodesOf = (stored: unknown) =>
  decodeStoredNodes<Record<string, { props?: Record<string, unknown> }>>(stored) ?? {}

/** Every binding the rule keeps, and every one it refuses, in one tree. */
function expectComponentBindings(stored: unknown) {
  const nodes = nodesOf(stored)
  expect(nodes['cta']?.props).toEqual({
    href: '{{prop.ctaLink}}',
    children: '{{prop.ctaLabel}}',
  })
  expect(nodes['hero']?.props).toEqual({
    src: '{{prop.heroImage}}',
    href: '{{prop.ctaLink}}',
    alt: 'Hero',
  })
  expect(nodes['spaced']?.props?.['href']).toBe('{{ prop.ctaLink }}')
  expect(nodes['textFed']?.props).not.toHaveProperty('href')
  expect(nodes['ghost']?.props).not.toHaveProperty('href')
  expect(nodes['crossed']?.props).not.toHaveProperty('src')
  expect(nodes['spliced']?.props).not.toHaveProperty('href')
  expect(nodes['script']?.props).not.toHaveProperty('href')
}

describe('a published design keeps the links and images its properties feed (AGL-2933)', () => {
  beforeEach(() =>
    seedSource(URL_PROPS, {
      component: URL_BOUND_COMPONENT_NODES,
      layout: URL_BOUND_LAYOUT_NODES,
    }),
  )

  it('keeps an href bound to a Link property and a src bound to an Image property, through publish and install', async () => {
    const listingId = await publishComponent()
    expectComponentBindings(
      state.store[`marketplaceListings/${listingId}/versions/1`].nodes,
    )

    const result = await call(installHandler, { listingId, hostId: 'target' })

    expect(result.status).toBe(200)
    expectComponentBindings(installedComponents()[0].nodes)
  })

  it('keeps them through an update, in merge and copy mode', async () => {
    const listingId = await publishComponent()
    await call(installHandler, { listingId, hostId: 'target' })
    // The publisher ships a second version through the same publish route.
    state.store['hosts/source/components/cmp-1'].displayName = 'Hero v2'
    await publishComponent()

    const merged = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'merge',
    })
    expect(merged.status).toBe(200)
    expectComponentBindings(installedComponents()[0].nodes)

    await publishComponent()
    const copied = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'copy',
    })
    expect(copied.status).toBe(200)
    expectComponentBindings(
      state.store[`hosts/target/components/${copied.body.newId}`].nodes,
    )
  })

  it('keeps a layout’s bindings through publish, install and update', async () => {
    const listingId = await publishLayout()
    const expectLayoutBindings = (stored: unknown) => {
      const nodes = nodesOf(stored)
      expect(nodes['home']?.props?.['href']).toBe('{{prop.ctaLink}}')
      expect(nodes['logo']?.props?.['src']).toBe('{{prop.heroImage}}')
    }
    expectLayoutBindings(
      state.store[`marketplaceListings/${listingId}/versions/1`].layout.nodes,
    )

    await call(installLayoutHandler, { listingId, hostId: 'target' })
    expectLayoutBindings(installedLayouts()[0].nodes)

    await publishLayout()
    const updated = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'merge',
    })
    expect(updated.status).toBe(200)
    expectLayoutBindings(installedLayouts()[0].nodes)
  })

  it('still clears a script-scheme default on the property the binding reads', async () => {
    seedSource(
      [
        { ...URL_PROPS[0], defaultValue: 'javascript:alert(document.cookie)' },
        { ...URL_PROPS[1], defaultValue: 'data:text/html,<script>alert(1)</script>' },
        URL_PROPS[2],
      ],
      { component: URL_BOUND_COMPONENT_NODES },
    )
    const listingId = await publishComponent()
    await call(installHandler, { listingId, hostId: 'target' })

    const [installed] = installedComponents()
    expectComponentBindings(installed.nodes)
    expect(installed.props[0]).not.toHaveProperty('defaultValue')
    expect(installed.props[1]).not.toHaveProperty('defaultValue')
  })
})

/* ------------------------------------------------------------------------ */
/* Condition patterns                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Conditions a publisher could write, beside a default long enough to hang a
 * backtracking matcher on the catastrophic one.
 */
const PATTERN_PROPS: ReusableComponentProp[] = [
  { name: 'headline', type: 'text', defaultValue: `${'a'.repeat(28)}!` },
  { name: 'unbalanced', type: 'text', condition: { when: 'headline', pattern: '(' } },
  {
    name: 'flagged',
    type: 'text',
    condition: { when: 'headline', pattern: 'a', flags: 'gg' },
  },
  {
    name: 'lookahead',
    type: 'text',
    condition: [
      { when: 'headline', isNotEmpty: true },
      { when: 'headline', pattern: 'a(?=!)' },
    ],
  },
  {
    name: 'unicode',
    type: 'text',
    condition: { or: [{ when: 'headline', pattern: 'a', flags: 'u' }] },
  },
  {
    name: 'catastrophic',
    type: 'text',
    condition: { when: 'headline', pattern: '^(a+)+$' },
  },
  {
    name: 'plain',
    type: 'text',
    condition: { when: 'headline', pattern: '^A+!$', flags: 'i' },
  },
]

/**
 * What survives: every property, and every rule a page can match. The
 * catastrophic pattern is one — conditions are matched in linear time, so it
 * answers in microseconds rather than hanging.
 */
const MATCHABLE_PATTERN_PROPS: ReusableComponentProp[] = [
  PATTERN_PROPS[0],
  { name: 'unbalanced', type: 'text' },
  { name: 'flagged', type: 'text' },
  {
    name: 'lookahead',
    type: 'text',
    condition: [{ when: 'headline', isNotEmpty: true }],
  },
  { name: 'unicode', type: 'text' },
  PATTERN_PROPS[5],
  PATTERN_PROPS[6],
]

describe('a published condition carries only patterns a page can match (AGL-2893)', () => {
  it('clears a pattern it cannot match at publish and install, and keeps the property', async () => {
    seedSource(PATTERN_PROPS)
    const listingId = await publishComponent()
    expect(state.store[`marketplaceListings/${listingId}/versions/1`].props).toEqual(
      MATCHABLE_PATTERN_PROPS,
    )

    await call(installHandler, { listingId, hostId: 'target' })

    expect(installedComponents()[0].props).toEqual(MATCHABLE_PATTERN_PROPS)
  })

  it('clears one planted in a stored version on the way in, and on update', async () => {
    seedSource(undefined)
    const listingId = await publishComponent()
    // Written by something other than the publish route.
    state.store[`marketplaceListings/${listingId}/versions/1`].props = PATTERN_PROPS
    await call(installHandler, { listingId, hostId: 'target' })
    expect(installedComponents()[0].props).toEqual(MATCHABLE_PATTERN_PROPS)

    publishNextVersion(listingId, {
      rootId: ROOT,
      nodes: COMPONENT_NODES,
      props: PATTERN_PROPS,
    })
    const result = await call(updateArtifactHandler, {
      listingId,
      hostId: 'target',
      action: 'apply',
      mode: 'merge',
    })
    expect(result.status).toBe(200)
    expect(installedComponents()[0].props).toEqual(MATCHABLE_PATTERN_PROPS)
  })

  it('does the same for a layout', async () => {
    seedSource(PATTERN_PROPS)
    const listingId = await publishLayout()
    await call(installLayoutHandler, { listingId, hostId: 'target' })
    expect(installedLayouts()[0].props).toEqual(MATCHABLE_PATTERN_PROPS)
  })
})

describe('sanitizeMarketplaceProps', () => {
  const only = (prop: Record<string, unknown>) => {
    const result = sanitizeMarketplaceProps([prop])
    if (result.ok === false) throw new Error(result.error)
    return result
  }

  it.each([
    ['a javascript: link', { type: 'href', defaultValue: 'javascript:alert(1)' }],
    ['a link hidden behind a tab', { type: 'href', defaultValue: ' java\tscript:x' }],
    ['a data: link', { type: 'href', defaultValue: 'data:text/html,<script>' }],
    ['an http image', { type: 'image', defaultValue: 'http://x.example/a.png' }],
    ['a javascript: image', { type: 'image', defaultValue: 'javascript:alert(1)' }],
    ['script in Markdown', { type: 'markdown', defaultValue: '<script>alert(1)</script>' }],
    ['an event handler in Markdown', { type: 'markdown', defaultValue: '<b onclick="x()">hi</b>' }],
    ['a javascript: Markdown link', { type: 'markdown', defaultValue: '[x](javascript:alert(1))' }],
    ['a javascript: reference link', { type: 'markdown', defaultValue: '[x]\n\n[x]: javascript:alert(1)' }],
    ['script in Long text', { type: 'richText', defaultValue: '<iframe src="https://x"></iframe>' }],
    ['a javascript: text', { type: 'text', defaultValue: 'javascript:alert(1)' }],
    ['an icon path that is markup', { type: 'icon', defaultValue: 'mdiHome', defaultIconPath: '<svg/>' }],
    ['a style value with a url()', { type: 'css-gradient', defaultValue: 'url(https://t.example/p.gif)' }],
    ['a style value that ends its declaration', { type: 'color-picker', defaultValue: 'red; color: blue' }],
    ['a non-numeric number', { type: 'number', defaultValue: 'lots' }],
    ['a list for a single choice', { type: 'choice', options: OPTIONS, defaultValue: ['a', 'b'] }],
    ['an object for a text', { type: 'text', defaultValue: { toString: 'x' } }],
    ['an object for a date', { type: 'date-picker', defaultValue: { $gt: '' } }],
  ])('clears %s and keeps the property', (_, declaration) => {
    const result = only({ name: 'subject', label: 'Subject', ...declaration })
    expect(result.clearedDefaults).toEqual(['subject'])
    expect(result.props).toHaveLength(1)
    expect(result.props[0].name).toBe('subject')
    expect(result.props[0].label).toBe('Subject')
    expect(result.props[0]).not.toHaveProperty('defaultValue')
    expect(result.props[0]).not.toHaveProperty('defaultIconPath')
  })

  it.each([
    ['a site-relative link', { type: 'href', defaultValue: '/pricing' }],
    ['a mailto link', { type: 'href', defaultValue: 'mailto:hi@example.com' }],
    ['an inline image', { type: 'image', defaultValue: 'data:image/png;base64,AAAA' }],
    ['Markdown with a comparison in it', { type: 'markdown', defaultValue: 'If a < b then **b**' }],
    ['a text that mentions data', { type: 'text', defaultValue: 'Data: 42%' }],
    ['a numeric string for a number', { type: 'number', defaultValue: '28' }],
    ['several answers for a multi choice', { type: 'choice', options: OPTIONS, settings: { isMulti: true }, defaultValue: ['a', 'b'] }],
  ])('keeps %s', (_, declaration) => {
    const result = only({ name: 'subject', ...declaration })
    expect(result.clearedDefaults).toEqual([])
    expect(result.props[0].defaultValue).toEqual(declaration.defaultValue)
  })

  it('clears markup from a label, help text and an option label, keeping each property and option', () => {
    const result = only({
      name: 'tone',
      type: 'choice',
      label: '<img src=x onerror=alert(1)>',
      description: '<script>alert(1)</script>',
      options: [{ value: 'a', label: '<b>Bold</b>' }, { value: 'b', label: 'Plain' }],
      defaultValue: 'a',
    })
    expect(result.props).toEqual([
      {
        name: 'tone',
        type: 'choice',
        options: [{ value: 'a' }, { value: 'b', label: 'Plain' }],
        defaultValue: 'a',
      },
    ])
  })

  it('keeps only the keys a declaration has', () => {
    const result = only({
      name: 'headline',
      type: 'text',
      defaultValue: 'Hi',
      dangerouslySetInnerHTML: { __html: '<script>' },
      onClick: 'alert(1)',
    })
    expect(result.props).toEqual([{ name: 'headline', type: 'text', defaultValue: 'Hi' }])
  })

  it('skips an entry nothing could bind to, and a second use of a name', () => {
    const result = sanitizeMarketplaceProps([
      { name: 'hero.title' },
      { label: 'No name' },
      'headline',
      { name: 'headline', defaultValue: 'First' },
      { name: 'headline', defaultValue: 'Second' },
    ])
    expect(result).toEqual({
      ok: true,
      props: [{ name: 'headline', defaultValue: 'First' }],
      clearedDefaults: [],
    })
  })

  it('refuses a declaration list too long to publish', () => {
    const result = sanitizeMarketplaceProps(
      Array.from({ length: 201 }, (_, index) => ({ name: `p${index}` })),
    )
    expect(result.ok).toBe(false)
  })

  it('is idempotent', () => {
    const once = sanitizeMarketplaceProps([
      ...EVERY_KIND_PROPS,
      ...DISALLOWED_DEFAULT_PROPS,
    ])
    if (once.ok === false) throw new Error(once.error)
    expect(sanitizeMarketplaceProps(once.props)).toEqual({
      ok: true,
      props: once.props,
      clearedDefaults: [],
    })
  })
})
