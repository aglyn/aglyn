/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { getDisplayName } from '@aglyn/shared-util-tools'
import { NextRouter, Router, useRouter } from 'next/router'
import { ComponentType, forwardRef } from 'react'
import { Normalized } from './aglyn-deprecated'


type ID = string // The slug of the page excluding parent
type Paths = ID[] // The paths to be used to join with a `/`
type PageName = string // Used for the individual page
type PageTitle = string // Used with combined PageNames for the browser
type NameMeta = {
  default: PageName
  singular: PageName
  plural: PageName
  long: PageName
}
type PageMeta = {
  id?: ID // Dynamically set from the full url path
  slug: ID
  dynamic?: boolean,
  title: PageTitle
  name: NameMeta
  icon?: string
  pages?: Paths
  areas?: Paths
  parent?: ID
  area?: ID
  collection?: ID
}
type PageMetaWithoutId = Omit<PageMeta, 'id'>


const areas: Normalized<PageMeta> = new Normalized<PageMeta>()
const pages: Normalized<PageMeta> = new Normalized<PageMeta>()


export function getPage(id: ID): PageMeta | null {
  return pages.get(id)
}
export function getArea(id: ID): PageMeta {
  return areas.get(id)
}
export function getAreaPages(id: ID): PageMeta[] {
  return getArea(id)?.pages?.map(path => getPage(path)) ?? []
}
export function getAreaParent(area: PageMeta): PageMeta | null {
  return area?.parent ? getArea(area.parent) : null
}
export function getPageParent(page: PageMeta): PageMeta | null {
  return page?.parent ? getPage(page.parent) : null
}
export function getAreaParents(area: PageMeta): PageMeta[] {
  const parent = getAreaParent(area)
  const parentParents = parent ? getAreaParents(parent) : []
  return [...parentParents, parent].filter(i => Boolean(i))
}
export function getPageParents(page: PageMeta): PageMeta[] {
  const parent = getPageParent(page)
  const parentParents = parent ? getPageParents(parent) : []
  return [...parentParents, parent].filter(i => Boolean(i))
}
export function getPageArea(page: PageMeta): PageMeta {
  const area = page?.area ?? getPageParents(page).reduceRight((a, c) => a ? a : (c.area ? c : null), null)?.area
  return getArea(area) ?? getArea(ROOT_META.id)
}
export function getPageAncestors(page: PageMeta): PageMeta[] {
  const parents = getPageParents(page)
  const area = getPageArea(page)
  return [...getAreaParents(area), area, ...parents].filter(i => Boolean(i))
}
export function buildPagePath(page: PageMeta): ID {
  const parentSlugs = getPageAncestors(page).map(i => i?.slug)
  const paths = [...parentSlugs, page?.slug].filter(i => Boolean(i))
  return `/${paths.join('/')}`
}
export function addArea(meta: PageMetaWithoutId): PageMeta {
  const path = buildPagePath(meta)
  const area = areas.set(path, {...meta, id: path}).get(path)
  const parent = getAreaParent(area)
  if (parent) {
    // (parent.areas ??= []).push(area.id) // TODO: SHORT CIRCUIT ASSIGNMENT NOT WORKING? TS v4.1.2
    // bug
    parent.areas.push(area.id)
    areas.set(parent.id, parent)
  }
  return area
}
export function addPage(meta: PageMetaWithoutId, pathname?: string): PageMeta {
  const path = pathname ?? buildPagePath(meta)
  const page = pages.set(path, {...meta, id: path}).get(path)
  const parent = getPageParent(page)
  if (parent) {
    // (parent.pages ??= []).push(page.id) // TODO: SHORT CIRCUIT ASSIGNMENT NOT WORKING? TS v4.1.2
    // bug
    (parent.pages ?? (parent.pages = [])).push(page.id)
    pages.set(parent.id, parent)
  }
  else if (page.area) {
    const area = getArea(page.area);
    // (area.pages ??= []).push(page.id) // TODO: SHORT CIRCUIT ASSIGNMENT NOT WORKING? TS v4.1.2
    // bug
    (area.pages ?? (parent.pages = [])).push(page.id)
    areas.set(area.id, area)
  }
  return page
}


export const ROOT_META: PageMeta = {
  id: '/',
  slug: '',
  title: 'App Dashboard',
  icon: 'home',
  pages: [],
  areas: [],
  name: {
    default: 'Dashboard',
    singular: 'Dashboard',
    plural: 'App',
    long: 'App Dashboard',
  },
}
areas.set(ROOT_META.id, ROOT_META)


// AREAS
const manageArea = addArea({
  slug: 'manage',
  title: 'Manage',
  parent: ROOT_META.id,
  icon: 'vector-polyline-edit',
  pages: [],
  areas: [],
  name: {
    default: 'Manage',
    singular: 'Manage',
    plural: 'Manage',
    long: 'App Management',
  },
})

// PAGES
const manageAuth = addPage({
  slug: 'auth',
  title: 'Manage Authentication and Authorization',
  area: manageArea.id,
  pages: [],
  name: {
    default: 'Auth',
    singular: 'Auth',
    plural: 'Auth',
    long: 'Auth & Security',
  },
})
const permissions = addPage({
  slug: 'permissions',
  title: 'Manage Auth Permissions',
  parent: manageAuth.id,
  name: {
    default: 'Permissions',
    singular: 'Permission',
    plural: 'Permissions',
    long: 'Permissions',
  },
})
addPage({
  ...permissions,
  slug: '[documentId]',
  title: 'Manage Auth Permissions',
  parent: permissions.id,
  dynamic: true,
})
addPage({
  slug: 'roles',
  title: 'Manage Auth Roles',
  parent: manageAuth.id,
  name: {
    default: 'Roles',
    singular: 'Role',
    plural: 'Roles',
    long: 'Roles',
  },
})
addPage({
  slug: 'users',
  title: 'Manage Auth Users',
  parent: manageAuth.id,
  name: {
    default: 'Users',
    singular: 'User',
    plural: 'Users',
    long: 'User Accounts',
  },
})

const manageStructure = addPage({
  slug: 'structure',
  title: 'Manage Data Structure',
  area: manageArea.id,
  pages: [],
  name: {
    default: 'Structure',
    singular: 'Structure',
    plural: 'Structure',
    long: 'Data Structure',
  },
})
addPage({
  slug: 'blueprints',
  title: 'Manage Structure Blueprints',
  parent: manageStructure.id,
  collection: 'blueprints',
  name: {
    default: 'Blueprints',
    singular: 'Blueprint',
    plural: 'Blueprints',
    long: 'Your Blueprints',
  },
})

const manageLogic = addPage({
  slug: 'workflow',
  title: 'Manage Workflow',
  area: manageArea.id,
  pages: [],
  name: {
    default: 'Workflow',
    singular: 'Workflow',
    plural: 'Workflow',
    long: 'Workflow',
  },
})
addPage({
  slug: 'rules',
  title: 'Manage Workflow Rules',
  parent: manageLogic.id,
  collection: 'rules',
  name: {
    default: 'Rules',
    singular: 'Rule',
    plural: 'Rules',
    long: 'Workflow Rules',
  },
})
addPage({
  slug: 'operations',
  title: 'Manage Workflow Operations',
  parent: manageLogic.id,
  collection: 'operations',
  name: {
    default: 'Operations',
    singular: 'Operation',
    plural: 'Operations',
    long: 'Workflow Operations',
  },
})
addPage({
  slug: 'queries',
  title: 'Manage Queries',
  parent: manageLogic.id,
  collection: 'queries',
  name: {
    default: 'Queries',
    singular: 'Queries',
    plural: 'Queries',
    long: 'Document Queries',
  },
})

type AggregatedRouterProps = Pick<Router, 'asPath' | 'basePath' | 'pathname' | 'query' | 'route'>
type DenormalizedPage = Omit<PageMeta, 'pages'> & { pages: PageMeta[] }
export type AggregatedPageMeta = AggregatedRouterProps & {
  pageMeta: PageMeta
  overrideMeta?: PageMeta
  areaMeta: PageMeta
  pageAncestors: PageMeta[]
  areaPages: PageMeta[]
  denormalizedAreaPages: DenormalizedPage[]
}

export const getAggregatedPageMeta = (router: NextRouter): AggregatedPageMeta => {
  const {pathname, asPath, basePath, route, query} = router
  const pageMeta = getPage(pathname)
  const overrideMeta = pageMeta?.dynamic ? getPage(pageMeta.parent) : null
  const areaMeta = getPageArea(overrideMeta ?? pageMeta)
  const pageAncestors = getPageAncestors(overrideMeta ?? pageMeta)
  const areaPages = getAreaPages(areaMeta?.id)
  const denormalizedAreaPages = getAreaPages(areaMeta?.id).map(i => ({
    ...i,
    pages: (i.pages ?? []).map(i => getPage(i)),
  }))
  // console.log('pathname', pathname)

  return {
    asPath,
    basePath,
    pathname,
    route,
    query,
    pageMeta,
    overrideMeta,
    areaMeta,
    pageAncestors,
    areaPages,
    denormalizedAreaPages,
  }
}

const WithN = 'aggregatedPageMeta'
type WithN = typeof WithN
export type WithPageMetaProps<P> = P & Record<WithN, AggregatedPageMeta>
export type WithPageMetaComponent<P> = ComponentType<WithPageMetaProps<P>>

export function withAggregatedPageMeta<P>(
  Component: ComponentType<P & { aggregatedPageMeta?: AggregatedPageMeta }>,
) {
  const displayName = `WithAggregatedPageMeta(${getDisplayName(Component)})`
  const WithAggregatedPageMeta = forwardRef<any, Omit<P, 'aggregatedPageMeta'>>(
    function RefRenderFn(props, ref) {
      const router = useRouter()
      const aggregatedPageMeta = getAggregatedPageMeta(router)
      return (
        <Component
          ref={ref}
          aggregatedPageMeta={aggregatedPageMeta}
          {...props as P}
        />
      )
    },
  )
  WithAggregatedPageMeta.displayName = displayName
  return WithAggregatedPageMeta
}
