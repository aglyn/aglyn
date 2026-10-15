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
 * PIXABAY'S RECORDED ANSWERS FOR THE COPPER KETTLE CATERING HERO (AGL-3831):
 * what production's `stockPhotoSearches` cache held for the two searches the
 * beta.257 restaurant site "Copper Kettle Catering" ("Family-run Austin
 * caterer: Texas barbecue and Tex-Mex for weddings, office lunches and
 * parties", job mRxC_v18aH, 2026-10-15) sent for its home hero, read back
 * from the cache, never searched again. Ids, sizes, page slugs and tags are
 * Pixabay's own, in its order; the contributor is left out. Each search was
 * matched to its cache entry by the entry's key.
 *
 * The hero was held to the craft "caterer", and a photo of catering is
 * tagged "catering", "buffet", "bbq": only three hits said "caterer", none
 * first, so nothing was accepted and the starter pottery photo filled the
 * hero under the model's words "A spread of smoked brisket, fajitas and sides
 * on a long catering table".
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

/** `family-run austin caterer` (horizontal, min_width 1600), answered 2026-10-15T18:47:45.010Z. */
export const FAMILY_RUN_AUSTIN_CATERER: StockPhoto[] = [
  hit(
    3860567,
    1280,
    853,
    'austin-healey-car-automobile-3860567',
    'austin healey, car, automobile, vehicle, austin, retro, healey, vintage, chromium, car wallpapers, speed',
  ),
  hit(
    2999867,
    1280,
    853,
    'traffic-automobile-antique-car-2999867',
    'traffic, automobile, car wallpapers, antique car, austin, austin healey, convertible, sports car, headlights, grille, parrot, composing, blue, car, driving a car',
  ),
  hit(
    5276620,
    1280,
    853,
    'old-buda-texas-city-park-entrance-5276620',
    'old buda texas city park entrance, vintage, historical, park, buda, buda texas, atx, texas, central texas, austin, austin texas, city park, texas, central texas, austin texas, austin texas, austin texas, austin texas, austin texas',
  ),
  hit(
    4877118,
    1280,
    853,
    'cypress-tree-roots-nature-texas-4877118',
    'cypress, tree, roots, nature, texas, austin, atx, river, forest, natural, landscape, waterway, cypress, cypress, cypress, cypress, texas, texas, austin, austin',
  ),
  hit(
    4066441,
    1280,
    901,
    'texas-state-capitol-austin-america-4066441',
    'texas state capitol, austin, america, architecture, government, dome, landscape, mood, hdr, landmark, historic, austin, austin, austin, austin, austin',
  ),
  hit(
    3345327,
    1280,
    914,
    'water-nature-river-landscape-lake-3345327',
    'water, nature, river, landscape, lake, bats, austin, reflection, sunset, tranquil, united states, austin, texas',
  ),
  hit(
    5029318,
    1280,
    853,
    'chinese-rose-rose-flower-rose-5029318',
    'chinese rose, rose flower, rose, gold celebration, austin, chinese rose, chinese rose, chinese rose, chinese rose, chinese rose, rose, austin',
  ),
  hit(
    3967304,
    1280,
    852,
    'macaroon-caterer-plateau-food-3967304',
    'macaroon, caterer, plateau, food, cocktail',
  ),
  hit(
    5357325,
    1280,
    854,
    'river-austin-viewing-bats-texas-5357325',
    'river, austin, nature, viewing, bats, texas, water, landscape, bridge',
  ),
  hit(
    4549223,
    1280,
    853,
    'transport-traffic-automobile-4549223',
    'transport, traffic, automobile, sports car, austin, blue, cabriolet, antique car, car wallpapers, car',
  ),
  hit(
    3409985,
    1280,
    853,
    'texas-art-wall-street-art-urban-3409985',
    'texas, art, wall, street art, urban, austin, blue art, blue wall, blue street, austin, austin, austin, austin, austin',
  ),
  hit(
    4699178,
    1280,
    960,
    'austin-healey-car-classic-sport-4699178',
    'austin healey, car, classic, sport, car wallpapers, coupe, austin healey 3000, motot, calender, hood, detail, design, red',
  ),
  hit(
    7933399,
    1280,
    670,
    'austin-texas-river-buildings-city-7933399',
    'austin, texas, river, buildings, city, urban, cityscape, travel, architecture, usa, nature, spring, austin, austin, austin, austin, austin',
  ),
  hit(
    1566254,
    1280,
    848,
    'table-wedding-table-covered-wedding-1566254',
    'table, wedding table, covered, wedding, event, knives, fork, napkin, butterfly, restaurant, caterer, decoration, table decoration, wedding decoration, reception',
  ),
  hit(
    173907,
    1280,
    960,
    'austin-texas-architecture-skyline-173907',
    'austin, texas, architecture, skyline, city, cityscape, tower, skyscraper, building, landmark, urban, scenic, scenery, downtown, metropolis, buildings, metropolitan, austin, austin, austin',
  ),
  hit(
    4064427,
    1280,
    853,
    'austin-texas-bridge-bats-sunset-4064427',
    'austin, texas, bridge, bats, sunset, river, lake, downtown, nature, cityscape, tx, sky',
  ),
  hit(
    3178752,
    1280,
    851,
    'architecture-city-skyline-3178752',
    'architecture, city, nature, skyline, skyscraper, cityscape, austin, texas, lake, blue, buildings, reflections, panorama, downtown, tourism',
  ),
  hit(
    4874473,
    1280,
    853,
    'windmill-water-tanks-ranch-rural-4874473',
    'windmill, water tanks, ranch, rural, farm, old windmill, water storage, meadow, landscape, countryside, austin, texas, old windmill, water storage, water storage, texas, texas, texas, texas, texas',
  ),
  hit(
    3468795,
    1280,
    847,
    'austin-texas-tx-bridge-lake-3468795',
    'austin, texas, nature, tx, bridge, lake, skyline, city, lady bird lake, congress avenue bridge',
  ),
  hit(
    4874396,
    1280,
    853,
    'texas-scenic-landscape-countryside-4874396',
    'texas, scenic, landscape, countryside, shed, cactus, country, outdoors, rural, travel, austin, tx',
  ),
  hit(
    4822547,
    1280,
    757,
    'flower-yellow-rose-david-austin-4822547',
    'flower, yellow, rose, flower background, david austin, flower wallpaper, beautiful flowers, greeting card, decoration, rose flower, cut out, isolated, garden, nature',
  ),
  hit(
    4357790,
    1280,
    857,
    'shepherd-dog-dog-domestic-animal-4357790',
    'shepherd dog, nature, dog, domestic animal, animal, dog puppy, baby dog, young and old, pet, old german shepherd dog, puppy',
  ),
  hit(
    4681969,
    1280,
    853,
    'cars-malta-classic-cars-vintage-4681969',
    'cars, malta, classic cars, vintage, auto, automobile, austin, healey, collectable',
  ),
  hit(
    1461727,
    1280,
    856,
    'automobile-flower-car-planted-car-1461727',
    'automobile, flower car, beautiful flowers, planted car, flower wallpaper, planted, red, flower, flower background, deco, nature, red car, austin, austin-mini',
  ),
  hit(
    3545794,
    1280,
    640,
    'traffic-automobile-antique-car-3545794',
    'traffic, automobile, antique car, austin, blue, sports car, animals, peacock, bird, proudly, composing, feathers, vehicle, nature, to travel, luxury',
  ),
  hit(
    5313570,
    1280,
    853,
    'nature-flower-blossoms-roses-5313570',
    'nature, flower, blossoms, flower background, roses, english rose, flower wallpaper, beautiful flowers, austin rose, garden roses',
  ),
  hit(
    6885081,
    1280,
    854,
    'knives-cutlery-kitchen-cooking-6885081',
    'knives, cutlery, kitchen, cooking, tools, fork, silver, caterer, chop, ladle, metal, cut, kettle, spoon, baking, sharp, knives, knives, knives, knives',
  ),
  hit(
    3345330,
    1280,
    960,
    'water-lake-river-tree-landscape-3345330',
    'water, lake, river, tree, landscape, austin, ladybird, dam, sky, nature, scenery, united states, austin, texas',
  ),
  hit(
    1756159,
    1280,
    853,
    'austin-texas-austin-tx-texas-1756159',
    'austin texas, austin, tx, texas, cityscape, downtown, skyline, urban, america, usa, corporate, austin texas, austin texas, austin texas, austin texas, austin, austin, austin, austin, austin',
  ),
  hit(
    931131,
    1280,
    853,
    'sisters-girls-field-running-931131',
    'sisters, girls, field, running, playing, play, children, childhood, nature, sisterhood, summer, fun, children playing, siblings, young, happy, happiness, outdoors',
  ),
  hit(
    5756718,
    1280,
    719,
    'buildings-lake-city-skyline-5756718',
    'buildings, lake, city, skyline, skyscrapers, nature, downtown, urban, cityscape, austin, texas, usa, aerial view',
  ),
  hit(
    3255280,
    1280,
    1002,
    'rose-red-david-austin-plant-garden-3255280',
    'rose, rose flower, red, david austin, plant, garden, nature, isolated, cut out',
  ),
  hit(
    3176081,
    1280,
    851,
    'architecture-city-water-reflection-3176081',
    'architecture, nature, city, water, reflection, sky, austin, texas, lake, downtown, river, sunlight, scenic, forest, landscape, travel',
  ),
  hit(
    4477874,
    1280,
    853,
    'family-game-fun-outdoors-playing-4477874',
    'family, game, fun, outdoors, playing, family, family, family, family, family',
  ),
  hit(
    4059507,
    1280,
    541,
    'texas-history-museum-education-4059507',
    'texas history museum, education, attractions, tourism, landscape, austin, texas, panorama, building, sky, clouds, nature, trees, hdr, mood, landmark, america',
  ),
  hit(
    5739040,
    1280,
    853,
    'pat-austin-rose-flower-petals-bloom-5739040',
    'pat austin rose, flower, petals, flower wallpaper, flower background, beautiful flowers, bloom, nature, blossom, plant, flora, closeup',
  ),
  hit(
    4686574,
    1280,
    960,
    'car-coupe-vintage-ancient-4686574',
    'car, car wallpapers, coupe, vintage, ancient, austin-healey 3000, wheel, radio, detail',
  ),
  hit(
    5301421,
    1280,
    887,
    'roses-nature-flower-english-roses-5301421',
    'roses, nature, flower, english roses, romance, garden, close up, flower wallpaper, blossoms, rose blossom, austin rose, romantic, flower background, beautiful flowers, fragrance',
  ),
  hit(
    3468800,
    1280,
    863,
    'austin-texas-tx-city-skyline-3468800',
    'austin, texas, nature, tx, city, skyline, buildings, bridge, lake, lady bird lake, congress avenue bridge, blue bridge, blue lady',
  ),
  hit(
    210403,
    1280,
    960,
    'catering-airport-plane-ever-entry-210403',
    'catering, airport, plane, ever, entry, hull, aviation, air traffic, vacations, arrival, rear, charge, meal, food, nourishment, enjoy the meal, airfield, dusseldorf, airport düsseldorf, catering',
  ),
]
/** `caterer` (horizontal, min_width 1600), answered 2026-10-15T18:47:45.261Z. */
export const CATERER: StockPhoto[] = [
  hit(
    3967304,
    1280,
    852,
    'macaroon-caterer-plateau-food-3967304',
    'macaroon, caterer, plateau, food, cocktail',
  ),
  hit(
    1566254,
    1280,
    848,
    'table-wedding-table-covered-wedding-1566254',
    'table, wedding table, covered, wedding, event, knives, fork, napkin, butterfly, restaurant, caterer, decoration, table decoration, wedding decoration, reception',
  ),
  hit(
    6885081,
    1280,
    854,
    'knives-cutlery-kitchen-cooking-6885081',
    'knives, cutlery, kitchen, cooking, tools, fork, silver, caterer, chop, ladle, metal, cut, kettle, spoon, baking, sharp, knives, knives, knives, knives',
  ),
  hit(
    210403,
    1280,
    960,
    'catering-airport-plane-ever-entry-210403',
    'catering, airport, plane, ever, entry, hull, aviation, air traffic, vacations, arrival, rear, charge, meal, food, nourishment, enjoy the meal, airfield, dusseldorf, airport düsseldorf, catering',
  ),
  hit(
    2009590,
    1280,
    854,
    'christmas-wallpaper-platter-food-2009590',
    'christmas wallpaper, platter, food, starters, meal, feast, dining table, table, eat, delicious food, restaurant, dining, cuisine, catering, buffet, flat lay',
  ),
  hit(
    1283608,
    1280,
    853,
    'drinks-alcohol-glasses-champagne-1283608',
    'drinks, alcohol, glasses, champagne, wine, serving trays, alcoholic drinks, beverage, refreshment, catering, wedding, party, event, celebration, alcohol, alcohol, champagne, champagne, champagne, champagne',
  ),
  hit(
    352475,
    1280,
    853,
    'dessert-cupcakes-food-352475',
    'dessert, cupcakes, food, strawberry cupcakes, snacks, sweets, confections, baked goods, pastries, tasty, delicious, cake stand, close up, eat, food photography, dessert, dessert, cupcakes, food, food',
  ),
  hit(
    2175326,
    1280,
    853,
    'hors-doeuvre-starters-appetizers-2175326',
    "hors d'oeuvre, starters, appetizers, charcuterie, delicatessen, food platter, catering, cheese, salami, smoked beef, tomato, snack, bread, plate, cuisine, protein, antipasto, meat, tasty, platter",
  ),
  hit(
    5582984,
    1280,
    853,
    'dessert-chocolate-food-sweets-nuts-5582984',
    'dessert, chocolate, food, sweets, nuts, tasty, delicious, dessert buffet, glasses, chocolate, chocolate, chocolate, chocolate, chocolate',
  ),
  hit(
    179046,
    1280,
    852,
    'catering-buffet-food-olives-179046',
    'catering, buffet, food, olives, restaurant, cater, party, table, banquet, decoration, catering, catering, catering, catering, buffet, olives, restaurant, restaurant, restaurant, party',
  ),
  hit(
    176991,
    1280,
    1024,
    'wine-glasses-stemware-crystal-party-176991',
    'wine glasses, stemware, crystal, party, glasses, elegant, restaurant, blue wine, blue restaurant, blue party, blue glass, blue glasses, party, party, restaurant, restaurant, restaurant, restaurant, restaurant',
  ),
  hit(
    594496,
    1280,
    806,
    'chunks-to-dish-out-menu-gastronomy-594496',
    'chunks, to dish out, menu, gastronomy, gourmet, meal, greetings from the kitchen, amuse gueule, menu, menu, menu, menu, menu, gastronomy, gastronomy, gastronomy, gourmet, gourmet, gourmet, gourmet',
  ),
  hit(
    3604064,
    1280,
    853,
    'table-setting-table-arrangement-3604064',
    'table setting, table arrangement, tableware, glassware, glasses, banquet table, table decoration, dining, table setting, tableware, banquet table, dining, dining, dining, dining, dining',
  ),
  hit(
    1206687,
    1280,
    853,
    'skewers-food-party-chunks-1206687',
    'skewers, food, party, chunks, mozzarella, olives, celebration, appetizer, vegetables, dish, table, party, party, party, party, party',
  ),
  hit(
    6657853,
    1280,
    854,
    'table-restaurant-plate-cafe-fork-6657853',
    'table, restaurant, plate, cafe, fork, knife, napkin, garden, nature, ornament, decor, decoration, decorative',
  ),
  hit(
    5993768,
    1280,
    855,
    'eggs-egg-shells-tray-food-catering-5993768',
    'eggs, egg shells, tray, food, catering, ingredients',
  ),
  hit(
    4511335,
    1280,
    854,
    'food-catering-africa-4511335',
    'food, catering, africa, catering, catering, catering, catering, catering',
  ),
  hit(
    5109778,
    1280,
    1280,
    'pizza-italian-delivery-catering-5109778',
    'pizza, italian, delivery, catering, home party, dinner',
  ),
  hit(
    5981612,
    1280,
    720,
    'tunnel-greenhouse-cultivation-5981612',
    'tunnel greenhouse, cultivation, nature, kitchen, garden, vegetables, vegetable land, gardening, self catering',
  ),
  hit(
    4118085,
    1280,
    853,
    'rolls-kaiser-rolls-catering-baked-4118085',
    'rolls, kaiser rolls, catering, baked, food, baker, kaiser rolls, kaiser rolls, kaiser rolls, kaiser rolls, kaiser rolls, catering',
  ),
  hit(
    2534606,
    1280,
    751,
    'antique-car-classic-automobile-2534606',
    'antique car, classic, automobile, vehicles, old, snack, hot dog, kiosk, foot truck, truck, food, meal, hunger, coffee, green, old vehicle, transporter, vintage car automobile, street food, rarity',
  ),
  hit(
    7438072,
    1280,
    854,
    'vegetables-cook-catering-cooking-7438072',
    'vegetables, cook, catering, cooking, benchtops, supplier, manufacturer, manufacturing, catering, catering, catering, catering, catering',
  ),
  hit(
    2655778,
    1280,
    853,
    'food-buffet-restaurant-lunch-2655778',
    'food, buffet, restaurant, lunch, catering, plate, cuisine, people, dining, party, dinner, meal, celebration, table, event, dish, gray food, gray restaurant, gray party, gray table',
  ),
  hit(
    8044946,
    1280,
    853,
    'historic-center-alley-restaurant-8044946',
    'historic center, alley, restaurant, historic centre, local, gastronomy, outdoor catering, greece',
  ),
  hit(
    4625940,
    1280,
    960,
    'food-meat-catering-meal-bbq-4625940',
    'food, meat, catering, meal, bbq, barbecue, grilled, catering, catering, catering, catering, catering, bbq, bbq, bbq, bbq, bbq',
  ),
  hit(
    4235910,
    1280,
    854,
    'sashimi-platter-dinner-4235910',
    'sashimi, platter, dinner, japanese meal, catering, delicious, cooking, sound, sashimi, sashimi, sashimi, sashimi, sashimi, catering, catering, sound',
  ),
  hit(
    4082705,
    1280,
    848,
    'street-cafe-outdoors-restaurant-4082705',
    'street cafe, outdoors, restaurant, gastronomy, outdoor catering',
  ),
  hit(
    7073759,
    1280,
    960,
    'bun-tomatoes-snack-loaf-healthy-7073759',
    'bun, tomatoes, snack, loaf, healthy, catering, chunks, food, catering, catering, catering, catering, catering',
  ),
  hit(
    3911154,
    1280,
    853,
    'breakfast-banquet-catering-table-3911154',
    'breakfast, banquet, catering, table, meal, restaurant, serving, dine, plate, wooden, juice, pepper',
  ),
  hit(
    4003652,
    1280,
    853,
    'wings-bbq-barbecue-chicken-food-4003652',
    'wings, bbq, barbecue, chicken, food, meat, delicious, grill, tasty, eat, restaurant, sauce, grilled, dinner, spicy, fried, appetizer, catering, wing, cuisine',
  ),
  hit(
    3728754,
    1280,
    853,
    'hotel-breakfast-breakfast-buffet-3728754',
    'hotel, breakfast, breakfast buffet, gastronomy, fruit, nourishment, enjoy the meal, restaurant, fresh, yummy, tasty, enjoyment, bio, comfortable, in the morning, kitchen, space, room, hotel, kitchen',
  ),
  hit(
    3393433,
    1280,
    720,
    'moscow-cateral-russia-religion-3393433',
    'moscow, cateral, russia, religion, dome, orthodox',
  ),
  hit(
    315691,
    1280,
    853,
    'buffet-indian-food-spices-lunch-315691',
    'buffet, indian, food, spices, lunch, restaurant, cuisine, dinner, spicy, cooking, eating, meal, gourmet, delicious, traditional, india, catering, dining, tasty, brown food',
  ),
  hit(
    1812772,
    1280,
    853,
    'exclusive-banquet-adoption-1812772',
    'exclusive banquet, adoption, business meeting, wedding, the ceremony, restaurant, dinner, party, table, flower wallpaper, eat, bouquet, arrangement, alcohol, wine, flowers, tablecloth, decoration, composition, cutlery',
  ),
  hit(
    3592178,
    1280,
    853,
    'glass-catering-architecture-3592178',
    'glass, catering, architecture, building, urban, passage, people',
  ),
  hit(
    3393435,
    1280,
    850,
    'moscow-cateral-russia-religion-3393435',
    'moscow, cateral, russia, religion, dome, orthodox, gold, cathedral dome, kremlin',
  ),
  hit(
    3393436,
    1280,
    720,
    'moscow-cateral-russia-religion-3393436',
    'moscow, cateral, russia, religion, dome, orthodox, gold, cathedral dome, kremlin',
  ),
  hit(
    4589759,
    1280,
    853,
    'chicken-and-waffles-fried-chicken-4589759',
    'chicken and waffles, fried chicken, chicken, food, meat, table, catering, skewers, waffles, picnic, outdoor dining, dining, bbq, barbeque, fried chicken, catering, catering, catering, catering, catering',
  ),
  hit(
    8388203,
    1280,
    853,
    'meal-food-party-buffet-cold-buffet-8388203',
    'meal, food, party, buffet, cold buffet, yummy, catering, sausage',
  ),
  hit(
    3354402,
    1280,
    914,
    'people-adult-indoors-restaurant-3354402',
    'people, adult, indoors, restaurant, woman, service, table, catering, gray restaurant, gray table, gray service, catering, catering, catering, catering, catering',
  ),
]
