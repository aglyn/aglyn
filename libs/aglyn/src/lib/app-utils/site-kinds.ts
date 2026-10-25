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

/**
 * The kinds of website a new site starts as (AGL-3660, AGL-4049): business,
 * trades, restaurant, portfolio and the rest, each with the words that name
 * it and the starter whose shape it follows.
 *
 * The platform's vocabulary, not one plugin's. The AI site start offers these
 * kinds as its cards and layers a look family and page guidance over each
 * (the AI plugin's `ai-site-kinds.ts`, which merges its own rows over these by
 * id), and a site starter from the marketplace is filed under one of them
 * (`site-starter.ts`), so a starter search and a guided start offer the same
 * kinds in the same order.
 *
 * Pure data and a deterministic classifier, safe for any surface to import:
 * no theme, no network, no model call.
 */

export interface SiteKind {
  /** A persisted identifier: the guided start's answer, the job's `siteKind` input and a starter's kind facet. */
  id: string
  /** The card's title, in customer copy. */
  label: string
  /** One line under it. */
  blurb: string
  /** A word from the icon set the card shows. */
  icon: string
  /**
   * Specific nouns and phrases that name this kind on their own ("roofer",
   * "law firm", "food bank"), matched whole and singular or plural. One is
   * enough to pick the kind ({@link siteKindFor}).
   */
  keywords: readonly string[]
  /**
   * Generic words that only lean toward this kind ("club", "studio",
   * "classes", "shop"): they add a little weight, break a tie, and never pick
   * a narrow kind on their own.
   */
  hints: readonly string[]
  /** The starter whose shape this kind follows, where one fits (`STARTER_TEMPLATES`). */
  starter: string
}

/**
 * The kinds, in the order the guided start shows them. Drawn from the template
 * categories the large site builders offer, merged where two would build the
 * same site: designer and agency are one studio, law and accounting one
 * practice, health and therapy one wellness kind.
 */
export const SITE_KINDS: readonly SiteKind[] = [
  {
    id: 'business',
    label: 'Business & services',
    blurb: 'Say what you do, why choose you, and how to reach you',
    icon: 'briefcase',
    keywords: ['cleaning service', 'cleaning company', 'house cleaning', 'cleaner', 'janitorial', 'maid', 'groomer', 'grooming', 'dog walker', 'dog walking', 'pet sitter', 'pet sitting', 'dog trainer', 'dog training', 'staffing', 'print shop', 'printing', 'courier', 'laundromat', 'dry cleaner', 'tailor', 'alterations', 'car wash', 'detailing', 'small business'],
    hints: ['business', 'company', 'service', 'local', 'pet', 'dog', 'cleaning', 'customers'],
    starter: 'business',
  },
  {
    id: 'trades',
    label: 'Home services & trades',
    blurb: 'Roofers, plumbers, towing, landscaping: bold, direct, built on trust',
    icon: 'wrench',
    keywords: ['roofer', 'roofing', 'plumber', 'plumbing', 'electrician', 'electrical', 'hvac', 'heating and cooling', 'towing', 'tow truck', 'roadside assistance', 'landscaping', 'landscaper', 'lawn care', 'contractor', 'general contractor', 'construction', 'handyman', 'house painter', 'house painting', 'movers', 'moving company', 'exterminator', 'pest control', 'remodeling', 'renovation', 'mechanic', 'auto repair', 'auto body', 'locksmith', 'flooring', 'fencing', 'pool cleaning', 'pool service', 'welder', 'welding', 'carpenter', 'carpentry', 'masonry', 'concrete', 'drywall', 'gutter', 'siding', 'garage door', 'tree service', 'arborist', 'junk removal', 'septic', 'pressure washing', 'power washing', 'appliance repair'],
    hints: ['repair', 'auto', 'garage', 'painting', 'painter', 'pool', 'moving', 'trade', 'trades', 'homeowner', 'pest', 'installation', 'emergency'],
    starter: 'business',
  },
  {
    id: 'professional',
    label: 'Law, finance & consulting',
    blurb: 'Law firms, accountants, advisers: calm, established, credible',
    icon: 'scale',
    keywords: ['law', 'law firm', 'lawyer', 'attorney', 'legal', 'paralegal', 'accountant', 'accounting', 'cpa', 'tax', 'bookkeeping', 'bookkeeper', 'financial', 'financial advisor', 'wealth management', 'advisor', 'adviser', 'advisory', 'consulting', 'consultant', 'insurance', 'notary', 'mediator', 'mediation', 'estate planning'],
    hints: ['firm', 'practice', 'clients', 'compliance'],
    starter: 'business',
  },
  {
    id: 'wellness',
    label: 'Health & wellness',
    blurb: 'Therapists, clinics, dentists, coaches: warm, reassuring, clear',
    icon: 'heart',
    keywords: ['therapist', 'therapy', 'counselor', 'counseling', 'counselling', 'psychologist', 'psychiatrist', 'psychotherapy', 'dentist', 'dental', 'orthodontist', 'clinic', 'doctor', 'physician', 'pediatrician', 'optometrist', 'chiropractor', 'chiropractic', 'massage', 'wellness', 'nutrition', 'nutritionist', 'dietitian', 'acupuncture', 'physio', 'physiotherapy', 'physical therapy', 'mental health', 'medical', 'vet', 'veterinary', 'veterinarian', 'animal hospital', 'midwife', 'doula', 'naturopath', 'life coach', 'health coach', 'wellness coach', 'home care', 'senior care'],
    hints: ['health', 'healing', 'coach', 'coaching', 'patient', 'care', 'practice', 'mental', 'anxiety'],
    starter: 'business',
  },
  {
    id: 'restaurant',
    label: 'Restaurant & café',
    blurb: 'Warm, photo-led pages for food, drink and a place to visit',
    icon: 'utensils',
    keywords: ['restaurant', 'cafe', 'coffee', 'coffee shop', 'coffee house', 'bakery', 'baker', 'pastry', 'cake', 'cupcake', 'bistro', 'diner', 'pizzeria', 'pizza', 'catering', 'caterer', 'brewery', 'winery', 'wine bar', 'distillery', 'taproom', 'food truck', 'deli', 'chef', 'personal chef', 'tavern', 'pub', 'eatery', 'tea room', 'tea house', 'ice cream', 'creamery', 'donut', 'bagel', 'taqueria', 'sushi', 'bbq', 'barbecue', 'ramen', 'cocktail', 'juice bar', 'brunch'],
    hints: ['food', 'kitchen', 'bar', 'tea', 'truck', 'breakfast', 'lunch', 'dinner', 'dining', 'menu', 'drinks', 'meal', 'wine', 'beer'],
    starter: 'business',
  },
  {
    id: 'store',
    label: 'Online store',
    blurb: 'Product-first pages for things you sell',
    icon: 'bag',
    keywords: ['online store', 'online shop', 'web shop', 'boutique', 'ecommerce', 'e-commerce', 'merch', 'merchandise', 'jewelry', 'jewellery', 'clothing', 'apparel', 'candle', 'soap', 'etsy', 'gift shop', 'bookstore', 'bookshop', 'florist', 'flower shop', 'plant shop', 'retail', 'wholesale', 'subscription box', 'thrift', 'sneakers'],
    hints: ['store', 'shop', 'market', 'product', 'sell', 'selling', 'buy', 'order', 'brand', 'handmade', 'goods', 'gifts', 'collection', 'shipping'],
    starter: 'physical-shop',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    blurb: 'Minimal, image-led pages that put the work first',
    icon: 'grid',
    keywords: ['portfolio', 'illustrator', 'illustration', 'artist', 'visual artist', 'architect', 'architecture', 'software engineer', 'developer', 'copywriter', 'animator', 'freelance', 'freelancer', 'ceramics', 'ceramicist', 'potter', 'pottery', 'sculptor', 'sculpture', 'woodworker', 'woodworking', 'printmaker', 'textile artist'],
    hints: ['art', 'maker', 'work', 'gallery', 'painter', 'paintings', 'commissions', 'writer', 'engineer', 'projects'],
    starter: 'portfolio',
  },
  {
    id: 'studio',
    label: 'Design studio & agency',
    blurb: 'Bold type and case studies for creative teams',
    icon: 'sparkle',
    keywords: ['design studio', 'creative studio', 'creative agency', 'design agency', 'marketing agency', 'digital agency', 'ad agency', 'branding agency', 'branding', 'brand identity', 'marketing', 'digital marketing', 'advertising', 'web design', 'web designer', 'web development', 'graphic design', 'graphic designer', 'motion design', 'video production', 'production company', 'animation', 'seo'],
    hints: ['agency', 'design', 'designer', 'creative', 'studio', 'digital', 'web', 'video', 'production', 'brand', 'campaign', 'case studies'],
    starter: 'portfolio',
  },
  {
    id: 'photography',
    label: 'Photography',
    blurb: 'Galleries first, words second',
    icon: 'camera',
    keywords: ['photographer', 'photography', 'videographer', 'videography', 'wedding photographer', 'wedding photography', 'portrait', 'headshot', 'photo studio', 'photo booth'],
    hints: ['photo', 'gallery', 'shoot', 'sessions', 'prints', 'camera'],
    starter: 'portfolio',
  },
  {
    id: 'blog',
    label: 'Blog & writing',
    blurb: 'Reading-first pages with a calm serif voice',
    icon: 'book',
    keywords: ['blog', 'blogger', 'food blog', 'travel blog', 'journal', 'magazine', 'newsletter', 'podcast', 'podcaster', 'essays', 'author', 'novelist', 'poet', 'poetry', 'publication', 'zine', 'columnist', 'substack'],
    hints: ['writing', 'stories', 'reading', 'readers', 'articles', 'posts', 'recipes', 'reviews', 'guides', 'tips', 'writer', 'episodes', 'listeners'],
    starter: 'business',
  },
  {
    id: 'events',
    label: 'Events & weddings',
    blurb: 'Dates, places and the details guests need',
    icon: 'calendar',
    keywords: ['wedding', 'conference', 'festival', 'gala', 'summit', 'event venue', 'wedding venue', 'venue', 'event planner', 'wedding planner', 'event planning', 'reunion', 'trade show', 'expo', 'hackathon', 'convention', 'birthday party', 'banquet', 'party rentals'],
    hints: ['event', 'party', 'meetup', 'retreat', 'workshop', 'planner', 'rsvp', 'tickets', 'celebration', 'guests', 'schedule', 'concert', 'fundraiser'],
    starter: 'landing',
  },
  {
    id: 'fitness',
    label: 'Fitness & sports',
    blurb: 'Gyms, trainers and studios with energy',
    icon: 'bolt',
    keywords: ['gym', 'fitness', 'personal trainer', 'personal training', 'trainer', 'crossfit', 'boxing', 'kickboxing', 'martial arts', 'martial', 'karate', 'judo', 'jiu jitsu', 'taekwondo', 'mma', 'pilates', 'bootcamp', 'boot camp', 'sports', 'sport', 'running', 'runner', 'marathon', 'triathlon', 'cycling', 'climbing', 'bouldering', 'dance', 'swim', 'swimming', 'soccer', 'football', 'basketball', 'baseball', 'softball', 'volleyball', 'tennis', 'pickleball', 'golf', 'hockey', 'rugby', 'lacrosse', 'wrestling', 'gymnastics', 'athletics', 'athlete', 'strength training', 'weightlifting', 'powerlifting', 'health club', 'league'],
    hints: ['training', 'team', 'workout', 'coach', 'coaching', 'studio', 'members', 'race', 'game', 'tournament'],
    starter: 'business',
  },
  {
    id: 'yoga',
    label: 'Yoga & mindfulness',
    blurb: 'Calm, spacious pages for classes and retreats',
    icon: 'leaf',
    keywords: ['yoga', 'meditation', 'mindfulness', 'breathwork', 'reiki', 'sound bath', 'sound healing', 'tai chi', 'qigong'],
    hints: ['retreat', 'spa', 'calm', 'studio', 'healing', 'stillness'],
    starter: 'business',
  },
  {
    id: 'beauty',
    label: 'Beauty & salon',
    blurb: 'Salons, barbers, spas and studios with style',
    icon: 'scissors',
    keywords: ['salon', 'hair salon', 'hair', 'hairdresser', 'hairstylist', 'barber', 'barbershop', 'nails', 'nail salon', 'beauty', 'makeup', 'lashes', 'brows', 'esthetician', 'aesthetician', 'skincare', 'skin care', 'facial', 'waxing', 'tattoo', 'piercing', 'stylist', 'spa', 'day spa', 'med spa', 'blowout'],
    hints: ['studio', 'glam', 'appointments', 'cosmetics'],
    starter: 'business',
  },
  {
    id: 'realestate',
    label: 'Real estate',
    blurb: 'Agents, brokers and property: polished and local',
    icon: 'home',
    keywords: ['real estate', 'realtor', 'realty', 'brokerage', 'broker', 'property', 'property management', 'rentals', 'apartment', 'mortgage', 'airbnb', 'vacation rental', 'short term rental', 'listings', 'condo', 'home builder', 'homebuilder'],
    hints: ['homes', 'house', 'buyers', 'sellers', 'vacation', 'cabin', 'neighborhoods', 'investors'],
    starter: 'business',
  },
  {
    id: 'education',
    label: 'Courses & education',
    blurb: 'Tutors, schools and courses, clear and encouraging',
    icon: 'school',
    keywords: ['course', 'online course', 'school', 'tutoring', 'tutor', 'teacher', 'teaching', 'lessons', 'academy', 'education', 'educational', 'learning', 'daycare', 'day care', 'preschool', 'kindergarten', 'music lessons', 'piano lessons', 'driving school', 'driving lessons', 'language school', 'coding bootcamp', 'curriculum', 'homeschool', 'montessori', 'summer camp'],
    hints: ['classes', 'students', 'learn', 'kids', 'training', 'camp', 'workshop', 'beginners'],
    starter: 'business',
  },
  {
    id: 'nonprofit',
    label: 'Nonprofit & community',
    blurb: 'A cause, its impact and how to help',
    icon: 'hands',
    keywords: ['nonprofit', 'non-profit', 'charity', 'charitable', 'foundation', 'church', 'parish', 'congregation', 'mosque', 'synagogue', 'temple', 'ministry', 'food bank', 'food pantry', 'pantry', 'shelter', 'animal shelter', 'animal rescue', 'rescue', 'volunteer', 'association', 'homeowners association', 'neighborhood association', 'hoa', 'pta', 'pto', 'parent teacher association', 'ngo', 'donate', 'donation', 'fundraising', 'mutual aid', 'community center', 'senior center', 'makerspace', 'hackerspace', 'guild', 'rotary', 'advocacy', 'coalition', 'civic', 'veterans'],
    hints: ['community', 'club', 'group', 'troupe', 'circle', 'society', 'collective', 'members', 'neighbors', 'neighborhood', 'join', 'meetup', 'gathering', 'mission', 'cause', 'together', 'fellowship', 'faith', 'fundraiser', 'residents', 'families'],
    starter: 'business',
  },
  {
    id: 'music',
    label: 'Music & bands',
    blurb: 'Artists, bands and DJs, loud and visual',
    icon: 'music',
    keywords: ['band', 'musician', 'music', 'dj', 'singer', 'songwriter', 'singer-songwriter', 'rapper', 'music producer', 'recording studio', 'record label', 'orchestra', 'choir', 'composer', 'jazz', 'ensemble', 'quartet', 'pianist', 'guitarist', 'drummer', 'violinist', 'tour dates', 'album', 'live music', 'music artist', 'folk band', 'rock band', 'punk band', 'metal band', 'country band', 'bluegrass band', 'cover band', 'wedding band', 'party band', 'duo', 'trio', 'hip hop', 'hip hop artist', 'rap', 'mixtape', 'ep', 'gig', 'discography', 'setlist', 'bandcamp'],
    hints: ['folk', 'indie', 'bluegrass', 'punk', 'metal', 'record', 'concert', 'tour', 'song', 'shows', 'tracks', 'producer', 'fans', 'listen'],
    starter: 'landing',
  },
  {
    id: 'personal',
    label: 'Personal & resume',
    blurb: 'A simple page about you and your work',
    icon: 'person',
    keywords: ['personal site', 'personal website', 'personal page', 'personal homepage', 'about me', 'resume', 'cv', 'online resume', 'job seeker', 'job search', 'candidate', 'speaker', 'public speaker', 'link in bio'],
    hints: ['me', 'myself', 'profile', 'job', 'career', 'hire', 'recruiters'],
    starter: 'portfolio',
  },
  {
    id: 'landing',
    label: 'Landing page',
    blurb: 'One page that leads to one action',
    icon: 'rocket',
    keywords: ['landing page', 'landing', 'app', 'mobile app', 'startup', 'saas', 'software', 'waitlist', 'wait list', 'ebook', 'webinar', 'lead magnet', 'product launch', 'signup page', 'sign-up page'],
    hints: ['product', 'launch', 'campaign', 'offer', 'users', 'download', 'platform', 'tool', 'beta'],
    starter: 'landing',
  },
  {
    id: 'coming-soon',
    label: 'Coming soon',
    blurb: 'A placeholder that collects interest',
    icon: 'clock',
    keywords: ['coming soon', 'prelaunch', 'pre-launch', 'under construction', 'placeholder', 'opening soon', 'launching soon'],
    hints: ['soon'],
    starter: 'landing',
  },
]

/** A kind by id, or `null`. */
export function siteKind(id: unknown): SiteKind | null {
  if (typeof id !== 'string' || !id) return null
  return SITE_KINDS.find((kind) => kind.id === id) ?? null
}

/** One word as the classifier compares it: lower case, unaccented, singular. */
const stem = (word: string): string => {
  if (word.length <= 3) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(?:ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

/** A text as the classifier's words ("Cafés & non-profits" → cafe, &, non, profit). */
const tokens = (text: string): string[] =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9&]+/)
    .filter(Boolean)
    .map(stem)

/**
 * Where the head of an answer ends: at its first punctuation or the first
 * word that starts a modifier ("a bookstore WITH author events", "a food blog
 * ABOUT cooking", "a pottery studio: stoneware…"). What comes before is what
 * the site IS; what follows describes it.
 */
const HEAD_END = /[:;,.()—–]|\s-\s|\b(?:with|for|about|that|who|which|where|in|on|at|of|offering|selling|serving|near|from|by|to|booking|touring|playing|performing)\b/i

/**
 * What a match is worth. A specific one-word keyword picks a kind alone; a
 * phrase is worth more than its words (it is the more specific reading, and
 * it claims its words so "wedding photographer" never also counts as a
 * wedding); a hint only leans. The last keyword in the head of the answer —
 * its noun — gets a bonus, so the thing the site is beats what it mentions.
 */
const KEYWORD_WEIGHT = 3
const PHRASE_WEIGHT_PER_WORD = 2
const HINT_WEIGHT = 1
const HEAD_NOUN_BONUS = 2
/** A generic head noun with nothing specific said: enough to clear {@link MIN_SCORE} alone, never to beat a keyword. */
const HEAD_HINT_BONUS = 1
/** "Who it's for" describes the people, not the site, so it counts half. */
const AUDIENCE_SHARE = 0.5
/** Below this no kind is meant: one stray hint is not a reason to pick a narrow vertical. */
const MIN_SCORE = 1.5

interface SiteKindTerm {
  kind: SiteKind
  words: readonly string[]
  weight: number
  keyword: boolean
}

/**
 * Every keyword and hint once per kind (a plural and its singular are one
 * term), longest phrase first so a phrase claims its words before they count
 * alone.
 */
const TERMS: readonly SiteKindTerm[] = SITE_KINDS.flatMap((kind) => {
  const seen = new Set<string>()
  const terms: SiteKindTerm[] = []
  const add = (term: string, keyword: boolean) => {
    const words = tokens(term)
    const key = words.join(' ')
    if (!words.length || seen.has(key)) return
    seen.add(key)
    const weight = !keyword ? HINT_WEIGHT : words.length > 1 ? PHRASE_WEIGHT_PER_WORD * words.length : KEYWORD_WEIGHT
    terms.push({ kind, words, weight, keyword })
  }
  for (const keyword of kind.keywords) add(keyword, true)
  for (const hint of kind.hints) add(hint, false)
  return terms
}).sort((a, b) => b.words.length - a.words.length)

interface SiteKindScore {
  score: number
  /** Where the kind's last match in the answer ends, in words; -1 for none. */
  at: number
}

/** One term found in a text, by word position. */
interface SiteKindMatch {
  kind: SiteKind
  end: number
  keyword: boolean
}

/** Adds what one text says for each kind to `scores`; returns every term it found. */
function siteKindScores(text: string, share: number, scores: Map<SiteKind, SiteKindScore>): SiteKindMatch[] {
  const words = tokens(text)
  const matches: SiteKindMatch[] = []
  // Words a longer term has matched; terms of one length share their words
  // (two kinds may both have "studio"), and a shorter term never reuses them.
  const claimed = new Array<boolean>(words.length).fill(false)
  const pending = new Set<number>()
  const counted = new Set<SiteKindTerm>()
  let length = 0
  for (const term of TERMS) {
    if (term.words.length !== length) {
      length = term.words.length
      for (const index of pending) claimed[index] = true
      pending.clear()
    }
    for (let start = 0; start + term.words.length <= words.length; start++) {
      if (!term.words.every((word, offset) => words[start + offset] === word && !claimed[start + offset])) continue
      const end = start + term.words.length
      for (let index = start; index < end; index++) pending.add(index)
      const entry = scores.get(term.kind) ?? { score: 0, at: -1 }
      if (!counted.has(term)) {
        counted.add(term)
        entry.score += term.weight * share
      }
      entry.at = Math.max(entry.at, end)
      scores.set(term.kind, entry)
      matches.push({ kind: term.kind, end, keyword: term.keyword })
    }
  }
  return matches
}

/**
 * The kind the head of an answer names, if any. Its last keyword when it has
 * one. When nothing specific is said anywhere, its last generic word that
 * belongs to exactly one kind: "a pet store" is a store, "a writers group" a
 * community, "a cooking class studio" a class (studio says nothing, since
 * four kinds share it). A generic word outside the head never counts here.
 */
function siteHeadKind(head: readonly SiteKindMatch[], specific: boolean): SiteKind | null {
  const keywords = head.filter((match) => match.keyword)
  if (keywords.length) return keywords.reduce((last, match) => (match.end > last.end ? match : last)).kind
  if (specific) return null
  const ends = [...new Set(head.map((match) => match.end))].sort((a, b) => b - a)
  for (const end of ends) {
    const kinds = new Set(head.filter((match) => match.end === end).map((match) => match.kind))
    if (kinds.size === 1) return [...kinds][0] as SiteKind
  }
  return null
}

/**
 * The kind a "what kind of site" answer suggests, read with "who it's for"
 * when there is one: the card the guided start selects until the person
 * picks another. Deterministic and local, no model call (AGL-3660).
 *
 * Every kind scores what it finds. A specific keyword ("roofer", "food bank")
 * is enough alone; a phrase outweighs its words and claims them ("wedding
 * photographer" is photography, not events); a generic hint ("club",
 * "studio", "classes", "shop") only leans, so "a neighborhood book club" is
 * community, built from club + neighborhood + meetups + neighbors, and never
 * fitness on "club". The head noun — the last keyword before the answer's
 * first modifier — earns a bonus ("a bookstore with author events" is a
 * store); when the answer and audience name nothing specific, a generic head
 * noun that only one kind has may decide ("a bike shop" is a store, "a hiking
 * group" a community). The audience counts half. The highest score wins; of two equal,
 * the one named later, since English puts the noun last ("a food blog" is a
 * blog). Tricky ones, decided: a band that sells merch is music (the band is
 * the head and the merch only a mention); booking a DJ is music; a music
 * teacher or music lessons are education; a guitar shop or band merch store
 * is a store. A best score of no more than a stray hint, or a tie that order
 * cannot settle, is `business`, the most general kind.
 */
export function siteKindFor(siteType: string, audience = ''): SiteKind {
  const general = SITE_KINDS[0] as SiteKind
  const scores = new Map<SiteKind, SiteKindScore>()
  const found = siteKindScores(siteType, 1, scores)
  const fromAudience = new Map<SiteKind, SiteKindScore>()
  if (audience) found.push(...siteKindScores(audience, AUDIENCE_SHARE, fromAudience))
  const head = siteKindScores(siteType.split(HEAD_END)[0] ?? '', 0, new Map())
  const headKind = siteHeadKind(head, found.some((match) => match.keyword))
  const headEntry = headKind ? scores.get(headKind) : undefined
  if (headEntry) headEntry.score += head.some((match) => match.keyword) ? HEAD_NOUN_BONUS : HEAD_HINT_BONUS
  for (const [kind, { score }] of fromAudience) {
    const entry = scores.get(kind) ?? { score: 0, at: -1 }
    entry.score += score
    scores.set(kind, entry)
  }
  let best: { kind: SiteKind; score: number; at: number } | null = null
  let tied = false
  for (const [kind, { score, at }] of scores) {
    if (!best || score > best.score || (score === best.score && at > best.at)) {
      tied = false
      best = { kind, score, at }
    } else if (score === best.score && at === best.at) {
      tied = true
    }
  }
  if (!best || best.score < MIN_SCORE || tied) return general
  return best.kind
}
