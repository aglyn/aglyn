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
 * PIXABAY'S RECORDED ANSWERS FOR TWO beta.246 HEROES (AGL-3760): what
 * production's `stockPhotoSearches` cache held for the searches the starts
 * sent, read back from the cache, never searched again. Ids, sizes, page
 * slugs and tags are Pixabay's own, in its order; the contributor is left out.
 *
 * - Panadería Sol de Oaxaca (job ODSFzsGM91, 2026-10-13), a Spanish guided
 *   start: "Una panadería familiar de San Antonio con pan dulce, conchas y
 *   pasteles de tres leches al estilo de Oaxaca". Its business read as "con
 *   pan dulce", and all eight photos the site's library copied came from that
 *   one search: four of the Río Dulce in Guatemala at dusk (3619205–3619208),
 *   the home hero among them; a pan of vegetables, a ship off Côn Island, a
 *   rusted weight; and one cake (3147645, tagged "dulce").
 * - Copper Fern Candle Co (job UoGN1DHzur, 2026-10-13): "An online shop for
 *   hand-poured soy candles, wax melts and candle gift sets". Its home hero
 *   ← 9380550, a latte with a candle blurred behind it, taken because its
 *   fifth tag and its page slug said "candle".
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

/** `con pan dulce` (horizontal, min_width 1600): the Panadería hero, answered 2026-10-13T15:29:37.726Z. */
export const CON_PAN_DULCE_HERO: StockPhoto[] = [
  hit(
    2011373,
    1280,
    878,
    'deadvlei-namibia-africa-desert-2011373',
    'deadvlei, namibia, africa, desert, dryness, tree, dead vlei, sand, dried up, nature, burned, namib',
  ),
  hit(
    3238173,
    1280,
    930,
    'fried-egg-pan-meal-grill-egg-yolk-3238173',
    'fried egg, pan, meal, grill, egg yolk, food, fried eggs, frying pan, protein, cook, yolk, eggs, kitchen, egg, fried, yummy, tasty, eggs, eggs, eggs',
  ),
  hit(
    6472033,
    1280,
    853,
    'choclo-maiz-choclo-con-queso-6472033',
    'choclo, maiz, choclo con queso, choclo, choclo, choclo, choclo, choclo, maiz',
  ),
  hit(
    3147645,
    1280,
    719,
    'dulce-sweet-fruit-cake-pastry-3147645',
    'dulce, sweet, fruit, cake, pastry, sugar, italy',
  ),
  hit(
    4506703,
    1280,
    720,
    'dumpling-gyoza-frying-pan-skillet-4506703',
    'dumpling, gyoza, frying pan, skillet, pan, gyoza, gyoza, gyoza, gyoza, gyoza',
  ),
  hit(
    9565430,
    1280,
    853,
    'acacia-nature-tree-africa-etosha-9565430',
    'acacia, nature, tree, africa, etosha, salt pan, scenery, panorama',
  ),
  hit(
    1979272,
    1280,
    853,
    'happy-valentines-day-woman-man-1979272',
    'happy valentines day, woman, man, kitchen, food preparation, couple, relationship, together, cooking, pair, cutting, chopping, everyday life, blonde, cutting board, vegetables, happy couple, stove, cook, knife',
  ),
  hit(
    5921491,
    1280,
    854,
    'meal-food-tofu-rice-dish-cooked-5921491',
    'meal, food, tofu, rice, dish, cooked, fried, tasty, delicious, cuisine, pan, bowls, kaiseki, flat lay, meal, food, tofu, tofu, rice, rice',
  ),
  hit(
    3475625,
    1280,
    853,
    'cireșe-cireșele-dulci-fructe-roșu-3475625',
    'cireșe, cireșele dulci, fructe, roșu, dulce, delicios, creangă, frunze, cireșe, fructe, fructe, fructe, fructe, fructe, roșu, roșu, roșu, roșu, roșu, delicios',
  ),
  hit(
    64310,
    1280,
    850,
    'tree-desert-namibia-clay-pan-64310',
    'tree, desert, namibia, nature, clay pan, drought, africa, sand, sky, dunes, outdoors, discovery',
  ),
  hit(
    7887696,
    1280,
    853,
    'weight-metal-old-rusted-pan-weigh-7887696',
    'weight, metal, old, rusted, pan, weigh, weight, weight, weight, weight, weight',
  ),
  hit(
    8027678,
    1280,
    853,
    'vegetable-pan-grilled-vegetables-8027678',
    'vegetable pan, grilled vegetables, cooking, healthy, zucchini, broccoli, paprika, grilling, nourishment, cooking, cooking, cooking, healthy, healthy, healthy, healthy, healthy, zucchini',
  ),
  hit(
    729069,
    1280,
    853,
    'con-racehorse-gallop-running-horse-729069',
    'con, racehorse, gallop, running horse, sport, racehorse, racehorse, racehorse, racehorse, racehorse, running horse',
  ),
  hit(
    3060093,
    1280,
    854,
    'salt-harvesting-vietnam-water-salt-3060093',
    'salt harvesting, vietnam, water, salt, work, people, nature, reflection, hon khoi, salt field, salina, tropical, agriculture, asia, harvest, asian, hats, traditional',
  ),
  hit(
    9384171,
    1280,
    853,
    'food-japanese-meal-class-b-gourmet-9384171',
    'food, japanese meal, class b gourmet, takoyaki, cooking, shop',
  ),
  hit(
    8295778,
    1280,
    853,
    'sweet-potatoes-potatoes-cook-meal-8295778',
    'sweet potatoes, potatoes, cook, meal, food, grill, pan, food, food, food, food, food',
  ),
  hit(
    3619206,
    1280,
    847,
    'central-america-guatemala-rio-dulce-3619206',
    'central america, guatemala, rio dulce, water, heaven, nature, clouds, landscape',
  ),
  hit(
    1835369,
    1280,
    726,
    'cooking-wok-chinese-asian-food-1835369',
    'cooking, wok, chinese, asian, food, frying pan, meal, pan, vegetables, stir fry, frying, cook, cooking food, cooking vegetables, cooking, cooking, cooking, cooking, cooking, wok',
  ),
  hit(
    6286592,
    1280,
    853,
    'meatballs-cook-frying-pan-6286592',
    'meatballs, cook, frying pan, minced meat, meat, food, meal, delicious, fry, sear, pan, closeup, meatballs, meatballs, meatballs, meatballs, meatballs',
  ),
  hit(
    4926211,
    1280,
    853,
    'girl-the-sea-con-beach-summer-4926211',
    'girl, the sea, con, beach, summer, nature, rider, sport, race, animals',
  ),
  hit(
    3619207,
    1280,
    848,
    'central-america-guatemala-rio-dulce-3619207',
    'central america, guatemala, rio dulce, water, nature, heaven, clouds, landscape',
  ),
  hit(
    4813261,
    1280,
    853,
    'meat-duck-duck-breast-raw-fry-4813261',
    'meat, duck, duck breast, raw, fry, court, tasty, fried, sear, recipe, roast duck, food, poultry, food photo, kitchen, cook, meat, meat, meat, duck',
  ),
  hit(
    4644941,
    1280,
    853,
    'fat-frying-pan-4644941',
    'fat, frying, pan',
  ),
  hit(
    4937535,
    1280,
    960,
    'stroller-beach-the-sea-ocean-sand-4937535',
    'stroller, beach, the sea, nature, ocean, sand, con, rider, woman, umbrella, blue, red',
  ),
  hit(
    1838785,
    1280,
    1280,
    'avocado-chopping-board-ingredients-1838785',
    'avocado, chopping board, ingredients, produce, groceries, fresh produce, food preparation, vegetables, cut, chop, kitchen, cooking, eggs, food, frying pan, healthy, knife, mushrooms, kitchen, cooking',
  ),
  hit(
    4937541,
    1280,
    853,
    'rider-con-arena-saddle-helmet-4937541',
    'rider, con, arena, saddle, helmet, costume, wall, sand',
  ),
  hit(
    6380762,
    1280,
    853,
    'panpipe-musician-guatemalan-6380762',
    'panpipe, musician, guatemalan, traditional costume, culture, man, pan flute, instrument, music, musical instrument, portrait, musician, musician, culture, pan flute, music, music, music, music, music',
  ),
  hit(
    3246189,
    1280,
    853,
    'food-pan-cooking-frying-pan-meal-3246189',
    'food, pan, cooking, frying pan, meal, camping, breakfast, fire pit, morning, cook, outdoors, pit, fire, campfire, grill, scrambled, smoke, spatula, outside, skillet',
  ),
  hit(
    2119027,
    1280,
    853,
    'country-life-pan-kitchen-2119027',
    'country life, pan, kitchen, preparation, frying pan, farmer, kitchen appliances, farm yard, country life, country life, pan, kitchen, kitchen, kitchen, kitchen, farmer, kitchen appliances, kitchen appliances, kitchen appliances, kitchen appliances',
  ),
  hit(
    1927783,
    1280,
    853,
    'pan-cook-fire-boiling-water-food-1927783',
    'pan, cook, fire, boiling water, food, picture, free image, cook, boiling water, boiling water, boiling water, boiling water, boiling water',
  ),
  hit(
    2106825,
    1280,
    853,
    'carrots-yellow-beets-vegetables-2106825',
    'carrots, yellow beets, vegetables, carrot, food, vitamins, meal, fresh, bio, cook, yummy, vegetarian, vegetable plants, market fresh vegetables, orange, healthy, nourishment, vegan, ingredients, vegetable pan',
  ),
  hit(
    3619208,
    1280,
    847,
    'central-america-guatemale-rio-dulce-3619208',
    'central america, guatemale, rio dulce, water, heaven, clouds, nature, landscape',
  ),
  hit(
    5095290,
    1280,
    853,
    'bug-deep-con-infections-spike-5095290',
    'bug, deep, con, nature, infections, spike, tree, black',
  ),
  hit(
    3125689,
    1280,
    853,
    'cook-figure-fried-egg-food-3125689',
    'cook, figure, fried egg, food, frying pan, fried eggs, pan, yummy, eggs, grill, egg yolk, yolk, kitchen, fun',
  ),
  hit(
    3619205,
    1280,
    847,
    'central-america-guatemala-rio-dulce-3619205',
    'central america, guatemala, rio dulce, nature, water, heaven, clouds, landscape',
  ),
  hit(
    3941617,
    1280,
    853,
    'meal-pan-chicken-tomato-3941617',
    'meal, pan, chicken, tomato',
  ),
  hit(
    5650205,
    1280,
    853,
    'cosplay-clown-costume-scary-creepy-5650205',
    'cosplay, clown, costume, scary, creepy, evil clown, cosplayer, character, portrait, comic con, clown, clown, clown, clown, clown, evil clown, evil clown, evil clown, evil clown',
  ),
  hit(
    1583152,
    1280,
    905,
    'pan-vegetables-cook-1583152',
    'pan, vegetables, cook, pan, pan, pan, pan, pan, cook',
  ),
  hit(
    7478482,
    1280,
    853,
    'sea-ship-con-island-ocean-vietnam-7478482',
    'sea, ship, con island, ocean, vietnam, nature, fishing boat, blue, minimalism, tran thang nhat, 5 plus english',
  ),
  hit(
    5427775,
    1280,
    853,
    'sea-vung-tau-beach-sky-dawn-5427775',
    'sea, vung tau beach, sky, nature, dawn, con heo hill',
  ),
]

/** `candle shop` (vertical, min_width 1600): the Copper Fern hero, answered 2026-10-13T15:42:26.770Z. */
export const CANDLE_SHOP_TALL_HERO: StockPhoto[] = [
  hit(
    2692556,
    937,
    1280,
    'tea-light-light-worships-2692556',
    'tea light, light, worships, candlelight, flame, meditation, prayer, candle, contemplative, memorial candle, ecclesiastical, shining, memorial lights, sacrificial candle, sacrificial light, reflection, warmth, burn, grief, seem',
  ),
  hit(
    4597415,
    853,
    1280,
    'camera-book-candle-read-cozy-bed-4597415',
    'camera, book, candle, read, cozy, bed, lamp, bokeh, light, home, comfort, reading, cold, camera, book, book, book, candle, candle, candle',
  ),
  hit(
    5850280,
    853,
    1280,
    'candle-christmas-candle-advent-5850280',
    'candle, christmas candle, advent, advent candle, candlelight, flame, christmas decoration, christmas decor, decoration, decor, closeup, candle, candle, candle, candle, candle, christmas candle, christmas candle, christmas candle, advent',
  ),
  hit(
    9874140,
    853,
    1280,
    'candles-candlelight-tea-lights-9874140',
    'candles, candlelight, tea lights, church, prayer, faith, religion, light, burn, all saints, advent',
  ),
  hit(
    6942931,
    853,
    1280,
    'candle-book-read-study-fiction-6942931',
    'candle, book, read, study, fiction, story, pages, candle, candle, candle, candle, book, study, study, study, study, study, story',
  ),
  hit(
    4870097,
    853,
    1280,
    'white-candle-candlelight-dark-4870097',
    'white candle, candlelight, dark, blue flame, black candle, black candles',
  ),
  hit(
    5181374,
    857,
    1280,
    'candle-candlelight-flame-5181374',
    'candle, candlelight, flame, candle flame, fire, black background, wick, burning candle, black candle, black candles, iphone wallpaper',
  ),
  hit(
    1584711,
    848,
    1280,
    'massage-therapy-candles-relaxation-1584711',
    'massage therapy, candles, relaxation, treatment, luxury, spa, massage, towels, tea candles, candlelight, spa treatment, spa, spa, spa, spa, spa, massage',
  ),
  hit(
    4222263,
    868,
    1280,
    'table-candle-decoration-interior-4222263',
    'table, candle, decoration, interior, romantic, celebration, candlestick, candlelight, living room, table, table, table, candle, candle, candle, candle, candle, living room, living room, living room',
  ),
  hit(
    6668364,
    853,
    1280,
    'lemon-candle-scented-candle-6668364',
    'lemon candle, scented candle, blackberry candle, scented candle, scented candle, scented candle, scented candle, scented candle',
  ),
  hit(
    4829516,
    960,
    1280,
    'candlestick-classic-antique-candle-4829516',
    'candlestick, classic, antique, candle, decorative, brown candle, brown candles, candlestick, candlestick, candlestick, candlestick, candlestick',
  ),
  hit(
    2738532,
    853,
    1280,
    'candle-tea-light-hand-church-light-2738532',
    'candle, tea light, hand, church, light, worships, candlelight, faith, religion, christianity, flame, commemorate, meditation, prayer, contemplative, memorial candle, ecclesiastical, mood, shining, the atmosphere',
  ),
  hit(
    8104677,
    850,
    1280,
    'woman-manequin-shop-hat-hat-shop-8104677',
    'woman, manequin, shop, hat, hat shop, store window, monochromatic',
  ),
  hit(
    6145811,
    850,
    1280,
    'bags-shop-gift-shop-establishment-6145811',
    'bags, shop, gift shop, establishment, tourist shop, france, monaco, destination, vacation, travel',
  ),
  hit(
    397965,
    809,
    1280,
    'candle-candle-wax-candlelight-397965',
    'candle, candle wax, candlelight, candlestick, flame, wax, illuminated, fire, burning, romantic, candle, candle, candle, candle, candle, candle wax, candlestick, wax',
  ),
  hit(
    7581472,
    853,
    1280,
    'candle-pine-christmas-tree-holidays-7581472',
    'candle, pine, christmas tree, holidays, decoration, the background, pictures, image, burn, fire, heat, light, symbol, cozy, wax, night, black, hot, religion, meditation',
  ),
  hit(
    7131604,
    853,
    1280,
    'vintage-aesthetic-vintage-fashion-7131604',
    'vintage aesthetic, vintage fashion, restaurant, interior, vintage interior, restaurant, restaurant, restaurant, restaurant, restaurant, interior',
  ),
  hit(
    999370,
    853,
    1280,
    'marrakesh-morocco-market-travel-999370',
    'marrakesh, morocco, market, travel, colorful plates, morocco, morocco, morocco, morocco, morocco',
  ),
  hit(
    5960786,
    960,
    1280,
    'candle-holly-decorative-5960786',
    'candle, holly, decorative, beeswax candle, wax candle, scented candle, scented candle, scented candle, scented candle, scented candle, scented candle',
  ),
  hit(
    4126234,
    853,
    1280,
    'girl-portrait-candle-smoke-4126234',
    'girl, portrait, candle, smoke, brown smoke, brown candle, brown candles',
  ),
  hit(
    4832387,
    915,
    1280,
    'candlelight-candle-flame-dark-4832387',
    'candlelight, candle, flame, dark, black candle, black candles',
  ),
  hit(
    4725958,
    1024,
    1280,
    'string-light-street-lights-violin-4725958',
    'string, light, street, lights, violin, candle, christmas, woman, strings, brown candle, brown candles',
  ),
  hit(
    6805045,
    853,
    1280,
    'christmas-christmas-decoration-6805045',
    'christmas, christmas decoration, christmas background, holiday, happychristmas, iphone wallpaper, christmas, christmas, christmas, christmas, christmas, christmas background, christmas background, christmas background, christmas background, christmas background',
  ),
  hit(
    4368774,
    853,
    1280,
    'street-building-historic-travel-4368774',
    'street, building, historic, travel, trogir, architecture, mediterranean, croatia, old, culture, street, street, street, mediterranean, croatia, croatia, croatia, croatia, croatia',
  ),
  hit(
    4068284,
    862,
    1280,
    'girl-istanbul-shop-shopping-4068284',
    'girl, istanbul, shop, shopping, turkish, turkish, turkish, turkish, turkish, turkish',
  ),
  hit(
    9380550,
    854,
    1280,
    'coffee-latte-art-candle-cozy-drink-9380550',
    'coffee, mobile wallpaper 4k, latte art, samsung wallpaper, candle, cozy, drink, relaxation, ipad wallpaper, iphone wallpaper, aroma, beautiful wallpaper, coffee time, lock screen wallpaper, 4k, mobile wallpaper, wallpaper, phone wallpaper, background',
  ),
  hit(
    4670035,
    853,
    1280,
    'lantern-street-hoi-an-night-4670035',
    'lantern, street, hoi an, night, old quarter, lantern, lantern, lantern, lantern, lantern, street, street, street, street, street, hoi an, hoi an, night, night, night',
  ),
  hit(
    3358546,
    960,
    1280,
    'burnt-flame-candle-dark-wax-burn-3358546',
    'burnt, flame, candle, dark, wax, burn, heat, black candle, black candles',
  ),
  hit(
    3992893,
    894,
    1280,
    'flowers-table-setting-theme-wedding-3992893',
    'flowers, table setting, theme, flower background, flower wallpaper, nature, wedding, beautiful flowers, bouquets, romantic, party, love',
  ),
  hit(
    4523695,
    960,
    1280,
    'candle-light-burnt-black-wight-4523695',
    'candle, light, burnt, black, wight, black candle, black candles',
  ),
  hit(
    5409069,
    854,
    1280,
    'ice-cream-candy-food-dessert-sweet-5409069',
    'ice cream, candy, food, dessert, sweet, ice cream, ice cream, ice cream, ice cream, ice cream, candy',
  ),
  hit(
    8167776,
    1024,
    1280,
    'shopping-shop-store-market-8167776',
    'shopping, shop, store, market, supermarket, bakery, window',
  ),
  hit(
    4562179,
    853,
    1280,
    'candle-candlelight-shiny-mourning-4562179',
    'candle, candlelight, shiny, mourning, romantic, mood, decoration, deco, flame, bright, brown candle, brown candles, candle, candle, candle, candle, candle, candlelight',
  ),
  hit(
    2996627,
    960,
    1280,
    'advent-christmas-time-advent-season-2996627',
    'advent, christmas time, advent season, advent wreath, 3advent, advent greeting, greeting card, candles, candlelight, contemplative, decoration, flower arrangement, christmas jewelry, christmas, third candle, advent candle, advent, advent, advent, advent',
  ),
  hit(
    6783665,
    853,
    1280,
    'mulled-wine-christmas-drink-6783665',
    'mulled wine, christmas drink, christmas decor, alcoholic beverage, mulled wine, mulled wine, mulled wine, mulled wine, mulled wine, christmas drink',
  ),
  hit(
    5196603,
    960,
    1280,
    'candle-shadow-light-mood-fire-5196603',
    'candle, shadow, light, mood, fire, reflection, remember, brown candle, brown candles',
  ),
  hit(
    4449673,
    853,
    1280,
    'bokeh-night-dark-lights-candle-4449673',
    'bokeh, night, dark, lights, candle, darkness, mood, black candle, black candles, black bokeh, bokeh, bokeh, bokeh, bokeh, bokeh',
  ),
  hit(
    4220874,
    853,
    1280,
    'candles-table-mood-candle-light-4220874',
    'candles, table, mood, candle, light, candlelight, the atmosphere, lights, warm, candles, candles, candles, candles, candles, table, table, table, candle, light, candlelight',
  ),
  hit(
    4518366,
    960,
    1280,
    'taiwan-candle-temple-4518366',
    'taiwan, candle, temple',
  ),
  hit(
    4713126,
    1024,
    1280,
    'berlin-germany-city-shopping-4713126',
    'berlin, germany, city, shopping, blackandwhite, facade, black city, black shopping, gray shopping, black shop, gray shop',
  ),
]
