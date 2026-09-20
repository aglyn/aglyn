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

// Deep import (not the barrel) so this Server Component doesn't pull the
// app-utils index into the RSC graph of every published page (AGL-405).
import { resolvePageLocale } from '@aglyn/aglyn/app-utils/seo-locale'
import type { ReactNode } from 'react'
import DocumentShell from '../../components/document-shell.component'
import { getHostCached } from './host-data'

/**
 * The tenant document shell, in the site's own language (AGL-3153).
 *
 * This segment exists for one attribute. `<html lang>` was a literal `"en"`
 * in the host-agnostic root layout, so every published site declared English
 * whatever it was written in — the first customer to translate a site would
 * have inherited it. The language is a property of the SITE, and `[host]` is
 * the highest segment that knows which site this is.
 *
 * ## Why here and not one segment up
 *
 * The root layout has no params, so answering there means `headers()`, and a
 * dynamic API in the root layout de-opts static generation for every route
 * beneath it. Measured on this app: adding one took `/_not-found` out of the
 * prerender manifest, and the catch-all beneath — `revalidate = 3600`, a
 * number tuned against measured Write Utilization (AGL-2690) — would lose its
 * window the same way when it regenerates at request time.
 *
 * A path PARAMETER is not a dynamic API. Reading `params.host` here costs the
 * catch-all nothing, which is the same trade `[scheme]` made for the
 * visitor's colour scheme (AGL-2708): read the request where reading it is
 * free, spend the answer as a path segment, and keep one cached document per
 * distinguishable rendering.
 *
 * ## Why the site's language and not the screen's
 *
 * `resolvePageLocale` takes a screen first, and no segment that can render
 * `<html>` has one: the screen is resolved from the slug, one level below the
 * deepest layout. Nothing above the page can name a locale variant's own
 * language, whether it reads params or headers — a dynamic root layout would
 * have to re-resolve the screen itself to do better, at the cost of the ISR
 * window and a second copy of `load-page-data`.
 *
 * So this is the SITE's language, and it is resolved through the same chain
 * every other surface reads rather than a second default: `defaultLocale`,
 * then the first of `locales`, then the platform default. `og:locale`,
 * `og:locale:alternate` and every JSON-LD `inLanguage` call the same resolver
 * from the page WITH the screen, so a locale variant still advertises its own
 * language to the readers that take it from metadata — `<html lang>` names the
 * site the variant belongs to, which is what it could always answer honestly.
 *
 * ## No extra Firestore read
 *
 * `getHostCached` is React-`cache`d per render and `[host]/[scheme]/layout`
 * and the page already call it, so this collapses into the lookup they share.
 * It cannot reject either: `getHost` resolves to a null host on failure and
 * the chain falls through to the platform default, because a layout that threw
 * over a language attribute would take the whole site down with it.
 */
export default async function TenantDocumentLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ host: string }>
}) {
  const { host } = await params
  const hostRes = await getHostCached(host)
  return (
    <DocumentShell lang={resolvePageLocale({ host: hostRes.host })}>
      {children}
    </DocumentShell>
  )
}
