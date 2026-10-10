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
 * PIXABAY'S RECORDED ANSWERS (AGL-3660): what production's
 * `stockPhotoSearches` cache held for the searches the live starts of
 * 2026-10-10 sent — Juniper Clay Works (a ceramic artist's portfolio, job
 * rZk7bW00Rh) and Willow Wick Candles (a candle store, job MtlXWjvt9P) —
 * read back from the cache, never searched again. Ids, sizes, page slugs and
 * tags are Pixabay's own, in its order; the contributor is left out.
 *
 * What each start placed from them:
 * - "Speckled serving bowl" ← 634413, a robin (its last tag "food bowl").
 * - "Tall bud vase" ← 5348922, a lilac branch ("bud", "vase").
 * - "Nesting bowl set" ← 705667, letterpress type ("set").
 * - The hero ← 3684376, a paper mockup with a blank panel ("portfolio").
 * - "Candle Gift Set" ← 2735387, an antique tea set ("brown candle", "tea set").
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
    pageUrl: `https://pixabay.com/photos/${slug}`,
    photographer: 'A Pixabay contributor',
    tags: tags.split(', '),
    downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
  }) as StockPhoto

/** `serving bowl portfolio` (horizontal, min_width 900), answered 2026-10-10T04:31:50.394Z. */
export const SERVING_BOWL_PORTFOLIO: StockPhoto[] = [
  hit(
    3856050,
    1280,
    854,
    'indian-food-indian-kitchen-meal-3856050/',
    'indian food, indian kitchen, meal, cooking, spice, taste, gate of india, indian restaurant, brown kitchen, brown cooking, brown restaurant, indian food, indian food, indian food, indian food, indian food',
  ),
  hit(
    1844894,
    1280,
    880,
    'bowl-breakfast-fruits-healthy-food-1844894/',
    'bowl, breakfast, fruits, healthy, food, breakfast bowl, healthy breakfast, fruit bowl, fresh fruits, avocado, bread, orange, rustic, wooden table, flat lay, composition, breakfast, breakfast, breakfast, breakfast',
  ),
  hit(
    2580200,
    1280,
    857,
    'food-mexican-tacos-mexican-food-2580200/',
    'food, mexican, tacos, mexican food, spicy, meal, tortilla, chips, spice, snack, mexico, salsa, taco, pepper, yellow, tacos, tacos, tacos, mexican food, mexican food',
  ),
  hit(
    1248955,
    1280,
    853,
    'top-view-basil-herbs-bowl-closeup-1248955/',
    'top view, basil, herbs, bowl, closeup, healthy eating, vegetables, green, nature, leaves, food, ingredients',
  ),
  hit(
    1522680,
    1280,
    854,
    'peaches-fruits-bowl-fruit-bowl-1522680/',
    'peaches, fruits, bowl, fruit bowl, fresh, harvest, produce, organic, sweet, healthy, delicious, eat, food, agriculture, peaches, peaches, peaches, peaches, peaches, fruits',
  ),
  hit(
    2906457,
    1280,
    853,
    'apples-red-bowl-still-life-fruits-2906457/',
    'apples, red, bowl, still life, fruits, natural, healthy, decoration, centerpiece, flower vase, fresh apples, ripe, ripe apples, fruit bowl, organic, fresh, produce, apples, apples, apples',
  ),
  hit(
    634413,
    1280,
    854,
    'robin-bird-songbird-garden-winter-634413/',
    'robin, bird, songbird, garden, nature, winter, food bowl',
  ),
  hit(
    1600003,
    1280,
    866,
    'bowl-of-fruit-shell-fruit-healthy-1600003/',
    'bowl of fruit, shell, nature, fruit, healthy, food, summer',
  ),
  hit(
    765757,
    1280,
    774,
    'blossoms-flower-bowl-wood-tender-765757/',
    'blossoms, flower bowl, wood, tender, decoration, porcelain, lilac, knapweed, tender, lilac, lilac, lilac, lilac, lilac',
  ),
  hit(
    1158755,
    1280,
    984,
    'oatmeal-coconut-breakfast-healthy-1158755/',
    'oatmeal, coconut, breakfast, healthy, cereal, blue healthy, blue breakfast, oatmeal, oatmeal, oatmeal, oatmeal, oatmeal',
  ),
  hit(
    3532396,
    1280,
    1024,
    'dishes-vintage-table-plate-flowers-3532396/',
    'dishes, vintage, table, nature, plate, flowers, decoration, dish, tableware, cups, dishware, flower background, utensil, objects, beautiful flowers, white, bowl, serving, dining, collection',
  ),
  hit(
    715542,
    1280,
    853,
    'food-japanese-asian-bowl-dish-eat-715542/',
    'food, japanese, asian, bowl, dish, eat, chinese, food, food, food, food, food, japanese, bowl, bowl, dish, dish, dish, dish, eat',
  ),
  hit(
    2824826,
    1280,
    853,
    'party-birthday-holiday-fine-wall-2824826/',
    'party, holiday, fine, wall, green, vegetables, meat, sausage, puff pastry, happy birthday, bowl, annual, serving',
  ),
  hit(
    4634314,
    1280,
    854,
    'woman-crowd-soup-the-raval-4634314/',
    'woman, crowd, soup, the raval, barcelona, dinner, raval, festival, people, food, crowd, crowd, crowd, crowd, crowd, soup, barcelona, dinner, dinner',
  ),
  hit(
    1839515,
    1280,
    1024,
    'oatmeal-cereals-strawberries-1839515/',
    'oatmeal, cereals, strawberries, berries, bowl, breakfast, food, fruits, meal, breakfast bowl, healthy breakfast, breakfast meal, fresh strawberries, sliced strawberries, flat lay, food photography, oatmeal, oatmeal, oatmeal, oatmeal',
  ),
  hit(
    4458734,
    1280,
    853,
    'tofu-food-meat-fresh-eat-soup-4458734/',
    'tofu, food, meat, fresh, eat, soup, white, vegetable, soy, delicious, yummy, tofu, tofu, tofu, tofu, tofu',
  ),
  hit(
    5062263,
    1280,
    853,
    'leather-wallet-purse-portfolio-5062263/',
    'leather, wallet, purse, portfolio, cash, accessories, wallet, wallet, wallet, portfolio, portfolio, portfolio, portfolio, portfolio',
  ),
  hit(
    10478905,
    1280,
    853,
    'brazil-acaraj%C3%A9-shrimp-beans-10478905/',
    'brazil, acarajé, shrimp, beans, black-eyed peas, spicy, wooden board, lime, tomato salad, wooden spoon, curry, south american, street food, picnic, exotic, traditional recipe, colorful, fruit, cashew',
  ),
  hit(
    1867427,
    1280,
    1024,
    'bowls-cutlery-food-fruits-honey-1867427/',
    'bowls, cutlery, food, fruits, honey, spoon, table, honey, honey, honey, honey, honey',
  ),
  hit(
    7821415,
    1280,
    853,
    'fish-meal-food-nourishment-7821415/',
    'fish, nature, meal, food, nourishment, enjoy the meal',
  ),
]

/** `nesting bowl set portfolio` (horizontal, min_width 900), answered 2026-10-10T04:32:04.242Z. */
export const NESTING_BOWL_SET_PORTFOLIO: StockPhoto[] = [
  hit(
    8664063,
    1280,
    876,
    'tea-tea-set-tradition-zen-culture-8664063/',
    'tea, 4k wallpaper, free wallpaper, beautiful wallpaper, tea set, tradition, zen, wallpaper 4k, hd wallpaper, 4k wallpaper 1920x1080, desktop backgrounds, culture, peaceful, windows wallpaper, green, background, cool backgrounds, wallpaper hd, full hd wallpaper, laptop wallpaper',
  ),
  hit(
    705667,
    1280,
    850,
    'writing-lead-set-letterpress-705667/',
    'writing, lead set, letterpress, gutenberg, letters, brief, case, typography, high pressure, set of quantities, rows, set, words, language, writing, words, words, words, language, language',
  ),
  hit(
    1844894,
    1280,
    880,
    'bowl-breakfast-fruits-healthy-food-1844894/',
    'bowl, breakfast, fruits, healthy, food, breakfast bowl, healthy breakfast, fruit bowl, fresh fruits, avocado, bread, orange, rustic, wooden table, flat lay, composition, breakfast, breakfast, breakfast, breakfast',
  ),
  hit(
    4002726,
    1280,
    622,
    'table-setting-cutlery-table-deco-4002726/',
    'table setting, cutlery, table deco, table ware, spoon, fork, tableware, elegant, table, plate, cooking, table setting, table setting, cutlery, cutlery, cutlery, fork, tableware, tableware, tableware',
  ),
  hit(
    1248955,
    1280,
    853,
    'top-view-basil-herbs-bowl-closeup-1248955/',
    'top view, basil, herbs, bowl, closeup, healthy eating, vegetables, green, nature, leaves, food, ingredients',
  ),
  hit(
    898073,
    1280,
    853,
    'cereal-breakfast-meal-food-banana-898073/',
    'cereal, breakfast, meal, food, banana, fruit, healthy, nutrition, diet, bowl, table, table setting, tablecloth, closeup, breakfast, breakfast, breakfast, breakfast, breakfast, food',
  ),
  hit(
    1522680,
    1280,
    854,
    'peaches-fruits-bowl-fruit-bowl-1522680/',
    'peaches, fruits, bowl, fruit bowl, fresh, harvest, produce, organic, sweet, healthy, delicious, eat, food, agriculture, peaches, peaches, peaches, peaches, peaches, fruits',
  ),
  hit(
    7040875,
    1280,
    855,
    'salad-fruit-berry-healthy-vitamins-7040875/',
    'salad, fruit, berry, healthy, vitamins, fresh, food, vegetarian, vegan, diet, buffet, salad bowl, bowls, vegetables, table setting, nutrition, salad, salad, food, food',
  ),
  hit(
    2906457,
    1280,
    853,
    'apples-red-bowl-still-life-fruits-2906457/',
    'apples, red, bowl, still life, fruits, natural, healthy, decoration, centerpiece, flower vase, fresh apples, ripe, ripe apples, fruit bowl, organic, fresh, produce, apples, apples, apples',
  ),
  hit(
    1839061,
    1280,
    840,
    'knives-set-chopping-board-slice-1839061/',
    'knives, set, chopping board, slice, sharp, sharpness, blades, knife set, kitchen tools, orange slices, kitchen, kitchen utensils, flat lay, knives, knives, knives, knife set, kitchen tools, kitchen, kitchen',
  ),
  hit(
    1867521,
    1280,
    854,
    'chicken-hen-eggs-poultry-animal-1867521/',
    'chicken, nature, hen, eggs, poultry, animal, barn, bird, farm, livestock, landfowl, farm animal, nest, nesting, chicken eggs',
  ),
  hit(
    634413,
    1280,
    854,
    'robin-bird-songbird-garden-winter-634413/',
    'robin, bird, songbird, garden, nature, winter, food bowl',
  ),
  hit(
    1600003,
    1280,
    866,
    'bowl-of-fruit-shell-fruit-healthy-1600003/',
    'bowl of fruit, shell, nature, fruit, healthy, food, summer',
  ),
  hit(
    235269,
    1280,
    854,
    'singing-bowl-singing-bowls-235269/',
    'singing bowl, singing bowls, singing bowl massage, massage, sound, shell, peel, metal, bronze, brass, gold, meditation, instrument, tibet, tibetan sound bowls, esoteric, therapy, sound bowls set, therapy klangschalenset, health',
  ),
  hit(
    765757,
    1280,
    774,
    'blossoms-flower-bowl-wood-tender-765757/',
    'blossoms, flower bowl, wood, tender, decoration, porcelain, lilac, knapweed, tender, lilac, lilac, lilac, lilac, lilac',
  ),
  hit(
    715542,
    1280,
    853,
    'food-japanese-asian-bowl-dish-eat-715542/',
    'food, japanese, asian, bowl, dish, eat, chinese, food, food, food, food, food, japanese, bowl, bowl, dish, dish, dish, dish, eat',
  ),
  hit(
    1839515,
    1280,
    1024,
    'oatmeal-cereals-strawberries-1839515/',
    'oatmeal, cereals, strawberries, berries, bowl, breakfast, food, fruits, meal, breakfast bowl, healthy breakfast, breakfast meal, fresh strawberries, sliced strawberries, flat lay, food photography, oatmeal, oatmeal, oatmeal, oatmeal',
  ),
  hit(
    5062263,
    1280,
    853,
    'leather-wallet-purse-portfolio-5062263/',
    'leather, wallet, purse, portfolio, cash, accessories, wallet, wallet, wallet, portfolio, portfolio, portfolio, portfolio, portfolio',
  ),
  hit(
    3532396,
    1280,
    1024,
    'dishes-vintage-table-plate-flowers-3532396/',
    'dishes, vintage, table, nature, plate, flowers, decoration, dish, tableware, cups, dishware, flower background, utensil, objects, beautiful flowers, white, bowl, serving, dining, collection',
  ),
  hit(
    235266,
    1280,
    853,
    'singing-bowl-singing-bowls-235266/',
    'singing bowl, singing bowls, singing bowl massage, massage, sound, shell, peel, metal, bronze, brass, gold, meditation, instrument, tibet, tibetan sound bowls, esoteric, therapy, sound bowls set, therapy klangschalenset, health',
  ),
]

/** `tall bud vase portfolio` (vertical, min_height 900), answered 2026-10-10T04:31:59.394Z. */
export const TALL_BUD_VASE_PORTFOLIO: StockPhoto[] = [
  hit(
    1838553,
    853,
    1280,
    'vase-flowers-window-1838553/',
    'vase, nature, beautiful flowers, flowers, flower wallpaper, window, flower background, floral arrangement, flower arrangement, blossom, bloom, bouquet, decoration, flora',
  ),
  hit(
    10211596,
    853,
    1280,
    'ceramic-vase-woman-brown-jacket-10211596/',
    'ceramic vase, woman, brown jacket, floral decoration, earth tone background, contemplative, rose, use of light and shadow, modern interior, clothing details, art and culture, beauty, portrait, aesthetics, sculptural art style, luxury decoration, rose flower, intense colors, interior design, artistic',
  ),
  hit(
    5109481,
    928,
    1280,
    'vase-still-life-bouquet-5109481/',
    'vase, still life, bouquet, white flowers, black background, cherry blossom, flower vase, beauty, bloom, petals, black life, black beauty, iphone wallpaper, flower wallpaper, vase, vase, still life, still life, still life, still life',
  ),
  hit(
    5348922,
    854,
    1280,
    'plugged-nature-branches-sheets-bud-5348922/',
    'plugged, nature, branches, sheets, bud, environment, vase',
  ),
  hit(
    1914124,
    872,
    1280,
    'lilacs-bouquet-vase-flowers-1914124/',
    'lilacs, bouquet, flower background, nature, vase, flowers, flower vase, centerpiece, purple flowers, bloom, blossom, flora, beautiful flowers, flower wallpaper, happy mothers day, plants, rustic, still life',
  ),
  hit(
    646637,
    853,
    1280,
    'flowers-vase-daisies-white-flowers-646637/',
    'flowers, vase, nature, daisies, white flowers, white daisies, flower wallpaper, flower background, bunch of flowers, floral, still life, flower vase, beautiful flowers, close up',
  ),
  hit(
    687147,
    853,
    1280,
    'cup-bowls-vase-ceramics-old-687147/',
    'cup, bowls, vase, ceramics, old, antique, ancient, dishes, vase, vase, vase, vase, vase, ceramics, ceramics, dishes',
  ),
  hit(
    9192241,
    935,
    1280,
    'building-tower-tall-skyscraper-9192241/',
    'building, tower, tall, skyscraper, modern, glass, sky, lamp, urban, metropolis, offices, nature, perspective',
  ),
  hit(
    7523304,
    853,
    1280,
    'ornamental-plant-blossom-bloom-bud-7523304/',
    'ornamental plant, blossom, bloom, bud, blossom, blossom, blossom, bloom, bloom, bloom, bloom, bloom, bud',
  ),
  hit(
    8765477,
    853,
    1280,
    'tulip-home-vase-pocketbook-pink-8765477/',
    'tulip, flower background, nature, home, vase, flower wallpaper, pocketbook, pink, beautiful flowers, flower',
  ),
  hit(
    8378041,
    851,
    1280,
    'apple-flowers-vase-still-life-8378041/',
    'apple, flowers, flower background, beautiful flowers, vase, flower wallpaper, nature, still life, window',
  ),
  hit(
    10285907,
    853,
    1280,
    'forest-sequoia-trees-tall-trees-10285907/',
    'forest, sequoia, trees, tall trees, nature, plantation, californian, dark forest, mystical, atmospheric, mood, victoria, australia, forest floor, cool, ecosystem, travel, hiking, fresh air',
  ),
  hit(
    1715054,
    919,
    1280,
    'tulip-bouquet-tulips-1715054/',
    'tulip bouquet, beautiful flowers, tulips, bunch of flowers, vase, flower vase, decoration, still life, chair, flower wallpaper, wooden chair, flower, decorative, interior design, nature, vintage, antique, grunge, yellow tulips, texture',
  ),
  hit(
    8579641,
    854,
    1280,
    'plum-blossoms-flowers-flower-vase-8579641/',
    'plum blossoms, flower background, flowers, flower vase, beautiful flowers, decorate, flower wallpaper, nature, ornament, chinese style',
  ),
  hit(
    9340309,
    960,
    1280,
    'building-skyscraper-9340309/',
    'building, skyscraper, chrysler building, architecture, city, new york, black and white',
  ),
  hit(
    4726196,
    852,
    1280,
    'waterfall-oregon-nature-4726196/',
    'waterfall, oregon, nature, waterfall, waterfall, waterfall, waterfall, waterfall, oregon',
  ),
  hit(
    378903,
    802,
    1280,
    'books-bookcase-old-books-historical-378903/',
    'books, bookcase, old books, historical, antique, felbrigg hall, norfolk, brown book, brown books, brown old, books, books, books, books, books, bookcase, old books',
  ),
  hit(
    8047856,
    853,
    1280,
    'giraffes-herd-safari-namibia-8047856/',
    'giraffes, herd, safari, nature, namibia, south africa, africa, savannah, forest, wildlife',
  ),
  hit(
    6656672,
    960,
    1280,
    'forest-path-fog-nature-trees-6656672/',
    'forest, path, fog, nature, trees, trail, landscape, woods, trunks, fall, autumn, forest, forest, forest, nature, nature, nature, nature, nature, landscape',
  ),
  hit(
    7313398,
    853,
    1280,
    'poppies-red-poppies-red-flowers-7313398/',
    'poppies, flower wallpaper, red poppies, red flowers, meadow, grass, beautiful flowers, flowers, nature, flower background, flora',
  ),
]

/** `portfolio` (horizontal, min_width 1600), answered 2026-10-10T04:31:45.186Z. */
export const PORTFOLIO: StockPhoto[] = [
  hit(
    5062263,
    1280,
    853,
    'leather-wallet-purse-portfolio-5062263/',
    'leather, wallet, purse, portfolio, cash, accessories, wallet, wallet, wallet, portfolio, portfolio, portfolio, portfolio, portfolio',
  ),
  hit(
    3611078,
    1280,
    854,
    'model-yellow-background-pose-3611078/',
    'model, yellow background, pose, portfolio, yellow model, portfolio, portfolio, portfolio, portfolio, portfolio',
  ),
  hit(
    7046626,
    1280,
    853,
    'fashion-model-model-portrait-woman-7046626/',
    'fashion model, model, portrait, woman, photoshoot, female model, model portfolio, headshot, beautiful, headshot, headshot, headshot, headshot, headshot',
  ),
  hit(
    4926565,
    1280,
    819,
    'portfolio-sun-nature-beach-ocean-4926565/',
    'portfolio, sun, nature, beach, ocean, island, sunset, horizon, shades, fashion, woman, summer, sky, portfolio, portfolio, portfolio, portfolio, portfolio',
  ),
  hit(
    3150729,
    1280,
    848,
    'clipboard-blank-empty-show-3150729/',
    'clipboard, blank, empty, show, business, paper, isolated, white, design, office, sheet, template, message, space, mockup, stationery, mock, clip, mock-up, branding',
  ),
  hit(
    4038013,
    1280,
    960,
    'iphone-x-iphone-x-mobile-4038013/',
    'iphone x, iphone, x, mobile, technology, phone, display, design, smartphone, apps, screen, communication, electronic, device, apple, ios, photo app, photo, app, settings',
  ),
  hit(
    4151027,
    1280,
    846,
    'vacation-ocean-beach-sea-summer-4151027/',
    'vacation, ocean, beach, sea, summer, sand, nature, tropical, island, sunrise, boat, relaxation, landscape, relax, sky, sun, sunset, horizon, portfolio, portfolio',
  ),
  hit(
    3684376,
    1280,
    1192,
    'mockup-paint-flatlay-paper-picture-3684376/',
    'mockup, paint, flatlay, paper, picture, portfolio, table, painting, creative, artwork, desk, blank, business, layout, marketing, ecommerce, sheet, digital, drawing, blog',
  ),
  hit(
    3681541,
    1280,
    1280,
    'flatlay-plant-ecommerce-mockup-3681541/',
    'flatlay, plant, ecommerce, mockup, blank, paper, marketing, business, succulent, sheet, desk, table, white sheet, portfolio, shop, drawing, painting, layout, digital art, digital',
  ),
  hit(
    908569,
    1280,
    853,
    'wallet-credit-cards-cash-money-908569/',
    'wallet, credit cards, cash, money, payment, shopping, currency, paying, plastic, banking, transaction, commerce, finance, financial, purse, wealth, poverty, poor, rich, leather',
  ),
  hit(
    3683817,
    1280,
    853,
    'marble-paperclip-mockup-flatlay-3683817/',
    'marble, paperclip, mockup, flatlay, plant, ecommerce, scissors, blank, paper, marketing, business, succulent, sheet, desk, table, white sheet, portfolio, shop, drawing, painting',
  ),
  hit(
    3681646,
    1280,
    1280,
    'frame-mockup-flatlay-plant-3681646/',
    'frame, mockup, flatlay, plant, ecommerce, blank, paper, marketing, business, succulent, sheet, desk, table, white sheet, portfolio, shop, drawing, painting, layout, digital art',
  ),
  hit(
    3726428,
    1280,
    960,
    'cv-resume-job-employment-business-3726428/',
    'cv, resume, job, employment, business, recruitment, career, hr, work, employee, experience, application, document, interview, employer, portfolio, cirriculum, vitae, james, bond',
  ),
  hit(
    3682164,
    1280,
    1280,
    'rose-petals-mockup-ecommerce-paper-3682164/',
    'rose petals, flower wallpaper, mockup, ecommerce, paper, blank, flatlay, marketing, business, flower, paperclip, sheet, beautiful flowers, desk, table, white sheet, portfolio, marker, drawing, painting',
  ),
  hit(
    3683818,
    1280,
    853,
    'marble-mockup-flatlay-ecommerce-3683818/',
    'marble, mockup, flatlay, ecommerce, blank, paper, marketing, business, granite, sheet, desk, table, white sheet, portfolio, shop, drawing, painting, layout, digital art, digital',
  ),
  hit(
    3683822,
    1280,
    853,
    'marble-frame-mockup-flatlay-plant-3683822/',
    'marble, frame, mockup, flatlay, plant, ecommerce, blank, paper, marketing, business, succulent, desk, table, white sheet, portfolio, shop, drawing, painting, layout, digital art',
  ),
  hit(
    5183941,
    1280,
    853,
    'iphone-stocks-market-shares-crash-5183941/',
    'iphone, stocks, market, shares, crash, recession, depression, finance, 8plus, trading, nasdaq, apple, dow, option, put, call, economy, tech, bubble, gray tech',
  ),
  hit(
    4637459,
    1280,
    844,
    'sketchbook-pencil-pink-portfolio-4637459/',
    'sketchbook, pencil, pink, portfolio, creative, design, paper, creativity, drawing, pen, sketch, notebook, work, handmade, mockup, book, artist, picture, modern, cactus',
  ),
  hit(
    3840437,
    1280,
    961,
    'shelf-shop-fittings-stock-3840437/',
    'shelf, shop fittings, stock, winkelaanbieding, shops, display, grocery store, commercial break, presentation, product, energy drink, mixed drinks, drink, drinks, drinking, portfolio of brands, comprising, foodstuffs, grocery store, energy drink',
  ),
  hit(
    4419451,
    1280,
    853,
    'lavender-yard-flowers-meadow-4419451/',
    'lavender, yard, flowers, beautiful flowers, meadow, spring, landscape, flower background, portrait, portfolio, flower wallpaper, nature, woman, beauty, purple, guatemala, antigua guatemala',
  ),
]

/** `candle gift set online` (vertical, min_height 900), answered 2026-10-10T04:18:45.927Z. */
export const CANDLE_GIFT_SET_ONLINE: StockPhoto[] = [
  hit(
    6805045,
    853,
    1280,
    'christmas-christmas-decoration-6805045/',
    'christmas, christmas decoration, christmas background, holiday, happychristmas, iphone wallpaper, christmas, christmas, christmas, christmas, christmas, christmas background, christmas background, christmas background, christmas background, christmas background',
  ),
  hit(
    2692556,
    937,
    1280,
    'tea-light-light-worships-2692556/',
    'tea light, light, worships, candlelight, flame, meditation, prayer, candle, contemplative, memorial candle, ecclesiastical, shining, memorial lights, sacrificial candle, sacrificial light, reflection, warmth, burn, grief, seem',
  ),
  hit(
    2735387,
    850,
    1280,
    'vintage-tea-set-tea-set-tea-cup-2735387/',
    'vintage tea set, tea set, tea cup, candelabra, candle holder, tea, vintage, cup, retro, collection, antique, brown tea, brown candle, brown candles, tea set, tea cup, tea cup, tea cup, tea cup, tea cup',
  ),
  hit(
    4222263,
    868,
    1280,
    'table-candle-decoration-interior-4222263/',
    'table, candle, decoration, interior, romantic, celebration, candlestick, candlelight, living room, table, table, table, candle, candle, candle, candle, candle, living room, living room, living room',
  ),
  hit(
    4943215,
    854,
    1280,
    'candles-gift-scented-4943215/',
    'candles, gift, scented',
  ),
  hit(
    397965,
    809,
    1280,
    'candle-candle-wax-candlelight-397965/',
    'candle, candle wax, candlelight, candlestick, flame, wax, illuminated, fire, burning, romantic, candle, candle, candle, candle, candle, candle wax, candlestick, wax',
  ),
  hit(
    8429720,
    853,
    1280,
    'christmas-gift-decoration-holiday-8429720/',
    'christmas, gift, decoration, holiday, xmas, box, ball, tree, nature, celebration, present, ornament, ribbon, bow, winter, decor, candle, season, bauble',
  ),
  hit(
    6849672,
    962,
    1280,
    'christmas-decoration-xmas-holiday-6849672/',
    'christmas, decoration, xmas, holiday, tea cup, coffee cup, gift, cup, coffee, tea, candle, lantern',
  ),
  hit(
    2798983,
    853,
    1280,
    'atmosphere-christmas-when-2798983/',
    'atmosphere, christmas, when, candle light, gift, christmas box, six',
  ),
  hit(
    4597415,
    853,
    1280,
    'camera-book-candle-read-cozy-bed-4597415/',
    'camera, book, candle, read, cozy, bed, lamp, bokeh, light, home, comfort, reading, cold, camera, book, book, book, candle, candle, candle',
  ),
  hit(
    2099740,
    852,
    1280,
    'wedding-gift-lantern-wedding-2099740/',
    'wedding gift, lantern, happy birthday, wedding, celebration, candle, bomboniere, party, celebrate',
  ),
  hit(
    1082511,
    1024,
    1280,
    'winter-wonderland-red-snow-cold-1082511/',
    'winter wonderland, red, snow, cold, season, christmas, white, snowflake, little girl, nature, december, holiday, winter',
  ),
  hit(
    5850280,
    853,
    1280,
    'candle-christmas-candle-advent-5850280/',
    'candle, christmas candle, advent, advent candle, candlelight, flame, christmas decoration, christmas decor, decoration, decor, closeup, candle, candle, candle, candle, candle, christmas candle, christmas candle, christmas candle, advent',
  ),
  hit(
    546932,
    1266,
    1280,
    'ribbon-red-christmas-decoration-546932/',
    'ribbon, red, christmas, decoration, gift, gift ribbon, loop, ribbon, ribbon, ribbon, ribbon, ribbon',
  ),
  hit(
    9874140,
    853,
    1280,
    'candles-candlelight-tea-lights-9874140/',
    'candles, candlelight, tea lights, church, prayer, faith, religion, light, burn, all saints, advent',
  ),
  hit(
    7868140,
    850,
    1280,
    'set-table-cover-cutlery-plate-meal-7868140/',
    'set table, cover, cutlery, plate, meal, table, dinner, lunch, cover, table, dinner, dinner, dinner, dinner, dinner, lunch, lunch',
  ),
  hit(
    8449615,
    853,
    1280,
    'christmas-balls-fir-tree-8449615/',
    'christmas balls, fir tree, fairy lights, deco, christmas, lights, macro',
  ),
  hit(
    4705200,
    960,
    1280,
    'sun-set-nature-bangladesh-4705200/',
    'sun, set, nature, bangladesh, bangladesh, bangladesh, bangladesh, bangladesh, bangladesh',
  ),
  hit(
    2659051,
    853,
    1280,
    'candle-holders-silver-old-candle-2659051/',
    'candle holders, silver, old, candle, holder, christmas, candlestick, candlelight, traditional, brown candle, brown candles, candle holders, silver, candle, candlestick, candlestick, candlestick, candlestick, candlestick',
  ),
  hit(
    6942931,
    853,
    1280,
    'candle-book-read-study-fiction-6942931/',
    'candle, book, read, study, fiction, story, pages, candle, candle, candle, candle, book, study, study, study, study, study, story',
  ),
]
