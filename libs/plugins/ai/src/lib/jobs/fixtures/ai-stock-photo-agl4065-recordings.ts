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
 * WHAT PIXABAY GAVE SIX BOOTH-KIT SITES ON 2026-10-25 (AGL-4065), AS THEIR
 * MEDIA LIBRARIES RECORD IT.
 *
 * Six guided starts in the test workspace, one per fictional business:
 * Bluebonnet Yard & Landscape (landscaping), Rut Runners Racing (an amateur
 * motocross team), Holeshot Moto Repair (motorcycle and dirt bike repair),
 * Berm & Bolt Moto Parts (dirt bike and ATV parts), Two Oaks Handyman and Pit
 * Row Tacos (a taco trailer). The provider's 24-hour search cache had expired
 * by 2026-10-28, so the answers are read back from what each site's library
 * holds for every photo it copied: its Pixabay id, its stored size, its page
 * address and the search that found it (`stockPhoto.query`).
 *
 * Each list is the photos one search placed, by that search's words, in the
 * order the libraries hold them: a part of what Pixabay answered, never more.
 * A photo's tags are the words of its page address, which Pixabay builds from
 * its leading tags, grouped as the alt text the start wrote from them reads
 * ("A race car and a motorsport" is "race car", "motorsport"); its later
 * tags are not recorded. A search not listed here was not sent on 2026-10-25,
 * and a replay answers it with nothing. No contributor, no contact details.
 */

const hit = (id: number, width: number, height: number, slug: string, tags: string): StockPhoto =>
  ({
    provider: 'pixabay',
    id: String(id),
    width,
    height,
    pageUrl: `https://pixabay.com/photos/${slug}-${id}/`,
    photographer: 'A Pixabay contributor',
    tags: tags.split(', '),
    downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
  }) as StockPhoto

// ── Rut Runners Racing: "Amateur motocross race team: rider profiles, …" ──

/** `motocross race team`: every page's cover hero (the first, 4462875, on all four), and eight of the "Race events" records' covers. */
export const MOTOCROSS_RACE_TEAM: StockPhoto[] = [
  hit(4462875, 1280, 853, 'race-car-motorsport-pit-lane', 'race car, motorsport, pit lane'),
  hit(10135205, 1280, 912, 'motorcycle-motocross-race-speed', 'motorcycle, motocross, race, speed'),
  hit(7690696, 1280, 853, 'motorcycle-motocross-speed-ktm', 'motorcycle, motocross, speed, ktm'),
  hit(4948269, 1280, 853, 'motocross-race-sport-speed-extreme', 'motocross, race, sport, speed, extreme'),
  hit(4287241, 1280, 853, 'speedway-motorcycle-motorcycle-race', 'speedway, motorcycle, motorcycle race'),
  hit(7097693, 1280, 853, 'motocross-motorbike-bikers-enduro', 'motocross, motorbike, bikers, enduro'),
  hit(8122941, 1280, 853, 'training-motocross-motorcycle-sport', 'training, motocross, motorcycle, sport'),
  hit(6380133, 1280, 853, 'motorcycle-rider-motocross-dust', 'motorcycle, rider, motocross, dust'),
  hit(5546581, 1280, 868, 'motocross-race-sports-racing', 'motocross, race, sports, racing'),
]

/** `team`: the Riders page's cover, once its own search found nothing it took. */
export const TEAM: StockPhoto[] = [hit(386673, 1280, 960, 'team-group-people-motivation', 'team, group, people, motivation')]

/** `team ready ride`: the "Ready to ride with us?" closing picture (vertical). */
export const TEAM_READY_RIDE: StockPhoto[] = [
  hit(7594065, 853, 1280, 'horse-riding-ride-out-terrain-horse', 'horse riding, ride out, terrain, horse'),
]

/** `upcoming race`: two "Race events" records' covers, named "Upcoming race 1 (details to be added)" and on. */
export const UPCOMING_RACE: StockPhoto[] = [
  hit(1851269, 1280, 841, 'cyclists-race-bicycles-bikes', 'cyclists, race, bicycles, bikes'),
  hit(394205, 1280, 853, 'horses-horse-tradition-rider', 'horses, horse, tradition, rider'),
]

// ── Holeshot Moto Repair: "Motorcycle and dirt bike repair shop: …" ──

/** `motorcycle`: every page's picture searched it, the home hero (vertical) first. */
export const MOTORCYCLE: StockPhoto[] = [
  hit(7749462, 853, 1280, 'indian-motorcycles-motorcycle', 'indian motorcycles, motorcycle'),
  hit(459594, 1280, 960, 'motorcycle-engine-metal-motor', 'motorcycle, engine, metal, motor'),
  hit(7356527, 853, 1280, 'motorcycle-moped-old-motorcycle', 'motorcycle, moped, old motorcycle'),
  hit(7425471, 853, 1280, 'motorcycle-scooter-speed-honda', 'motorcycle, scooter, speed, honda'),
  hit(1084694, 1280, 844, 'motorcycle-race-race-track', 'motorcycle, race, race track'),
]

// ── Berm & Bolt Moto Parts: "Dirt bike and ATV parts shop: …" ──

/** `dirt bike`: the heroes of the home, about, special-order and contact pages. */
export const DIRT_BIKE: StockPhoto[] = [
  hit(4187393, 1280, 853, 'bike-enduro-extreme-downhill-sport', 'bike, enduro, extreme, downhill, sport'),
  hit(209489, 1280, 851, 'dirt-bike-motorcycle-jump-autumn', 'dirt bike, motorcycle, jump, autumn'),
  hit(6594869, 1280, 859, 'dirt-bike-dirt-quad-planet-space', 'dirt bike, dirt, quad, planet, space'),
  hit(6938660, 1280, 853, 'dirt-bike-countryside-boys', 'dirt bike, countryside, boys'),
  hit(1868996, 1280, 874, 'dirt-bike-bike-rider-motocross', 'dirt bike, bike, rider, motocross'),
  hit(330815, 1280, 851, 'dirt-bike-motocross-motorcycle', 'dirt bike, motocross, motorcycle'),
  hit(171156, 848, 1280, 'dirt-bike-motocross-bike-motorcycle', 'dirt bike, motocross, bike, motorcycle'),
  hit(4500339, 1280, 853, 'bike-racing-motocross-motorsport', 'bike, racing, motocross, motorsport'),
]

/** `parts`: the home's "Shop by collection" tiles "Parts for the bike" and "Parts for the ranch". */
export const PARTS: StockPhoto[] = [
  hit(4612334, 848, 1280, 'river-part-canoe-blue', 'river, part, canoe, blue'),
  hit(4648358, 1280, 853, 'machined-parts-wrench-part-industry', 'machined parts, wrench, part, industry'),
]

/** `part`: the product "Aftermarket Dirt Bike Part". */
export const PART: StockPhoto[] = [hit(4753080, 853, 1280, 'auto-parts-belt-car-parts', 'auto parts, belt, car parts')]

/** `describe part`: the special-order step "Describe the part". */
export const DESCRIBE_PART: StockPhoto[] = [hit(443674, 1280, 844, 'gear-workshop-spare-part-metal', 'gear, workshop, spare part, metal')]

/** `atv tire`: the product "ATV Tire". */
export const ATV_TIRE: StockPhoto[] = [
  hit(3267701, 960, 1280, 'tire-tread-car-tire-rubber-pattern', 'tire, tread, car tire, rubber, pattern'),
]

/** `riding gear`: the product "Riding Gear Item". */
export const RIDING_GEAR: StockPhoto[] = [
  hit(408364, 1039, 1280, 'gear-mechanics-bikes-transmission', 'gear, mechanics, bikes, transmission'),
]

/** `bike parts order`: the product "OEM Dirt Bike Parts Order". */
export const BIKE_PARTS_ORDER: StockPhoto[] = [
  hit(4756327, 853, 1280, 'delivery-man-food-service-order', 'delivery man, food, service, order'),
]

/** `atv parts order`: the product "OEM ATV Parts Order". */
export const ATV_PARTS_ORDER: StockPhoto[] = [
  hit(4450390, 960, 1280, 'trees-sync-order-aligned-shapes', 'trees, sync, order, aligned, shapes'),
]

/** `bike it`: the special-order step "Pick it up in store". */
export const BIKE_IT: StockPhoto[] = [hit(4367285, 1280, 853, 'cycling-cyclists-cycle-racing', 'cycling, cyclists, cycle racing')]

/** `bike it will fit`: the closing band "Not sure it will fit?". */
export const BIKE_IT_WILL_FIT: StockPhoto[] = [
  hit(7576306, 1280, 960, 'helmet-bicycle-woman-cyclist', 'helmet, bicycle, woman, cyclist'),
]

/** `bike tell us machine`: the special-order step "Tell us your machine". */
export const BIKE_TELL_US_MACHINE: StockPhoto[] = [
  hit(5309140, 1280, 850, 'machine-design-bike-technology', 'machine, design, bike, technology'),
]

/** `bike visit shop`: the about page's "Visit the shop" band. */
export const BIKE_VISIT_SHOP: StockPhoto[] = [hit(7006089, 1280, 853, 'scooter-store-shop-street-ride', 'scooter, store, shop, street, ride')]

/** `bike we source it`: the special-order step "We source it". */
export const BIKE_WE_SOURCE_IT: StockPhoto[] = [
  hit(4369056, 1280, 853, 'bike-bike-race-helmet-cyclists', 'bike, bike race, helmet, cyclists'),
]

/** `tires`: the collection tile "Tires for every track and trail". */
export const TIRES: StockPhoto[] = [hit(4891682, 960, 1280, 'tire-highway-wheel-tires-wheels', 'tire, highway, wheel, tires, wheels')]

/** `dirt bike tire`: the product "Dirt Bike Tire". */
export const DIRT_BIKE_TIRE: StockPhoto[] = [
  hit(7284019, 853, 1280, 'bike-tire-motorcycle-motocross', 'bike tire, motorcycle, motocross'),
]

/** `gear`: the collection tile "Gear for ride day". */
export const GEAR: StockPhoto[] = [hit(2291916, 1280, 853, 'gears-bicycle-chain-transmission', 'gears, bicycle, chain, transmission')]

// ── Two Oaks Handyman: "Handyman business: home repairs, drywall, …" ──

/** `handyman`: the services, about, contact and working-together covers, and a closing band. */
export const HANDYMAN: StockPhoto[] = [
  hit(6850368, 1280, 853, 'woodworking-carpenter-handyman', 'woodworking, carpenter, handyman'),
  hit(3094035, 1280, 780, 'handyman-construction-site-workers', 'handyman, construction site, workers'),
  hit(3546194, 1280, 853, 'handyman-furniture-assembly-drill', 'handyman, furniture assembly, drill'),
  hit(7671904, 1280, 763, 'wood-handyman-recycling-greece', 'wood, handyman, recycling, greece'),
  hit(6809403, 1280, 855, 'handyman-driller-workman-work', 'handyman, driller, workman, work'),
]

/** `drywall`: a services record's cover, its name read as "drywall". */
export const DRYWALL: StockPhoto[] = [
  hit(3294517, 1280, 854, 'architecture-family-drywall-house', 'architecture, family, drywall, house'),
]

/** `handyman describe job`: the closing band "Call to action: describe your job". */
export const HANDYMAN_DESCRIBE_JOB: StockPhoto[] = [
  hit(2904780, 1280, 854, 'dream-job-application-job-request', 'dream job, application, job request'),
]

/** `doors`: a services record's cover, its name read as "doors". */
export const DOORS: StockPhoto[] = [hit(2606818, 1280, 853, 'house-home-door-sidewalk', 'house, home, door, sidewalk')]

/** `rental unit repairs`: a services record's cover. */
export const RENTAL_UNIT_REPAIRS: StockPhoto[] = [
  hit(840835, 1280, 853, 'plumbing-pipe-wrenches-plumber', 'plumbing, pipe, wrenches, plumber'),
]

// ── Bluebonnet Yard & Landscape: "Landscaping company: lawn care, …" ──

/** `landscaping`: the "Irrigation repair and tune-ups" picture. */
export const LANDSCAPING: StockPhoto[] = [
  hit(7079355, 1280, 853, 'zen-garden-sand-plants-leaves-bush', 'zen garden, sand, plants, leaves, bush'),
]

/** `team meeting office`: the business kind's second widened search; the contact and about covers. */
export const TEAM_MEETING_OFFICE: StockPhoto[] = [
  hit(10213524, 1280, 717, 'team-collaboration-meeting-business', 'team, collaboration, meeting, business'),
  hit(10503569, 1280, 714, 'business-meeting-teamwork-office', 'business meeting, teamwork, office'),
]

// ── Pit Row Tacos: "Taco food trailer: street and breakfast tacos at …" ──

/** `caterer`: the craft's broad search once "catering" was read as the craft: the home, catering and menu heroes. */
export const CATERER: StockPhoto[] = [
  hit(4797476, 1280, 854, 'food-hotel-buffet-holiday', 'food, hotel, buffet, holiday'),
  hit(7165148, 1280, 853, 'buffet-catering-cafeteria-kitchen', 'buffet, catering, cafeteria, kitchen'),
  hit(315691, 1280, 853, 'buffet-indian-food-spices-lunch', 'buffet, indian food, spices, lunch'),
]

/** `chef cooking`: the catering craft's maker at work, for the trailer's story. */
export const CHEF_COOKING: StockPhoto[] = [hit(4625935, 1280, 819, 'chef-catering-food', 'chef, catering, food')]

/** `catering potato`: the menu record "Potato and egg breakfast taco". */
export const CATERING_POTATO: StockPhoto[] = [
  hit(3440360, 1280, 853, 'potato-new-harvest-nature', 'potato, new harvest, nature'),
]

/** `breakfast taco`: the visit page's hero. */
export const BREAKFAST_TACO: StockPhoto[] = [
  hit(4942004, 1280, 960, 'tacos-breakfast-tacos-tortilla', 'tacos, breakfast tacos, tortilla'),
]

/** `asada street taco`, `pastor street taco`, `chicken street taco`, `carnitas street taco`: the street taco records, and the story hero. */
export const STREET_TACOS: StockPhoto[] = [
  hit(4179895, 1280, 720, 'tacos-mexico-tortilla-food-taco', 'tacos, mexico, tortilla, food, taco'),
  hit(4505032, 1280, 960, 'tacos-pastor-tacos-tacos-mexico', 'tacos, pastor, tacos mexico'),
  hit(4511272, 1280, 851, 'tacos-food-chicken-mexican', 'tacos, food, chicken, mexican'),
  hit(5932654, 1280, 853, 'tacos-tortilla-salsa-mexican-food', 'tacos, tortilla, salsa, mexican food'),
]

/** `catering bacon`: a menu record read as "bacon" and qualified by the craft. */
export const CATERING_BACON: StockPhoto[] = [
  hit(5755336, 1280, 853, 'bacon-egg-cup-dish-breakfast-food', 'bacon, egg cup, dish, breakfast food'),
]

/** Every photo above, by its Pixabay id. */
export const AGL4065_HITS: ReadonlyMap<string, StockPhoto> = new Map(
  [
    MOTOCROSS_RACE_TEAM,
    TEAM,
    TEAM_READY_RIDE,
    UPCOMING_RACE,
    MOTORCYCLE,
    DIRT_BIKE,
    PARTS,
    PART,
    DESCRIBE_PART,
    ATV_TIRE,
    RIDING_GEAR,
    BIKE_PARTS_ORDER,
    ATV_PARTS_ORDER,
    BIKE_IT,
    BIKE_IT_WILL_FIT,
    BIKE_TELL_US_MACHINE,
    BIKE_VISIT_SHOP,
    BIKE_WE_SOURCE_IT,
    TIRES,
    DIRT_BIKE_TIRE,
    GEAR,
    HANDYMAN,
    DRYWALL,
    HANDYMAN_DESCRIBE_JOB,
    DOORS,
    RENTAL_UNIT_REPAIRS,
    LANDSCAPING,
    TEAM_MEETING_OFFICE,
    CATERER,
    CHEF_COOKING,
    CATERING_POTATO,
    BREAKFAST_TACO,
    STREET_TACOS,
    CATERING_BACON,
  ]
    .flat()
    .map((photo) => [photo.id, photo] as const),
)
