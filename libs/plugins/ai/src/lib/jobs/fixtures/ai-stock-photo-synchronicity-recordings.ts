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
 * PIXABAY'S RECORDED ANSWERS FOR THE BETA.261 SYNCHRONICITY GYM START
 * (AGL-3856): what production's `stockPhotoSearches` cache held on 2026-10-16
 * for "ready train", the one search the site's home page sent (job
 * pB0Jnr3isL; its hero, held to no world, sent none), and for "gym", sent
 * the same day by another start, read back from the cache by each search's
 * key, never searched again. Ids, sizes, page slugs and tags are Pixabay's
 * own, in its order; the contributor is left out.
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

/** `ready train` (horizontal, min_width 900), for the Synchronicity Gym closing band, a cover whose words read as the subject "ready train"; answered 2026-10-16T19:19:16.709Z. 8517089 is the subway train it placed. */
export const READY_TRAIN_WIDE: StockPhoto[] = [
  hit(3237738, 1280, 722, 'regional-express-double-deck-train-3237738', 'regional express, double deck train, schubzug, control car, electric locomotive, br143, hbf, central station, trier, platform, ready to go, train, railroad, transport system, rail, railway regional transport, regional train, the moselle range'),
  hit(2110931, 1280, 820, 'switzerland-sbb-powerhouse-30000-hp-2110931', 'switzerland, sbb, powerhouse, 30000 hp, ready to use, uphill, alpine crossing, railroad, swiss federal railway, ffs, cff, electric locomotive, re 16-16, freight train, brig, valais, central station, rhône valley, lötschberg, simplon'),
  hit(4576439, 1280, 725, 'lokdepot-deutsche-bahn-depot-meshes-4576439', 'lokdepot, deutsche bahn, depot, meshes, hamburg, electric locomotive, diesel locomotive, switcher, waiting, readiness for operation, overview of freight trains, marshalling yard'),
  hit(3274537, 1280, 853, 'transportation-system-bus-car-train-3274537', 'transportation system, bus, car, train, traffic, street, subway system, city, free wallpaper, vehicle, public, road, industry, urban, travel, railway, commuter, wallpaper hd, tram, locomotive'),
  hit(498257, 1280, 853, 'woman-athlete-running-exercise-498257', 'woman, athlete, running, exercise, sprint, cinder-track, cinderpath, start, sports, fitness, healthy, workout, young, female, body, lifestyle, training, fit, health, people'),
  hit(797072, 1280, 853, 'train-railroad-transport-rails-797072', 'train, railroad, transport, rails, catenary, miniature, masts, catenary masts, railway line, rail track, train, train, train, train, train'),
  hit(4362166, 1280, 853, 'train-monument-scotland-jacobite-4362166', 'train, monument, scotland, jacobite, landscape, travel, scottish, nature, train, train, train, train, train, scotland, scotland'),
  hit(4797907, 1280, 853, 'bride-ready-wedding-female-dress-4797907', 'bride, ready, wedding, female, dress, gray wedding, bride, bride, ready, ready, ready, ready, ready, wedding'),
  hit(4314049, 1280, 853, 'train-bridge-mountains-railway-4314049', 'train, bridge, mountains, railway, steam, transport, landscape, nature, railroad'),
  hit(5237269, 1280, 853, 'shinkansen-bullet-train-5237269', 'shinkansen, bullet train, railway station, train station, express train, platform, railway, railroad, travel, train, transport, vehicle, high speed, fast, modern, kyoto, japan, shinkansen, bullet train, bullet train'),
  hit(3169964, 1280, 722, 'train-station-couple-traveling-3169964', 'train station, couple, traveling, railway, travelers, train station, couple, couple, couple, couple, couple, traveling'),
  hit(8517089, 1280, 720, 'train-station-subway-metro-8517089', 'train, station, subway, metro, architecture, cityscape, transport, modern, futuristic, building, steel construction, germany, hamburg, track, railroad, rails, railroad track, elbe bridge, hafencity'),
  hit(4324792, 1280, 720, 'buildings-skyscrapers-downtown-4324792', 'buildings, skyscrapers, downtown, chicago, architecture, urban, illinois, city, cityscape, nature, skyline, water, travel'),
  hit(1527780, 1280, 652, 'central-station-railway-station-1527780', 'central station, railway station, train, cologne, cologne main station, railway, rails, railroad track, rail traffic, train tracks, train station, departure, tilt shift, train, train, train, train, train'),
  hit(7859021, 1280, 850, 'train-railroad-station-passengers-7859021', 'train, railroad, station, passengers, travellers, regional train, train, train, train, train, train'),
  hit(7860168, 1280, 853, 'railway-train-station-train-7860168', 'railway, train station, train, passenger, travel, skill, civilization, rail, transportation, red, train station, train, train, train, train, train'),
  hit(3928590, 1280, 853, 'harbour-city-hamburg-city-3928590', 'harbour city, hamburg, city, lights game, shining, lamps, metro, platform, modern, architecture, hamburg, hamburg, hamburg, hamburg, hamburg, city, city, city, metro, metro'),
  hit(1868256, 1280, 853, 'train-station-adult-wait-waiting-1868256', 'train station, adult, wait, waiting, benches, trains, commuter, commute, passenger trains, public transportation, transportation, city, man, person, railway, station, train, transportation system, travel, urban'),
  hit(7767132, 1280, 853, 'station-train-railroad-rail-city-7767132', 'station, train, railroad, rail, city, architecture, berlin, germany, icc, capital city, cityscape, transport, metro, to travel, wait, commuter, platform, terminal, station, rail'),
  hit(1940691, 1280, 853, 'city-people-underground-metro-1940691', 'city, people, underground, metro, transport, transfer, traffic, transportation, prague, czech, business, man, motion, lights, station, train, stop, architecture, metro, metro'),
  hit(3714601, 1280, 815, 'train-speed-in-transit-platform-3714601', 'train, speed, in transit, platform, train station, passenger train, railway, railroad, railway station, railroad station, railway system, transportation, commute, motion, station, amsterdam, urban, subway, metro, transit'),
  hit(5616861, 1280, 853, 'woman-bride-smile-make-up-5616861', 'woman, bride, smile, make up, getting ready, lashes, mascara, hairstyle, wedding, married, getting ready, lashes, lashes, lashes, lashes, lashes, mascara, mascara'),
  hit(4068968, 1280, 829, 'berlin-metro-train-station-4068968', 'berlin, metro, train station, train platform, architecture, railway station, underground, urban, platform, germany, landmark, building, berlin, berlin, berlin, berlin, berlin, metro, train station, train station'),
  hit(10442256, 1280, 853, 'railway-track-sun-sunset-landscape-10442256', 'railway track, sun, sunset, landscape, forest, nature, railway, path, railway route, railway curve, railroad line, railway setting, railway construction, railway station, railway infrastructure, railway bridge, railway facility, winter railway, railway tracks'),
  hit(3384786, 1280, 853, 'train-station-platform-railway-3384786', 'train, station, platform, railway, rail, transport, travel, people, waiting, train, train, train, train, train'),
  hit(8302635, 1280, 828, 'train-windows-platform-speed-8302635', 'train, windows, platform, speed, circulation, transport, public transport, wagon, wide, wide view, snapshot, station, train station, roof'),
  hit(4501839, 1280, 788, 'metro-station-subway-train-4501839', 'metro, station, subway, train, underground, urban, transport, platform, architecture, travel, transportation, trainstation, terminal, railway, tube, metro, metro, subway, subway, train'),
  hit(619082, 1280, 853, 'train-tracks-train-station-railroad-619082', 'train, tracks, train station, railroad, train tracks, railway system, railway tracks, railway station, cologne, railway, rails, steel structure, cologne main station, central station, steel, train, train, train, train, train'),
  hit(4300448, 1280, 853, 'sit-architecture-inner-space-4300448', 'sit, architecture, inner space, building, subway, platform, wait, train, blur, move, stop, subway, subway, subway, platform, wait, train, train, train, train'),
  hit(4651062, 1280, 853, 'rail-track-stop-glass-4651062', 'rail, track, stop, glass, transportation, engine, rail, rail, stop, stop, stop, stop, stop, transportation, engine, engine, engine'),
  hit(7427924, 1280, 854, 'ice-train-train-railroad-transport-7427924', 'ice train, train, railroad, transport, speed train, travel, ice, ice train, ice train, ice train, ice train, ice train, train, train, train, train, train, speed train, speed train, speed train'),
  hit(4971800, 1280, 853, 'train-railway-locomotive-station-4971800', 'train, railway, locomotive, station, railroad, transport, transportation, rail, travel, electric, track, platform, engine, diesel, red, russia, cargo, power, speed, wagon'),
  hit(1486004, 1280, 853, 'bride-woman-model-wedding-dress-1486004', 'bride, woman, model, wedding dress, room, windows, elegant, extravagant, fancy, luxury, wedding, bride, model, luxury, luxury, wedding, wedding, wedding, wedding, wedding'),
  hit(3758523, 1280, 854, 'train-transportation-winter-season-3758523', 'train, transportation, winter, season, landscape, nature, travel, adventure, train, train, train, train, train, winter, winter, winter, winter, travel, travel'),
  hit(5422795, 1280, 853, 'couple-social-distancing-5422795', 'couple, social distancing, train station, coronavirus, face mask, covid-19, covid, distancing, pandemic, protection, new normal, indonesia, jakarta, covid-19, covid, covid, covid, covid, covid, pandemic'),
  hit(731165, 1280, 853, 'little-boy-window-waiting-bored-731165', 'little boy, window, waiting, bored, tired, rainy weather, glass window, raindrops, water droplets, wet, kid, child, inside, nature, train, looking out, boring, travel, rain, weather'),
  hit(60539, 1280, 848, 'train-railroad-transportation-60539', 'train, railroad, transportation, trail raffic, railway, rail, rail track, transport, locomotive, steam locomotive, russia, train, train, train, train, train'),
  hit(62849, 1280, 788, 'train-railway-snow-winter-railroad-62849', 'train, nature, railway, snow, winter, railroad, rail track, rail, transport, transportation, electric locomotive, locomotive, mountain railway, lagalb, bernina, bernina railway, switzerland'),
  hit(3153742, 1280, 854, 'railway-train-travel-street-train-3153742', 'railway train, travel, street, train, transport system, the train conductor, train station, diesel train, pingxi line, railway, platform, taiwan'),
  hit(7057750, 1280, 961, 'model-train-toy-train-train-7057750', 'model train, toy train, train, close up, miniature'),
]

/** `gym` (horizontal, min_width 900), sent by the beta.259 Ironline Strength Studio start; answered 2026-10-16T06:27:32.432Z. */
export const GYM_WIDE: StockPhoto[] = [
  hit(1282232, 1280, 853, 'man-person-power-strength-strong-1282232', 'man, person, power, strength, strong, fitness, body, muscles, weights, exhausted, heavy, weightlifting, effort, exhausting, bodybuilding, powerful, black fitness, black workout, black body, black power'),
  hit(2604149, 1280, 720, 'man-exercise-fitness-gym-dumbbells-2604149', 'man, exercise, fitness, gym, dumbbells, workout, weightlifting, exercise, fitness, gym, gym, gym, gym, gym, workout'),
  hit(2465478, 1280, 853, 'dumbbells-shoes-sneakers-2465478', 'dumbbells, shoes, sneakers, rubber shoes, fitness, gym, training, workout, exercise, health, fit, strength, bodybuilding, pilates, trainer, running shoes, cardio vascular, physio therapy, wellness, shoes'),
  hit(2250970, 1280, 853, 'woman-crunches-sport-training-2250970', 'woman, crunches, sport, training, exercise, fit, fitness, wellness, body, abdominals, movement, sporty, active, condition, shoes, sneakers, health, healthy, sport, sport'),
  hit(1850925, 1280, 850, 'adult-gym-athlete-dark-energy-1850925', 'adult, gym, athlete, dark, energy, exercise, exercise equipment, female, fit, fitness, girl, healthy, legs, muscles, plates, strength, strong, sweat, training, woman'),
  hit(8246973, 1280, 960, 'weight-dumbbell-strength-arm-force-8246973', 'weight, dumbbell, strength, arm, force, male, exercise, sport, fitness, wrist, hand, muscle, youth, body, adult, health, exercise, exercise, exercise, exercise'),
  hit(8246972, 1280, 960, 'weights-dumbbells-strength-force-8246972', 'weights, dumbbells, strength, force, exercise, sport, fitness, wrist, hand, muscle, body, health'),
  hit(1284616, 1280, 853, 'weight-lifting-fitness-gym-1284616', 'weight lifting, fitness, gym, perspective, bodybuilding, dumbells, weights, health, sport, training, exercise, workout, fitness, gym, gym, gym, gym, gym'),
  hit(1850926, 1280, 850, 'abs-athlete-biceps-blonde-body-1850926', 'abs, athlete, biceps, blonde, body, fit, fitness, gym, healthy, muscles, person, strength, strong, trainer, training, woman, workout, workout gear'),
  hit(534615, 1280, 853, 'crossfit-sports-fitness-training-534615', 'crossfit, sports, fitness, training, exercise, athlete, young, healthy, workout, fit, muscular, body, people, strength, power, strong, female, sport, woman, athletic'),
  hit(6995813, 1280, 1280, 'kettlebell-crossfit-training-gym-6995813', 'kettlebell, crossfit, training, gym, fitness, exercise, kettlebell, kettlebell, kettlebell, kettlebell, kettlebell, crossfit, crossfit, crossfit, crossfit, gym'),
  hit(828726, 1280, 850, 'training-muscles-arms-blonde-828726', 'training, muscles, arms, blonde, bar bells, workout, fitness, exercise, sport, gym, strong, young, woman, person, healthy, lifestyle, body, fit, muscular, studio'),
  hit(594143, 1280, 853, 'fitness-dumbbells-training-gym-594143', 'fitness, dumbbells, training, gym, weights, weightlifting, weight training, gym equipment, fitness studio, studio, weight, exercise, many, train, fit, fitness, gym, gym, gym, gym'),
  hit(828741, 1280, 850, 'training-rmuscles-back-shoulders-828741', 'training, rmuscles, back, shoulders, blonde, workout, fitness, exercise, sport, gym, strong, young, woman, person, healthy, lifestyle, body, fit, muscular, studio'),
  hit(9180669, 1280, 720, 'fitness-exercise-men-work-out-gym-9180669', 'fitness, exercise, men, work out, gym'),
  hit(2264825, 1280, 853, 'man-woman-push-ups-wellness-2264825', 'man, woman, push-ups, wellness, exercise, pair, couple, fit, fitness, sport, strength training, one arm, sporty, movement, muscles, muscle training, training, exercise, exercise, fitness'),
  hit(595529, 1280, 853, 'physiotherapy-weight-training-595529', 'physiotherapy, weight training, dumbbells, exercise balls, weight loss, workout, health, gym, therapist, physiotherapist, healthcare, fitness, wellness, rehabilitation, healing, therapeutic, weight loss, weight loss, workout, health'),
  hit(2260736, 1280, 853, 'woman-personal-trainer-fitness-2260736', 'woman, personal trainer, fitness, exercise, workout, strength training, coach, dumbbells, weight bench, weight training, healthy, caucasian, personal trainer, personal trainer, personal trainer, personal trainer, fitness, fitness, fitness, fitness'),
  hit(8563109, 1280, 914, 'ai-generated-woman-fitness-training-8563109', 'ai generated, woman, fitness, training, gym, adventure, sport, portrait, pose, stretch, exercise'),
  hit(1984344, 1280, 783, 'boxer-woman-sport-fighter-fitness-1984344', 'boxer, woman, sport, fighter, fitness, training, athlete, dark, fitness, fitness, fitness, fitness, fitness'),
  hit(2245029, 1280, 853, 'sports-fitness-fit-training-2245029', 'sports, fitness, fit, training, abdominal muscles, six pack, athletic, move, gymnastics, power, weight training, human, elegant, female, elegance, abdominal trainer, woman, bodybuilding, femininity, abdominal exercise'),
  hit(6902886, 1280, 853, 'sport-basketball-ball-gym-activity-6902886', 'sport, basketball, ball, gym, activity, basketball, basketball, basketball, basketball, basketball'),
  hit(5031071, 1280, 945, 'workout-gym-exercise-fitness-5031071', 'workout, gym, exercise, fitness, healthy, athletic, lifestyle, gym, gym, gym, gym, gym'),
  hit(998836, 1280, 853, 'abs-gym-exercise-athlete-horse-998836', 'abs, gym, nature, exercise, athlete, horse, italian'),
  hit(3483560, 1280, 853, 'weights-dumbbells-exercise-gym-3483560', 'weights, dumbbells, exercise, gym, workout, equipment, brown fitness, brown gym, brown exercise, brown workout, gym, gym, gym, gym, gym'),
  hit(8108014, 1280, 948, 'gym-fitness-exercise-workout-yoga-8108014', 'gym, fitness, exercise, workout, yoga, fit, training, workout, workout, workout, workout, workout'),
  hit(6888634, 1280, 930, 'woman-training-health-gym-strong-6888634', 'woman, training, health, gym, strong, wellness, strength, fit, gym, gym, gym, gym, gym'),
  hit(5013985, 1280, 853, 'bodybuilding-gym-muscles-dumbbells-5013985', 'bodybuilding, gym, muscles, dumbbells, training, bodybuilding, bodybuilding, bodybuilding, bodybuilding, gym, gym, gym, gym, gym, dumbbells, dumbbells, dumbbells'),
  hit(3324976, 1280, 853, 'dumbbell-gym-fitness-dumbbells-3324976', 'dumbbell, gym, fitness, dumbbells, training, dumbbell, gym, gym, gym, gym, gym, dumbbells'),
  hit(4938219, 1280, 853, 'fitness-weights-gym-exercise-4938219', 'fitness, weights, gym, exercise, weight, strength, gray fitness, gray gym, gray exercise, gray workout, gym, gym, gym, gym, gym'),
  hit(6894904, 1280, 853, 'gym-fitness-training-exercise-6894904', 'gym, fitness, training, exercise, health, diet, slimming'),
  hit(4873885, 1280, 853, 'boiled-eggs-eggs-gym-food-4873885', 'boiled eggs, eggs, gym food, healthy food, food, protein, egg, food photography, delicious, breakfast, gym diet, brown gym, brown egg, brown eggs, brown diet'),
  hit(3516215, 1280, 853, 'gym-abdomen-training-3516215', 'gym, abdomen, training, gym, gym, abdomen, abdomen, abdomen, abdomen, abdomen'),
  hit(1126999, 1280, 856, 'crossfit-zimmer-health-fitness-1126999', 'crossfit, zimmer, health, fitness, dumbbell, gym, gym, gym, gym, gym, gym'),
  hit(6789766, 1280, 853, 'abandoned-school-abandoned-school-gym-6789766', 'abandoned school, abandoned school gym, abandoned building'),
  hit(5031689, 1280, 953, 'home-workout-gym-exercise-fitness-5031689', 'home workout, gym, exercise, fitness, training, treadmill, gray home, gray fitness, gray gym, gray exercise, gray training, gray workout, home workout, treadmill, treadmill, treadmill, treadmill, treadmill'),
  hit(4161647, 1280, 853, 'sneakers-gym-shoes-gym-plimsolls-4161647', 'sneakers, gym shoes, gym plimsolls, shoes, shoelace, sole, youth, fashion, sport, shoelace, shoelace, shoelace, shoelace, shoelace'),
  hit(4873886, 1280, 853, 'boiled-eggs-eggs-gym-food-4873886', 'boiled eggs, eggs, gym food, healthy food, food, protein, egg, food photography, delicious, breakfast, gym diet, brown gym, brown egg, brown eggs, brown diet, gym food, gym food, gym food, gym food, gym food'),
  hit(1235019, 1280, 853, 'sport-exercises-fitness-center-1235019', 'sport, exercises, fitness center, muscles, iron, metal, bitumen, rubber, health, strength, practice, diet, bodybuilding, dumbbells, barbells, slimming, fitness center, strength, strength, strength'),
  hit(8268566, 1280, 853, 'running-sportswear-sports-fitness-8268566', 'running, sportswear, sports, fitness, gym, nature, running, running, running, running, running'),
]
