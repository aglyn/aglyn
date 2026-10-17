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
 * PIXABAY'S RECORDED ANSWERS FOR THE BETA.262 ADULT HYBRID LEARNING CENTER
 * START (AGL-3856, job ttzbLqppuu, host 6b5F8a9RUO): what production's
 * `stockPhotoSearches` cache held on 2026-10-16, read back by each search's
 * key, never searched again. Its business type, "LMS", read as the world
 * "lms", so every picture searched "lms" and Pixabay answered a sports car
 * and a Polaroid camera, neither of which named it: the home page shipped
 * with no photo and an empty gray card beside its hero's words. Ids, sizes,
 * page slugs and tags are Pixabay's own, in its order; the contributor is
 * left out.
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

/** `lms` (vertical, min_width 1600), for the hero card beside its words (4 / 5); answered 2026-10-16T23:41:18.032Z. */
export const LMS_HERO: StockPhoto[] = [
  hit(706167, 960, 1280, 'camera-polaroid-old-nostalgia-706167', 'camera, polaroid, old, nostalgia, instant'),
]

/** `lms` (any orientation, min_width 1600); answered 2026-10-16T23:42:23.177Z. */
export const LMS_WIDE: StockPhoto[] = [
  hit(3374112, 1280, 602, 'sports-car-run-uphill-lucchini-lm89-3374112', 'sports car, run uphill, lucchini lm89, motorsport, gp mutschellen 2018'),
  hit(706167, 960, 1280, 'camera-polaroid-old-nostalgia-706167', 'camera, polaroid, old, nostalgia, instant'),
]

/** Seven photos of study and teaching that Pixabay answered OTHER searches with, in the same cache on 2026-10-16: production never sent an education search for this site, so these stand in for its answer. */
export const EDUCATION_HITS: StockPhoto[] = [
  hit(2877134, 1280, 507, 'training-businesswoman-mens-suit-2877134', 'training, businesswoman, men\'s suit, manager, skills, teaching, concept, presentation, coach, trainer, seminar, improvement, tutor, business, work, teacher, practice, talent, skills, skills'),
  hit(5906362, 853, 1280, 'telework-e-learning-girl-laptop-5906362', 'telework, e-learning, girl, laptop, home, woman, remote working, teleworking, working from home, mobile work, remote job, computer, online lessons, online, virtual, technology, telework, e-learning, e-learning, e-learning'),
  hit(1052010, 1280, 960, 'glasses-book-education-eyeglasses-1052010', 'glasses, book, education, eyeglasses, research, knowledge, text, textbook, information, literature, study, read, open, old, vintage, antique, retro, page, literary, book'),
  hit(1428428, 1280, 961, 'open-book-library-education-read-1428428', 'open book, library, education, read, book, school, literature, study, knowledge, text, information, reading, studying, library, education, education, book, book, book, school'),
  hit(849828, 1280, 853, 'student-typing-keyboard-text-woman-849828', 'student, typing, keyboard, text, woman, startup, business, people, students, office, strategy, work, technology, company, corporate, communication, young, plan, marketing, computer'),
  hit(3765909, 1280, 855, 'teacher-property-plant-and-teaching-3765909', 'teacher, property, plant, and teaching, teaching, nature, whiteboard, classroom, smart board, media, training, to learn, school, board, feedback, elementary school'),
  hit(6530416, 853, 1280, 'man-reading-education-portrait-6530416', 'man, reading, education, portrait, beard, glasses, book, wisdom, knowledge, novel, literature, reading, reading, education, education, book, wisdom, wisdom, wisdom, wisdom'),
]
