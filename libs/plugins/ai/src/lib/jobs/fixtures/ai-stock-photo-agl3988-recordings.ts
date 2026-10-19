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
 * PIXABAY'S RECORDED ANSWERS FOR THE BETA.270 SUGAR HOLLOW PHOTOGRAPHY
 * GUIDED START (AGL-3988): host MBuUDI70oE, job DQ9pZupq6M, 2026-10-19
 * 19:01Z, "a wedding and family photographer in the Blue Ridge Mountains
 * who books sessions and elopements". What production's `stockPhotoSearches`
 * cache held for the searches its "Gallery collections" covers and its home
 * and contact heroes sent, read back by each search's key, never searched
 * again. Ids, sizes, page slugs and tags are Pixabay's own, in its order;
 * the contributor is left out, and one contributor stands for all. Its
 * `wedding couple mountains` answer is the beta.267 Copper Hollow cache
 * entry (`ai-stock-photo-agl3942-recordings.ts`).
 */

const hit = (id: number, width: number, height: number, slug: string, tags: string): StockPhoto =>
  ({
    provider: 'pixabay',
    id: String(id),
    width,
    height,
    pageUrl: `https://pixabay.com/photos/${slug}/`,
    photographer: 'A Pixabay contributor',
    tags: tags ? tags.split(', ') : [],
    downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
  }) as StockPhoto

/** `couple mountains` (horizontal, min_width 900), sent by the "Gallery collections" covers; answered 2026-10-19T19:03:23.174Z. */
export const COUPLE_MOUNTAINS_0919: StockPhoto[] = [
  hit(7126126, 1280, 853, 'sunset-couple-sky-clouds-mountain-7126126', 'sunset, couple, sky, clouds, mountain, love, nature, couple, love, love, love, love, love'),
  hit(7490522, 1280, 853, 'sunset-silhouettes-romantic-7490522', 'sunset, silhouettes, nature, romantic, together, love, romance, couple'),
  hit(2179256, 1280, 855, 'couple-lake-mountains-point-2179256', 'couple, lake, mountains, point, pointing, lovers, together, hikers, mountaineers, sit, sitting, adventure, mountain lake, alps, daylight, fir trees, hike, hiking, idyllic, landscape'),
  hit(6561172, 1280, 853, 'boat-lake-few-to-travel-tourism-6561172', 'boat, lake, nature, few, to travel, tourism, outdoors, exploration, adventure, sunset, ship, sail, sea, ocean, horizon, seascape, dusk, sailing ship, masts, windjammer'),
  hit(6017739, 1280, 853, 'couple-lovers-kiss-wedding-love-6017739', 'couple, lovers, kiss, wedding, love, romantic, happy, joy, affection, pier, couple, lovers, lovers, kiss, kiss, wedding, wedding, wedding, wedding, wedding'),
  hit(6704262, 1280, 853, 'couple-love-romance-wedding-bride-6704262', 'couple, love, romance, wedding, bride, groom, marriage, affection, together, couple, couple, couple, love, love, love, wedding, wedding, wedding, wedding, wedding'),
  hit(4329036, 1280, 848, 'loves-couple-romantic-sky-sun-4329036', 'loves, couple, romantic, sky, sun, nature, outdoors, together'),
  hit(4900493, 1280, 853, 'road-couple-travel-dessert-4900493', 'road, couple, travel, dessert, road, couple, couple, couple, couple, couple, travel'),
  hit(8574590, 1280, 854, 'morning-sunshine-sunrise-nature-8574590', 'morning, sunshine, sunrise, beautiful flowers, nature, couple, love, sunray, tree, bench, bush, flower background, flower wallpaper, flower, lake, mountain'),
  hit(8497575, 1280, 851, 'mountains-mountain-peak-8497575', 'mountains, mountain peak, cortina d\'ampezzo, italy, winding road, pine forest, forest, clouds, nature, people, walking, hike, people, people, people, people, people'),
  hit(9215839, 1280, 853, 'couple-boat-shore-lake-coast-love-9215839', 'couple, nature, boat, shore, lake, coast, love, portrait'),
  hit(7144049, 1280, 853, 'valentines-day-background-wedding-7144049', 'valentines day background, wedding, happy, love, nature, sunset, mountain, cloud, forest, wife, husband, pair'),
  hit(7061929, 1280, 853, 'couple-love-nature-sunset-meadow-7061929', 'couple, love, nature, sunset, meadow, romantic, romance, together, man, woman, happiness, couple, love, love, love, love, love, sunset'),
  hit(6562725, 1280, 853, 'couple-sunset-silhouette-love-6562725', 'couple, sunset, silhouette, love, romance, lovers, romantic, relationship, nature, together, man, woman, dusk, dark'),
  hit(5267726, 1280, 853, 'couple-guy-girl-dog-mountain-5267726', 'couple, guy, girl, dog, mountain, mountains, nature, people, hug, pet, romantic, friendship, look, far, future, trail, destiny, animal, open, trip'),
  hit(6230410, 1280, 949, 'bride-groom-wedding-6230410', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(6770226, 1280, 854, 'couple-countryside-garden-tourists-6770226', 'couple, flower wallpaper, beautiful flowers, countryside, garden, flower background, nature, tourists, flowers'),
  hit(7130484, 1280, 849, 'beach-sea-ocean-love-couple-sand-7130484', 'beach, sea, ocean, love, couple, sand, holiday, nature, outdoors'),
  hit(8028185, 1280, 853, 'bride-groom-wedding-marriage-8028185', 'bride, groom, wedding, marriage, couple, love, bridal gown, model, natural, girl, woman, beautiful, wedding, natural, natural, natural, natural, natural'),
  hit(10480224, 1280, 853, 'sunset-lake-couple-paddling-dusk-10480224', 'sunset, lake, couple, paddling, dusk, romantic, red sky, mountains, silhouette, water sport, tranquility, nature, blue, evening, rowing, silence, evening sky, calm water, fiery sunset, symmetry'),
  hit(5693164, 1280, 853, 'couple-newlyweds-bride-groom-5693164', 'couple, newlyweds, bride, groom, holding hands, pair, love, people, relationship, together, couple, couple, couple, couple, couple, bride, holding hands'),
  hit(9553864, 1280, 854, 'utliberg-switzerland-nature-9553864', 'utliberg, switzerland, nature, landscape, alps, hike, swiss, winter, uetliberg, zurich, excursion'),
  hit(7003291, 1280, 853, 'wedding-snow-prenup-shoot-winter-7003291', 'wedding, snow, prenup shoot, winter, mountains, bride, groom, marriage, man, woman, couple, together, love, garden, nature, snowscape, landscape'),
  hit(6935359, 1280, 853, 'couple-river-holding-hands-mountain-6935359', 'couple, river, holding hands, mountain, walking, man, woman, sky, romantic, love, nature, holding hands, holding hands, holding hands, holding hands, holding hands'),
  hit(4650819, 1280, 619, 'mountain-landscape-nature-4650819', 'mountain, landscape, nature, kiss in the mountains, couple, love, scenic, darling, composition'),
  hit(7140471, 1280, 853, 'monkeys-primates-animals-wildlife-7140471', 'monkeys, primates, animals, wildlife, pair, couple, portrait, mountain, nature, gibraltar'),
  hit(7162791, 1280, 797, 'couple-outdoors-mountain-7162791', 'couple, outdoors, mountain, mountain peak, resting, relaxing, nature, cold, hiking'),
  hit(4388267, 1280, 853, 'manipulation-crescent-moon-couple-4388267', 'manipulation, crescent, moon, couple, romantic, love, sunset, landscape, hill, mountain, nature, birds'),
  hit(2521221, 1280, 761, 'fantasy-dream-cartoon-drawing-2521221', 'fantasy, dream, cartoon, drawing, design, magic, flower background, sweet, girl, nature, animal, fairytale, beautiful flowers, princess, cloud, landscape, happy, mountain, flower wallpaper, night sky'),
  hit(2597270, 1280, 853, 'clouds-sky-mountain-people-woman-2597270', 'clouds, sky, mountain, people, woman, holding hands, guy, nature, dating, blue nature, blue sky, blue mountain, blue clouds, dating, dating, dating, dating, dating'),
  hit(4897535, 1280, 853, 'mountain-snow-winter-cold-couple-4897535', 'mountain, snow, winter, cold, couple, color, landscape, nature, outdoors, happy'),
  hit(2560893, 1280, 854, 'mountain-highland-cloud-sky-peak-2560893', 'mountain, highland, cloud, sky, peak, landscape, nature, valley, people, couple, man, girl, hug, kiss, couple, couple, couple, couple, hug, hug'),
  hit(3916295, 1280, 856, 'landscape-mountain-summit-clouds-3916295', 'landscape, mountain, summit, clouds, sunset, sun, silhouette, couple, countryside, nature, winter, freedom, clermont ferrand, puy de dôme, france, europe, brown mountain'),
  hit(4855390, 1280, 853, 'ninh-binh-couple-travel-boat-4855390', 'ninh binh, nature, couple, travel, boat, mountain'),
  hit(3385783, 1280, 1070, 'silhouette-night-tree-dog-star-3385783', 'silhouette, pet, night, tree, dog, star, animal, starry sky, mountain, couple, nature, bank'),
  hit(2567022, 1280, 853, 'people-woman-man-hug-love-couple-2567022', 'people, woman, man, hug, nature, love, couple, sunset'),
  hit(2506868, 1280, 768, 'wedding-marriage-day-fancy-colored-2506868', 'wedding, marriage, day, fancy, colored, month, rainbow, mountain, couple, nature, tree, castle, fog, forest, could, sky, kiss'),
  hit(4010627, 1280, 720, 'beach-couple-mountain-cloud-ride-4010627', 'beach, couple, nature, mountain, cloud, ride, ocean, umbrella, valentine'),
  hit(7612157, 1280, 816, 'couple-the-glacier-mountains-7612157', 'couple, the glacier, mountains, trekking, tour, jungfrau, switzerland, top, together, tourist, walk together, backpack, mountain hike, mountain path, travel with a backpack, recreation, fresh air, nature, wanderers, adventure'),
  hit(3732779, 1280, 856, 'mountain-top-adventure-hiking-3732779', 'mountain, top, adventure, hiking, travel, couple, freedom, hiker, trekking, man, silhouette, backpacker, nature, blue sky, sky, blue, sunset, sunrise, landscape, fitness'),
]

/** `family mountains` (horizontal, min_width 900), sent by the "Gallery collections" covers; answered 2026-10-19T19:03:23.576Z. */
export const FAMILY_MOUNTAINS_0919: StockPhoto[] = [
  hit(920131, 1280, 814, 'children-hug-siblings-brother-920131', 'children, hug, siblings, brother, sister, kiss, affection, affectionate, hugging, embrace, love, relationship, together, portrait, little boy, little girl, friends, childhood, cute, people'),
  hit(4610864, 1280, 853, 'family-hike-travel-alps-4610864', 'family, hike, nature, travel, alps, distant view, hochwald, fir trees, mountains, wallberg, summit, picnic, hiking area, recreation, leisure time, mood, bavaria'),
  hit(4355469, 1280, 853, 'children-girl-hiking-trail-4355469', 'children, girl, hiking, trail, forest road, three, nature, landscape, path, forest, away, woman, person, wanderer, tourism, vacations, sunny, sunny day, mountain hiking, hiking'),
  hit(9822301, 1280, 831, 'viet-nam-flag-country-family-9822301', 'viet nam, flag, country, family, portrait, cute, girl, mother'),
  hit(6775216, 1280, 853, 'hike-nature-travel-adventure-6775216', 'hike, nature, travel, adventure, family, outdoors, forest, drought, pico ruivo, trekking, adventure, adventure, family, family, family, drought, drought, drought, drought, drought'),
  hit(5483516, 1280, 853, 'great-wall-of-china-beijing-china-5483516', 'great wall of china, beijing, china, asia, chinese, travel, adventure, visit, destination, family, great wall, architecture, historical, landmark, tourist attraction, history, places of interest, stone wall, china, china'),
  hit(6935341, 1280, 853, 'mother-daughter-outdoors-parent-6935341', 'mother, daughter, outdoors, parent, baby, child, people, family, love, closeup'),
  hit(3071287, 1280, 853, 'lake-waters-reflection-flow-3071287', 'lake, waters, reflection, flow, nature, mountain, web, family, mountains'),
  hit(7843738, 1280, 853, 'family-travel-mountain-forest-tree-7843738', 'family, travel, mountain, forest, nature, tree, thai nguyen, fun, vietnam'),
  hit(9605495, 1280, 853, 'spring-field-kids-sun-clouds-bird-9605495', 'spring, field, kids, nature, sun, clouds, bird, moutains, meadow'),
  hit(1807560, 1280, 777, 'teddy-bear-toys-asia-bali-kids-1807560', 'teddy bear, toys, asia, bali, kids, china, daughter, family, nature, farm, farmer, harvesting, mountains, people, plant, countryside, sewing, fabrics, woman, mother'),
  hit(1822446, 1280, 821, 'agriculture-rice-field-farming-asia-1822446', 'agriculture, rice field, farming, asia, cambodia, culture, farm, farmers, harvest, terrain, laos, happy mothers day, mountain, countryside, sa pa, valley, vietnam, village, thailand, county'),
  hit(3238401, 1280, 853, 'lifestyle-nature-ease-funny-family-3238401', 'lifestyle, nature, ease, funny, family, kid, union, girl, young, outdoors, joy, love, friendship, kids, smile, happiness, happy kids, family, kids, kids'),
  hit(165077, 1280, 837, 'sunset-sundown-da-nang-bay-165077', 'sunset, sundown, nature, da nang bay, danang city, vietnam, beach'),
  hit(4574003, 1280, 853, 'mountain-mint-clinopodium-nepeta-4574003', 'mountain mint, clinopodium nepeta, small-flowered mountain mint, kölme, lamiaceae, lip flower family, steinquendel, blossoms, blue, violet, alpine plant, mountain mint, mountain mint, mountain mint, mountain mint, mountain mint'),
  hit(6883668, 1280, 853, 'goat-mammal-mother-baby-family-6883668', 'goat, mammal, mother, baby, family, animal, nature, mountain, gerês, portugal'),
  hit(7420557, 1280, 853, 'snow-mountain-trillium-lake-7420557', 'snow mountain, trillium lake, paddle board, nature, child, childhood, summer, family, portland, oregon'),
  hit(275998, 1280, 844, 'sunset-sundown-da-nang-bay-275998', 'sunset, sundown, da nang bay, danang city, central vietnam, vietnam, nature, brown city, brown sunset'),
  hit(854005, 1280, 854, 'people-papa-man-child-girl-meadow-854005', 'people, papa, man, child, girl, meadow, wheelbarrows, mountains, in height, country life, nature, outdoors, sunset, lighting mood, people, papa, country life, country life, country life, country life'),
  hit(3218863, 1280, 853, 'man-child-father-lake-early-fog-3218863', 'man, child, father, lake, early fog, fog, mountains, web, fathers day, waters, people, nature, water, buoy, landscape, fathers day, fathers day, fathers day, fathers day, fathers day'),
  hit(10386423, 1280, 853, 'monkey-macaque-family-interaction-10386423', 'monkey, macaque, family, interaction, dialogue, friendly, nature, cliff, companionship, tourist path, natural habitat, curiosity, group, undershirt, bun, excursion, natural beauty, summer time, observation'),
  hit(838221, 1280, 853, 'boys-brothers-child-fun-little-838221', 'boys, brothers, child, fun, little, childhood, toddler, kid, people, together, young, happiness, siblings, two, play, adorable, outdoor, road, brown happy, brown road'),
  hit(1576456, 1280, 820, 'father-son-family-mountain-1576456', 'father, son, family, mountain, happiness, couple, field, mount, landscape, stone, child portrait, nature, child, smiles, play, family photo, happy, walk, fathers day'),
  hit(868394, 1280, 720, 'father-child-family-love-toddler-868394', 'father, child, family, love, toddler, dad, daughter, mountains, holiday, landscape, nature, view, rest, summer, beauty, the national park, top view, the height of the, ocean, relaxation'),
  hit(845235, 1280, 843, 'capricorn-mountains-alps-boy-cub-845235', 'capricorn, mountains, alps, boy, cub, animal, nature, horns'),
  hit(1837263, 1280, 853, 'child-clouds-dad-dock-father-lake-1837263', 'child, clouds, dad, dock, father, lake, mountain range, mountains, nature, outdoors, parent, pier, relaxation, sky, water, dad, dock, dock, father, father'),
  hit(2106625, 1280, 768, 'landscapedesign-photomanipulations-2106625', 'landscapedesign, photomanipulations, digitalart, art, landscape, landscapephotography, photoshop, design, digital art, art, art, art, art, art, photoshop, photoshop, photoshop, photoshop'),
  hit(7488520, 1280, 854, 'father-and-son-coast-football-wave-7488520', 'father and son, coast, football, nature, wave, playing, mountain, sea, sky, family, classic, love and cherish, romantic, minimalism'),
  hit(4333589, 1280, 689, 'consolation-tears-sad-cry-pain-4333589', 'consolation, tears, sad, cry, pain, help, compassion, suffering, elephants, children, people, compassion, compassion, compassion, compassion, compassion, suffering'),
  hit(2388636, 1280, 969, 'chamois-with-young-animals-2388636', 'chamois with young animals, rupicapra rupicapra, high mountains, switzerland, greina'),
  hit(1044383, 1280, 854, 'alp-canton-of-glarus-mountains-1044383', 'alp, canton of glarus, mountains, glarus, girl, glarus alps, switzerland, nature, glärnisch, child, glarus, switzerland, switzerland, switzerland, switzerland, switzerland, child, child, child'),
  hit(3717770, 1280, 854, 'man-son-people-person-family-3717770', 'man, son, people, person, family, parent, parenthood, walking, beach, mountains, cloudy, phuket, thailand, nature, people, phuket, phuket, phuket, phuket, phuket'),
  hit(10042132, 1280, 720, 'mountainous-area-mountain-10042132', 'mountainous area, mountain, nature, butt people, butt, ethnic minority, number, people'),
  hit(1147499, 1280, 960, 'mountain-avens-alpine-flower-1147499', 'mountain avens, alpine flower, alpine flora, alpine plant, dryas octopetala, blossom, flower background, nature, bloom, flower, roses, trellis shrub, dryas, beautiful flowers, inflorescence, flower wallpaper, seed stand'),
  hit(515532, 1280, 854, 'mother-and-daughter-family-happy-515532', 'mother and daughter, family, happy, outdoors, women, female, people, smile, cheerful'),
  hit(4445289, 1280, 853, 'bellflower-flower-blossom-bloom-4445289', 'bellflower, flower, flower background, blossom, bloom, violet, plant, flower wallpaper, bluebell family, petals, beautiful flowers, flora, wildflower, mountain flower, summer, nature'),
  hit(2592704, 1280, 853, 'family-people-parent-mother-mom-2592704', 'family, people, nature, parent, mother, mom, baby, kid, child, cute, sweet, windmill, plants, mountain'),
  hit(4383859, 1280, 852, 'plant-leaf-rainforest-4383859', 'plant, leaf, nature, rainforest, the transmitted light, spines there, palm family, harry the salak mountain national park, java island, indonesia'),
  hit(3167588, 1280, 652, 'children-ski-lessons-exercise-hills-3167588', 'children, ski lessons, exercise hills, black forest, ski slope, children hill, beginners, hill, nature, snow, winter, forest, landscape, mountain, heaven, cold, hike, travel, vacations, piste'),
  hit(2465836, 1280, 960, 'swan-chick-cute-bird-young-animals-2465836', 'swan, chick, cute, nature, bird, young animals, white, swans, water bird, new burger, lake, switzerland'),
]

/** `wedding` (horizontal, min_width 1600), sent by the home and contact heroes; answered 2026-10-19T19:04:24.193Z. */
export const WEDDING_HERO: StockPhoto[] = [
  hit(1837148, 1280, 853, 'bride-couple-groom-hands-1837148', 'bride, couple, groom, hands, holding hands, wedding, wedding rings, wedding bands, lovers, husband and wife, bride and groom, love, man, marriage, partners, people, trust, woman, wedding, wedding'),
  hit(3611277, 1280, 800, 'wedding-rings-engagement-rings-3611277', 'wedding rings, engagement rings, marriage, jewelry, gold, wedding rings, wedding rings, marriage, marriage, marriage, jewelry, jewelry, gold, gold, gold, gold, gold'),
  hit(2595862, 1280, 853, 'valentines-day-background-wedding-2595862', 'valentines day background, wedding, marriage, husband, wife, bride, groom, bridal gown, bridal dress, bridal bouquet, suit, man, woman, couple, lovers, together, love, people, guy, female'),
  hit(5574694, 1280, 853, 'hand-wedding-marriage-couple-love-5574694', 'hand, wedding, marriage, couple, love, romance, romantic, celebration, family, togetherness, commitment, diamond, honeymoon, relationship, gold, jewelry, fiance, wedding ring, horizontal, touching'),
  hit(260894, 1280, 853, 'flowers-rings-bouquet-260894', 'flowers, flower wallpaper, rings, bouquet, nature, wedding bouquet, wedding rings, bridal bouquet, wedding bands, wedding, marriage, flower background, flower arrangement, beautiful flowers, close up'),
  hit(10320741, 1280, 853, 'wedding-bride-groom-beach-love-10320741', 'wedding, bride, groom, beach, love, beautiful flowers, romance, kiss, nature, couple, wedding dress, suit, tenderness, happiness, marriage, flower wallpaper, flowers, bouquet, special day, bridal bouquet'),
  hit(7744547, 1280, 853, 'church-catholic-cathedral-aisle-7744547', 'church, catholic, cathedral, aisle, pews, religion, altar, christian, faith, wedding, ceremony, wedding ceremony, couple, marriage, chapel, architecture, church, church, church, church'),
  hit(4615557, 1280, 853, 'happy-valentines-day-couple-wedding-4615557', 'happy valentines day, couple, wedding, marriage, bridal, double, nature, love, people, man, woman, romance, happy, romantic, dress, married, male, big, girl, happiness'),
  hit(1284225, 1280, 851, 'wedding-rings-marriage-wedding-1284225', 'wedding rings, marriage, wedding, open bible, golden rings, couple, love, rings, book, bible, vows, love wallpaper, wedding rings, marriage, marriage, marriage, wedding, wedding, wedding, wedding'),
  hit(1836315, 1280, 838, 'wedding-couple-marriage-1836315', 'wedding, beautiful flowers, couple, marriage, bridal bouquet, wedding ceremony, matrimony, husband and wife, bride and groom, bloom, blossom, bouquet, bride, flower background, ceremony, flowers, groom, flower wallpaper, people, nature'),
  hit(8220935, 1280, 853, 'rings-marriage-gold-love-family-8220935', 'rings, marriage, gold, love, family, marriage, marriage, marriage, marriage, marriage, gold, love, love, family'),
  hit(1485984, 1280, 864, 'wedding-dress-bride-extravagant-1485984', 'wedding dress, bride, extravagant, fancy, luxury, dress, white, wedding, wedding gown, fashion, style, modeling, pose, posing, portrait, wedding dress, wedding dress, wedding dress, bride, bride'),
  hit(10397634, 1280, 853, 'couple-hands-wedding-ring-love-10397634', 'couple, hands, wedding, ring, love, wedding rings, vow, delicate, feeling, connection, closeness, romance, skin, ceremony, softness, close, symbol, marriage, holding hands, support'),
  hit(3061485, 1280, 852, 'paper-page-ring-romantic-love-3061485', 'paper, page, ring, romantic, love, valentine, heart, book, read, getting married, rings, proposing, ring, ring, ring, ring, ring, love, love, love'),
  hit(6230420, 1280, 853, 'bride-groom-wedding-marriage-6230420', 'bride, groom, wedding, marriage, wedding photography, bridal gown, bridal dress, couple, love, lovers, bridal, together, man, wedding dress, woman, people, in love, romantic, romance, relationship'),
  hit(6552057, 1280, 762, 'bride-groom-wedding-6552057', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(698501, 1280, 852, 'sunset-wedding-silhouettes-marriage-698501', 'sunset, wedding, silhouettes, marriage, newlyweds, bride, groom, holding hands, couple, bridal, sky, clouds, dusk, romantic, nature, love, romance, man, woman, relationship'),
  hit(10119091, 1280, 853, 'classic-bike-old-house-kiss-love-10119091', 'classic, bike, old house, kiss, love, couple, romantic, relationship, wedding, wedding ring'),
  hit(5955351, 1280, 853, 'wedding-couple-bouquet-marriage-5955351', 'wedding, couple, bouquet, marriage, love, romantic, bride, groom, man, woman, together, relationship, romance, hands, bridal, wedding dress, happiness, closeup, wedding, wedding'),
  hit(8176869, 1280, 853, 'couple-wedding-marriage-love-8176869', 'couple, wedding, marriage, love, romance, man, woman, portrait, groom, bride'),
  hit(1486005, 1280, 853, 'wedding-dresses-bride-wedding-1486005', 'wedding dresses, bride, wedding, elegant, white, female, bride, wedding, wedding, wedding, wedding, wedding'),
  hit(1846114, 1280, 854, 'wedding-aisle-flower-arrangement-1846114', 'wedding, aisle, flower arrangement, bloom, blossom, bouquet, celebration, chairs, decoration, beautiful flowers, flower background, nature, flora, flowers, roses, event, flower wallpaper, wedding photography, wedding preparations'),
  hit(1854076, 1280, 852, 'beach-wedding-reception-1854076', 'beach, flower wallpaper, wedding, flower background, reception, table setting, centerpieces, flower vases, event, beach wedding, wedding photography, wedding preparations, bunch of flowers, celebration, chairs, decorations, flowers, beautiful flowers, sea, summer'),
  hit(2162950, 1280, 853, 'couple-wedding-love-back-lovers-2162950', 'couple, wedding, love, back, lovers, relationship, newlyweds, marriage, bride, groom, sit, sitting, together, man, woman, dress, female, romantic, pier, jetty'),
  hit(4066022, 1280, 853, 'bride-groom-wedding-4066022', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(260899, 1280, 853, 'happy-valentines-day-couple-marriage-260899', 'happy valentines day, couple, marriage, bench, married couple, bride, groom, sit, sitting, together, relationship, lovers, love, wedding, rest'),
  hit(443600, 1280, 853, 'couple-wedding-park-newlyweds-443600', 'couple, wedding, park, newlyweds, wedding day, husband, wife, man, woman, bride, groom, romantic, love, happy, relationship, outdoors, wedding photography, portrait, couple, wedding'),
  hit(1183271, 1280, 853, 'wedding-bride-married-ceremony-1183271', 'wedding, bride, married, ceremony, romance, couple, romantic, love, wedding dress, event, white, lovers, marriage, beautiful, woman, brown love, brown beauty, brown wedding, brown event, wedding'),
  hit(1355473, 1280, 850, 'bride-wedding-redhead-red-hair-1355473', 'bride, beautiful flowers, wedding, redhead, flower wallpaper, red hair, floral wreath, hairstyle, flowers, flower background, marriage, decoration, nature, woman'),
  hit(1745240, 1280, 853, 'wedding-beach-young-couple-couple-1745240', 'wedding, beach, young couple, couple, portrait, lovers, husband and wife, bride and groom, beach wedding, marriage, pair, together, romantic couple, couple portrait, love, romantic, ocean, nature, seashore, shore'),
  hit(458119, 1280, 853, 'newlyweds-bride-groom-wedding-458119', 'newlyweds, bride, groom, wedding, bride and groom, husband and wife, wedding photography, wedding day, wedding dress, wedding details, couple, love, man, woman, marriage, happy couple, happy, happiness, together, bridal'),
  hit(1255520, 1280, 852, 'bride-groom-wedding-1255520', 'bride, groom, wedding, wedding photography, bridal gown, bridal dress, couple, pair, together, love, lovers, newlyweds, bridal, wedding dress, marriage, woman, fashion, dress, man, people'),
  hit(9490176, 1280, 853, 'pre-wedding-couple-love-wedding-9490176', 'pre-wedding, couple, love, wedding'),
  hit(1854074, 1280, 852, 'wedding-reception-table-banquet-1854074', 'wedding, reception, table, banquet, centerpieces, flower vases, table setting, bouquets, nature, celebration, flower wallpaper, event, decorations, elegant, flower background, flower arrangements, flowers, roses, beautiful flowers, table set-up'),
  hit(5582980, 1280, 853, 'wedding-photography-wedding-details-5582980', 'wedding photography, wedding details, wedding preparations, flower background, wedding, table set-up, flower arrangement, nature, flowers, table, glassware, candles, dining table, decoration, decorative, flower wallpaper, beautiful flowers, floral'),
  hit(529607, 1280, 852, 'heart-wedding-marriage-529607', 'heart, 4k wallpaper 1920x1080, wedding, marriage, hd wallpaper, valentines day, hands, romantic, wallpaper hd, marry, laptop wallpaper, beautiful wallpaper, mac wallpaper, couple, free background, together, wallpaper 4k, free wallpaper, husband, desktop backgrounds'),
  hit(4226896, 1280, 853, 'marriage-couple-wedding-love-4226896', 'marriage, couple, wedding, love, family, romantic, romance, relationship, happy, together, grooms, husband, wife, wedding, wedding, wedding, wedding, wedding, family'),
  hit(7389356, 1280, 851, 'jewel-diamond-ring-fashion-jewelry-7389356', 'jewel, diamond, ring, fashion, jewelry, wedding, diamond, diamond, ring, ring, ring, jewelry, jewelry, jewelry, jewelry, jewelry'),
  hit(7407081, 1280, 854, 'park-rain-wedding-couple-7407081', 'park, rain, wedding, couple, wedding day, nature, wedding photography, raining, trees, forest, landscape, rain, rain, rain, rain, rain, wedding, raining'),
  hit(8628797, 1280, 853, 'wedding-marriage-couple-love-8628797', 'wedding, marriage, couple, love, relationship, romance, bridal'),
]

/** The photos production placed whose alt text read as tag soup, by Pixabay id, as their searches answered them. */
export const SUGAR_HOLLOW_PLACED: StockPhoto[] = [
  hit(9140142, 853, 1280, 'father-girl-care-love-worry-9140142', 'father, girl, care, love, worry, children, palm, autumn, fall, baby, child, model, nature, park, trees, leaves, family, outdoors'),
  hit(10140688, 854, 1280, 'couple-on-bench-autumn-romance-10140688', 'couple on bench, ipad wallpaper, autumn romance, beautiful wallpaper, lakeside view, phone wallpaper, lock screen wallpaper, cozy moment, fall season, nature love, scenic beauty, peaceful retreat, mobile wallpaper 4k, relationship goals, outdoor date, tranquil forest, serene landscape, iphone wallpa'),
  hit(6071186, 853, 1280, 'family-tourists-sightseeing-6071186', 'family, tourists, sightseeing, mountain, landscape, vacation, holiday, leisure, mother, daughter, women, baby, child, girl, young, people, together, cute, happy, outdoors'),
  hit(7065652, 853, 1280, 'couple-wedding-fog-forest-bride-7065652', 'couple, wedding, fog, forest, bride, groom, romantic, newly married, nature, wedding day, husband, wife, man, woman, love, park, happy, relationship, outdoors, portrait'),
  hit(4897535, 1280, 853, 'mountain-snow-winter-cold-couple-4897535', 'mountain, snow, winter, cold, couple, color, landscape, nature, outdoors, happy'),
  hit(7126126, 1280, 853, 'sunset-couple-sky-clouds-mountain-7126126', 'sunset, couple, sky, clouds, mountain, love, nature, couple, love, love, love, love, love'),
  hit(2191390, 853, 1280, 'couple-sky-evening-sunset-romantic-2191390', 'couple, sky, evening, sunset, romantic, engaged, newy wed, nature, silhouette, happy, love'),
  hit(1837263, 1280, 853, 'child-clouds-dad-dock-father-lake-1837263', 'child, clouds, dad, dock, father, lake, mountain range, mountains, nature, outdoors, parent, pier, relaxation, sky, water, dad, dock, dock, father, father'),
]
