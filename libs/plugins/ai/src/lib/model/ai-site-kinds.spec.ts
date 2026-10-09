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

import { AI_SITE_KINDS, aiSiteKindFor, aiSiteKindOfInputs } from './ai-site-kinds'

/** [what the site is for, who it is for, the kind it should pick]. */
type Brief = readonly [businessType: string, audience: string, kind: string]

/**
 * Realistic guided-start answers across every kind (AGL-3660), with the
 * generic words that used to decide on their own: club, studio, personal,
 * center, group, classes, shop.
 */
const BRIEFS: readonly Brief[] = [
  // The production miss: "club" picked Fitness & sports.
  ['A neighborhood book club: monthly meetups, the current read, past picks, and a way to join', 'Neighbors on the east side who love reading and want company', 'nonprofit'],
  ['The Riverside chess club: weekly games, a ladder, and a way to join', 'Players of every level in town', 'nonprofit'],
  ['A knitting group that meets at the library on Tuesdays', 'Anyone in the neighborhood who wants to learn or share patterns', 'nonprofit'],
  ['A garden club for our community plot', 'Residents who want to grow vegetables together', 'nonprofit'],
  ['Grace Fellowship, a small church with Sunday services and a youth group', 'Families looking for a church home', 'nonprofit'],
  ['A community food bank with pantry hours and volunteer shifts', 'Families who need groceries and neighbors who want to help', 'nonprofit'],
  ['Our HOA: dues, meeting minutes, pool rules and contacts', 'Homeowners in Willow Creek', 'nonprofit'],
  ['The Lincoln Elementary PTA: fundraisers, volunteer sign-ups and meeting notes', 'Parents and teachers at the school', 'nonprofit'],
  ['A nonprofit animal rescue that places dogs and cats with foster families', 'People who want to adopt, foster or donate', 'nonprofit'],
  ['A youth mentoring charity', 'Donors and volunteers', 'nonprofit'],
  ['A community center with classes and events', 'Seniors and families on the north side', 'nonprofit'],
  ['A quilting guild', 'Quilters in the county', 'nonprofit'],
  // Generic head nouns decide when nothing specific competes.
  ['A pet store', 'Dog and cat owners in town', 'store'],
  ['A bike shop', 'Commuters and weekend riders', 'store'],
  ['A farmers market', 'Families who shop local', 'store'],
  ['A hiking group', 'Outdoor lovers', 'nonprofit'],
  ['A writers group', 'Local writers', 'nonprofit'],
  ['A gaming group', 'Gamers', 'nonprofit'],
  ['An improv theater troupe', 'Comedy fans', 'nonprofit'],
  ['A historical society', 'History buffs in the county', 'nonprofit'],
  ['A makerspace', 'Tinkerers and hobbyists', 'nonprofit'],
  ['A cooking class studio', 'Home cooks', 'education'],
  // Clubs that ARE sport.
  ['A running club with Saturday long runs and a couch-to-5K group', 'Runners of every pace', 'fitness'],
  ['A youth soccer club with spring and fall leagues', 'Parents of kids aged 5 to 14', 'fitness'],
  ['A boxing gym with open sparring', 'Adults who want to get fit', 'fitness'],
  ['Personal trainer offering one-on-one sessions and online programs', 'Busy professionals who want to get stronger', 'fitness'],
  ['A CrossFit box in Denver', 'Athletes of all levels', 'fitness'],
  ['A dance studio for salsa and bachata', 'Couples and singles who want to learn to dance', 'fitness'],
  ['A climbing gym with bouldering and youth teams', 'Climbers and families', 'fitness'],
  // Studios of every kind.
  ['A yoga studio with drop-in classes', 'Beginners and regulars downtown', 'yoga'],
  ['A meditation and breathwork studio', 'Stressed professionals', 'yoga'],
  ['Weekend mindfulness retreats in the mountains', 'People who want to slow down', 'yoga'],
  ['A pottery studio: handmade stoneware, glazes and a gallery of recent work', 'Collectors and people who love handmade things', 'portfolio'],
  ['A photography studio for newborn and family portraits', 'New parents', 'photography'],
  ['A design studio that does branding and websites for restaurants', 'Restaurant owners', 'studio'],
  ['A tattoo studio in Brooklyn', 'People planning their first or next tattoo', 'beauty'],
  ['A creative agency specializing in video production', 'Marketing teams at mid-size companies', 'studio'],
  // "Personal" as an adjective.
  ['Personal chef and private dinner parties', 'Families and hosts in Austin', 'restaurant'],
  ['A personal travel blog about long train journeys', 'Slow travelers', 'blog'],
  ['My personal website', 'Recruiters and hiring managers', 'personal'],
  ['My resume and a few projects', 'Recruiters', 'personal'],
  ['A keynote speaker on leadership', 'Event organizers who book speakers', 'personal'],
  // Restaurants and food.
  ['A neighborhood café with breakfast and pastries', 'Commuters and remote workers', 'restaurant'],
  ['A family bakery with custom cakes', 'Local families planning birthdays', 'restaurant'],
  ['A taco food truck', 'Office workers at lunch', 'restaurant'],
  ['A craft brewery and taproom', 'Beer lovers', 'restaurant'],
  ['An Italian restaurant with a seasonal menu', 'Couples and families', 'restaurant'],
  ['A coffee shop and roastery', 'Students and remote workers', 'restaurant'],
  // Stores.
  ['A candle shop selling hand-poured soy candles', 'Gift buyers', 'store'],
  ['An online store for hand-poured soy candles', 'People who love cozy homes', 'store'],
  ['A vintage clothing boutique', 'Thrifters and collectors', 'store'],
  ['Handmade jewelry I sell online', 'Women who like minimal gold pieces', 'store'],
  ['An independent bookstore with author events', 'Readers in the neighborhood', 'store'],
  ['A plant shop with delivery', 'Apartment dwellers', 'store'],
  // Portfolios.
  ['A ceramic artist portfolio', 'Galleries and collectors', 'portfolio'],
  ['An illustrator portfolio for picture books and editorial work', 'Art directors and publishers', 'portfolio'],
  ['An independent illustrator and designer: a portfolio of editorial illustrations and brand work', 'Art directors', 'portfolio'],
  ['A freelance software engineer', 'Startups that need help', 'portfolio'],
  ['An architecture practice designing modern homes', 'Homeowners planning a build', 'portfolio'],
  // Photography.
  ['A wedding photographer', 'Engaged couples', 'photography'],
  ['A wedding and portrait photographer', 'Couples and families', 'photography'],
  ['Headshots for actors and executives', 'Professionals who need a new headshot', 'photography'],
  // Blogs and writing.
  ['A blog about gardening', 'Home gardeners', 'blog'],
  ['My food blog', 'Home cooks', 'blog'],
  ['A food blog about weeknight cooking', 'Busy parents', 'blog'],
  ['A podcast about local history', 'Listeners who love stories', 'blog'],
  ['A weekly newsletter on climate policy', 'Policy wonks', 'blog'],
  ['A novelist and her books', 'Readers of literary fiction', 'blog'],
  // Music.
  ['A five-piece indie band', 'Fans and venues that book us', 'music'],
  ['A wedding DJ', 'Engaged couples', 'music'],
  ['A jazz trio for hire', 'Restaurants and private events', 'music'],
  // Events.
  ['A rustic wedding venue', 'Engaged couples', 'events'],
  ['An annual tech conference', 'Developers and engineering leaders', 'events'],
  ['A summer music festival', 'Families and fans', 'events'],
  ['An event planner for corporate parties', 'HR teams', 'events'],
  // Professional.
  ['A family law firm', 'Parents going through divorce', 'professional'],
  ['A small family law firm', 'Local families', 'professional'],
  ['A CPA firm for small businesses', 'Owners who need tax help', 'professional'],
  ['An independent financial advisor', 'Retirees and pre-retirees', 'professional'],
  ['An insurance agency', 'Drivers and homeowners', 'professional'],
  // Wellness.
  ['A dentist', 'Families in Plano', 'wellness'],
  ['A family dental practice', 'Families', 'wellness'],
  ['A licensed counselor for anxiety and life transitions', 'Adults who feel stuck', 'wellness'],
  ['A counselor for teens', 'Parents of teenagers', 'wellness'],
  ['A chiropractor and massage clinic', 'People with back pain', 'wellness'],
  ['A veterinary clinic', 'Pet owners', 'wellness'],
  // Beauty.
  ['A hair salon', 'Women in the suburbs', 'beauty'],
  ['A barbershop with walk-ins', 'Men who want a sharp cut', 'beauty'],
  ['A nail and lash studio', 'Brides and regulars', 'beauty'],
  ['A day spa with facials and massages', 'People who want a treat', 'beauty'],
  // Trades.
  ['A roofing company in Tulsa', 'Homeowners after a storm', 'trades'],
  ['A roofing contractor', 'Homeowners', 'trades'],
  ['A 24-hour towing and roadside assistance company', 'Stranded drivers', 'trades'],
  ['A plumber', 'Homeowners with a leak', 'trades'],
  ['A landscaping and lawn care service', 'Homeowners', 'trades'],
  ['An auto repair shop', 'Car owners in town', 'trades'],
  // Real estate.
  ['A real estate agent in Phoenix', 'First-time home buyers', 'realestate'],
  ['Vacation rentals on the lake', 'Families planning a getaway', 'realestate'],
  ['A property management company', 'Landlords and tenants', 'realestate'],
  // Education.
  ['Math tutoring for high schoolers', 'Parents of struggling students', 'education'],
  ['Piano lessons for kids and adults', 'Beginners', 'education'],
  ['A Montessori preschool', 'Parents of toddlers', 'education'],
  ['An online course on bookkeeping basics', 'Freelancers', 'education'],
  ['A driving school', 'Teens getting their license', 'education'],
  // Business and services.
  ['A dog groomer in Austin', 'Busy dog owners', 'business'],
  ['A house cleaning service', 'Busy families', 'business'],
  ['A staffing agency for warehouses', 'Employers and job seekers', 'business'],
  ['Something else entirely', '', 'business'],
  // Landing and coming soon.
  ['A SaaS app for scheduling shifts', 'Restaurant managers', 'landing'],
  ['A waitlist for our new mobile app', 'Early adopters', 'landing'],
  ['A coming soon page for our bakery', 'Neighbors', 'coming-soon'],
  ['Our site is under construction', '', 'coming-soon'],
]

describe('aiSiteKindFor', () => {
  it.each(BRIEFS)('%s (for %s) is %s', (businessType, audience, kind) => {
    expect(aiSiteKindFor(businessType, audience).id).toBe(kind)
  })

  it('covers every kind', () => {
    const covered = new Set(BRIEFS.map(([, , kind]) => kind))
    expect(AI_SITE_KINDS.map((kind) => kind.id).filter((id) => !covered.has(id))).toEqual([])
  })

  it('never picks a narrow kind on a generic word several kinds share', () => {
    for (const word of ['studio', 'personal', 'center', 'training', 'workshop']) {
      expect(aiSiteKindFor(`a ${word}`).id).toBe('business')
    }
  })

  it('lets a generic head noun decide only when nothing specific competes', () => {
    expect(aiSiteKindFor('a shop').id).toBe('store')
    expect(aiSiteKindFor('a club').id).toBe('nonprofit')
    expect(aiSiteKindFor('classes').id).toBe('education')
    // Not the head: "group" and "shop" only describe it.
    expect(aiSiteKindFor('a place to meet with a group').id).toBe('business')
    expect(aiSiteKindFor('a website for my shop').id).toBe('business')
    // A specific word anywhere outranks a generic head.
    expect(aiSiteKindFor('a yoga group').id).toBe('yoga')
    expect(aiSiteKindFor('a club', 'golf players').id).toBe('fitness')
  })

  it('falls back to the most general kind on a tie it cannot settle', () => {
    expect(aiSiteKindFor('').id).toBe('business')
    expect(aiSiteKindFor('a studio', 'a club').id).toBe('business')
  })

  it('reads the audience, but less than what the site is', () => {
    expect(aiSiteKindFor('a club', 'neighbors who want company').id).toBe('nonprofit')
    expect(aiSiteKindFor('a yoga studio', 'runners who need to stretch').id).toBe('yoga')
  })

  it('reads the audience a job carries', () => {
    expect(aiSiteKindOfInputs({ businessType: 'a club', audience: 'neighbors who want company' })?.id).toBe('nonprofit')
    expect(aiSiteKindOfInputs({ businessType: 'a club', siteKind: 'fitness' })?.id).toBe('fitness')
    expect(aiSiteKindOfInputs({})).toBeNull()
  })

  it('declares no keyword or hint twice in one kind', () => {
    for (const kind of AI_SITE_KINDS) {
      const all = [...kind.keywords, ...kind.hints]
      expect(all.filter((term, index) => all.indexOf(term) !== index)).toEqual([])
    }
  })
})
