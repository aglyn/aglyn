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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiReferencePage } from '../ai-theme-brand-inputs'

/**
 * Three recorded home pages for Sites I like (AGL-3975), each with the one
 * stylesheet it links, as `readReferencePage` returns them: a minimal
 * photography portfolio, a busy restaurant that takes reservations and shows
 * its menu, and a software landing page with pricing. Written for the specs
 * in the shapes such sites are built in (semantic sections, an AOS scroll
 * library, utility classes), with sentences, names, picture files and alt
 * texts of their own, which the specs hold out of every prompt and output.
 * The businesses are invented. The pages are files beside this module
 * (`ai-site-inspiration/`), as a recording is.
 */
export interface AiSiteInspirationRecording {
  url: string
  page: AiReferencePage
  /** The words, names and picture addresses of the page that must never reach a prompt. */
  never: readonly string[]
}

/** A recorded file, as the page or sheet was served. */
const recorded = (file: string) => readFileSync(join(__dirname, 'ai-site-inspiration', file), 'utf8')

const PORTFOLIO_HTML = recorded('portfolio.html')

const PORTFOLIO_CSS = recorded('portfolio.css')

const RESTAURANT_HTML = recorded('restaurant.html')

const RESTAURANT_CSS = recorded('restaurant.css')

const SAAS_HTML = recorded('saas.html')

const SAAS_CSS = recorded('saas.css')

export const AI_INSPIRATION_PORTFOLIO: AiSiteInspirationRecording = {
  url: 'https://lumenandgrain.example/',
  page: { url: 'https://lumenandgrain.example/', html: PORTFOLIO_HTML, stylesheets: [PORTFOLIO_CSS] },
  never: [
    'Light that lingers on every frame since 2009',
    'Quiet portraits and coastal landscapes by Mara Ellison',
    'Mara Ellison',
    'Bolinas darkroom',
    'Lumen and Grain wordmark',
    'lumen-grain-wordmark.svg',
    'fog-over-pacifica.jpg',
    'Fog rolling over the Pacifica cliffs',
    'Commission a session',
    'lumenandgrain',
  ],
}

export const AI_INSPIRATION_RESTAURANT: AiSiteInspirationRecording = {
  url: 'https://osteriafiamma.example/',
  page: { url: 'https://osteriafiamma.example/', html: RESTAURANT_HTML, stylesheets: [RESTAURANT_CSS] },
  never: [
    "Fire, flour and Nonna Rosa's Sunday sugo",
    'Chef Dario Bellini',
    'Oregon white oak',
    'Pappardelle with wild boar ragu',
    'Burrata with charred peaches',
    'The best cacio e pepe outside of Rome',
    'Barolo tasting night',
    'Osteria Fiamma flame logo',
    'fiamma-logo.png',
    'dining-room.jpg',
    '2214 SE Division Street',
    'opentable.com/r/osteria-fiamma-portland',
    'Fiamma',
    'osteriafiamma',
  ],
}

export const AI_INSPIRATION_SAAS: AiSiteInspirationRecording = {
  url: 'https://flowline.example/',
  page: { url: 'https://flowline.example/', html: SAAS_HTML, stylesheets: [SAAS_CSS] },
  never: [
    'Invoices that chase themselves',
    'Flowline sends polite reminders',
    'Trusted by finance teams at Northwind and Brightpath',
    'Northwind',
    'Late-payer radar',
    'Flowline cut our days sales outstanding',
    'Does Flowline work with QuickBooks',
    'Flowline logo',
    'flowline-mark.svg',
    '$19/mo',
    'Flowline',
    'flowline.example',
  ],
}

export const AI_INSPIRATION_RECORDINGS: readonly AiSiteInspirationRecording[] = [
  AI_INSPIRATION_PORTFOLIO,
  AI_INSPIRATION_RESTAURANT,
  AI_INSPIRATION_SAAS,
]
