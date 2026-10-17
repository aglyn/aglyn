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
 * PIXABAY'S RECORDED ANSWERS FOR THE RECORD COVERS OF THE BETA.259 JUNIPER
 * AND RYE PHOTOGRAPHY START (AGL-3856, job FrKrUct5mk, host nVj_-hl115):
 * what production's `stockPhotoSearches` cache held on 2026-10-16 for the
 * searches its "Selected work" dataset's records sent, read back from the
 * cache by each search's key, never searched again. "Mountain Wedding Day"
 * placed the red roses (3799286), "Ridgetop Elopement" a bride and groom
 * under a stone arcade (6825609) and "Family Session in the Fall" a bride
 * (3909540). Ids, sizes, page slugs and tags are Pixabay's own, in its
 * order; the contributor is left out.
 */

const hit = (
  id: number,
  width: number,
  height: number,
  slug: string,
  tags: string,
): StockPhoto =>
  ({
    provider: 'pixabay',
    id: String(id),
    width,
    height,
    pageUrl: `https://pixabay.com/photos/${slug}/`,
    photographer: 'A Pixabay contributor',
    tags: tags.split(', '),
    downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
  }) as StockPhoto

/** `mountain wedding day` (horizontal, min_width 900), for the record "Mountain Wedding Day"; answered 2026-10-16T06:29:33.148Z. */
export const MOUNTAIN_WEDDING_DAY_WIDE: StockPhoto[] = [
  hit(4923470, 1280, 853, 'sky-pratomagno-mountain-nature-day-4923470', 'sky, pratomagno, beautiful flowers, rose flower, mountain, nature, day, wedding, love, rose, flower, winter, flower wallpaper, flower background, pink, bloom, romantic, summer, white, tulip'),
  hit(3061483, 1280, 852, 'scrabble-valentines-day-background-3061483', 'scrabble, valentines day, wallpaper 4k, background, cool backgrounds, desktop backgrounds, 4k wallpaper 1920x1080, 4k wallpaper, wallpaper hd, love, valentine, hd wallpaper, free wallpaper, laptop wallpaper, mac wallpaper, free background, heart, windows wallpaper, in love, romantic'),
  hit(5137688, 1280, 853, 'mothers-day-flower-mom-love-5137688', 'flower, mom, love, natural, flower wallpaper, bouquet, life, floral, flower bouquet, happy, arrangement, beautiful flowers, gift, decoration, romance, nature, spring, happy mothers day, flower background, wedding'),
  hit(3799286, 1280, 720, 'roses-red-love-romantic-wedding-3799286', 'roses, red, happy mothers day, love, romantic, wedding, valentine\'s day, wedding day'),
  hit(6704262, 1280, 853, 'couple-love-romance-wedding-bride-6704262', 'couple, love, romance, wedding, bride, groom, marriage, affection, together, couple, couple, couple, love, love, love, wedding, wedding, wedding, wedding, wedding'),
  hit(6230410, 1280, 949, 'bride-groom-wedding-6230410', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(8028185, 1280, 853, 'bride-groom-wedding-marriage-8028185', 'bride, groom, wedding, marriage, couple, love, bridal gown, model, natural, girl, woman, beautiful, wedding, natural, natural, natural, natural, natural'),
  hit(1822488, 1280, 850, 'bride-wedding-adult-asia-pretty-1822488', 'bride, wedding, adult, asia, pretty, dressed up, fresh, girl, gabardine, happy, human, luxury, outdoor, people, thailand, white, wife, woman, elegant, fashion'),
  hit(2482405, 1280, 854, 'wedding-to-marry-marriage-love-2482405', 'wedding, to marry, marriage, love, in love, rose petals, bouquet of flowers, white, roses, bunch of flowers, wedding day, happiness, rings, hand, wedding couple, wedding, wedding, wedding, wedding, wedding'),
  hit(7689627, 1280, 853, 'bride-wedding-wedding-dress-forest-7689627', 'bride, wedding, wedding dress, forest, woods, haze, nature, dawn, bride, bride, bride, bride, wedding, wedding, wedding, wedding, wedding, wedding dress, wedding dress, wedding dress'),
  hit(1485984, 1280, 864, 'wedding-dress-bride-extravagant-1485984', 'wedding dress, bride, extravagant, fancy, luxury, dress, white, wedding, wedding gown, fashion, style, modeling, pose, posing, portrait, wedding dress, wedding dress, wedding dress, bride, bride'),
  hit(6388640, 1280, 853, 'bride-groom-wedding-6388640', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(4289093, 1280, 853, 'wedding-marriage-celebration-4289093', 'wedding, marriage, celebration, to marry, wedding day, before, just married, just married, just married, just married, just married, just married'),
  hit(3792225, 1280, 853, 'rose-blossom-bloom-flower-nature-3792225', 'rose, blossom, flower wallpaper, bloom, flower, beautiful flowers, flower background, nature, pink, romantic, plant, love, romance, noble, wedding, valentine\'s day, rose flower, wedding day, date of birth'),
  hit(3611277, 1280, 800, 'wedding-rings-engagement-rings-3611277', 'wedding rings, engagement rings, marriage, jewelry, gold, wedding rings, wedding rings, marriage, marriage, marriage, jewelry, jewelry, gold, gold, gold, gold, gold'),
  hit(4288992, 1280, 853, 'wedding-husband-mens-suit-4288992', 'wedding, husband, men\'s suit, wedding day, love, marriage, gypsophila, to marry, groom, groom, groom, groom, groom, groom'),
  hit(3061485, 1280, 852, 'paper-page-ring-romantic-love-3061485', 'paper, page, ring, romantic, love, valentine, heart, book, read, getting married, rings, proposing, ring, ring, ring, ring, ring, love, love, love'),
  hit(1284225, 1280, 851, 'wedding-rings-marriage-wedding-1284225', 'wedding rings, marriage, wedding, open bible, golden rings, couple, love, rings, book, bible, vows, love wallpaper, wedding rings, marriage, marriage, marriage, wedding, wedding, wedding, wedding'),
  hit(5235120, 1280, 853, 'wedding-day-planning-wedding-plan-5235120', 'wedding day, planning, wedding, plan, day, meeting, reserve, communication, prepare, bride, groom, notebook, pinterest, sequence, list, laptop, ideas, mockup, wedding, wedding'),
  hit(2686783, 1280, 1280, 'hearts-love-wedding-valentines-day-2686783', 'hearts, nature, love, flower wallpaper, wedding, valentine\'s day, flower background, heart, decoration, deco, art, beautiful flowers, vector, wedding day, flower, rainbow, colorful, romance, decorative, romantic'),
  hit(10320742, 1280, 853, 'wedding-bride-groom-sea-beach-10320742', 'wedding, bride, groom, sea, beach, coast, waves, romance, nature, love, couple, walk, ceremony, celebration, dress, sandy, day, outdoor, happy'),
  hit(6005928, 1280, 800, 'lake-mountain-reflection-water-6005928', 'lake, mountain, reflection, water, rocks, clouds, sky, nature, scenery, scenic, snowdon, wales, wales, wales, wales, wales, wales'),
  hit(8220935, 1280, 853, 'rings-marriage-gold-love-family-8220935', 'rings, marriage, gold, love, family, marriage, marriage, marriage, marriage, marriage, gold, love, love, family'),
  hit(1837148, 1280, 853, 'bride-couple-groom-hands-1837148', 'bride, couple, groom, hands, holding hands, wedding, wedding rings, wedding bands, lovers, husband and wife, bride and groom, love, man, marriage, partners, people, trust, woman, wedding, wedding'),
  hit(4840797, 1280, 836, 'roses-wedding-rings-rose-bush-4840797', 'roses, wedding rings, rose bush, connected, bible, connection, love, wedding day, fragrant, romantic, fragrance, thank you, wedding, greeting card, valentine\'s day, connect competition'),
  hit(260894, 1280, 853, 'flowers-rings-bouquet-260894', 'flowers, rings, flower wallpaper, beautiful flowers, bouquet, wedding bouquet, wedding rings, bridal bouquet, nature, wedding bands, wedding, flower background, marriage, flower arrangement, close up'),
  hit(5574694, 1280, 853, 'hand-wedding-marriage-couple-love-5574694', 'hand, wedding, marriage, couple, love, romance, romantic, celebration, family, togetherness, commitment, diamond, honeymoon, relationship, gold, jewelry, fiance, wedding ring, horizontal, touching'),
  hit(7743478, 1280, 853, 'couple-marriage-wedding-love-heart-7743478', 'couple, marriage, nature, wedding, love, heart, lovers, fun, beach'),
  hit(4838710, 1280, 851, 'pearl-necklace-roses-jewellery-4838710', 'pearl necklace, roses, jewellery, wedding day, happy mothers day, flower wallpaper, nature, beautiful flowers, pearls, love, flower background, wedding, noble, romantic, valentine\'s day, greeting card, thank you, flower, valentine, connection'),
  hit(4641262, 1280, 853, 'roses-pink-dark-pink-romantic-love-4641262', 'roses, pink, dark pink, romantic, love, nature, romance flower, wedding, wedding day, valentine\'s day, rose blossom, flora, blossoms, anniversary'),
  hit(3573506, 1280, 853, 'wedding-reading-vows-marriage-3573506', 'wedding, reading vows, marriage, wedding day, romantic, white'),
  hit(5693164, 1280, 853, 'couple-newlyweds-bride-groom-5693164', 'couple, newlyweds, bride, groom, holding hands, pair, love, people, relationship, together, couple, couple, couple, couple, couple, bride, holding hands'),
  hit(4836579, 1280, 853, 'valentines-day-valentine-valentines-4836579', 'valentine\'s day, valentine, valentines, hearts, pink, love, wedding, romance, little girl, pink love, pink heart, pink wedding'),
  hit(7003291, 1280, 853, 'wedding-snow-prenup-shoot-winter-7003291', 'wedding, snow, prenup shoot, winter, mountains, bride, groom, marriage, man, woman, couple, together, love, garden, nature, snowscape, landscape'),
  hit(3934284, 1280, 853, 'wedding-wedding-dress-woman-girl-3934284', 'wedding, wedding dress, woman, girl, to marry, marriage, romance, love, white, promise, wedding day'),
  hit(6825609, 1280, 853, 'bride-groom-wedding-6825609', 'bride, groom, wedding, wedding photography, bouquet, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man'),
  hit(5400305, 1280, 848, 'wedding-rings-rings-wedding-5400305', 'wedding rings, rings, wedding, together, few, to marry, before, romantic, symbol, gold, wedding day, wedding rings, wedding rings, wedding rings, wedding rings, wedding rings, wedding, wedding, wedding'),
  hit(3153226, 1280, 853, 'love-love-lock-love-locks-bridge-3153226', 'love, love lock, love locks, bridge, castle, metal, hohenzollern bridge, cologne, romance, wedding day, wedding, valentine'),
  hit(3526052, 1280, 853, 'wedding-mr-mrs-bid-day-marriage-3526052', 'wedding, mr, mrs, bid day, marriage, gray wedding, marriage, marriage, marriage, marriage, marriage'),
  hit(1787863, 1280, 854, 'heart-tree-bark-romance-romantic-1787863', 'heart, tree bark, romance, romantic, tree, carved, love, engraved, loyalty, symbol, relationship, emotion, nature, in love, tree heart, bark, valentine\'s day, wedding, wedding day'),
]

/** `wedding session` (horizontal, min_width 900), for the record "Family Session in the Fall"; answered 2026-10-16T06:29:33.372Z. */
export const WEDDING_SESSION_WIDE: StockPhoto[] = [
  hit(974845, 1280, 850, 'bride-and-groom-free-white-974845', 'bride and groom, free, white, wedding photo, wedding photograpy, wedding session, shooting session, picture, love, wedding, white dress, wedding photo, wedding photo, wedding photo, wedding photo, wedding photo, wedding, wedding'),
  hit(3909540, 1280, 853, 'bride-wedding-session-photos-3909540', 'bride, wedding, session photos, happiness, married, nuptials, commitment, white, romantic, love, people'),
  hit(3238431, 1280, 853, 'outdoors-love-woman-summer-two-3238431', 'outdoors, love, woman, summer, two, happiness, nature, girl, young, session, photography, photo, wedding, postboda, hands, linked, hug, looks'),
  hit(7983099, 1280, 853, 'wedding-bride-dad-family-love-7983099', 'wedding, bride, dad, family, love, happiness, marriage, candles, session, ceremony, couple, celebration, entrance, gate, party, event, decoration, decor, entry, nature'),
  hit(3203867, 1280, 720, 'pose-outside-game-summer-woman-3203867', 'pose, outside, game, summer, woman, lifestyle, paradise, nature, sea, adult, cover, travel, young, sky, holiday, brunette, black hair, blue sky, girl, photo session'),
  hit(6388640, 1280, 853, 'bride-groom-wedding-6388640', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(1485984, 1280, 864, 'wedding-dress-bride-extravagant-1485984', 'wedding dress, bride, extravagant, fancy, luxury, dress, white, wedding, wedding gown, fashion, style, modeling, pose, posing, portrait, wedding dress, wedding dress, wedding dress, bride, bride'),
  hit(3611277, 1280, 800, 'wedding-rings-engagement-rings-3611277', 'wedding rings, engagement rings, marriage, jewelry, gold, wedding rings, wedding rings, marriage, marriage, marriage, jewelry, jewelry, gold, gold, gold, gold, gold'),
  hit(3061485, 1280, 852, 'paper-page-ring-romantic-love-3061485', 'paper, page, ring, romantic, love, valentine, heart, book, read, getting married, rings, proposing, ring, ring, ring, ring, ring, love, love, love'),
  hit(1284225, 1280, 851, 'wedding-rings-marriage-wedding-1284225', 'wedding rings, marriage, wedding, open bible, golden rings, couple, love, rings, book, bible, vows, love wallpaper, wedding rings, marriage, marriage, marriage, wedding, wedding, wedding, wedding'),
  hit(8220935, 1280, 853, 'rings-marriage-gold-love-family-8220935', 'rings, marriage, gold, love, family, marriage, marriage, marriage, marriage, marriage, gold, love, love, family'),
  hit(1837148, 1280, 853, 'bride-couple-groom-hands-1837148', 'bride, couple, groom, hands, holding hands, wedding, wedding rings, wedding bands, lovers, husband and wife, bride and groom, love, man, marriage, partners, people, trust, woman, wedding, wedding'),
  hit(260894, 1280, 853, 'flowers-rings-bouquet-260894', 'flowers, rings, flower wallpaper, beautiful flowers, bouquet, wedding bouquet, wedding rings, bridal bouquet, nature, wedding bands, wedding, flower background, marriage, flower arrangement, close up'),
  hit(5574694, 1280, 853, 'hand-wedding-marriage-couple-love-5574694', 'hand, wedding, marriage, couple, love, romance, romantic, celebration, family, togetherness, commitment, diamond, honeymoon, relationship, gold, jewelry, fiance, wedding ring, horizontal, touching'),
  hit(7743478, 1280, 853, 'couple-marriage-wedding-love-heart-7743478', 'couple, marriage, nature, wedding, love, heart, lovers, fun, beach'),
  hit(6825609, 1280, 853, 'bride-groom-wedding-6825609', 'bride, groom, wedding, wedding photography, bouquet, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man'),
  hit(1854076, 1280, 852, 'beach-wedding-reception-1854076', 'beach, flower wallpaper, wedding, flower background, reception, table setting, centerpieces, flower vases, event, beach wedding, wedding photography, wedding preparations, bunch of flowers, celebration, chairs, decorations, flowers, beautiful flowers, sea, summer'),
  hit(6552057, 1280, 762, 'bride-groom-wedding-6552057', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(10320741, 1280, 853, 'wedding-bride-groom-beach-love-10320741', 'wedding, bride, groom, beach, love, beautiful flowers, romance, kiss, nature, couple, wedding dress, suit, tenderness, happiness, marriage, flower wallpaper, flowers, bouquet, special day, bridal bouquet'),
  hit(8176870, 1280, 853, 'couple-wedding-marriage-love-8176870', 'couple, wedding, marriage, love, romance, man, woman, portrait, groom, bride'),
  hit(10119091, 1280, 853, 'classic-bike-old-house-kiss-love-10119091', 'classic, bike, old house, kiss, love, couple, romantic, relationship, wedding, wedding ring'),
  hit(529607, 1280, 852, 'heart-wedding-marriage-529607', 'heart, wedding, 4k wallpaper, hd wallpaper, wallpaper hd, free wallpaper, free background, beautiful wallpaper, marriage, mac wallpaper, full hd wallpaper, wallpaper 4k, valentines day, hands, laptop wallpaper, romantic, 4k wallpaper 1920x1080, marry, desktop backgrounds, windows wallpaper'),
  hit(2595862, 1280, 853, 'valentines-day-background-wedding-2595862', 'valentines day background, wedding, marriage, husband, wife, bride, groom, bridal gown, bridal dress, bridal bouquet, suit, man, woman, couple, lovers, together, love, people, guy, female'),
  hit(1355473, 1280, 850, 'bride-wedding-redhead-red-hair-1355473', 'bride, wedding, flower wallpaper, redhead, red hair, flower background, floral wreath, hairstyle, nature, beautiful flowers, flowers, marriage, decoration, woman'),
  hit(260899, 1280, 853, 'happy-valentines-day-couple-marriage-260899', 'happy valentines day, couple, marriage, bench, married couple, bride, groom, sit, sitting, together, relationship, lovers, love, wedding, rest'),
  hit(698501, 1280, 852, 'sunset-wedding-silhouettes-marriage-698501', 'sunset, wedding, silhouettes, marriage, newlyweds, bride, groom, nature, holding hands, couple, bridal, sky, clouds, dusk, romantic, love, romance, man, woman, relationship'),
  hit(10397634, 1280, 853, 'couple-hands-wedding-ring-love-10397634', 'couple, hands, wedding, ring, love, wedding rings, vow, delicate, feeling, connection, closeness, romance, skin, ceremony, softness, close, symbol, marriage, holding hands, support'),
  hit(4615557, 1280, 853, 'happy-valentines-day-couple-wedding-4615557', 'happy valentines day, couple, wedding, marriage, bridal, double, love, people, man, woman, romance, happy, romantic, dress, married, male, big, girl, happiness, celebration'),
  hit(1255520, 1280, 852, 'bride-groom-wedding-1255520', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(768594, 1280, 850, 'bride-and-groom-couple-wedding-sit-768594', 'bride and groom, couple, wedding, sit, sitting, together, lovers, marriage, bride, groom, gown, tuxedo, married, nature, romantic, happiness, romance, love, outdoors, bridal'),
  hit(1745240, 1280, 853, 'wedding-beach-young-couple-couple-1745240', 'wedding, beach, young couple, couple, portrait, lovers, husband and wife, bride and groom, beach wedding, marriage, pair, together, romantic couple, nature, couple portrait, love, romantic, ocean, seashore, shore'),
  hit(4459161, 1280, 850, 'lama-alpaca-hairy-fluffy-animal-4459161', 'lama, nature, alpaca, hairy, fluffy, animal, foto session, chilled'),
  hit(636018, 1280, 677, 'marriage-bridal-wedding-shoes-636018', 'marriage, bridal, wedding, shoes, wedding dress, sneakers, legs, crossed legs, footwear, husband and wife, bride and groom, bridal gown, wedding photography, marriage, wedding, wedding, wedding, wedding, wedding, shoes'),
  hit(6230420, 1280, 853, 'bride-groom-wedding-marriage-6230420', 'bride, groom, wedding, marriage, wedding photography, bridal gown, bridal dress, couple, love, lovers, bridal, together, man, wedding dress, woman, people, in love, romantic, romance, relationship'),
  hit(4226896, 1280, 853, 'marriage-couple-wedding-love-4226896', 'marriage, couple, wedding, love, family, romantic, romance, relationship, happy, together, grooms, husband, wife, wedding, wedding, wedding, wedding, wedding, family'),
  hit(1850073, 1280, 853, 'couple-wedding-dawn-dusk-love-man-1850073', 'couple, wedding, dawn, dusk, love, man, outdoors, people, silhouette, sky, sunrise, sunset, nature, together, blue love, blue sky, blue sunset, blue sunrise, blue wedding, blue together'),
  hit(2162950, 1280, 853, 'couple-wedding-love-back-lovers-2162950', 'couple, wedding, love, back, lovers, relationship, newlyweds, marriage, bride, groom, sit, sitting, together, man, woman, dress, female, romantic, pier, jetty'),
  hit(3940561, 1280, 855, 'heart-clouds-postcard-romance-3940561', 'heart, full hd wallpaper, clouds, postcard, romance, free background, free wallpaper, light blue, laptop wallpaper, windows wallpaper, congratulations, wedding, wallpaper hd, greeting, declaration of love, nature, valentine\'s day, 4k wallpaper, 4k wallpaper 1920x1080, blue'),
  hit(1353829, 1280, 853, 'wedding-couple-marriage-ceremony-1353829', 'wedding, couple, marriage, ceremony, bride, husband, wife, confetti, party, celebration, people, wedding, wedding, wedding, wedding, wedding, marriage, party, party'),
  hit(2566244, 1280, 853, 'bride-groom-wedding-2566244', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
]

/** `wedding` (horizontal, min_width 900), for the record "Ridgetop Elopement"; answered 2026-10-16T06:29:32.879Z. */
export const WEDDING_WIDE_CARD: StockPhoto[] = [
  hit(1837148, 1280, 853, 'bride-couple-groom-hands-1837148', 'bride, couple, groom, hands, holding hands, wedding, wedding rings, wedding bands, lovers, husband and wife, bride and groom, love, man, marriage, partners, people, trust, woman, wedding, wedding'),
  hit(3611277, 1280, 800, 'wedding-rings-engagement-rings-3611277', 'wedding rings, engagement rings, marriage, jewelry, gold, wedding rings, wedding rings, marriage, marriage, marriage, jewelry, jewelry, gold, gold, gold, gold, gold'),
  hit(2595862, 1280, 853, 'valentines-day-background-wedding-2595862', 'valentines day background, wedding, marriage, husband, wife, bride, groom, bridal gown, bridal dress, bridal bouquet, suit, man, woman, couple, lovers, together, love, people, guy, female'),
  hit(5574694, 1280, 853, 'hand-wedding-marriage-couple-love-5574694', 'hand, wedding, marriage, couple, love, romance, romantic, celebration, family, togetherness, commitment, diamond, honeymoon, relationship, gold, jewelry, fiance, wedding ring, horizontal, touching'),
  hit(260894, 1280, 853, 'flowers-rings-bouquet-260894', 'flowers, rings, flower wallpaper, beautiful flowers, bouquet, wedding bouquet, wedding rings, bridal bouquet, nature, wedding bands, wedding, flower background, marriage, flower arrangement, close up'),
  hit(698501, 1280, 852, 'sunset-wedding-silhouettes-marriage-698501', 'sunset, wedding, silhouettes, marriage, newlyweds, bride, groom, nature, holding hands, couple, bridal, sky, clouds, dusk, romantic, love, romance, man, woman, relationship'),
  hit(6388640, 1280, 853, 'bride-groom-wedding-6388640', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(10320741, 1280, 853, 'wedding-bride-groom-beach-love-10320741', 'wedding, bride, groom, beach, love, beautiful flowers, romance, kiss, nature, couple, wedding dress, suit, tenderness, happiness, marriage, flower wallpaper, flowers, bouquet, special day, bridal bouquet'),
  hit(4615557, 1280, 853, 'happy-valentines-day-couple-wedding-4615557', 'happy valentines day, couple, wedding, marriage, bridal, double, love, people, man, woman, romance, happy, romantic, dress, married, male, big, girl, happiness, celebration'),
  hit(1284225, 1280, 851, 'wedding-rings-marriage-wedding-1284225', 'wedding rings, marriage, wedding, open bible, golden rings, couple, love, rings, book, bible, vows, love wallpaper, wedding rings, marriage, marriage, marriage, wedding, wedding, wedding, wedding'),
  hit(8220935, 1280, 853, 'rings-marriage-gold-love-family-8220935', 'rings, marriage, gold, love, family, marriage, marriage, marriage, marriage, marriage, gold, love, love, family'),
  hit(1485984, 1280, 864, 'wedding-dress-bride-extravagant-1485984', 'wedding dress, bride, extravagant, fancy, luxury, dress, white, wedding, wedding gown, fashion, style, modeling, pose, posing, portrait, wedding dress, wedding dress, wedding dress, bride, bride'),
  hit(10397634, 1280, 853, 'couple-hands-wedding-ring-love-10397634', 'couple, hands, wedding, ring, love, wedding rings, vow, delicate, feeling, connection, closeness, romance, skin, ceremony, softness, close, symbol, marriage, holding hands, support'),
  hit(1836315, 1280, 838, 'wedding-couple-marriage-1836315', 'wedding, beautiful flowers, couple, marriage, bridal bouquet, wedding ceremony, matrimony, flower wallpaper, husband and wife, bride and groom, bloom, blossom, bouquet, bride, flower background, nature, ceremony, flowers, groom, people'),
  hit(7744547, 1280, 853, 'church-catholic-cathedral-aisle-7744547', 'church, catholic, cathedral, aisle, pews, religion, altar, christian, faith, wedding, ceremony, wedding ceremony, couple, marriage, chapel, architecture, church, church, church, church'),
  hit(6825609, 1280, 853, 'bride-groom-wedding-6825609', 'bride, groom, wedding, wedding photography, bouquet, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man'),
  hit(7743478, 1280, 853, 'couple-marriage-wedding-love-heart-7743478', 'couple, marriage, nature, wedding, love, heart, lovers, fun, beach'),
  hit(3061485, 1280, 852, 'paper-page-ring-romantic-love-3061485', 'paper, page, ring, romantic, love, valentine, heart, book, read, getting married, rings, proposing, ring, ring, ring, ring, ring, love, love, love'),
  hit(5955351, 1280, 853, 'wedding-couple-bouquet-marriage-5955351', 'wedding, couple, bouquet, marriage, love, romantic, bride, groom, man, woman, together, relationship, romance, hands, bridal, wedding dress, happiness, closeup, wedding, wedding'),
  hit(6230420, 1280, 853, 'bride-groom-wedding-marriage-6230420', 'bride, groom, wedding, marriage, wedding photography, bridal gown, bridal dress, couple, love, lovers, bridal, together, man, wedding dress, woman, people, in love, romantic, romance, relationship'),
  hit(6552057, 1280, 762, 'bride-groom-wedding-6552057', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(8176869, 1280, 853, 'couple-wedding-marriage-love-8176869', 'couple, wedding, marriage, love, romance, man, woman, portrait, groom, bride'),
  hit(8176870, 1280, 853, 'couple-wedding-marriage-love-8176870', 'couple, wedding, marriage, love, romance, man, woman, portrait, groom, bride'),
  hit(1854076, 1280, 852, 'beach-wedding-reception-1854076', 'beach, flower wallpaper, wedding, flower background, reception, table setting, centerpieces, flower vases, event, beach wedding, wedding photography, wedding preparations, bunch of flowers, celebration, chairs, decorations, flowers, beautiful flowers, sea, summer'),
  hit(1846114, 1280, 854, 'wedding-aisle-flower-arrangement-1846114', 'wedding, aisle, flower arrangement, bloom, flower wallpaper, blossom, bouquet, nature, celebration, chairs, decoration, flora, beautiful flowers, flowers, roses, flower background, event, wedding photography, wedding preparations'),
  hit(260899, 1280, 853, 'happy-valentines-day-couple-marriage-260899', 'happy valentines day, couple, marriage, bench, married couple, bride, groom, sit, sitting, together, relationship, lovers, love, wedding, rest'),
  hit(1183271, 1280, 853, 'wedding-bride-married-ceremony-1183271', 'wedding, bride, married, ceremony, romance, couple, romantic, love, wedding dress, event, white, lovers, marriage, beautiful, woman, brown love, brown beauty, brown wedding, brown event, wedding'),
  hit(1355473, 1280, 850, 'bride-wedding-redhead-red-hair-1355473', 'bride, wedding, flower wallpaper, redhead, red hair, flower background, floral wreath, hairstyle, nature, beautiful flowers, flowers, marriage, decoration, woman'),
  hit(10119091, 1280, 853, 'classic-bike-old-house-kiss-love-10119091', 'classic, bike, old house, kiss, love, couple, romantic, relationship, wedding, wedding ring'),
  hit(1745240, 1280, 853, 'wedding-beach-young-couple-couple-1745240', 'wedding, beach, young couple, couple, portrait, lovers, husband and wife, bride and groom, beach wedding, marriage, pair, together, romantic couple, nature, couple portrait, love, romantic, ocean, seashore, shore'),
  hit(2162950, 1280, 853, 'couple-wedding-love-back-lovers-2162950', 'couple, wedding, love, back, lovers, relationship, newlyweds, marriage, bride, groom, sit, sitting, together, man, woman, dress, female, romantic, pier, jetty'),
  hit(1255520, 1280, 852, 'bride-groom-wedding-1255520', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(4066022, 1280, 853, 'bride-groom-wedding-4066022', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(458119, 1280, 853, 'newlyweds-bride-groom-wedding-458119', 'newlyweds, bride, groom, wedding, bride and groom, husband and wife, wedding photography, wedding day, wedding dress, wedding details, couple, love, man, woman, marriage, happy couple, happy, happiness, together, bridal'),
  hit(443600, 1280, 853, 'couple-wedding-park-newlyweds-443600', 'couple, wedding, park, newlyweds, wedding day, husband, wife, man, woman, bride, groom, romantic, love, happy, relationship, outdoors, wedding photography, portrait, couple, wedding'),
  hit(8628796, 1280, 853, 'couple-lovers-wedding-marriage-8628796', 'couple, lovers, wedding, marriage, bridal'),
  hit(1854074, 1280, 852, 'wedding-reception-table-banquet-1854074', 'wedding, reception, table, banquet, centerpieces, flower vases, table setting, bouquets, nature, celebration, flower wallpaper, event, decorations, elegant, flower background, flower arrangements, flowers, roses, beautiful flowers, table set-up'),
  hit(529607, 1280, 852, 'heart-wedding-marriage-529607', 'heart, wedding, 4k wallpaper, hd wallpaper, wallpaper hd, free wallpaper, free background, beautiful wallpaper, marriage, mac wallpaper, full hd wallpaper, wallpaper 4k, valentines day, hands, laptop wallpaper, romantic, 4k wallpaper 1920x1080, marry, desktop backgrounds, windows wallpaper'),
  hit(4226896, 1280, 853, 'marriage-couple-wedding-love-4226896', 'marriage, couple, wedding, love, family, romantic, romance, relationship, happy, together, grooms, husband, wife, wedding, wedding, wedding, wedding, wedding, family'),
  hit(1868868, 1280, 853, 'wedding-ceremony-champagne-glasses-1868868', 'wedding, ceremony, champagne, glasses, newlyweds, marriage, bride and groom, champagne glasses, toast, cheers, celebrate, celebration, wedding ceremony, elegant, bride, formal, groom, love, man, people'),
]
