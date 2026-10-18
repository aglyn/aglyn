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

import type { AiBuildPlan } from '../../model/ai-build-plan'
import type { AiInventoryDataset } from '../../model/ai-site-inventory'

/**
 * RECORDED, NOT GOLDEN (AGL-3912): two guided starts on production beta.264,
 * read back from Firestore on 2026-10-17 in the platform's own test workspace.
 * Each plan reused datasets the workspace's earlier test sites had filled,
 * and both of those sites had since been deleted.
 *
 *  - ironwood-barbell-gym (job YUICpDdidL, site 8hxAi89hyE) reused "Session
 *    packages" (a deleted photographer's wedding packages), "Coaches" (a
 *    deleted strength studio's coaches, one bio naming that studio, every
 *    photo in that site's library) and "Gym FAQs" (the same studio's), and
 *    "Gym contact leads", empty, for its form.
 *  - silver-fir-film-portrait (job 0XoEWZteOn, site _lgryxv-Nv) reused
 *    "Gallery sessions", whose six covers are in a deleted photographer's
 *    library, and "Photography inquiries", empty, for its form.
 *
 * The plans' reuse, creations and sections are as kept, less the draft ids
 * the job minted; their pages' layouts, search titles and descriptions are
 * stand-ins, and silver-fir's About and Contact pages, which list no
 * dataset, are left out. The datasets are as the site inventory reads them
 * (`readIndexedDatasets`): the data plugin keeps no site on a dataset or a
 * record — each is `visibleTo: ['org']` — so nothing in them says which site
 * they were written for. The records keep only the values a spec reads, the
 * photo addresses verbatim.
 */

/** The deleted strength studio whose library the coaches' photos were in. */
export const AI_FOREIGN_COACHES_SITE = 'MEo5ZeWQB2'

/** The deleted photographer whose library the gallery's covers were in. */
export const AI_FOREIGN_GALLERY_SITE = 'nVj_-hl115'

export const AI_IRONWOOD_SITE = '8hxAi89hyE'
export const AI_SILVER_FIR_SITE = '_lgryxv-Nv'

/** The workspace datasets both sites saw, with the records each held on 2026-10-17. */
export const AI_FOREIGN_DATASETS_INVENTORY: AiInventoryDataset[] = [
  {
    id: '4DCiNNbwjK',
    name: 'Session packages',
    fields: ['Name', 'Type', 'Description', 'Duration', 'Includes'],
    fieldIds: ['name', 'type', 'description', 'duration', 'includes'],
    records: 5,
  },
  {
    id: 'BvgMhWY9Nz',
    name: 'Coaches',
    fields: ['Name', 'Role', 'Specialty', 'Bio', 'Certifications', 'Image'],
    fieldIds: ['name', 'role', 'specialty', 'bio', 'certifications', 'image'],
    imageField: 'image',
    records: 4,
  },
  {
    id: 'BAdfabo_W9',
    name: 'Gym FAQs',
    fields: ['Question', 'Answer', 'Category'],
    fieldIds: ['question', 'answer', 'category'],
    records: 8,
  },
  {
    id: 'uKk5agxIcM',
    name: 'Gym contact leads',
    fields: ['Name', 'Email', 'Phone', 'Interested in', 'Lifting experience', 'Goals or injuries to know about', 'Best time to reach you', 'Consent'],
    fieldIds: ['name', 'email', 'phone', 'interested_in', 'lifting_experience', 'goals_or_injuries_to_know_about', 'best_time_to_reach_you', 'consent'],
    records: 0,
  },
  {
    id: 'h2CARlHhYY',
    name: 'Gallery sessions',
    fields: ['Title', 'Category', 'Location', 'Description', 'Camera type', 'Image'],
    fieldIds: ['title', 'category', 'location', 'description', 'camera_type', 'image'],
    imageField: 'image',
    records: 6,
  },
  {
    id: 'v96W19iBEM',
    name: 'Photography inquiries',
    fields: ['Name', 'Email', 'Phone', 'I am planning', 'Event date', 'Location or venue', 'Guest count', 'Film or digital preference', 'How did you hear about us', 'Message', 'Consent'],
    fieldIds: ['name', 'email', 'phone', 'i_am_planning', 'event_date', 'location_or_venue', 'guest_count', 'film_or_digital_preference', 'how_did_you_hear_about_us', 'message', 'consent'],
    records: 0,
  },
]

/** The coaches' records, as the gym's pages listed them. */
export const AI_FOREIGN_COACH_RECORDS: Array<Record<string, string>> = [
  { $id: 'JQiYgdRgOu', name: 'Open gym coach', role: 'Open gym coach', image: '/api/media/cdn/MEo5ZeWQB2/fdgCu-U42k' },
  { $id: 'Jqg4jZBmq_', name: 'Small-group class coach', role: 'Small-group class coach', image: '/api/media/cdn/MEo5ZeWQB2/Q6QBtQkFUs' },
  {
    $id: 'P9vy8p2NM8',
    name: 'Head coach',
    role: 'Head coach',
    bio: 'Leads coaching at Ironline Strength Studio and shapes how classes and programs are run. Focused on helping busy Austin adults get strong safely.',
    image: '/api/media/cdn/MEo5ZeWQB2/wSWoP1kjUG',
  },
  { $id: 'd8r6PFhWw6', name: 'Barbell coach', role: 'Barbell coach', image: '/api/media/cdn/MEo5ZeWQB2/7Sf-fC_y_e' },
]

/** The gallery's records, as the photographer's home and galleries pages listed them. */
export const AI_FOREIGN_GALLERY_RECORDS: Array<Record<string, string>> = [
  { $id: '5jiszknObR', title: 'Ridgetop Elopement', category: 'Elopement', image: '/api/media/cdn/nVj_-hl115/RM4pCuwtcQ' },
  { $id: 'CcW0e8hBdK', title: 'Family Session in the Fall', category: 'Family portrait', image: '/api/media/cdn/nVj_-hl115/e3BdfPAEHe' },
  { $id: 'FHRgCSO-jk', title: 'Intimate Forest Ceremony', category: 'Elopement', image: '/api/media/cdn/nVj_-hl115/c1cu6ECRrR' },
  { $id: 'RRR6ZGZHLK', title: 'Mountain Wedding Day', category: 'Wedding', image: '/api/media/cdn/nVj_-hl115/o18r7M8gjv' },
  { $id: 'i4LjphUlXx', title: 'Generations Portrait Session', category: 'Family portrait', image: '/api/media/cdn/nVj_-hl115/xM_bbg5H2L' },
  { $id: 'n-mS4OTVUW', title: 'Golden Hour Engagement', category: 'Engagement', image: '/api/media/cdn/nVj_-hl115/6tbRI25Wy2' },
]

/** ironwood-barbell-gym's plan, job YUICpDdidL. */
export const AI_IRONWOOD_SITE_PLAN: AiBuildPlan = {
  reuse: [
    { kind: 'dataset', id: '4DCiNNbwjK', purpose: 'Lists session packages on Services and Home' },
    { kind: 'dataset', id: 'BvgMhWY9Nz', purpose: 'Lists coaches on About' },
    { kind: 'dataset', id: 'BAdfabo_W9', purpose: 'Lists gym FAQs on Contact' },
    { kind: 'dataset', id: 'uKk5agxIcM', purpose: 'Stores contact form submissions as leads' },
    { kind: 'theme', id: 'theme', purpose: 'Brand palette and Plus Jakarta Sans typography' },
  ],
  create: [
    {
      kind: 'layout',
      name: 'Ironwood site layout',
      why: 'The site has no layout; every page needs a shared header, navigation and footer.',
      duplicateOf: null,
      fields: ['header', 'nav', 'main', 'footer'],
    },
    {
      kind: 'form',
      name: 'Gym contact form',
      why: 'The site has no saved form; visitors need to ask to be contacted by the gym.',
      duplicateOf: null,
      fields: ['Name', 'Email', 'Phone', 'Interested in', 'Lifting experience', 'Goals or injuries to know about', 'Best time to reach you', 'Consent'],
      writesTo: 'uKk5agxIcM',
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'new:Ironwood site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Ironwood Barbell Gym',
      seoDescription: 'Barbell coaching and small-group strength classes.',
      record: null,
      sections: [
        { name: 'Hero with call to action', uses: [], items: 0 },
        { name: 'What we offer', uses: ['4DCiNNbwjK'], items: 4 },
        { name: 'Why Ironwood Barbell Gym', uses: [], items: 3 },
        { name: 'Meet the coaches', uses: ['BvgMhWY9Nz'], items: 4 },
        { name: 'What getting started is like', uses: [], items: 4 },
        { name: 'Closing contact band', uses: ['new:Gym contact form'], items: 0 },
      ],
    },
    {
      title: 'Services',
      slug: '/services',
      layout: 'new:Ironwood site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Services',
      seoDescription: 'Session packages at Ironwood Barbell Gym.',
      record: null,
      sections: [
        { name: 'Services intro', uses: [], items: 0 },
        { name: 'Session packages list', uses: ['4DCiNNbwjK'], items: 4 },
        { name: 'Who each package suits', uses: [], items: 3 },
        { name: 'How a session works', uses: [], items: 4 },
        { name: 'Book a visit call to action', uses: ['new:Gym contact form'], items: 0 },
      ],
    },
    {
      title: 'About',
      slug: '/about',
      layout: 'new:Ironwood site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About',
      seoDescription: 'The coaches and the gym floor at Ironwood Barbell Gym.',
      record: null,
      sections: [
        { name: 'About hero', uses: [], items: 0 },
        { name: 'Our story and values', uses: [], items: 3 },
        { name: 'Coaches', uses: ['BvgMhWY9Nz'], items: 4 },
        { name: 'The gym floor and equipment', uses: [], items: 4 },
        { name: 'Join us call to action', uses: [], items: 0 },
      ],
    },
    {
      title: 'Contact',
      slug: '/contact',
      layout: 'new:Ironwood site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Contact',
      seoDescription: 'Ask Ironwood Barbell Gym about a first visit.',
      record: null,
      sections: [
        { name: 'Contact intro', uses: [], items: 0 },
        { name: 'Contact form', uses: ['new:Gym contact form'], items: 0 },
        { name: 'Gym details and hours', uses: [], items: 3 },
        { name: 'Frequently asked questions', uses: ['BAdfabo_W9'], items: 6 },
      ],
    },
  ],
}

/** silver-fir-film-portrait's plan, job 0XoEWZteOn. */
export const AI_SILVER_FIR_SITE_PLAN: AiBuildPlan = {
  reuse: [
    { kind: 'dataset', id: 'h2CARlHhYY', purpose: 'Gallery pieces listed on home and galleries pages' },
    { kind: 'dataset', id: 'v96W19iBEM', purpose: 'Stores each contact form submission as an inquiry record' },
    { kind: 'theme', id: 'theme', purpose: 'Brand palette and Plus Jakarta Sans typography' },
  ],
  create: [
    {
      kind: 'layout',
      name: 'Site layout',
      why: 'The site has no layout; header, navigation and footer must live in one shared layout.',
      duplicateOf: null,
      fields: ['header', 'nav', 'main', 'footer'],
    },
    {
      kind: 'form',
      name: 'Contact form',
      why: 'The site has no saved form; visitors need to ask to be contacted about weddings and portrait sessions.',
      duplicateOf: null,
      fields: ['Name', 'Email', 'Phone', 'I am planning', 'Event date', 'Location or venue', 'Guest count', 'Film or digital preference', 'How did you hear about us', 'Message', 'Consent'],
      writesTo: 'v96W19iBEM',
    },
    {
      kind: 'dataset',
      name: 'Photography packages',
      why: 'No existing dataset lists wedding, elopement and portrait packages for this photographer.',
      duplicateOf: null,
      fields: ['Name', 'Type', 'Description', 'Duration', 'Includes'],
    },
    {
      kind: 'dataset',
      name: 'Photography FAQs',
      why: 'No existing dataset holds questions and answers about booking, film and mountain locations.',
      duplicateOf: null,
      fields: ['Question', 'Answer', 'Category'],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'new:Site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Silver Fir Film & Portrait',
      seoDescription: 'Wedding, elopement and portrait photography in the Blue Ridge.',
      record: null,
      sections: [
        { name: 'Hero with book a session call to action', uses: [], items: 0 },
        { name: 'Selected work gallery', uses: ['h2CARlHhYY'], items: 6 },
        { name: 'Services: weddings, elopements, portraits', uses: [], items: 3 },
        { name: 'About the photographer', uses: [], items: 0 },
        { name: 'Film and digital approach', uses: [], items: 0 },
        { name: 'What working together is like', uses: [], items: 4 },
        { name: 'Closing contact band with form', uses: ['new:Contact form'], items: 0 },
      ],
    },
    {
      title: 'Galleries',
      slug: '/galleries',
      layout: 'new:Site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Galleries',
      seoDescription: 'Weddings, elopements and portraits.',
      record: null,
      sections: [
        { name: 'Galleries intro', uses: [], items: 0 },
        { name: 'Gallery by category', uses: ['h2CARlHhYY'], items: 6 },
        { name: 'Film versus digital note', uses: [], items: 0 },
        { name: 'Call to action to book', uses: [], items: 0 },
      ],
    },
    {
      title: 'Packages',
      slug: '/packages',
      layout: 'new:Site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Packages',
      seoDescription: 'Wedding, elopement and portrait packages.',
      record: null,
      sections: [
        { name: 'Packages intro', uses: [], items: 0 },
        { name: 'Package list', uses: ['new:Photography packages'], items: 5 },
        { name: 'Questions and answers', uses: ['new:Photography FAQs'], items: 6 },
        { name: 'Call to action to inquire', uses: [], items: 0 },
      ],
    },
  ],
}
