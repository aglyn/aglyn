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

import type {
  PluginEgressHostDeclaration,
  PluginSubprocessorsAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'

/**
 * Pixabay (AGL-3660): a library Aglyn searches and copies photos from with
 * its own API key. No customer's personal data is sent: the search words are
 * a site's kind and a section's subject, and the photo fetch sends nothing.
 */
export const STOCK_PHOTOS_HOSTS: PluginEgressHostDeclaration[] = [
  {
    host: 'pixabay.com',
    disposition: 'not-a-subprocessor',
    reason:
      "Pixabay's image search API (`https://pixabay.com/api/`), asked by the stock-photos plugin's client (`libs/plugins/stock-photos/src/lib/providers/pixabay.ts`) from the console's server while an AI job builds a site's pages, to find photos for the page's picture slots; answers are cached for 24 hours. Also the host of `largeImageURL`, from which a chosen photo's bytes are downloaded once and stored in the site's own media library, so no page ever loads an image from Pixabay. A photo's page and its contributor's page on this host are recorded on the asset as its credit.",
    dataReceived:
      "Aglyn's API key and the search words: a few words naming the kind of business (from the site's business type) and the section's subject (from the picture's description), with Aglyn's fixed filters (photos only, orientation, minimum size, safe search). No customer data: no name, email address, phone number or other personal data of a customer or a visitor, and no workspace or site identifier. The image download sends no data beyond the request for the image.",
  },
  {
    host: 'cdn.pixabay.com',
    disposition: 'not-a-subprocessor',
    reason:
      "Pixabay's image CDN, one of the two hosts the stock-photos plugin's client (`libs/plugins/stock-photos/src/lib/providers/pixabay.ts`) will download a chosen photo's bytes from, on the console's server, before storing them in the site's own media library.",
    dataReceived: 'Nothing beyond the request for the image.',
  },
]

/** The plugin's `subprocessors` entry: no recipient of personal data, only the library's hosts. */
export function stockPhotosSubprocessors(): PluginSubprocessorsAnswer {
  return { subprocessors: [], hosts: STOCK_PHOTOS_HOSTS }
}
