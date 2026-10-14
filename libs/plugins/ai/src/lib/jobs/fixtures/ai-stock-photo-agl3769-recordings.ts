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
 * PIXABAY'S RECORDED ANSWERS FOR THE beta.247 PANADERÍA RETEST (AGL-3769):
 * what production's `stockPhotoSearches` cache held for the two searches
 * Panaderia La Espiga Dorada's guided start (job Eynu8Iag2Z, 2026-10-13)
 * sent, read back from the cache, never searched again. Ids, sizes, page
 * slugs and tags are Pixabay's own, in its order; the contributor is left out.
 *
 * Its plan's photo words were "bakery pan dulce conchas": the subject first,
 * as the tool asks, then two Spanish names spelled in English letters. Read
 * as an English noun phrase, head last, the site's business became "pan dulce
 * conchas" and its craft "concha", so the hero searched that and took
 * 4965870, purple ceanothus flowers whose first tag is "ceanothus concha";
 * the story section took 109343, "the concha bay" at San Sebastián, and
 * another ceanothus (4955734) filled a cake slot. "bakery", the subject the
 * words led with, was searched only as the bakery kin's broad search.
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

/** `pan dulce conchas`: the Espiga Dorada hero and four other slots, answered 2026-10-13T20:16:23.066Z. */
export const PAN_DULCE_CONCHAS: StockPhoto[] = [
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
    64310,
    1280,
    850,
    'tree-desert-namibia-clay-pan-64310',
    'tree, desert, namibia, nature, clay pan, drought, africa, sand, sky, dunes, outdoors, discovery',
  ),
  hit(
    8027678,
    1280,
    853,
    'vegetable-pan-grilled-vegetables-8027678',
    'vegetable pan, grilled vegetables, cooking, healthy, zucchini, broccoli, paprika, grilling, nourishment, cooking, cooking, cooking, healthy, healthy, healthy, healthy, healthy, zucchini',
  ),
  hit(
    7887696,
    1280,
    853,
    'weight-metal-old-rusted-pan-weigh-7887696',
    'weight, metal, old, rusted, pan, weigh, weight, weight, weight, weight, weight',
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
    6286592,
    1280,
    853,
    'meatballs-cook-frying-pan-6286592',
    'meatballs, cook, frying pan, minced meat, meat, food, meal, delicious, fry, sear, pan, closeup, meatballs, meatballs, meatballs, meatballs, meatballs',
  ),
  hit(
    4965870,
    1280,
    853,
    'ceanothus-concha-california-4965870',
    'ceanothus concha, nature, california, native plants, spring, flower background, flowers, flower wallpaper, beautiful flowers, purple',
  ),
  hit(
    4216459,
    1280,
    853,
    'spain-salamanca-architecture-old-4216459',
    'spain, salamanca, architecture, old, history, europe, tourism, church, casa conchas, salamanca, salamanca, salamanca, salamanca, salamanca',
  ),
  hit(
    3619207,
    1280,
    848,
    'central-america-guatemala-rio-dulce-3619207',
    'central america, guatemala, rio dulce, water, nature, heaven, clouds, landscape',
  ),
  hit(
    1835369,
    1280,
    726,
    'cooking-wok-chinese-asian-food-1835369',
    'cooking, wok, chinese, asian, food, frying pan, meal, pan, vegetables, stir fry, frying, cook, cooking food, cooking vegetables, cooking, cooking, cooking, cooking, cooking, wok',
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
    3246189,
    1280,
    853,
    'food-pan-cooking-frying-pan-meal-3246189',
    'food, pan, cooking, frying pan, meal, camping, breakfast, fire pit, morning, cook, outdoors, pit, fire, campfire, grill, scrambled, smoke, spatula, outside, skillet',
  ),
  hit(
    6380762,
    1280,
    853,
    'panpipe-musician-guatemalan-6380762',
    'panpipe, musician, guatemalan, traditional costume, culture, man, pan flute, instrument, music, musical instrument, portrait, musician, musician, culture, pan flute, music, music, music, music, music',
  ),
  hit(
    2119027,
    1280,
    853,
    'country-life-pan-kitchen-2119027',
    'country life, pan, kitchen, preparation, frying pan, farmer, kitchen appliances, farm yard, country life, country life, pan, kitchen, kitchen, kitchen, kitchen, farmer, kitchen appliances, kitchen appliances, kitchen appliances, kitchen appliances',
  ),
  hit(
    2106825,
    1280,
    853,
    'carrots-yellow-beets-vegetables-2106825',
    'carrots, yellow beets, vegetables, carrot, food, vitamins, meal, fresh, bio, cook, yummy, vegetarian, vegetable plants, market fresh vegetables, orange, healthy, nourishment, vegan, ingredients, vegetable pan',
  ),
  hit(
    3125689,
    1280,
    853,
    'cook-figure-fried-egg-food-3125689',
    'cook, figure, fried egg, food, frying pan, fried eggs, pan, yummy, eggs, grill, egg yolk, yolk, kitchen, fun',
  ),
  hit(
    3619208,
    1280,
    847,
    'central-america-guatemale-rio-dulce-3619208',
    'central america, guatemale, rio dulce, water, heaven, clouds, nature, landscape',
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
    109343,
    1280,
    860,
    'the-concha-bay-san-sebastian-lights-109343',
    'the concha bay, san sebastian, lights, highlights, san sebastian, san sebastian, san sebastian, san sebastian, san sebastian',
  ),
  hit(
    1583152,
    1280,
    905,
    'pan-vegetables-cook-1583152',
    'pan, vegetables, cook, pan, pan, pan, pan, pan, cook',
  ),
  hit(
    6941781,
    1280,
    854,
    'roulades-beef-bacon-pan-grill-6941781',
    'roulades, beef, bacon, pan, grill, cooking, bacon, bacon, bacon, bacon, bacon',
  ),
  hit(
    4955734,
    1280,
    853,
    'ceanothus-concha-bee-pollen-4955734',
    'ceanothus concha, bee, pollen, pollinator, native plants, spring, nature, purple, blue bee',
  ),
  hit(
    5979722,
    1280,
    853,
    'cooking-butter-pan-frying-pan-cook-5979722',
    'cooking, butter, pan, frying pan, cook, food prepartaion, kitchen, dairy, pan, frying pan, frying pan, frying pan, frying pan, frying pan',
  ),
  hit(
    4644950,
    1280,
    853,
    'frying-pan-fat-4644950',
    'frying, pan, fat',
  ),
  hit(
    5909434,
    1280,
    853,
    'breakfast-bacon-cast-iron-skillet-5909434',
    'breakfast, bacon, cast iron, skillet, fying pan, frying, cooking, pan fry, meal, meat, delicious, tasty, pork, bacon strips, food, cooking food, bacon, bacon, skillet, skillet',
  ),
  hit(
    5003297,
    1280,
    853,
    'butter-pan-cook-frying-pan-grill-5003297',
    'butter, pan, cook, frying pan, grill, oil, fat, stove',
  ),
  hit(
    3834178,
    1280,
    733,
    'cakes-cake-mould-springform-pan-3834178',
    'cakes, cake mould, springform pan, baking pan, to bake, apples, apple cake, pastries, baked, kitchen, food, meal, yummy, cake mould, apple cake, apple cake, apple cake, apple cake, apple cake',
  ),
  hit(
    3125697,
    1280,
    793,
    'fried-egg-pan-meal-grill-egg-yolk-3125697',
    'fried egg, pan, meal, grill, egg yolk, food, fried eggs, frying pan, protein, cook, yolk, eggs, kitchen, egg, fried, yummy, tasty, fried egg, fried egg, fried egg',
  ),
  hit(
    1195362,
    1280,
    853,
    'royal-fan-court-frying-pan-1195362',
    'royal fan, court, frying pan, frying pan, frying pan, frying pan, frying pan, frying pan',
  ),
]

/** `bakery`: the Espiga Dorada slots that searched the subject, answered 2026-10-13T20:16:23.366Z. */
export const BAKERY: StockPhoto[] = [
  hit(
    1867459,
    1280,
    853,
    'breads-pastries-croissants-1867459',
    'breads, pastries, croissants, puff pastries, danish, baked goods, puff pastry, bakery, breakfast, delicious, food, fresh pastries, pastry shop, bakeshop, restaurant, shop, tasty, variety, bread display, bakery',
  ),
  hit(
    6245204,
    1280,
    853,
    'bread-basket-food-breakfast-snack-6245204',
    'bread, basket, food, breakfast, snack, baked, delicious, bakery, closeup',
  ),
  hit(
    8535650,
    1280,
    853,
    'bread-sourdough-flaxseed-seeds-8535650',
    'bread, sourdough, flaxseed, seeds, healthy, bake, homemade, breakfast, bakery, flour, bread, bread, breakfast, bakery, bakery, bakery, bakery, bakery, flour',
  ),
  hit(
    3946227,
    1280,
    853,
    'cake-homemade-dessert-roasted-3946227',
    'cake, homemade, dessert, roasted, bakery, tasty, sweetness, party, cake, cake, cake, cake, cake',
  ),
  hit(
    5470532,
    1280,
    853,
    'bread-bakery-baked-flour-braided-5470532',
    'bread, bakery, baked, flour, braided, food, fresh, challah, traditional, bread, bread, bread, bread, bread, bakery, bakery, bakery, bakery, challah',
  ),
  hit(
    1284438,
    1280,
    719,
    'bread-croissant-morning-puff-paste-1284438',
    'bread, croissant, morning, puff paste, puff pastry, flaky pastry, bakery, breakfast, dessert, sweet, snack, homemade, delicious, cuisine, tasty, pie, bake, pastry, bun, nutrition',
  ),
  hit(
    8447394,
    1280,
    853,
    'bun-sesame-baked-goods-baked-brown-8447394',
    'bun, sesame, baked goods, baked, brown, crust, fresh, grain bread, food, bakery, healthy, crispy, sesame, baked goods, food, food, food, bakery, bakery, bakery',
  ),
  hit(
    1868396,
    1280,
    852,
    'bakery-bread-baker-apron-baking-1868396',
    'bakery, bread, baker, apron, baking, chef, cook, dough, flour, food, bakery, bakery, bakery, bakery, bread, bread, bread, bread, bread, baker',
  ),
  hit(
    8233676,
    1280,
    960,
    'cake-berries-dessert-sweet-8233676',
    'cake, berries, dessert, sweet, chocolate, chocolate cake, rum cake, bakery, birthday cake, raspberries, blueberries, fruit, round cake, figs, food, cake, cake, cake, cake, cake',
  ),
  hit(
    8503298,
    1280,
    853,
    'bread-loaf-chef-cook-food-bakery-8503298',
    'bread, loaf, chef, cook, food, bakery, bake, baking, bread, bread, bread, bread, bread, chef, bakery',
  ),
  hit(
    5116009,
    1280,
    854,
    'cupcakes-chocolate-muffin-food-5116009',
    'cupcakes, chocolate, muffin, food, sweet, baking, delicious, bakery, pastry, icing, frosting, cocoa, simple, white, cupcakes, cupcakes, cupcakes, cupcakes, cupcakes, chocolate',
  ),
  hit(
    1971552,
    1280,
    871,
    'cake-piece-plate-dessert-pastry-1971552',
    'cake, piece, plate, dessert, pastry, sweet, chocolate, cake slice, piece of cake, confectionery, bake, food, delicious, sweets, calories, eat, food photography, cake, cake, cake',
  ),
  hit(
    3216243,
    1280,
    853,
    'cookie-biscuit-round-sweet-snack-3216243',
    'cookie, biscuit, round, sweet, snack, carbohydrate, sugar, bakery, unhealthy, baked, treat, smile, jolly jammers tm, fattening, cookie, cookie, cookie, cookie, cookie, biscuit',
  ),
  hit(
    380178,
    1280,
    851,
    'cupcakes-candles-birthday-380178',
    'cupcakes, candles, candlelight, birthday candles, bithday celebration, bithday party, birthday cake, cake, party, happy birthday, celebrate, flame',
  ),
  hit(
    2918172,
    1280,
    875,
    'christmas-cookies-xmas-christmas-2918172',
    'christmas cookies, xmas, christmas, gingerbread, decoration, food, sweets, dessert, yummy, festive, celebrate, delicious, holiday, cookies, christmas cookies, christmas cookies, christmas, christmas, christmas, christmas',
  ),
  hit(
    1281053,
    1280,
    857,
    'bread-baked-food-freshly-baked-1281053',
    'bread, baked, food, freshly baked, artisan bread, dough, homemade, homemade bread, carbohydrates, eat, food photography, bread, bread, bread, bread, bread',
  ),
  hit(
    1868573,
    1280,
    853,
    'doughnuts-desserts-pastries-treats-1868573',
    'doughnuts, desserts, pastries, treats, sweets, pastry shop, dessert shop, assorted, assortment, display, shop, store, baked goods, bake shop, baked, bakery, buffet, chocolate, confectionery, delicious',
  ),
  hit(
    3641851,
    1280,
    936,
    'plums-crumble-cake-pastry-3641851',
    'plums, crumble cake, pastry, streuselkuchen, food, sweet, pie, cake, fruit cake, plum cake, sweet dish, fruits, baked, baked goods, fruity, delicious, tasty, closeup, pie, pie',
  ),
  hit(
    399286,
    1280,
    853,
    'bread-food-baked-artisan-breads-399286',
    'bread, food, baked, artisan breads, homemade bread, freshly baked, carbohydrates, dough, baked goods, fresh, tasty, eat, food photography, bread, bread, bread, bread, bread',
  ),
  hit(
    1283821,
    1280,
    764,
    'cupcakes-fruits-dessert-food-1283821',
    'cupcakes, fruits, dessert, food, pastry, cakes, berry, sweet, delicious, baked, bakery, cupcakes, dessert, dessert, dessert, dessert, food, pastry, cakes, cakes',
  ),
  hit(
    599521,
    1280,
    853,
    'bake-butter-flour-pile-599521',
    'bake, butter, flour, pile, food preparation, baking, dough, sweets, pastries, sugar, flour, flour, flour, flour, flour, baking, baking, baking, sugar, sugar',
  ),
  hit(
    1850628,
    1280,
    852,
    'cupcakes-muffins-marshmallows-icing-1850628',
    'cupcakes, muffins, marshmallows, icing, frosting, pastries, desserts, sweets, plate, treats, baked, homemade, homemade cupcakes, baked goods, baking, delicious, food, food photography, cupcakes, cupcakes',
  ),
  hit(
    1850011,
    1280,
    854,
    'cake-chocolate-chocolate-cake-1850011',
    'cake, chocolate, chocolate cake, sliced cake, cake slice, dessert, sweet, food, eat, food photography, delicious, indulgence, pastry, plate, sinful cake, slice, cake, cake, cake, cake',
  ),
  hit(
    7445434,
    1280,
    865,
    'loaf-evening-bread-bread-crust-7445434',
    'loaf, evening bread, bread, crust, breakfast, abendbrot, grain bread, sesame seeds, bread, bread, bread, bread, bread',
  ),
  hit(
    943245,
    1280,
    837,
    'new-year-background-dough-cook-943245',
    'new year background, dough, cook, recipe, italian, flour, kitchen, preparation, white, ingredient, bakery, homemade, preparing, cuisine, pastry, bread, baking, pizza, traditional',
  ),
  hit(
    3257019,
    1280,
    853,
    'cakes-dessert-sugar-muffin-cupcake-3257019',
    'cakes, dessert, sugar, muffin, cupcake, sweets, sprinkles, bakery, pink, meal, cakes, cakes, cakes, cakes, sugar, sugar, cupcake, cupcake, cupcake, bakery',
  ),
  hit(
    1868925,
    1280,
    948,
    'bakery-breads-assorted-assortment-1868925',
    'bakery, breads, assorted, assortment, bread shop, food, pastries, shop, store, freshly baked, bakery, bakery, bakery, bakery, bakery, shop',
  ),
  hit(
    821503,
    1280,
    853,
    'bread-baking-fresh-home-made-food-821503',
    'bread, baking, fresh, home made, food, bakery, healthy, flour, traditional, cuisine, homemade, loaf, eating, bread, bread, bread, bread, bread, baking',
  ),
  hit(
    2285209,
    1280,
    853,
    'cupcakes-muffins-dessert-food-cake-2285209',
    'cupcakes, muffins, dessert, food, cake, sweet, frosting, icing, cupcakes, cupcakes, cake, cake, cake, cake, cake',
  ),
  hit(
    9865309,
    1280,
    791,
    'sourdough-bread-food-homemade-9865309',
    'sourdough, bread, food, homemade, baking, fresh, baked, wheat, traditional, crust',
  ),
  hit(
    4840960,
    1280,
    853,
    'baker-bread-bake-nutrition-bakery-4840960',
    'baker, bread, bake, nutrition, bakery, fresh, homemade, food, craftsmen, flour, baked, delicious, baker, baker, baker, baker, bread, bread, bread, bakery',
  ),
  hit(
    9424463,
    1280,
    853,
    'bun-food-fresh-bakery-9424463',
    'bun, food, fresh, bakery, carbohydrates, to bake, dough, homemade, meal, yummy, nourishment, close up',
  ),
  hit(
    2436370,
    1280,
    853,
    'loaf-bakery-preparation-fresh-bread-2436370',
    'loaf, bakery, preparation, fresh bread, baker, meal, nourishment, baguette, dough, flour, craft, authentic, rye bread, wheat bread, to bake, biological, bakery, baguette, baguette, baguette',
  ),
  hit(
    2193537,
    1280,
    853,
    'bread-loaves-crust-freshly-baked-2193537',
    'bread, loaves, crust, freshly baked, bakery, bread crust, crispy, fresh, food, baked goods, homemade, baked bread, baked, flour, bread, bread, bread, bread, bread',
  ),
  hit(
    2178371,
    1280,
    853,
    'macaroons-dessert-sweets-snacks-2178371',
    'macaroons, dessert, sweets, snacks, colors, food, dessert, dessert, dessert, dessert, dessert, sweets, food',
  ),
  hit(
    8128550,
    1280,
    921,
    'bread-loaves-food-bakery-craft-8128550',
    'bread, loaves, food, bakery, craft, shelf, bread, bread, bread, bread, bread, bakery, bakery',
  ),
  hit(
    6562091,
    1280,
    853,
    'croissant-bread-pastry-breakfast-6562091',
    'croissant, bread, pastry, breakfast, raspberry, dish, berry, croissant, croissant, croissant, croissant, bread, breakfast, breakfast, breakfast, breakfast, breakfast',
  ),
  hit(
    279523,
    1280,
    763,
    'cupcake-cake-sweets-sugar-carrot-279523',
    'cupcake, cake, sweets, sugar, carrot, creme, candy, dough, dessert, brown, pastry, cupcake, cupcake, cake, cake, cake, cake, cake',
  ),
  hit(
    1869969,
    1280,
    851,
    'book-diary-notes-notepad-paper-1869969',
    'book, diary, notes, notepad, paper, still life, write, blank pages, open notebook, journal, notebook, empty pages, pages, book, book, book, book, book, diary, paper',
  ),
  hit(
    1868181,
    1280,
    853,
    'desserts-pastries-shop-pastry-shop-1868181',
    'desserts, pastries, shop, pastry shop, food, bakeshop, bakery, store, sweets, macaroons, pralines, chocolate candy, confections, bakery, bakery, bakery, bakery, bakery',
  ),
]
