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

import type { StockPhoto } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'

/**
 * THE EMBER & OAK START'S PHOTOS, IN PIXABAY'S SHAPE (AGL-3660): the beta.239
 * production store "Ember & Oak Candle Co" ("A small-batch candle shop selling
 * hand-poured soy candles, wax melts and gift sets online") placed the photos
 * below, each described from what it showed. They are written in the shape
 * Pixabay answers with (a page slug from the first tags, then the tags in its
 * order), never searched for; the ids are this file's own, not Pixabay's.
 *
 * The bad ones, each beside a photo that should win:
 * - The story band "Poured by hand, in small batches" ← bronze mannequin hands.
 * - The "Wax melts" collection tile ← colourful resin fluid art.
 * - The "Gifts for melt fans" tile ← devotional candles with crosses and names.
 * - "Hand-Poured Soy Candle" ← a bed with a book, a mug and a camera.
 * - "Wax Melt Gift Set" ← a single taper candle in a holder.
 */

const hit = (id: number, slug: string, tags: string): StockPhoto =>
  ({
    provider: 'pixabay',
    id: String(id),
    width: 1280,
    height: 1600,
    pageUrl: `https://pixabay.com/photos/${slug}-${id}/`,
    photographer: 'A Pixabay contributor',
    tags: tags.split(', '),
    downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
  }) as StockPhoto

/** Bronze mannequin hands: "wax" is the only word of the shop's world. */
export const MANNEQUIN_HANDS = hit(
  9100001,
  'hands-mannequin-bronze',
  'hands, mannequin, bronze, sculpture, wax, fingers, art, figure',
)

/** A candlemaker pouring wax: the maker at work. */
export const CANDLE_MAKING = hit(
  9100002,
  'candle-making-pouring-wax',
  'candle making, pouring wax, candle, wax, soy wax, workshop, handmade',
)

/** Resin fluid art: "melt" and "wax", never a wax melt. */
export const FLUID_ART = hit(
  9100003,
  'fluid-art-abstract-resin',
  'fluid art, abstract, resin, colorful, paint, wax, melt, liquid, pattern',
)

/** One taper candle in a brass holder. */
export const TAPER_CANDLE = hit(
  9100004,
  'candle-taper-candlestick',
  'candle, taper, candlestick, flame, candle holder, brass, light',
)

/** Wax melts beside a warmer. */
export const WAX_MELTS = hit(
  9100005,
  'wax-melts-melt-warmer-scented',
  'wax melts, melt warmer, scented, aroma, wax, fragrance, home',
)

/** Devotional candles decorated with crosses and names. */
export const DEVOTIONAL_CANDLES = hit(
  9100006,
  'candles-gift-cross',
  'candles, gift, cross, religious, church, decorated, name, baptism',
)

/** A wrapped candle gift. */
export const CANDLE_GIFT = hit(
  9100007,
  'candle-gift-wrapped-scented',
  'candle, gift, wrapped, scented, ribbon, present, soy candle',
)

/** A bed with a book, a mug and a camera; a candle among its last tags. */
export const BED_SCENE = hit(
  9100008,
  'bed-book-mug-camera',
  'bed, book, mug, camera, bedroom, cozy, morning, blanket, candle',
)

/** A plain soy candle in a jar. */
export const SOY_CANDLE = hit(
  9100009,
  'candle-soy-candle-jar',
  'candle, soy candle, jar, flame, candlelight, amber',
)

/*
 * THE KILN & CLOVER START'S PHOTOS, IN PIXABAY'S SHAPE (AGL-3660): a fresh
 * production portfolio, "Kiln & Clover Ceramics" ("A portfolio for a ceramic
 * artist making wheel-thrown stoneware bowls, mugs and vases, with
 * commissions and classes"), placed a nude torso sculpture in its "About the
 * artist and the process" band and red and yellow glass art in its Work
 * page's hero. Described from what they showed; the ids are this file's own.
 */

/** A perforated ceramic sculpture of a nude female torso. */
export const NUDE_TORSO = hit(
  9200001,
  'sculpture-ceramic-torso',
  'sculpture, ceramic, torso, nude, woman, body, art, clay',
)

/** A potter at the wheel. */
export const POTTER_AT_WHEEL = hit(
  9200002,
  'potter-pottery-wheel-clay',
  'potter, pottery wheel, clay, ceramic, hands, workshop, stoneware',
)

/** Red and yellow blown glass art, fired in a kiln. */
export const GLASS_ART = hit(
  9200003,
  'glass-art-blown-glass',
  'glass art, blown glass, red, yellow, vase, kiln, handmade, colorful',
)

/** Stoneware bowls on a shelf. */
export const STONEWARE_BOWLS = hit(
  9200004,
  'pottery-stoneware-bowls',
  'pottery, stoneware, bowls, ceramics, handmade, glaze',
)
