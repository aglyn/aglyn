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

import {
  SCREEN_KIND_TEMPLATE,
  type SitePageResolver,
  isHostPluginEnabled,
} from '@aglyn/aglyn/server'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { collectSocialImageFacts } from '@aglyn/tenant-runtime/social-image-facts'
import { BUNDLE_ID } from '../constants/bundle-common'
import { repeatRowsModelOf } from '../model/dataset-models'
import { readRecordPageRecord, readSiteRecordPageBindings } from './record-page-read.server'
import {
  matchRecordPagePath,
  recordPageHead,
  recordPagePath,
  recordPageRoute,
} from './record-pages'

/**
 * Record pages on the published site (AGL-3475): `/{base}/{address}` renders
 * the binding's template page with the routed record in scope.
 *
 * Registered on the platform's site page resolver seam, the one commerce
 * serves `/products/{slug}` through, so it runs only for a path no published
 * page claims — a page an author publishes at `/services/roofing` always wins
 * over the record of that address. A path that matches no binding, an address
 * no record holds, a dataset the site may no longer see, and a template that
 * is no longer a template or has never been published all answer `undefined`,
 * and the request carries on down the loader's chain to the site's 404.
 *
 * A site that has switched the Data plugin off serves none of them.
 *
 * The template must be a `kind: 'template'` screen: that stamp is what keeps
 * its own address from serving raw `{{item.*}}` tokens, so a binding whose
 * page has been made a page again serves nothing until it is a template
 * again.
 */
export const recordPageResolver: SitePageResolver = async ({
  hostId,
  host,
  org,
  path,
}) => {
  // A site that switched Data off serves no record pages (the plugin's
  // `publishedSiteImpact: routes`).
  if (!isHostPluginEnabled(org, host, BUNDLE_ID)) return undefined
  const bindings = await readSiteRecordPageBindings(hostId)
  if (!bindings.length) return undefined
  const match = matchRecordPagePath(bindings, path)
  if (!match) return undefined
  const { binding, address } = match

  const [routed, templateRes] = await Promise.all([
    readRecordPageRecord(hostId, binding, address),
    getScreen({ hostId, screenId: binding.screenId, allowTemplate: true }),
  ])
  const template = templateRes.screen as
    | (Record<string, any> & { kind?: unknown })
    | undefined
  if (!routed || !template || template.kind !== SCREEN_KIND_TEMPLATE) {
    return undefined
  }

  const head = recordPageHead(binding, routed.dataset.model, routed.record)
  const pagePath = recordPagePath(binding.base, address)
  // The record's own image leads, then the template's, then the site's
  // (AGL-2850): their documents are read in the page's one facts batch.
  const card = collectSocialImageFacts([
    head.image,
    template['seo']?.image,
    host?.seo?.image,
  ])
  const nodes = await composeScreenNodes({
    hostId,
    screenId: binding.screenId,
    screen: template as never,
    socialImages: card.socialImages,
    host,
    record: {
      record: routed.record,
      model: repeatRowsModelOf(routed.dataset.model),
      datasetsByKey: routed.datasetsByKey,
    },
    // Named as the record template it is if the page review holds it
    // (AGL-3374).
    page: {
      template: {
        role: 'entry',
        route: recordPageRoute(binding.base),
        collectionName: routed.dataset.name || 'Dataset',
        entryPath: pagePath,
        fallback: 'not-found',
      },
    },
  })
  if (!nodes) return undefined

  return {
    props: JSON.parse(
      JSON.stringify({
        data: {
          host,
          screen: {
            data: {
              ...template,
              // The record NAMES this page, as a product names its page: the
              // template's own name describes none of the records it draws.
              // A name takes the site title after it, while an authored
              // search title is used as written (AGL-1341).
              ...(head.name ? { displayName: head.name } : {}),
              seo: {
                ...(template['seo'] ?? {}),
                // Only the record's own: inheriting the template's title
                // would give every record page the same `<title>`.
                title: head.title,
                description: head.description ?? template['seo']?.description,
                image: head.image ?? template['seo']?.image,
              },
            },
          },
        },
        nodes,
        // The address this page answers at, in the routing map's form, so
        // the head's canonical and breadcrumb name it rather than the
        // template's own (which serves nothing).
        routePath: pagePath.slice(1),
        ...card.collected(),
      }),
    ),
    revalidate: 60,
  }
}
