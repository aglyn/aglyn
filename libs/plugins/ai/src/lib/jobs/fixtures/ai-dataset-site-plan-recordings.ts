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

/**
 * RECORDED, NOT GOLDEN: the first plan answers of two paid (business) briefs
 * from the live site-plan eval of 2026-10-10 on #1362 (claude-sonnet-5-5),
 * copied from their replay recordings (AGL-3616). Each created four datasets,
 * one of them testimonials, past the three a site start makes, and was
 * refused for it: the dental plan four times over; the food bank's re-ask
 * then named a section "Page header" and was refused for that. Both are now
 * settled in code (`aiSettlePlanDatasets`) and kept on their first answer.
 */

/** "a family dental practice", recorded 2026-10-10T06:32:23.901Z. */
export const AI_DENTAL_SITE_PLAN_FIRST_ANSWER = {
  reuse: [
    {
      kind: 'layout',
      id: 'laySite',
      purpose:
        'Site layout holding the header, navigation and footer for every page',
    },
    {
      kind: 'screen',
      id: 'scrStarter',
      purpose: 'Starter home page, replaced by the planned home page at /',
    },
  ],
  create: [
    {
      kind: 'form',
      name: 'Appointment request',
      why: 'The site has no saved form, and booking and contact pages need one that routes to the inbox.',
      duplicateOf: null,
      fields: [
        'parentName',
        'email',
        'phone',
        'childName',
        'childAge',
        'preferredDate',
        'visitReason',
        'consent',
      ],
    },
    {
      kind: 'dataset',
      name: 'Dental services',
      why: 'Services are a list of like items and the site has no dataset for them.',
      duplicateOf: null,
      fields: ['name', 'summary', 'description', 'ageGroup', 'duration'],
    },
    {
      kind: 'dataset',
      name: 'Team members',
      why: 'The care team is a list of like items and the site has no dataset for it.',
      duplicateOf: null,
      fields: ['name', 'role', 'bio', 'photo'],
    },
    {
      kind: 'dataset',
      name: 'Patient testimonials',
      why: 'Parent reviews are a list of like items and the site has no dataset for them.',
      duplicateOf: null,
      fields: ['quote', 'parentName', 'childAge'],
    },
    {
      kind: 'dataset',
      name: 'Visit questions',
      why: 'Frequently asked questions are a list of like items and the site has no dataset for them.',
      duplicateOf: null,
      fields: ['question', 'answer'],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'laySite',
      template: null,
      duplicateOf: 'scrStarter',
      nav: true,
      seoTitle: 'Maple Street Dental | Family Dentist for Kids and Parents',
      seoDescription:
        "Maple Street Dental is a family dental practice with gentle check-ups for kids. Meet our team, see our services and book your child's visit today.",
      sections: [
        {
          name: 'Hero with book a check-up button',
          uses: [],
          items: 0,
        },
        {
          name: 'Services overview',
          uses: ['new:Dental services'],
          items: 4,
        },
        {
          name: 'Why families choose Maple Street Dental',
          uses: [],
          items: 3,
        },
        {
          name: 'First visit steps',
          uses: [],
          items: 3,
        },
        {
          name: 'Parent testimonials',
          uses: ['new:Patient testimonials'],
          items: 3,
        },
        {
          name: 'Team preview',
          uses: ['new:Team members'],
          items: 3,
        },
        {
          name: 'Booking call to action with form',
          uses: ['new:Appointment request'],
          items: 0,
        },
      ],
      record: null,
    },
    {
      title: 'Services',
      slug: '/services',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Dental Services for Kids and Families | Maple Street Dental',
      seoDescription:
        'Check-ups, cleanings, sealants and fluoride care for children and parents at Maple Street Dental. See what each visit includes and book online.',
      sections: [
        {
          name: 'Services hero',
          uses: [],
          items: 0,
        },
        {
          name: 'Full services list',
          uses: ['new:Dental services'],
          items: 6,
        },
        {
          name: 'What to expect at a check-up',
          uses: [],
          items: 4,
        },
        {
          name: 'Services questions',
          uses: ['new:Visit questions'],
          items: 5,
        },
        {
          name: 'Booking call to action',
          uses: ['new:Appointment request'],
          items: 0,
        },
      ],
      record: null,
    },
    {
      title: 'About',
      slug: '/about',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About Maple Street Dental | Our Family Dental Practice',
      seoDescription:
        "Learn the story behind Maple Street Dental, our gentle approach to children's dentistry and the people who care for your family.",
      sections: [
        {
          name: 'About hero',
          uses: [],
          items: 0,
        },
        {
          name: 'Our story and approach',
          uses: [],
          items: 0,
        },
        {
          name: 'Our values',
          uses: [],
          items: 3,
        },
        {
          name: 'Meet the team',
          uses: ['new:Team members'],
          items: 4,
        },
        {
          name: 'Parent testimonials',
          uses: ['new:Patient testimonials'],
          items: 3,
        },
        {
          name: 'Closing call to action',
          uses: [],
          items: 0,
        },
      ],
      record: null,
    },
    {
      title: 'Patient Info',
      slug: '/patient-info',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'New Patient Info and FAQs | Maple Street Dental',
      seoDescription:
        "Plan your child's first visit to Maple Street Dental: what to bring, how appointments work, insurance questions and answers for parents.",
      sections: [
        {
          name: 'Patient info hero',
          uses: [],
          items: 0,
        },
        {
          name: 'Before your visit checklist',
          uses: [],
          items: 4,
        },
        {
          name: 'Frequently asked questions',
          uses: ['new:Visit questions'],
          items: 6,
        },
        {
          name: 'Opening hours and location',
          uses: [],
          items: 0,
        },
        {
          name: 'Booking call to action',
          uses: ['new:Appointment request'],
          items: 0,
        },
      ],
      record: null,
    },
    {
      title: 'Book a Visit',
      slug: '/book',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Book a Check-up | Maple Street Dental',
      seoDescription:
        "Request your child's dental check-up at Maple Street Dental. Share a preferred date and our team will confirm your appointment.",
      sections: [
        {
          name: 'Booking hero',
          uses: [],
          items: 0,
        },
        {
          name: 'Appointment request form',
          uses: ['new:Appointment request'],
          items: 0,
        },
        {
          name: 'Contact details and hours',
          uses: [],
          items: 3,
        },
        {
          name: 'Reassurance for nervous kids',
          uses: [],
          items: 3,
        },
      ],
      record: null,
    },
  ],
} as unknown as AiBuildPlan

/** "a nonprofit food bank", recorded 2026-10-10T06:32:08.811Z. */
export const AI_FOOD_BANK_SITE_PLAN_FIRST_ANSWER = {
  reuse: [
    {
      kind: 'layout',
      id: 'laySite',
      purpose: 'Site layout with header, navigation and footer for every page',
    },
    {
      kind: 'screen',
      id: 'scrStarter',
      purpose: 'Starter home page replaced by the planned home page at /',
    },
  ],
  create: [
    {
      kind: 'form',
      name: 'Get involved form',
      why: 'The site has no saved form, and volunteers and donors need one to sign up or send a question to the inbox.',
      duplicateOf: null,
      fields: ['fullName', 'email', 'phone', 'interest', 'message', 'consent'],
    },
    {
      kind: 'dataset',
      name: 'Programs',
      why: 'The site has no dataset, and programs are a list of like items shown on Home and Our programs.',
      duplicateOf: null,
      fields: ['name', 'summary', 'schedule', 'audience', 'image'],
    },
    {
      kind: 'dataset',
      name: 'Testimonials',
      why: 'Quotes from volunteers, donors and neighbors are a list of like items used as social proof on Home and About.',
      duplicateOf: null,
      fields: ['quote', 'name', 'role'],
    },
    {
      kind: 'dataset',
      name: 'Volunteer roles',
      why: 'Volunteer roles are a list of like items shown on the Get involved page.',
      duplicateOf: null,
      fields: ['role', 'description', 'timeCommitment', 'location'],
    },
    {
      kind: 'dataset',
      name: 'FAQs',
      why: 'Questions and answers are a list of like items for donors and volunteers.',
      duplicateOf: null,
      fields: ['question', 'answer'],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'laySite',
      template: null,
      duplicateOf: 'scrStarter',
      nav: true,
      seoTitle: 'Eastside Food Bank | Food for Our Neighbors',
      seoDescription:
        'Eastside Food Bank is a nonprofit serving our community with groceries and meals. Volunteer, donate or find food support near you.',
      sections: [
        {
          name: 'Hero with donate and volunteer buttons',
          uses: [],
          items: 0,
        },
        {
          name: 'Impact numbers',
          uses: [],
          items: 4,
        },
        {
          name: 'Our programs',
          uses: ['new:Programs'],
          items: 4,
        },
        {
          name: 'Why Eastside Food Bank',
          uses: [],
          items: 3,
        },
        {
          name: 'How you can help',
          uses: [],
          items: 3,
        },
        {
          name: 'Testimonials',
          uses: ['new:Testimonials'],
          items: 3,
        },
        {
          name: 'Closing call to action with form',
          uses: ['new:Get involved form'],
          items: 0,
        },
      ],
      record: null,
    },
    {
      title: 'Our programs',
      slug: '/programs',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Our Programs | Eastside Food Bank',
      seoDescription:
        'Explore Eastside Food Bank programs: food pantry, community meals, mobile pantry and more. See schedules and who each program serves.',
      sections: [
        {
          name: 'Page intro',
          uses: [],
          items: 0,
        },
        {
          name: 'Programs list',
          uses: ['new:Programs'],
          items: 6,
        },
        {
          name: 'Visit the pantry: hours and what to bring',
          uses: [],
          items: 3,
        },
        {
          name: 'Programs FAQ',
          uses: ['new:FAQs'],
          items: 5,
        },
        {
          name: 'Call to action',
          uses: [],
          items: 0,
        },
      ],
      record: null,
    },
    {
      title: 'About',
      slug: '/about',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About Eastside Food Bank',
      seoDescription:
        'Learn about Eastside Food Bank, our mission, our history and the volunteers and partners who help feed our neighbors.',
      sections: [
        {
          name: 'Page intro',
          uses: [],
          items: 0,
        },
        {
          name: 'Our mission and story',
          uses: [],
          items: 0,
        },
        {
          name: 'Values',
          uses: [],
          items: 3,
        },
        {
          name: 'Milestones',
          uses: [],
          items: 4,
        },
        {
          name: 'Community voices',
          uses: ['new:Testimonials'],
          items: 3,
        },
        {
          name: 'Partners and supporters',
          uses: [],
          items: 4,
        },
        {
          name: 'Call to action',
          uses: [],
          items: 0,
        },
      ],
      record: null,
    },
    {
      title: 'Get involved',
      slug: '/get-involved',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Get Involved | Eastside Food Bank',
      seoDescription:
        'Volunteer, donate food or give funds to Eastside Food Bank. Choose a role, see what we need and sign up in minutes.',
      sections: [
        {
          name: 'Page intro',
          uses: [],
          items: 0,
        },
        {
          name: 'Ways to help',
          uses: [],
          items: 3,
        },
        {
          name: 'Volunteer roles',
          uses: ['new:Volunteer roles'],
          items: 5,
        },
        {
          name: 'Most-needed donations',
          uses: [],
          items: 6,
        },
        {
          name: 'Sign-up form',
          uses: ['new:Get involved form'],
          items: 0,
        },
        {
          name: 'Volunteer FAQ',
          uses: ['new:FAQs'],
          items: 4,
        },
      ],
      record: null,
    },
    {
      title: 'Contact',
      slug: '/contact',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Contact Eastside Food Bank',
      seoDescription:
        'Contact Eastside Food Bank with questions about getting food, donating or volunteering. Find our address, hours and phone.',
      sections: [
        {
          name: 'Page intro',
          uses: [],
          items: 0,
        },
        {
          name: 'Contact details: address [address], phone [phone], hours [hours]',
          uses: [],
          items: 3,
        },
        {
          name: 'Contact form',
          uses: ['new:Get involved form'],
          items: 0,
        },
        {
          name: 'Need food today? Help finding a pantry',
          uses: [],
          items: 0,
        },
      ],
      record: null,
    },
  ],
} as unknown as AiBuildPlan
