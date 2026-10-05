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

/*==========================================
 * OTHER PRODUCTS' EXPORT HEADERS (AGL-3527).
 *
 * The column names the CRMs people arrive from write into their exports,
 * per field id of `fields.ts`. The import's header matcher reads them as
 * exact aliases and shows where a match came from ("Salesforce"), so a
 * Salesforce report, a HubSpot export, an Apollo list or a Pipedrive file
 * maps itself. They live here, beside the fields they name: the platform's
 * core knows no product's vocabulary.
 *
 * A column whose meaning is the OPPOSITE of a field is left out on purpose:
 * Salesforce's "Email Opt Out" and HubSpot's "Unsubscribed" are refusals,
 * and mapping either to Marketing consent would read every refusal as a
 * grant.
 *
 * The platform's own dictionary is the CRM's earlier CSV export, so a file taken out before
 * the field picker existed still comes back in.
 *=========================================*/

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { TransferAliasDictionary } from '@aglyn/aglyn/data-transfer'

const SALESFORCE = 'Salesforce'
const HUBSPOT = 'HubSpot'
const APOLLO = 'Apollo'
const PIPEDRIVE = 'Pipedrive'
const OWN = `${PLATFORM_BRAND_NAME} (earlier export)`

/** The six address columns each product writes, under one prefix. */
function address(prefix: string, words: {
  street: readonly string[]
  street2?: readonly string[]
  city: readonly string[]
  state: readonly string[]
  postalCode: readonly string[]
  country: readonly string[]
}): Record<string, readonly string[]> {
  return {
    [`${prefix}Street`]: words.street,
    ...(words.street2 ? { [`${prefix}Street2`]: words.street2 } : {}),
    [`${prefix}City`]: words.city,
    [`${prefix}State`]: words.state,
    [`${prefix}PostalCode`]: words.postalCode,
    [`${prefix}Country`]: words.country,
  }
}

/*==========================================
 * CONTACTS
 *=========================================*/

export const CONTACT_ALIASES: readonly TransferAliasDictionary[] = [
  {
    source: SALESFORCE,
    aliases: {
      salutation: ['Salutation'],
      firstName: ['First Name'],
      lastName: ['Last Name'],
      name: ['Full Name', 'Contact Name'],
      email: ['Email'],
      phone: ['Phone', 'Business Phone'],
      mobilePhone: ['Mobile Phone', 'Mobile'],
      homePhone: ['Home Phone'],
      otherPhone: ['Other Phone'],
      fax: ['Fax', 'Business Fax'],
      assistantName: ['Assistant', "Assistant's Name"],
      assistantPhone: ['Asst. Phone', 'Assistant Phone'],
      jobTitle: ['Title'],
      department: ['Department'],
      birthdate: ['Birthdate'],
      company: ['Account Name', 'Account'],
      reportsTo: ['Reports To', 'Reports To: Email'],
      owner: ['Contact Owner', 'Owner Name', 'Contact Owner Email'],
      leadSource: ['Lead Source'],
      doNotCall: ['Do Not Call'],
      notes: ['Description', 'Contact Description'],
      ...address('mailing', {
        street: ['Mailing Street', 'Mailing Address Line 1'],
        street2: ['Mailing Address Line 2'],
        city: ['Mailing City'],
        state: ['Mailing State/Province', 'Mailing State'],
        postalCode: ['Mailing Zip/Postal Code', 'Mailing Zip', 'Mailing Postal Code'],
        country: ['Mailing Country', 'Mailing Country Code'],
      }),
      ...address('other', {
        street: ['Other Street', 'Other Address Line 1'],
        street2: ['Other Address Line 2'],
        city: ['Other City'],
        state: ['Other State/Province', 'Other State'],
        postalCode: ['Other Zip/Postal Code', 'Other Zip', 'Other Postal Code'],
        country: ['Other Country', 'Other Country Code'],
      }),
    },
  },
  {
    source: HUBSPOT,
    aliases: {
      salutation: ['Salutation'],
      firstName: ['First Name'],
      lastName: ['Last Name'],
      email: ['Email'],
      phone: ['Phone Number'],
      mobilePhone: ['Mobile Phone Number'],
      fax: ['Fax Number'],
      jobTitle: ['Job Title'],
      department: ['Department'],
      birthdate: ['Date of birth'],
      company: ['Associated Company', 'Company Name', 'Company'],
      owner: ['Contact owner', 'HubSpot Owner'],
      lifecycleStage: ['Lifecycle Stage'],
      leadSource: ['Original Source', 'Original source'],
      notes: ['Message'],
      ...address('mailing', {
        street: ['Street Address'],
        street2: ['Street Address 2'],
        city: ['City'],
        state: ['State/Region', 'State'],
        postalCode: ['Postal Code', 'Zip'],
        country: ['Country/Region', 'Country'],
      }),
    },
  },
  {
    source: APOLLO,
    aliases: {
      firstName: ['First Name'],
      lastName: ['Last Name'],
      email: ['Email'],
      phone: ['Work Direct Phone', 'First Phone', 'Corporate Phone'],
      mobilePhone: ['Mobile Phone'],
      homePhone: ['Home Phone'],
      otherPhone: ['Other Phone'],
      jobTitle: ['Title'],
      department: ['Departments'],
      company: ['Company', 'Company Name for Emails'],
      owner: ['Contact Owner'],
      tags: ['Lists'],
      ...address('mailing', {
        street: ['Street'],
        city: ['City'],
        state: ['State'],
        postalCode: ['Postal Code'],
        country: ['Country'],
      }),
    },
  },
  {
    source: PIPEDRIVE,
    aliases: {
      name: ['Person - Name', 'Name'],
      firstName: ['Person - First name', 'First name'],
      lastName: ['Person - Last name', 'Last name'],
      email: ['Person - Email - Work', 'Person - Email', 'Email - Work', 'Person - Email - Other', 'Person - Email - Home'],
      phone: ['Person - Phone - Work', 'Person - Phone', 'Phone - Work'],
      mobilePhone: ['Person - Phone - Mobile', 'Phone - Mobile'],
      homePhone: ['Person - Phone - Home', 'Phone - Home'],
      otherPhone: ['Person - Phone - Other', 'Phone - Other'],
      jobTitle: ['Person - Job title', 'Job title'],
      company: ['Person - Organization', 'Organization'],
      owner: ['Person - Owner', 'Owner'],
      tags: ['Person - Labels', 'Person - Label', 'Labels', 'Label'],
      birthdate: ['Person - Birthday'],
      notes: ['Person - Notes'],
      ...address('mailing', {
        street: ['Person - Postal address - Street/road name', 'Person - Postal address'],
        city: ['Person - Postal address - City/town/village/locality'],
        state: ['Person - Postal address - State/county'],
        postalCode: ['Person - Postal address - ZIP/Postal code'],
        country: ['Person - Postal address - Country'],
      }),
    },
  },
  {
    source: OWN,
    aliases: {
      name: ['Name'],
      company: ['Company'],
      owner: ['Owner'],
      assistantName: ['Assistant'],
      ...address('mailing', {
        street: ['Mailing address line 1', 'Address line 1'],
        street2: ['Mailing address line 2', 'Address line 2'],
        city: ['Mailing city'],
        state: ['Mailing state'],
        postalCode: ['Mailing postal code'],
        country: ['Mailing country'],
      }),
      ...address('other', {
        street: ['Other address line 1'],
        street2: ['Other address line 2'],
        city: ['Other city'],
        state: ['Other state'],
        postalCode: ['Other postal code'],
        country: ['Other country'],
      }),
    },
  },
]

/*==========================================
 * COMPANIES
 *=========================================*/

export const COMPANY_ALIASES: readonly TransferAliasDictionary[] = [
  {
    source: SALESFORCE,
    aliases: {
      name: ['Account Name'],
      parentCompany: ['Parent Account', 'Parent Account Name'],
      accountNumber: ['Account Number'],
      site: ['Account Site'],
      type: ['Type', 'Account Type'],
      industry: ['Industry'],
      annualRevenue: ['Annual Revenue'],
      rating: ['Rating', 'Account Rating'],
      phone: ['Phone', 'Account Phone'],
      fax: ['Fax', 'Account Fax'],
      website: ['Website'],
      tickerSymbol: ['Ticker Symbol'],
      ownership: ['Ownership'],
      numberOfEmployees: ['Employees'],
      sicCode: ['SIC Code'],
      owner: ['Account Owner', 'Account Owner Email'],
      accountSource: ['Account Source'],
      notes: ['Description', 'Account Description'],
      ...address('billing', {
        street: ['Billing Street', 'Billing Address Line 1'],
        street2: ['Billing Address Line 2'],
        city: ['Billing City'],
        state: ['Billing State/Province', 'Billing State'],
        postalCode: ['Billing Zip/Postal Code', 'Billing Zip', 'Billing Postal Code'],
        country: ['Billing Country', 'Billing Country Code'],
      }),
      ...address('shipping', {
        street: ['Shipping Street', 'Shipping Address Line 1'],
        street2: ['Shipping Address Line 2'],
        city: ['Shipping City'],
        state: ['Shipping State/Province', 'Shipping State'],
        postalCode: ['Shipping Zip/Postal Code', 'Shipping Zip', 'Shipping Postal Code'],
        country: ['Shipping Country', 'Shipping Country Code'],
      }),
    },
  },
  {
    source: HUBSPOT,
    aliases: {
      name: ['Company name', 'Name'],
      domain: ['Company Domain Name', 'Company domain name'],
      website: ['Website URL'],
      phone: ['Phone Number'],
      industry: ['Industry'],
      type: ['Type'],
      numberOfEmployees: ['Number of Employees'],
      annualRevenue: ['Annual Revenue'],
      parentCompany: ['Parent Company'],
      owner: ['Company owner'],
      notes: ['Description'],
      ...address('billing', {
        street: ['Street Address'],
        street2: ['Street Address 2'],
        city: ['City'],
        state: ['State/Region'],
        postalCode: ['Postal Code'],
        country: ['Country/Region'],
      }),
    },
  },
  {
    source: APOLLO,
    aliases: {
      name: ['Company', 'Company Name'],
      website: ['Website'],
      numberOfEmployees: ['# Employees'],
      industry: ['Industry'],
      phone: ['Company Phone'],
      annualRevenue: ['Annual Revenue'],
      sicCode: ['SIC Codes'],
      owner: ['Account Owner'],
      notes: ['Short Description'],
      ...address('billing', {
        street: ['Company Street', 'Company Address'],
        city: ['Company City'],
        state: ['Company State'],
        postalCode: ['Company Postal Code'],
        country: ['Company Country'],
      }),
    },
  },
  {
    source: PIPEDRIVE,
    aliases: {
      name: ['Organization - Name', 'Name'],
      website: ['Organization - Website'],
      numberOfEmployees: ['Organization - Number of employees'],
      annualRevenue: ['Organization - Annual revenue'],
      industry: ['Organization - Industry'],
      owner: ['Organization - Owner', 'Owner'],
      tags: ['Organization - Labels', 'Organization - Label', 'Labels', 'Label'],
      ...address('billing', {
        street: ['Organization - Address - Street/road name', 'Organization - Address'],
        city: ['Organization - Address - City/town/village/locality'],
        state: ['Organization - Address - State/county'],
        postalCode: ['Organization - Address - ZIP/Postal code'],
        country: ['Organization - Address - Country'],
      }),
    },
  },
  {
    source: OWN,
    aliases: {
      name: ['Company'],
      owner: ['Owner'],
      ...address('billing', {
        street: ['Billing address line 1'],
        street2: ['Billing address line 2'],
        city: ['Billing city'],
        state: ['Billing state'],
        postalCode: ['Billing postal code'],
        country: ['Billing country'],
      }),
      ...address('shipping', {
        street: ['Shipping address line 1'],
        street2: ['Shipping address line 2'],
        city: ['Shipping city'],
        state: ['Shipping state'],
        postalCode: ['Shipping postal code'],
        country: ['Shipping country'],
      }),
    },
  },
]
