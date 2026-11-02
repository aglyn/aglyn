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
 * WHAT PIXABAY ANSWERED THE RIDERS PAGE'S TWO SEARCHES ON 2026-11-01 (AGL-4092).
 *
 * The live check that day started an amateur motocross team afresh, and its
 * riders page showed a kitesurfer in the section about joining the team (photo
 * 7288297, search "joining young rider"). Its media library records only the
 * search that found the photo, so the two searches its slot sends before its
 * broad ones were asked of Pixabay, read-only, as the provider asks them. Every
 * other search of the replay is {@link AGL4092_1029_ANSWERS}'s.
 *
 * Each list is the first 20 hits of its answer, in its order. A hit's tags are
 * the provider's, less any that names a person; its size is its large copy's.
 * Each contributor is a number, one per contributor; no name, no contact
 * details. Keyed as `aiAgl40921029AnswerKey` keys them.
 */

const hit = (id: number, width: number, height: number, slug: string, contributor: number, tags: string): StockPhoto =>
  ({
    provider: 'pixabay',
    id: String(id),
    width,
    height,
    pageUrl: `https://pixabay.com/photos/${slug}-${id}/`,
    photographer: `Pixabay contributor ${contributor}`,
    tags: tags.split(', ').filter(Boolean),
    downloadUrl: `https://pixabay.com/get/g${id}_1280.jpg`,
  }) as StockPhoto

/** Every recorded hit, by id. */
export const AGL4092_1101_HITS: ReadonlyMap<string, StockPhoto> = new Map(
  [
    hit(20333, 1280, 853, 'hands-puzzle-pieces-connect', 1, 'hands, puzzle pieces, connect, connection, cooperation, holding, isolated, jigsaw, join, partnership, people, pieces, puzzle, teamwork, two, unity, monochrome, idea, concept, black and white, hands, hands, connect, connect, connection, connection, connection, cooperation, cooperation, partnership, partnership, partnership, people, people, people, people, puzzle, puzzle, puzzle, puzzle, puzzle, teamwork, teamwork, teamwork, teamwork, two, idea, idea, idea'),
    hit(3372907, 1280, 720, 'reiter-horse-water-sunset-dawn', 2, 'reiter, nature, horse, water, sunset, dawn, sky, sun, waters, mirroring, reflection, silhouette, lake, pond, bank, equestrian, ride, freedom, indians, horse wallpaper'),
    hit(407123, 1280, 853, 'biker-motorcycle-ride-vehicle', 3, 'biker, motorcycle, ride, vehicle, motorbike, road, travel, asphalt, vintage, motorcycle ride, motorcycle rider, riding, motorcycle, motorcycle, motorcycle, motorcycle, motorcycle, motorbike'),
    hit(9331340, 1280, 853, 'horse-pony-woman-nature-animal', 4, 'horse, pony, woman, nature, animal'),
    hit(9702440, 1280, 1280, 'cartoon-hands-joining-hands', 5, 'cartoon hands, joining hands, unity circle, teamwork symbol, friendship hands, hands together, support icon, community symbol, diversity hands, connected hands, group unity, circle of hands, togetherness vector, cooperation symbol, helping hands, solidarity icon, team support, round hands shape, cartoon unity, collective support, friendly gesture, partnership icon'),
    hit(8209523, 1280, 854, 'horse-rider-rodeo-cowboy-show', 6, 'horse, rider, rodeo, cowboy, nature, show, agriculture, animal, livestock'),
    hit(3237649, 1280, 856, 'teamwork-match-together', 7, 'teamwork, match, together, hand in hand, connect, connection, collaboration, hands, keep, join, partnership, people, piece, puzzle, solution, team, two, unit, characters, wood, doll, articulated manikin, match, connect, connect, connect, connect, connect, collaboration, collaboration, collaboration, collaboration, join, partnership, partnership, partnership, puzzle, puzzle, solution'),
    hit(7469078, 1280, 853, 'girl-horse-happy-rider-joy-fun', 6, 'girl, horse, happy, rider, joy, fun, smile, young, nature, saddle, riding'),
    hit(7288297, 1280, 853, 'kitesurfer-young-rider-kitesurfing', 8, 'kitesurfer, young, rider, nature, kitesurfing, sea, grandparents, watching, water, line, beach'),
    hit(7200409, 1280, 854, 'cow-grassland-grazing-nomad', 9, 'cow, grassland, grazing, nomad, dornod plain, asahi, mongolia, landscape, cow, cow, cow, cow, cow, mongolia, mongolia'),
    hit(10135205, 1280, 912, 'motorcycle-motocross-race-speed', 10, 'motorcycle, motocross, race, speed, sand, adrenaline, smart, glowing, extreme sport, stunt, rappelling, helmet, armor, terrain, thrill, camera, control, tag, entertainment, gear'),
    hit(557261, 1280, 853, 'horse-silhouettes-horse-back-riding', 11, 'horse, silhouettes, horse back riding, sunset, backlighting, bow, nature, saddle'),
    hit(95032, 1280, 853, 'mountain-biking-sports-leaping', 12, 'mountain biking, sports, leaping, jumping, freeriding, biking, bike, bicycle, mountain bicycle, nature, leap, jump, desert, utah'),
    hit(5221914, 1280, 768, 'skateboard-feet-shoes-guy-skating', 13, 'skateboard, feet, shoes, guy, skating, active, wheels, outdoors, movement, speed, fun, recreation, race, sport, exercise, street, freedom, skateboard, skateboard, skateboard, shoes, shoes, shoes, shoes, shoes, skating, exercise, exercise'),
    hit(1869727, 1280, 853, 'skateboard-skater-boy-skater', 14, 'skateboard, skater boy, skater, teenager, activity, recreational, asphalt, dawn, outdoors, street, sunset, sports, nature, fun'),
    hit(10388622, 1280, 853, 'motocross-motorcycle-road-riding', 15, 'motocross, motorcycle, road, riding, adventure, travel, nature, desert, sand, dawn, sunset, sand dunes, dusty, desert ride, speed, landscape photography, enduro, off-road, feeling, outdoor'),
    hit(3066167, 1280, 719, 'snow-mountain-fat-bikes-winter', 16, 'snow, nature, mountain, fat bikes, winter, mountain bikes, mtb, biking, bicycles, adventure, cold, sports, action, outdoors, bike, cycling'),
    hit(8022334, 1280, 853, 'scooter-motorcycle-city-paris', 17, 'scooter, motorcycle, city, paris, france, away, urban, landscape, yego, paris, paris, paris, paris, paris'),
    hit(1139142, 1280, 853, 'horse-horse-head-horseback-riding', 18, 'horse, horse head, horseback riding, animal, close up, nature, riding, equine, equestrian, saddle, horse saddle, bridle'),
    hit(394205, 1280, 853, 'horses-horse-tradition-rider', 19, 'horses, nature, horse, tradition, rider, hungarian, animals, gallop, speed, horse race'),
    hit(5360648, 1280, 853, 'to-go-biking-cycle-heaven', 20, 'to go biking, windows wallpaper, cycle, heaven, cloudburst, hd wallpaper, girl, bicycle, wallpaper 4k, free wallpaper, nature, silhouette, cool backgrounds, dramatic, background, screensaver, rain, 4k wallpaper 1920x1080, clouds, rain clouds, 4k wallpaper, sunlight, pretty, pleasure, unicycle, desktop backgrounds, free background, balance, beautiful wallpaper, homeland, laptop wallpaper, bad weather, wallpaper hd, mac wallpaper, full hd wallpaper, the atmosphere, air'),
    hit(8386051, 1280, 853, 'people-man-lonely-sad-alone', 21, 'people, man, lonely, sad, alone, uninhibited, under, graffiti, motorbike, sad, sad, sad, sad, sad'),
    hit(6281973, 1280, 853, 'road-city-motorcycle-morning', 22, 'road, city, motorcycle, morning, sunlight, motorbike, vehicle, pavement, street, highway, urban, road, road, road, motorcycle, motorcycle, motorcycle, motorcycle, motorcycle, motorbike, street, highway, highway, highway, highway'),
    hit(930715, 1280, 914, 'superbike-motorsport-fast-speed', 23, 'superbike, motorsport, fast, speed, red, track, race, power, motorcycle, sport, bike, motorbike, helmet, rider, gray sports, gray bike, gray power, fast, motorcycle, motorcycle, sport, bike, bike, bike, bike, bike'),
    hit(5101069, 1280, 853, 'horse-mountains-lagoon-sea', 24, 'horse, mountains, lagoon, sea, reflections, silhouette, nature, landscape, animal, sky, outdoor, cape town, noordhoek, sunset, brown nature, brown sky, brown city, beach, brown animals, brown landscape, brown sunset, brown sea, brown mountain, brown horse, brown ocean, brown natural, horse, horse, horse, horse, horse'),
  ].map((photo) => [photo.id, photo]),
)

const of = (...ids: number[]): StockPhoto[] => ids.map((id) => AGL4092_1101_HITS.get(String(id)) as StockPhoto)

/** What each search answered on 2026-11-01. */
export const AGL4092_1101_ANSWERS: Readonly<Record<string, readonly StockPhoto[]>> = {
  /** horizontal, 900 wide; first 20 of 40 */
  'joining young rider|horizontal|900|': of(20333, 3372907, 407123, 9331340, 9702440, 8209523, 3237649, 7469078, 7288297, 7200409, 10135205, 557261, 95032, 5221914, 1869727, 10388622, 3066167, 8022334, 1139142, 394205),
  /** horizontal, 900 wide; first 20 of 40 */
  'rider|horizontal|900|': of(3372907, 407123, 9331340, 8209523, 7200409, 10135205, 10388622, 557261, 5221914, 95032, 8022334, 1869727, 3066167, 1139142, 394205, 5360648, 8386051, 6281973, 930715, 5101069),
}
