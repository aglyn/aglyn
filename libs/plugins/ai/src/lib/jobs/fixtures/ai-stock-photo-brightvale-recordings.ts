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
 * PIXABAY'S RECORDED ANSWERS FOR THE BETA.267 BRIGHTVALE FREELANCE MARKETING
 * START (AGL-3923, job dUxJutW8Dp, host QyM-_Ii5Kh, 2026-10-18 19:41Z): the
 * searches its cover heroes and its About page's "Our story" picture sent,
 * read back from production's `stockPhotoSearches` by each search's key (a
 * SHA-256 of the provider and the request's canonical parameters), never
 * searched again. Ids, sizes, page slugs and tags are Pixabay's own, in its
 * order; the contributor is left out. The closing band's and one more of its
 * home page's answers are kept too, as photos no slot of a marketer may take.
 * A hit whose download address is not a
 * .jpg keeps its extension, as Pixabay's own address names it: 10157445's is a
 * .png, labeled image/png, and its bytes were not PNG.
 */

const hit = (id: number, width: number, height: number, slug: string, tags: string, extension = 'jpg'): StockPhoto =>
  ({
    provider: 'pixabay',
    id: String(id),
    width,
    height,
    pageUrl: `https://pixabay.com/photos/${slug}/`,
    photographer: 'A Pixabay contributor',
    tags: tags ? tags.split(', ') : [],
    downloadUrl: `https://pixabay.com/get/g${id}_1280.${extension}`,
  }) as StockPhoto

/** `freelencing` (horizontal, min_width 1600), every page's cover hero first; key `34565a1176c6bdc7e5797e3cc714ad5b97b0d75b63fe7572d022ac6d64d2c0b9`, answered 2026-10-18T11:36:29.367Z. */
export const FREELENCING_HERO: StockPhoto[] = []

/** `small business owner` (horizontal, min_width 1600), the business kind's hero search (#1758); key `e76f3be5ca9474724764f9587fec08e3ff5a8313f37438790f8db25917a3edf0`, answered 2026-10-18T19:44:21.162Z. */
export const SMALL_BUSINESS_OWNER_HERO: StockPhoto[] = [
  hit(10207329, 1280, 853, 'small-business-e-commerce-10207329', 'small business, e commerce, order packing, business owner, online store, packaging, shipping orders, home business, startup, entrepreneur, workspace, wooden desk, natural light, productivity, order fulfillment, retail, small business owner, logistics, packaging process, handmade business'),
  hit(5475187, 1280, 853, 'man-entrepreneur-business-manager-5475187', 'man, entrepreneur, business, manager, owner, restaurant, young, start, local, small business, bar, small business, small business, small business, small business, small business'),
  hit(10436141, 1280, 714, 'baker-bakery-woman-smiling-happy-10436141', 'baker, bakery, woman, smiling, happy, bread, craft, freshly baked, small business, owner, entrepreneur, authentic, commercial, food, product, organic, delicious, successful, natural ingredients, artisan product'),
  hit(8379770, 1280, 827, 'jack-russell-puppy-mammal-dog-8379770', 'jack russell, puppy, mammal, dog, nature, playing, cute, pet, playful, animal'),
  hit(5124948, 1280, 853, 'puppy-dog-mammal-cute-small-5124948', 'puppy, pet, animal, dog, mammal, cute, small, adorable, purebred, canine, sweet'),
  hit(7213011, 1280, 853, 'dog-walk-sea-beach-sand-leash-7213011', 'dog, animal, walk, sea, nature, beach, sand, pet, leash, outdoors, friend'),
  hit(3047316, 1280, 853, 'business-businessman-closing-couch-3047316', 'business, businessman, closing, couch, display, indian, male, man, market, metal, metallic, motor, motorcycle, rider, owner, person, seller, shop, shop owner, sitting'),
  hit(1838969, 1280, 660, 'standup-paddleboarding-man-dog-1838969', 'standup paddleboarding, animal, man, dog, friendship, companion, pet, owner, paddleboard, paddle, together, stand, standing, ocean, person, nature, sea, surfboard, water, leisure'),
  hit(5623231, 1280, 853, 'girl-dog-pet-friendship-companion-5623231', 'girl, dog, pet, friendship, companion, owner, caucasian, blonde, caucasian female, blonde female, canine, domestic dog, doggy, happy, animal, nature, love, woman, cute, puppy'),
  hit(1861839, 1280, 850, 'dog-labrador-pet-canine-companion-1861839', 'dog, labrador, pet, canine, companion, friendship, nature, trust, animal, snout'),
  hit(3344414, 1280, 854, 'dog-adorable-animal-cute-happiness-3344414', 'dog, nature, adorable, animal, cute, happiness, happy, man, pet, portrait, puppy, purebred, retriever'),
  hit(1850276, 1280, 853, 'puppy-sleeping-pet-owner-adorable-1850276', 'puppy, sleeping, pet, nature, owner, adorable, animal, canine, cute, dog, sleep, sleeping puppy, asleep, portrait'),
  hit(2264812, 1280, 790, 'arrangement-attractive-beautiful-2264812', 'arrangement, attractive, beautiful, bloom, blossom, bouquet, business, colorful, decoration, detail, floral, florist, flowers, natural, plants, present, shop, nature, small business, flower background'),
  hit(4778387, 1280, 854, 'cat-pet-care-pet-care-kitten-4778387', 'cat, pet, care, pet care, kitten, nature, animal, domestic cat, feline, mammal, cute, furry, playful, fur, kitty, adorable, rescue cat, animal care, closeup'),
  hit(5751151, 1280, 853, 'dog-woman-owner-pet-companion-5751151', 'dog, woman, owner, pet, animal, companion, friends, friendship, canine, fur, furry, furry dog, mammal, adorable, cuddle, cute'),
  hit(1868563, 1280, 853, 'man-kitten-pet-owner-kitty-tabby-1868563', 'man, kitten, pet, owner, kitty, tabby, cat, gray tabby, tabby cat, adorable, animal, cute, feline, nature, caring, hands, holding, portrait'),
  hit(8199216, 1280, 853, 'dog-puppy-grass-canine-mammal-8199216', 'dog, beautiful nature, cool backgrounds, puppy, wallpaper hd, grass, canine, 4k wallpaper, wallpaper 4k, 4k wallpaper 1920x1080, mammal, nature wallpaper, mac wallpaper, happy, free wallpaper, walking, windows wallpaper, free background, playing, laptop wallpaper'),
  hit(5331883, 1280, 853, 'cat-work-technology-pet-cute-pc-5331883', 'cat, work, technology, pet, cute, animal, pc, keyboard, remote work'),
  hit(237193, 1280, 853, 'dog-puppy-bath-water-person-girl-237193', 'dog, puppy, nature, bath, animal, water, person, girl, friendship, kiss, pet'),
  hit(5249583, 1280, 887, 'arabian-horse-horse-man-golden-hour-5249583', 'arabian horse, horse, man, golden hour, mane, equestrian, animal, nature, portrait, horse, horse, horse, horse, horse'),
  hit(2607704, 1280, 854, 'animals-dogs-friendship-pets-eyes-2607704', 'animals, dogs, friendship, pets, eyes, muzzle, adorable, nature, miniature, man, male, people, owner, love, love wallpaper'),
  hit(841174, 1280, 858, 'company-model-woman-message-girl-841174', 'company, model, woman, message, girl, open, model, woman, message, message, message, open, open, open, open, open'),
  hit(4411622, 1280, 720, 'chihuahua-scared-astonished-fun-4411622', 'chihuahua, scared, astonished, fun, small, cute, dog, animal, on the lap, man, hands, poor, animal portrait, love, lifestyle, loyal friend, maul, pet, nose, snout'),
  hit(4930050, 1280, 853, 'mask-walk-dog-pet-new-normal-4930050', 'mask, walk, dog, pet, new normal, animal, virus, pandemic, covid, safey'),
  hit(5467838, 1280, 854, 'woman-entrepreneur-owner-business-5467838', 'woman, entrepreneur, owner, business, shop, store, clothing, manager, saleswoman, retail, sales, small business, retail, small business, small business, small business, small business, small business'),
  hit(5753302, 1280, 853, 'dog-pet-pet-owner-animal-owner-5753302', 'dog, pet, pet owner, animal, owner, domestic dog, canine, harness, dog harness, mammal, cute, adorable, woman, female, nature, outdoors, saxony, germany, leipzig'),
  hit(841164, 1280, 853, 'woman-girl-dog-portrait-smile-841164', 'woman, girl, dog, portrait, pet, smile, animal, look, face'),
  hit(1868578, 1280, 853, 'animal-canine-chihuahua-cute-dog-1868578', 'animal, nature, canine, chihuahua, cute, dog, hand, pet, puppy'),
  hit(5020587, 1280, 853, 'dog-dog-training-training-5020587', 'dog, dog training, training, human and animal, pet, animal, nature, domestic animal, yorkie, yorkshire terrier, garden, meadow'),
  hit(698630, 1280, 853, 'yorkshire-terrier-dog-puppy-animal-698630', 'yorkshire terrier, nature, dog, puppy, animal, pet, tongue, cute, girl, legs, sandals'),
  hit(2562376, 1280, 851, 'people-girl-pet-animal-dog-2562376', 'people, girl, pet, nature, animal, dog'),
  hit(100544, 1280, 857, 'dog-small-cute-ice-cream-sun-100544', 'dog, nature, small, cute, ice cream, pet, sun, summer, sand, animal, human, person, receive'),
  hit(2808859, 1280, 853, 'dog-pet-dog-pets-puppy-walk-cute-2808859', 'dog, pet dog, pets, puppy, pet, walk, cute, nature, gladness, consensus, stare, animal'),
  hit(2592333, 1280, 853, 'dog-puppy-animal-hands-owner-2592333', 'dog, puppy, pet, animal, hands, owner, nature, people, ears'),
  hit(10157445, 1280, 1280, 'small-business-entrepreneur-10157445', 'small business, entrepreneur, ecommerce, packing orders, shipping orders, home business, workspace, wooden desk, startup, small business workflow, independent seller, office equipment, work from home, wrapping paper, labels, home office, agenda, office desk', 'png'),
  hit(1093675, 1280, 854, 'woman-dog-pet-people-female-1093675', 'woman, dog, pet, people, female, animal, lifestyle, together, friendship, togetherness, close, nature, friends'),
  hit(654511, 1280, 853, 'poodle-dog-pets-animal-654511', 'poodle, dog, pets, pet, nature, animal'),
  hit(672786, 1280, 870, 'hybrids-small-cute-small-dog-672786', 'hybrids, small, cute, small dog, domestic animal, fluffy, little hybrid, knuffig'),
  hit(5031737, 1280, 854, 'cat-playful-yellow-eyes-pedigree-5031737', 'cat, playful, yellow eyes, pedigree, striped, persian, exotic, iron, affectionate, care, love, pet, one owner, not let, fluffy, important cat, business, animal, pedigreed, evil'),
  hit(3951245, 1280, 853, 'superman-statue-success-trophy-3951245', 'superman, statue, success, trophy, small, business, design, superman, superman, superman, superman, superman'),
]

/** `freelencing story` (vertical, min_height 900, category people), the About page's "Our story" picture; key `ac3bd740cb1dafac2a9a53c4692c47d3dd2dd9c1f860c9d7592014ebd49816a9`, answered 2026-10-18T19:46:32.905Z. */
export const FREELENCING_STORY_PEOPLE: StockPhoto[] = [
  hit(6840320, 894, 1280, 'girl-magic-space-architecture-6840320', 'girl, magic, space, architecture, digital art, art, story'),
  hit(3715695, 1081, 1280, 'daughter-red-rain-girl-fashion-3715695', 'daughter, red, rain, girl, fashion, nature, story'),
  hit(4367341, 853, 1280, 'princess-historical-fairy-tale-4367341', 'princess, historical, fairy tale, fantasy, fairy, crown, magic, conjure up, female, woman, portrait, mystical, story, princess, princess, princess, princess, princess, crown, crown'),
  hit(2974363, 857, 1280, 'prince-boy-kids-magic-crown-2974363', 'prince, boy, kids, magic, crown, a cute baby, story, elf, portrait, sight, prince, prince, prince, prince, prince'),
  hit(5283552, 850, 1280, 'angel-wings-fantasy-horns-sukub-5283552', 'angel, wings, fantasy, horns, sukub, fallen angel, story, wing, young woman, mystical, mystic, magic, daemon, good'),
  hit(7755278, 837, 1280, 'madder-kokoshnik-woman-story-7755278', 'madder, kokoshnik, woman, story, mystic, fantasy, mythology, goddess, slavic, character, nature, costume, image, rite, crown, cosplay, goddess of death'),
  hit(7362364, 837, 1280, 'woman-cosplay-crown-kokoshnik-7362364', 'woman, cosplay, crown, kokoshnik, witch, svarog, magician, scull, horns, damage, shrew, sorceress, enchantress, story, magic, fantasy, cosplay, crown, crown, crown'),
  hit(4747076, 1024, 1280, 'young-woman-forest-deer-fantasy-4747076', 'young woman, forest, deer, fantasy, story, photoshop, nature, photo montage, surreal, fantastic, smoke, mystic, magic, sveta, dream'),
  hit(5344381, 855, 1280, 'young-woman-forest-story-beauty-5344381', 'young woman, forest, story, beauty, nature, mood'),
  hit(7362362, 853, 1280, 'woman-cosplay-crown-kokoshnik-7362362', 'woman, cosplay, crown, kokoshnik, witch, svarog, magician, scull, horns, damage, shrew, sorceress, enchantress, story, magic, fantasy, cosplay, crown, witch, witch'),
  hit(3172580, 1096, 1280, 'stone-door-old-wall-arch-3172580', 'stone, door, old, wall, arch, young woman, magic, story, fantasy, art, illustration, middle ages, magic, illustration, illustration, illustration, illustration, illustration'),
  hit(7359398, 876, 1280, 'woman-book-read-reading-study-7359398', 'woman, book, read, reading, study, girl, hobby, novel, bench, story, literature, reader, leisure, rocker'),
  hit(5344383, 855, 1280, 'young-woman-forest-light-story-5344383', 'young woman, forest, nature, light, story, trees, mood'),
  hit(5344382, 855, 1280, 'young-woman-forest-story-trees-5344382', 'young woman, forest, story, nature, trees, beauty, mood, landscape'),
  hit(3172588, 1141, 1280, 'people-art-adult-young-woman-magic-3172588', 'people, art, adult, young woman, magic, story, fantasy, illustration, middle ages, woman'),
  hit(6857724, 851, 1280, 'elf-cosplay-fantasy-the-enchantress-6857724', 'elf, cosplay, fantasy, the enchantress, woman, portrait, elves, image, magic, enchantress, ears, gems, sparkle, story, fairytale character, young woman, nimbus, holy, cosplay, cosplay'),
  hit(8533942, 834, 1280, 'woman-fashion-beauty-eastern-8533942', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose, dagger, weapon, blade'),
  hit(7362361, 1024, 1280, 'woman-cosplay-crown-kokoshnik-7362361', 'woman, cosplay, crown, kokoshnik, witch, svarog, magician, scull, horns, damage, shrew, sorceress, enchantress, story, magic, fantasy, woman, cosplay, cosplay, cosplay'),
  hit(4351441, 853, 1280, 'human-trees-foliage-house-4351441', 'human, trees, foliage, house, pterodactyl, light, man, tree, hike, nature, journey, story, fantasy, photoshop, amazing'),
  hit(5381815, 851, 1280, 'elf-ears-story-magic-fairy-5381815', 'elf, ears, story, magic, fairy, fantasy, elves, pipe, music, tolkien, cosplay, young woman, woman, figure, the flute, elf, fairy, elves, elves, elves'),
  hit(4439625, 855, 1280, 'lighthouse-crystal-girl-ball-moon-4439625', 'lighthouse, crystal, girl, ball, moon, light, sparks, bokeh sky, clouds, fantasy, nature, photoshop, steam, lighting, story'),
  hit(7613624, 853, 1280, 'elf-elvish-fantasy-young-woman-7613624', 'elf, elvish, fantasy, young woman, ears, story, magic, folklore, spirit of the forest, character, cosplay, image, mythology, outfit, tolkien, lord of the rings, elves, elf, magic, folklore'),
  hit(7040028, 921, 1280, 'woman-fantasy-story-fiction-girl-7040028', 'woman, fantasy, story, fiction, girl, young, beauty, white dress, lamp, nature, light, forest, stairs, mushroom, magic, fairytale, book cover'),
  hit(4440401, 853, 1280, 'young-couple-love-story-courtship-4440401', 'young couple, love story, courtship, young, hug, young woman, beauty, portrait, model, person, hair, femininity, fashion, embrace'),
  hit(5283548, 881, 1280, 'angel-wings-fantasy-horns-sukub-5283548', 'angel, wings, fantasy, horns, sukub, fallen angel, story, wing, young woman, mystical, mystic, magic, dream, mysterious, mood, fairy tales'),
  hit(7613621, 853, 1280, 'elf-elvish-fantasy-young-woman-7613621', 'elf, elvish, fantasy, young woman, ears, story, magic, folklore, spirit of the forest, character, cosplay, image, mythology, outfit, tolkien, lord of the rings, elves'),
  hit(8533939, 832, 1280, 'woman-fashion-beauty-eastern-8533939', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, exotic, decorations, long hair, dancer, hands, gracefully, portrait, model, pose'),
  hit(5532334, 853, 1280, 'mysterious-mystery-thriller-face-5532334', 'mysterious, mystery, thriller, face, dark, shadows, serious, male, dirt, brave, hero, warrior, soldier, headshot, man, black, white, eyes, story, telling'),
  hit(3877719, 850, 1280, 'autumn-girl-the-apprentice-backpack-3877719', 'autumn, girl, the apprentice, backpack, young woman, model, leaves, nature, story, the park, baby, childhood, backpack, backpack, backpack, backpack, backpack'),
  hit(5381802, 851, 1280, 'elf-ears-story-magic-fairy-5381802', 'elf, ears, story, magic, fairy, fantasy, elves, pipe, music, tolkien, cosplay, young woman, woman, figure'),
  hit(4304019, 854, 1280, 'fantasy-gothic-dark-dream-portrait-4304019', 'fantasy, gothic, dark, dream, portrait, fantasy portrait, female, girl, model, night, lamp, candle, wood, mystery, mysterious, ghost story, atmosphere, composing, book cover, photoshop'),
  hit(4273436, 848, 1280, 'horse-horses-forest-red-hood-4273436', 'horse, horses, forest, red hood, little red riding hood, fairy tale, story teller, fantasy, nature, girl, adventure, woods, enchanted, green forest, green fantasy'),
  hit(8533943, 848, 1280, 'woman-fashion-beauty-eastern-8533943', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose'),
  hit(5016422, 853, 1280, 'winter-young-woman-model-portrait-5016422', 'winter, young woman, model, nature, portrait, snow, story, smile, holiday, january, cold, woman, forest, christmas tree, cosiness'),
  hit(8533944, 796, 1280, 'woman-fashion-beauty-eastern-8533944', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose, dagger, weapon, blade'),
  hit(8533947, 834, 1280, 'woman-fashion-beauty-eastern-8533947', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose, dagger, weapons, blade'),
  hit(6858089, 851, 1280, 'queen-crown-monarch-cosplay-6858089', 'queen, crown, monarch, cosplay, fantasy, throne, power, woman, image, jewelry, decorations, story, fairytale character, young woman, portrait, drapery, kingdom'),
  hit(8533938, 802, 1280, 'woman-beauty-fashion-eastern-8533938', 'woman, beauty, fashion, eastern, gorgeous, arabic, scheherazade, story, cosplay, thousand and one nights, exotic, decorations, long hair, dancer, graceful'),
  hit(4440380, 853, 1280, 'young-couple-love-story-courtship-4440380', 'young couple, love story, courtship, young, hug, young woman, beauty, portrait, model, person, hair, femininity, fashion, dress, birch'),
  hit(5283555, 853, 1280, 'portrait-angel-wings-fantasy-horns-5283555', 'portrait, angel, wings, fantasy, horns, sukub, fallen angel, story, wing, young woman, mystical, mystic, magic'),
]

/** `freelencing` (vertical, min_height 900, category people), the same picture; key `047c7c65b06bb5d1d8172b67951b37937adc34e7f86ae2cf133f2039107067ef`, answered 2026-10-18T19:46:33.166Z. */
export const FREELENCING_TALL_PEOPLE: StockPhoto[] = []

/** `freelencing` (vertical, min_height 900), the same picture; key `aeb056269f4c83fff44bc71068a085a67f501a4639625370b0045f8675fc5a16`, answered 2026-10-18T19:46:33.335Z. */
export const FREELENCING_TALL: StockPhoto[] = []

/** `story` (vertical, min_height 900, category people), the same picture; key `b260f8d7f9c430236d7443b0cecdbc0a613f5b8ae7c7cfd0c6c54ab0900e5075`, answered 2026-10-18T19:46:33.653Z. */
export const STORY_PEOPLE: StockPhoto[] = [
  hit(6840320, 894, 1280, 'girl-magic-space-architecture-6840320', 'girl, magic, space, architecture, digital art, art, story'),
  hit(3715695, 1081, 1280, 'daughter-red-rain-girl-fashion-3715695', 'daughter, red, rain, girl, fashion, nature, story'),
  hit(2974363, 857, 1280, 'prince-boy-kids-magic-crown-2974363', 'prince, boy, kids, magic, crown, a cute baby, story, elf, portrait, sight, prince, prince, prince, prince, prince'),
  hit(4367341, 853, 1280, 'princess-historical-fairy-tale-4367341', 'princess, historical, fairy tale, fantasy, fairy, crown, magic, conjure up, female, woman, portrait, mystical, story, princess, princess, princess, princess, princess, crown, crown'),
  hit(5283552, 850, 1280, 'angel-wings-fantasy-horns-sukub-5283552', 'angel, wings, fantasy, horns, sukub, fallen angel, story, wing, young woman, mystical, mystic, magic, daemon, good'),
  hit(7362364, 837, 1280, 'woman-cosplay-crown-kokoshnik-7362364', 'woman, cosplay, crown, kokoshnik, witch, svarog, magician, scull, horns, damage, shrew, sorceress, enchantress, story, magic, fantasy, cosplay, crown, crown, crown'),
  hit(7755278, 837, 1280, 'madder-kokoshnik-woman-story-7755278', 'madder, kokoshnik, woman, story, mystic, fantasy, mythology, goddess, slavic, character, nature, costume, image, rite, crown, cosplay, goddess of death'),
  hit(5344381, 855, 1280, 'young-woman-forest-story-beauty-5344381', 'young woman, forest, story, beauty, nature, mood'),
  hit(4747076, 1024, 1280, 'young-woman-forest-deer-fantasy-4747076', 'young woman, forest, deer, fantasy, story, photoshop, nature, photo montage, surreal, fantastic, smoke, mystic, magic, sveta, dream'),
  hit(7362362, 853, 1280, 'woman-cosplay-crown-kokoshnik-7362362', 'woman, cosplay, crown, kokoshnik, witch, svarog, magician, scull, horns, damage, shrew, sorceress, enchantress, story, magic, fantasy, cosplay, crown, witch, witch'),
  hit(3172580, 1096, 1280, 'stone-door-old-wall-arch-3172580', 'stone, door, old, wall, arch, young woman, magic, story, fantasy, art, illustration, middle ages, magic, illustration, illustration, illustration, illustration, illustration'),
  hit(7359398, 876, 1280, 'woman-book-read-reading-study-7359398', 'woman, book, read, reading, study, girl, hobby, novel, bench, story, literature, reader, leisure, rocker'),
  hit(5344382, 855, 1280, 'young-woman-forest-story-trees-5344382', 'young woman, forest, story, nature, trees, beauty, mood, landscape'),
  hit(5344383, 855, 1280, 'young-woman-forest-light-story-5344383', 'young woman, forest, nature, light, story, trees, mood'),
  hit(6857724, 851, 1280, 'elf-cosplay-fantasy-the-enchantress-6857724', 'elf, cosplay, fantasy, the enchantress, woman, portrait, elves, image, magic, enchantress, ears, gems, sparkle, story, fairytale character, young woman, nimbus, holy, cosplay, cosplay'),
  hit(8533942, 834, 1280, 'woman-fashion-beauty-eastern-8533942', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose, dagger, weapon, blade'),
  hit(3172588, 1141, 1280, 'people-art-adult-young-woman-magic-3172588', 'people, art, adult, young woman, magic, story, fantasy, illustration, middle ages, woman'),
  hit(7362361, 1024, 1280, 'woman-cosplay-crown-kokoshnik-7362361', 'woman, cosplay, crown, kokoshnik, witch, svarog, magician, scull, horns, damage, shrew, sorceress, enchantress, story, magic, fantasy, woman, cosplay, cosplay, cosplay'),
  hit(4351441, 853, 1280, 'human-trees-foliage-house-4351441', 'human, trees, foliage, house, pterodactyl, light, man, tree, hike, nature, journey, story, fantasy, photoshop, amazing'),
  hit(7040028, 921, 1280, 'woman-fantasy-story-fiction-girl-7040028', 'woman, fantasy, story, fiction, girl, young, beauty, white dress, lamp, nature, light, forest, stairs, mushroom, magic, fairytale, book cover'),
  hit(7613624, 853, 1280, 'elf-elvish-fantasy-young-woman-7613624', 'elf, elvish, fantasy, young woman, ears, story, magic, folklore, spirit of the forest, character, cosplay, image, mythology, outfit, tolkien, lord of the rings, elves, elf, magic, folklore'),
  hit(5381815, 851, 1280, 'elf-ears-story-magic-fairy-5381815', 'elf, ears, story, magic, fairy, fantasy, elves, pipe, music, tolkien, cosplay, young woman, woman, figure, the flute, elf, fairy, elves, elves, elves'),
  hit(4439625, 855, 1280, 'lighthouse-crystal-girl-ball-moon-4439625', 'lighthouse, crystal, girl, ball, moon, light, sparks, bokeh sky, clouds, fantasy, nature, photoshop, steam, lighting, story'),
  hit(4440401, 853, 1280, 'young-couple-love-story-courtship-4440401', 'young couple, love story, courtship, young, hug, young woman, beauty, portrait, model, person, hair, femininity, fashion, embrace'),
  hit(7613621, 853, 1280, 'elf-elvish-fantasy-young-woman-7613621', 'elf, elvish, fantasy, young woman, ears, story, magic, folklore, spirit of the forest, character, cosplay, image, mythology, outfit, tolkien, lord of the rings, elves'),
  hit(5283548, 881, 1280, 'angel-wings-fantasy-horns-sukub-5283548', 'angel, wings, fantasy, horns, sukub, fallen angel, story, wing, young woman, mystical, mystic, magic, dream, mysterious, mood, fairy tales'),
  hit(8533939, 832, 1280, 'woman-fashion-beauty-eastern-8533939', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, exotic, decorations, long hair, dancer, hands, gracefully, portrait, model, pose'),
  hit(5532334, 853, 1280, 'mysterious-mystery-thriller-face-5532334', 'mysterious, mystery, thriller, face, dark, shadows, serious, male, dirt, brave, hero, warrior, soldier, headshot, man, black, white, eyes, story, telling'),
  hit(3877719, 850, 1280, 'autumn-girl-the-apprentice-backpack-3877719', 'autumn, girl, the apprentice, backpack, young woman, model, leaves, nature, story, the park, baby, childhood, backpack, backpack, backpack, backpack, backpack'),
  hit(5381802, 851, 1280, 'elf-ears-story-magic-fairy-5381802', 'elf, ears, story, magic, fairy, fantasy, elves, pipe, music, tolkien, cosplay, young woman, woman, figure'),
  hit(4304019, 854, 1280, 'fantasy-gothic-dark-dream-portrait-4304019', 'fantasy, gothic, dark, dream, portrait, fantasy portrait, female, girl, model, night, lamp, candle, wood, mystery, mysterious, ghost story, atmosphere, composing, book cover, photoshop'),
  hit(4273436, 848, 1280, 'horse-horses-forest-red-hood-4273436', 'horse, horses, forest, red hood, little red riding hood, fairy tale, story teller, fantasy, nature, girl, adventure, woods, enchanted, green forest, green fantasy'),
  hit(5016422, 853, 1280, 'winter-young-woman-model-portrait-5016422', 'winter, young woman, model, nature, portrait, snow, story, smile, holiday, january, cold, woman, forest, christmas tree, cosiness'),
  hit(8533943, 848, 1280, 'woman-fashion-beauty-eastern-8533943', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose'),
  hit(8533944, 796, 1280, 'woman-fashion-beauty-eastern-8533944', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose, dagger, weapon, blade'),
  hit(8533947, 834, 1280, 'woman-fashion-beauty-eastern-8533947', 'woman, fashion, beauty, eastern, gorgeous, arabic, scheherazade, story, cosplay, decorations, dancer, hands, gracefully, portrait, model, pose, dagger, weapons, blade'),
  hit(8533938, 802, 1280, 'woman-beauty-fashion-eastern-8533938', 'woman, beauty, fashion, eastern, gorgeous, arabic, scheherazade, story, cosplay, thousand and one nights, exotic, decorations, long hair, dancer, graceful'),
  hit(6858089, 851, 1280, 'queen-crown-monarch-cosplay-6858089', 'queen, crown, monarch, cosplay, fantasy, throne, power, woman, image, jewelry, decorations, story, fairytale character, young woman, portrait, drapery, kingdom'),
  hit(5283555, 853, 1280, 'portrait-angel-wings-fantasy-horns-5283555', 'portrait, angel, wings, fantasy, horns, sukub, fallen angel, story, wing, young woman, mystical, mystic, magic'),
  hit(4440380, 853, 1280, 'young-couple-love-story-courtship-4440380', 'young couple, love story, courtship, young, hug, young woman, beauty, portrait, model, person, hair, femininity, fashion, dress, birch'),
]

/** `small business owner` (vertical, min_height 900), the same picture, widened to the business kind; key `9ee171cee5bff5e5b565e69074a57764babd6283a1da648807f5085444ba8ab2`, answered 2026-10-18T19:46:34.056Z. */
export const SMALL_BUSINESS_OWNER_TALL: StockPhoto[] = [
  hit(992643, 850, 1280, 'working-girl-working-woman-young-992643', 'working, girl, working woman, young, people, female, woman, work, happy, person, business, adult, lifestyle, home, woman on computer, woman computer, lady, working, working, working'),
  hit(5964181, 853, 1280, 'dog-girl-love-pet-owner-companion-5964181', 'dog, girl, love, pet, owner, companion, nature, friends, friendship, happy, animal, akita, portrait, pet owner'),
  hit(7308033, 854, 1280, 'woman-dog-walk-pooch-dog-leash-7308033', 'woman, animal, dog, pet, walk, pooch, dog leash, domestic animal'),
  hit(6401957, 854, 1280, 'woman-model-portrait-pose-dog-pet-6401957', 'woman, model, portrait, pose, nature, dog, pet, animal, style, fashion, posing, young woman, girl, modeling, female, woman portrait'),
  hit(7862413, 853, 1280, 'woman-shopping-market-lifestyle-7862413', 'woman, shopping market, lifestyle, marketplace, people, people, people, people, people, people'),
  hit(7172131, 853, 1280, 'ferret-pet-animal-mustelidae-owner-7172131', 'ferret, pet, nature, animal, mustelidae, owner, hug, domestic, closeup'),
  hit(2586356, 851, 1280, 'people-girl-woman-dog-puppy-pet-2586356', 'people, girl, woman, nature, dog, puppy, pet, animal'),
  hit(6032824, 853, 1280, 'woman-dog-playing-playful-bonding-6032824', 'woman, dog, nature, playing, playful, bonding, happiness, pet, animal, girl, pet owner, leisure, fun, happy'),
  hit(2517682, 853, 1280, 'pet-dog-puppy-animal-dog-stare-2517682', 'pet dog, puppy, nature, animal, dog, pet, stare, park, walk, consensus, emotion, snow, gladness, pets, cute'),
  hit(9248858, 851, 1280, 'teen-boy-portrait-cavy-pet-9248858', 'teen, boy, portrait, cavy, pet, darling, master, owner'),
  hit(9248855, 851, 1280, 'teen-boy-portrait-cavy-pet-9248855', 'teen, boy, portrait, cavy, pet, darling, master, owner'),
  hit(8032746, 854, 1280, 'open-sign-signage-window-store-8032746', 'open, sign, signage, window, store, business, small business, green, business, small business, small business, small business, small business, small business'),
  hit(9971558, 853, 1280, 'nature-wildlife-mammal-fauna-fur-9971558', 'nature, wildlife, mammal, fauna, fur, animals, mouse, rodent, cute, mice, harvest mice, seedhead, plant, wheat'),
  hit(8702640, 853, 1280, 'man-dog-pet-animal-canine-fur-8702640', 'man, nature, dog, pet, animal, canine, fur, sitting, owner, boy, tattoo, outdoor, terrace, restaurant, lifestyle, relaxation'),
  hit(8013214, 854, 1280, 'hummingbird-bird-nature-wallpaper-8013214', 'hummingbird, samsung wallpaper, bird, iphone wallpaper, nature, lock screen wallpaper, wallpaper, wildlife, phone wallpaper, mobile wallpaper 4k, ipad wallpaper, beautiful wallpaper, mobile wallpaper, animal'),
  hit(9846388, 853, 1280, 'fennec-fox-fennec-fox-africa-9846388', 'fennec fox, fennec, fox, africa, animal, wildlife, nature, mammal'),
  hit(8781844, 853, 1280, 'dog-puppy-pooch-domestic-animal-8781844', 'dog, puppy, pooch, domestic animal, animal, pet, cute, nature'),
  hit(4051412, 853, 1280, 'bird-perched-animal-feathers-4051412', 'bird, perched, animal, feathers, plumage, beak, bill, bird watching, ornithology, animal world, nature, bird, bird, bird, bird, bird'),
  hit(8496039, 853, 1280, 'wren-bird-animal-nature-wildlife-8496039', 'wren, bird, animal, nature, wildlife, songbird, ornithology, bird watching, bird, bird, bird, bird, bird, animal, nature'),
  hit(6027672, 853, 1280, 'man-dog-drink-drinking-6027672', 'man, dog, drink, drinking, drinking water, pet, owner, canine, landscape, desert, nature, travel, traveling, sand, animal, refreshment'),
  hit(1281284, 1052, 1280, 'elder-man-dogs-puppy-man-senior-1281284', 'elder man, dogs, puppy, man, senior, nature, old, elderly, retired, people, pet, person, animal, love, aged, older, care, happy, calm, human'),
  hit(9830647, 958, 1280, 'small-copper-butterfly-insect-9830647', 'small copper, butterfly, insect, nature, pollinator, entomology, pollinate, lepidoptera'),
  hit(10021805, 939, 1280, 'brown-breasted-nun-gorgeous-finch-10021805', 'brown-breasted nun, gorgeous finch, songbird, sperling, bronze men, bird, sparrow bird, bird watching, plumage, nature, animal'),
  hit(8024809, 853, 1280, 'blue-tit-nuthatch-bird-animal-8024809', 'blue tit, nuthatch, bird, animal, wildlife, plumage, branch, perched, nature, birdwatching, wildlife photography, nature photography, bird photography, nature, nature, nature, nature, nature'),
  hit(10260310, 853, 1280, 'kitten-feline-pet-portrait-fur-10260310', 'kitten, feline, pet, portrait, fur, mackerel, tabby, charming, woman, glasses, closeness, cozy, coat, young, domestic animal, cat, cuddly, contact, animal, home'),
  hit(9617024, 854, 1280, 'sparrow-branch-springtime-nature-9617024', 'sparrow, mobile wallpaper 4k, branch, springtime, iphone wallpaper, lock screen wallpaper, nature, birdwatching, soft colors, cherry blossom, ipad wallpaper, wildlife photography, mobile wallpaper, tranquility, beautiful wallpaper, phone wallpaper, small birds, urban nature, avian, wallpaper'),
  hit(4997202, 960, 1280, 'if-you-ski-super-ski-pet-dog-puppy-4997202', 'if you, ski super ski, pet dog, puppy, pet, dog, consensus, walk, cute, animal, emotion, park, jindo dog, new man, laugh, preciousness, dang stuck, nature, happiness, pets'),
  hit(3824672, 877, 1280, 'animal-baby-bird-born-child-cute-3824672', 'animal, baby, bird, born, child, cute, duck, duckling, ducklings, ducky, farm, feathers, fluff, fluffy, fun, funny, grass, green, little, nature'),
  hit(10022157, 853, 1280, 'eurasian-wren-bird-bird-photography-10022157', 'eurasian wren, bird, bird photography, ornithology, spring, songbird, hd background, garden, bird watching, animal, wildlife, feathered animal, forest, nature, chirp, tweet, chirrup, forest-aged tree'),
  hit(9286306, 853, 1280, 'animal-shih-tzu-dog-puppy-cute-9286306', 'animal, shih tzu, dog, puppy, cute, mammal, fur, grass, snout, small, pet, home, race, portrait, nature, fluffy, companion'),
  hit(9643209, 853, 1280, 'cat-kitten-animal-feline-kitty-9643209', 'cat, kitten, animal, feline, kitty, pet, cute, small, nature, whiskers'),
  hit(1551708, 848, 1280, 'leisure-time-leisure-activities-1551708', 'leisure time, leisure activities, dog photography, dog, dog runs, animal, nature, fun, dog human, dog with human, comrade, plays, action, dog plays, dogs portrait, portrait, man dog, dog with man, forest, walk'),
  hit(8666099, 853, 1280, 'bird-winged-pen-animal-fauna-wild-8666099', 'bird, winged, pen, animal, fauna, wild, nature, little bird, small bird, sparrow-like, sparrow bird, gray, bird, bird, bird, bird, bird'),
  hit(817371, 888, 1280, 'child-running-children-girl-happy-817371', 'child, running, children, girl, happy, people, nature, female, kids, person, happiness, summer, outdoors, pet'),
  hit(10180402, 853, 1280, 'frog-tree-frog-small-frog-amphibian-10180402', 'frog, tree frog, small frog, amphibian, tropical frog, terrarium, frog on branch, wildlife, animal close-up, amphibian skin, exotic animal, zoo animal, nature detail, macro wildlife, frog portrait, rainforest animal, small animal, indoor habitat, green leaves, camouflage'),
  hit(4912213, 853, 1280, 'cat-kitten-british-pet-kitty-4912213', 'cat, kitten, british, pet, kitty, animal, feline, sweet, fur, domestic, nature, young, adorable, playful, small, funny, furry, pets, portrait, curious'),
  hit(4906211, 857, 1280, 'shaoxing-watertown-small-river-4906211', 'shaoxing, watertown, small river, scenery, small town, shaoxing, shaoxing, shaoxing, shaoxing, shaoxing'),
  hit(1851108, 904, 1280, 'terrier-dog-puppy-animal-breed-1851108', 'terrier, dog, puppy, animal, nature, breed, canine, adorable, cute, domestic, fur, grass, little, mammal, pedigree, pet, portrait, purebred, furry'),
  hit(9432600, 1097, 1280, 'bird-animal-wildlife-avian-9432600', 'bird, animal, wildlife, avian, nature, hyderabad, india, zoo'),
  hit(4906607, 853, 1280, 'veterinarian-examination-dog-4906607', 'veterinarian, examination dog, ambulance, clinic, pets, dog, health, nature, prevention, animal, diagnosis, dog diseases, vaccination, care, pet, treatment, petcare'),
]

/** `ready talk marketing` (horizontal, min_width 900, category people), the home page's closing band, read as a picture of people for the "about" in "Ready to talk about your marketing?"; key `cc8084e352c19e774009237406ddeda4d228b4cacb45415533c10be734042f39`, answered 2026-10-18T19:44:22.401Z. */
export const READY_TALK_MARKETING_PEOPLE: StockPhoto[] = [
  hit(238488, 1280, 853, 'tin-can-speak-talk-microphone-can-238488', 'tin can, speak, talk, microphone, can, tin, mouth, say, communicate, string, yell, hand, teeth, man, guy, speak, speak, speak, talk, talk'),
  hit(5616861, 1280, 853, 'woman-bride-smile-make-up-5616861', 'woman, bride, smile, make up, getting ready, lashes, mascara, hairstyle, wedding, married, getting ready, lashes, lashes, lashes, lashes, lashes, mascara, mascara'),
  hit(7061934, 1280, 853, 'couple-love-romance-together-7061934', 'couple, love, romance, together, outdoors, man, woman, nature, sunset, talk, talk, talk, talk, talk, talk'),
  hit(6027213, 1280, 853, 'man-viking-axe-knight-medieval-6027213', 'man, viking, axe, knight, medieval, warrior, battle, fantasy, weapon, scandinavian, fighter, barbarian, viking, viking, viking, viking, viking, warrior'),
  hit(5935801, 1280, 853, 'women-market-african-scene-talk-5935801', 'women, market, african, scene, talk, table, adults, people, life, outdoors, lifestyle, africa, african, african, african, african, african, talk, people, africa'),
  hit(5060639, 1280, 853, 'man-talking-seated-call-looking-5060639', 'man, talking, seated, call, looking, mobile, gray mobile, gray talk, gray talking'),
  hit(5446268, 1280, 912, 'woman-smiling-black-woman-ethnic-5446268', 'woman, smiling, black woman, ethnic, conversation, communication, smile, people, talk, person, girl, talking, women, face, cute, contact, information, black woman, black woman, black woman'),
  hit(451281, 1280, 932, 'career-man-laugh-smile-happy-451281', 'career, man, laugh, smile, happy, relaxed, glasses, open, on the places, finished, los, begin, beginning, starting shot, at the beginning, entry, profession, get ahead, opportunities, young people'),
  hit(1565486, 1280, 853, 'softball-player-girl-action-1565486', 'softball, player, girl, action, short stop, focused, competition, game, teen, play, uniform, female, athlete, field, sport, teenager, infield, base, concentration, glove'),
  hit(3036181, 1280, 853, 'businessman-man-afraid-angry-3036181', 'businessman, man, 4k wallpaper, afraid, angry, announce, boss, beautiful wallpaper, business, laptop wallpaper, wallpaper hd, employee, fear, full hd wallpaper, loud, loudspeaker, male, megaphone, shout, desktop backgrounds'),
  hit(9738545, 1280, 853, 'woman-samurai-ninja-cosplay-katana-9738545', 'woman, samurai, ninja, cosplay, katana, sword, killer, warrior, japanese style, oriental, asiatic, latex, overalls, black suit, pose, fighting posture, rack'),
  hit(6881081, 1280, 853, 'tennis-sports-girl-6881081', 'tennis, sports, girl, physical education, physical education, physical education, physical education, physical education, physical education'),
  hit(6274746, 1280, 960, 'sisters-secret-whisper-kids-6274746', 'sisters, secret, whisper, kids, children, girls, young, family, friends, friendship, gossip, whispering, happy, smile, portrait, friendship day, whisper, whisper, whisper, whisper'),
  hit(1584808, 1280, 914, 'softball-player-female-infielder-1584808', 'softball, player, female, infielder, sport, uniform, teen, competition, game, teenager, concentration, glove, ballgame, young, infield, girl, athlete, watching, action, athletic'),
  hit(3826830, 1280, 854, 'children-girls-conversation-3826830', 'children, girls, conversation, discussion, translate, gestures, childhood, friend, people, together, game, conversation, conversation, conversation, conversation, conversation'),
  hit(7971754, 1280, 854, 'digital-marketing-advertising-man-7971754', 'digital, marketing, advertising, man, portrait, concept, marketing, marketing, marketing, marketing, marketing, advertising, advertising, concept'),
  hit(3100981, 1280, 427, 'car-communication-conversation-3100981', 'car communication, conversation, self talk, inner dialogue, communication, faces, woman, contact, dialog, smartphone, mobile, compared to, mirrors, mirror image, to speak, psychology, voice, interior, process, intrapersonal communication'),
  hit(4622280, 1280, 921, 'india-colorful-culture-discussion-4622280', 'india, colorful, culture, discussion, color, asia, hinduism, religion, people, hindu, worker, tourism, traditional, travel, portrait, strong, female, fashion, woman, wonderful'),
  hit(7269055, 1280, 853, 'men-friends-talk-people-greece-7269055', 'men, friends, talk, people, greece, street cafe, meet, discuss, typical greece, old men, outdoors'),
  hit(7765672, 1280, 720, 'lake-fishing-people-exercise-7765672', 'lake, fishing, people, exercise, open air, mild weather, walk, sport, relationship, landscape, park, nature, to run, talk, communication'),
  hit(8318489, 1280, 853, 'people-dinning-outdoors-terrace-8318489', 'people, dinning, outdoors, terrace, restaurant, girls, sitting, backgammon, relaxation, talk, drinks, lifestyle, nature, urban, plants, autumn'),
  hit(835890, 1280, 960, 'volleyball-women-game-sport-young-835890', 'volleyball, women, game, sport, young, people, lifestyle, fitness, athlete, person, exercise, fun, volleyball, volleyball, volleyball, volleyball, volleyball'),
  hit(10322093, 1280, 956, 'meeting-discussion-caf%C3%A9-coffee-10322093', 'meeting, discussion, café, coffee, suit, collaboration, older man, young man, serious, bar, table, concentrated, young, older, networking, partner, working relations, interaction, consulting'),
  hit(3100980, 1280, 800, 'car-communication-conversation-3100980', 'car communication, conversation, self talk, inner dialogue, communication, faces, woman, contact, dialog, window, compared to, mirrors, mirror image, to speak, psychology, voice, interior, process, intrapersonal communication, i'),
  hit(1577606, 1280, 1024, 'softball-batter-female-hitter-1577606', 'softball, batter, female, hitter, focus, concentration, game, competition, bat, helmet, uniform, player, competitive, playing, watching, athlete, home, sport, play, action'),
  hit(3746871, 1280, 853, 'baby-girl-kids-childhood-people-3746871', 'baby, girl, kids, childhood, people, faces, summer, entertainment, happiness, person, nature, talk'),
  hit(1572951, 1280, 825, 'softball-first-baseman-girl-player-1572951', 'softball, first baseman, girl, player, athlete, base, game, glove, play, active, summer, nature, competition, concentration, crouched, female, infield, prepared, ready, teen'),
  hit(1533195, 1280, 852, 'football-teenager-greenery-sports-1533195', 'football, teenager, greenery, sports, child, training, ball, goalkeeper, football, goalkeeper, goalkeeper, goalkeeper, goalkeeper, goalkeeper'),
  hit(10283016, 1280, 715, 'ai-generated-therapy-psychologist-10283016', 'ai generated, therapy, psychologist, office, woman, patient, conversation, two people, session, psychology, therapist, consultation, counseling, interior, discussion, help, professional, psychoanalysis, clinic, books', 'png'),
  hit(3818482, 1280, 853, 'young-man-male-boy-japanese-anime-3818482', 'young, man, male, boy, japanese, anime, cartoon, television, youtube, film, video, series, basket, ball, sports, character, toy, figurine, small, painted'),
  hit(5446270, 1280, 853, 'conversation-phone-call-smartphone-5446270', 'conversation, phone, call, smartphone, communication, mobile, talking, contact, talk, cellphone, telephone, technology, message, chat, communicate, connection, cellular, modern, woman, black woman'),
  hit(3100983, 1280, 800, 'car-communication-conversation-3100983', 'car communication, conversation, self talk, inner dialogue, communication, faces, man, figure, comic, phone, make a phone call, contact, dialog, window, compared to, mirrors, mirror image, to speak, psychology, voice'),
  hit(1578185, 1280, 848, 'groom-wedding-marriage-elegant-man-1578185', 'groom, wedding, marriage, elegant, man, to marry, weddingfeast, fixed, shoes, before, preparation, firstlook, commitment, festive'),
  hit(3203095, 1280, 853, 'people-grown-up-portrait-a-male-3203095', 'people, grown up, portrait, a, male, side view, facial expression, father son, to talk, conversation, secret, love, father son, father son, father son, father son, father son, conversation, conversation'),
  hit(4998990, 1280, 853, 'women-talk-sit-phone-female-said-4998990', 'women, talk, sit, phone, female, said, young, people, said, said, said, said, said'),
  hit(3600555, 1280, 442, 'silence-talk-freedom-of-speech-3600555', 'silence, talk, freedom of speech, woman, girl, to speak, finger, lips, quiet, calm, taboo, communication, flood of speech, taboo, taboo, taboo, taboo, taboo'),
  hit(2717014, 1280, 848, 'office-business-notebook-statistics-2717014', 'office, business, notebook, statistics, technology, digital, computer, internet, marketing, accounting, corporate, job, communication, creative, table, meeting, businessman, ideas, woman, project'),
  hit(5277513, 1280, 853, 'sports-young-team-train-talk-5277513', 'sports, young, team, train, talk, field, football, baseball, far, line, green, active, coach, teach, kit, group, spirit, people, grow, learn'),
  hit(4116444, 1280, 428, 'car-communication-conversation-4116444', 'car communication, conversation, self talk, inner dialogue, communication, faces, man, contact, dialog, smartphone, mobile, compared to, mirrors, mirror image, to speak, psychology, voice, interior, process, intrapersonal communication'),
  hit(3105927, 1280, 800, 'car-communication-conversation-3105927', 'car communication, conversation, self talk, inner dialogue, communication, faces, woman, contact, dialog, smartphone, mobile, compared to, mirrors, mirror image, to speak, psychology, voice, interior, process, intrapersonal communication'),
]

/** a home-page search (horizontal or vertical, people) whose words this fixture could not recover from its key; Pixabay answered pets and their owners; key `19aae3eb5dd061c944f5a483d98fe2be93ea66e7bcc5d95c4fbfa68d1563443f`, answered 2026-10-18T19:44:21.415Z. */
export const PETS_AND_OWNERS_UNNAMED: StockPhoto[] = [
  hit(1838969, 1280, 660, 'standup-paddleboarding-man-dog-1838969', 'standup paddleboarding, animal, man, dog, friendship, companion, pet, owner, paddleboard, paddle, together, stand, standing, ocean, person, nature, sea, surfboard, water, leisure'),
  hit(5623231, 1280, 853, 'girl-dog-pet-friendship-companion-5623231', 'girl, dog, pet, friendship, companion, owner, caucasian, blonde, caucasian female, blonde female, canine, domestic dog, doggy, happy, animal, nature, love, woman, cute, puppy'),
  hit(3344414, 1280, 854, 'dog-adorable-animal-cute-happiness-3344414', 'dog, nature, adorable, animal, cute, happiness, happy, man, pet, portrait, puppy, purebred, retriever'),
  hit(5751151, 1280, 853, 'dog-woman-owner-pet-companion-5751151', 'dog, woman, owner, pet, animal, companion, friends, friendship, canine, fur, furry, furry dog, mammal, adorable, cuddle, cute'),
  hit(1868563, 1280, 853, 'man-kitten-pet-owner-kitty-tabby-1868563', 'man, kitten, pet, owner, kitty, tabby, cat, gray tabby, tabby cat, adorable, animal, cute, feline, nature, caring, hands, holding, portrait'),
  hit(5249583, 1280, 887, 'arabian-horse-horse-man-golden-hour-5249583', 'arabian horse, horse, man, golden hour, mane, equestrian, animal, nature, portrait, horse, horse, horse, horse, horse'),
  hit(237193, 1280, 853, 'dog-puppy-bath-water-person-girl-237193', 'dog, puppy, nature, bath, animal, water, person, girl, friendship, kiss, pet'),
  hit(2607704, 1280, 854, 'animals-dogs-friendship-pets-eyes-2607704', 'animals, dogs, friendship, pets, eyes, muzzle, adorable, nature, miniature, man, male, people, owner, love, love wallpaper'),
  hit(3047316, 1280, 853, 'business-businessman-closing-couch-3047316', 'business, businessman, closing, couch, display, indian, male, man, market, metal, metallic, motor, motorcycle, rider, owner, person, seller, shop, shop owner, sitting'),
  hit(5753302, 1280, 853, 'dog-pet-pet-owner-animal-owner-5753302', 'dog, pet, pet owner, animal, owner, domestic dog, canine, harness, dog harness, mammal, cute, adorable, woman, female, nature, outdoors, saxony, germany, leipzig'),
  hit(2557396, 1280, 853, 'people-girls-women-students-2557396', 'people, girls, women, students, friends, talking, meeting, study, group, activity, homework, group work, brainstorming, group study, people, people, people, students, students, students'),
  hit(594090, 1280, 853, 'startup-meeting-brainstorming-594090', 'startup, meeting, brainstorming, business, teamwork, team, people, office, group, corporate, conference, colleagues, company, partnership, seminar, project, table, professionals, casual, partners'),
  hit(594091, 1280, 853, 'meeting-brainstorming-business-594091', 'meeting, brainstorming, business, teamwork, team, people, office, group, corporate, conference, colleagues, company, partnership, project, table, partners, plan, sketch, notepad, coworkers'),
  hit(594132, 1280, 853, 'office-startup-business-home-office-594132', 'office, startup, business, home office, businessman, notebook, laptop, computer, company, people, marketing, planning, strategy, project, creative, technology, start-up, organization, development, commerce'),
  hit(2284501, 1280, 800, 'meeting-business-architect-office-2284501', 'meeting, business, architect, office, team, plan, blueprints, teamwork, group, people, project, workplace, table, desk, meeting, meeting, meeting, business, business, business'),
  hit(1868728, 1280, 853, 'concept-man-papers-person-plan-1868728', 'concept, man, papers, person, plan, planning, research, thinking, whiteboard, blue paper, blue thinking, blue research, blue plan, blue planning, blue think, plan, plan, planning, planning, research'),
  hit(2557399, 1280, 853, 'people-girls-women-students-2557399', 'people, girls, women, students, friends, study, school, activity, homework, colorful, pens, drawing, sketch, students, students, students, friends, study, study, school'),
  hit(8441683, 1280, 938, 'girls-pretty-fashion-reviewing-8441683', 'girls, pretty, fashion, reviewing, photos, smartphone, outdoors, winter, women'),
  hit(841174, 1280, 858, 'company-model-woman-message-girl-841174', 'company, model, woman, message, girl, open, model, woman, message, message, message, open, open, open, open, open'),
  hit(888389, 1280, 740, 'woman-portrait-dog-hobby-pet-888389', 'woman, portrait, dog, hobby, pet, doberman pinscher, nature, friendship, people, animal, animals'),
  hit(5467838, 1280, 854, 'woman-entrepreneur-owner-business-5467838', 'woman, entrepreneur, owner, business, shop, store, clothing, manager, saleswoman, retail, sales, small business, retail, small business, small business, small business, small business, small business'),
  hit(4070864, 1280, 854, 'people-woman-sitting-two-together-4070864', 'people, woman, sitting, two, together, bench, togetherness, friends, dog, animal, pet, domestic, nature, park, brown dog, brown animals, brown park, brown pets, brown together'),
  hit(8699010, 1280, 1024, 'man-dog-pet-canine-animal-owner-8699010', 'man, dog, pet, canine, animal, owner, nature, leash, street, urban, friendship, lifestyle'),
  hit(7109714, 1280, 853, 'shetland-sheepdog-friendship-pet-7109714', 'shetland sheepdog, friendship, pet, dog, nature, companion, woman, owner, animal, raise, canine, young girl lou'),
  hit(867238, 1280, 853, 'dog-friend-companion-pet-animal-867238', 'dog, friend, companion, pet, animal, cute, puppy, young, portrait, happy, canine, friendship, funny, nature, doggy, love, adorable, domestic, together, white'),
  hit(4411622, 1280, 720, 'chihuahua-scared-astonished-fun-4411622', 'chihuahua, scared, astonished, fun, small, cute, dog, animal, on the lap, man, hands, poor, animal portrait, love, lifestyle, loyal friend, maul, pet, nose, snout'),
  hit(1551705, 1280, 848, 'leisure-time-leisure-activities-1551705', 'leisure time, leisure activities, dog photography, pet, dog, dog runs, animal, nature, fun, dog human, dog with human, comrade, plays, action, dog plays, dogs portrait, portrait, man dog, dog with man, forest'),
  hit(2352886, 1280, 1019, 'friendship-domestic-animal-bulldog-2352886', 'friendship, domestic animal, bulldog, trust, rule, family, snout, wildlife, fur, animal, race, together, dog portrait, dog look, to sit, rude, loyal to, human, man, riverbank'),
  hit(3226922, 1280, 849, 'dog-canine-mammal-animal-white-dog-3226922', 'dog, canine, mammal, animal, white dog, leash, man, person, people, walking the dog, pet, leg, foot, nature, road'),
  hit(5786067, 1280, 839, 'dog-large-poodle-the-person-walk-5786067', 'dog, animal, large poodle, the person, walk, owner, leash, friendship, pet, road, dog walk, purebred dogs, walking, autumn, domestic dogs, purebred dog, on a leash, the side of the road'),
  hit(2897935, 1280, 853, 'white-dog-golden-retriever-animal-2897935', 'white dog, golden retriever, animal, puppy, white, furry, hdr, look, lake, portrait, pet, friend, hair, walk, vigilance, pure-breed dog, man\'s friend, dog, autumn, seasons'),
  hit(6467803, 1280, 1072, 'man-dog-pet-brown-dog-leash-6467803', 'man, dog, pet, brown dog, leash, dog owner, walk, leisure, together, friendship, pavement, street, outdoors, animal, urban, city'),
  hit(6015991, 1280, 853, 'civita-di-bathroom-town-bridge-6015991', 'civita di bathroom, town, bridge, owner, pet, person, human, townscape, buildings, old town, hill, hilltop, italy, tuscany, architecture, old, landscape, nature, hilltop, hilltop'),
  hit(888409, 1280, 831, 'woman-dog-pacsi-paw-hobby-pet-888409', 'woman, dog, nature, pacsi, animal, paw, hobby, pet, doberman pinscher, friendship, people, animals'),
  hit(163341, 1280, 854, 'kat-people-face-person-animals-163341', 'kat, people, face, nature, person, animals, cats, pet, brown pets'),
  hit(2680910, 1280, 960, 'man-dog-company-grandfather-2680910', 'man, dog, company, grandfather, grandpa, old man, older, senior, retired, pensionary, retirees, old age, pet, animal love, labrador, companion, together, trust, friendship, a friend'),
  hit(7645685, 1280, 853, 'living-room-interior-woman-7645685', 'living room, interior, woman, evening dress, young woman, sheath dress, house, apartment, space, owner, mistress, fashion, style, beautiful, model, pose, apartments, living room, living room, living room'),
  hit(743429, 1280, 850, 'sunset-dog-owner-man-nature-743429', 'sunset, dog, owner, man, nature, sweden, pet, animal, brown dog, brown sunset'),
  hit(9607514, 1280, 853, 'dog-pet-leash-drinking-water-9607514', 'dog, pet, animal, leash, drinking, water, people, owner, nature, keeping, hands, arms, outdoors, park, fountain'),
  hit(5818108, 1280, 853, 'woman-dog-canine-friendship-pet-5818108', 'woman, dog, canine, friendship, pet, labrador, girl, owner, companion, happy, puppy, cute, animal, outside, outdoors, park, portrait, nature'),
]
