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
 * AGL-2008 — bucketing affected data subjects by Member State, from what we
 * already hold.
 *
 * ## Why this exists
 *
 * Aglyn LLC has no EU establishment, so there is no lead supervisory
 * authority and no one-stop-shop (Art. 56 attaches lead status to the main or
 * single establishment; EDPB Guidelines 9/2022 v2.0 §73 closes it). A breach
 * has to be notified to **every** authority in whose Member State affected
 * data subjects reside, separately, inside 72 hours. `BREACH_NOTIFICATION.md`
 * §4 carries the filing routes; every one of them opens with the question
 * this module answers.
 *
 * ## What it deliberately does NOT do
 *
 * It collects nothing. There is no new field, no IP-to-city lookup, no
 * geolocation call, and no request for a residence on signup. Answering a
 * privacy question by starting to collect precise location data trades a
 * reporting gap for a standing liability, and the standing liability is
 * worse: it applies to every user every day, not to the incident that may
 * never happen. Every signal below is already held, already disclosed, and
 * already retained for a stated purpose.
 *
 * ## The three signals, weakest last
 *
 * 1. **Declared** — `orgs/{orgId}.contact.address.country`, ISO alpha-2, set
 *    by the org in settings. Authoritative and volunteered. Also, measured
 *    2026-07-31, **unset on every production org**, so in practice it
 *    contributes almost nothing today. Recorded first anyway because it is
 *    the only signal that is a statement by the data subject's own
 *    organisation rather than an inference about it.
 * 2. **Billing** — `platformRevenue.customerAddress.country`, lifted from
 *    Stripe's `invoice.customer_address` on `invoice.paid` and retained
 *    permanently under Art. 17(3)(b) (`erase.ts` refuses to sweep it). Covers
 *    every org that has ever paid an invoice, and survives an org's erasure.
 * 3. **Sign-in IP** — the trailing token of `users/{uid}/devices.location`,
 *    which `describeSignInClient` writes as `"City, Region, Country"` from
 *    `x-vercel-ip-country` on every console sign-in. Covers every signed-in
 *    user including non-payers. It is the weakest and the widest.
 *
 * ## The honesty bar, which is the whole design
 *
 * **A guess presented as a count is worse than "we cannot say."** So no
 * function here returns a bare number:
 *
 * - Every bucket carries `byProvenance`, and the parts sum to the whole.
 * - A bucket built only from sign-in IPs is marked `inferredOnly`. Filing
 *   with an authority on that basis is a decision someone makes knowingly.
 * - Disagreeing sign-in countries resolve to `ambiguous`, never to the first
 *   or the most recent one. A user who travels, or uses a VPN, is precisely
 *   where an inferred country produces a confident wrong filing.
 * - `unknown`, `ambiguous` and `outsideScope` are outputs, not omissions, and
 *   `coverage` states what fraction of the population landed in a bucket at
 *   all. A report that quietly drops the people it cannot place reads as
 *   completeness.
 *
 * ## What none of this can support
 *
 * - **Billing country is not residence.** A card address is the payer's, and
 *   on an org it is frequently a company address in a country no member lives
 *   in. It is a lawful proxy for "which authority plausibly has an interest",
 *   not a finding of fact about where a person resides.
 * - **A sign-in location is where somebody WAS**, once, at a moment.
 * - **Members carry no country of their own.** `orgs/{orgId}/members/{uid}`
 *   has no address, phone or locale field at all, so a member is placed by
 *   their own sign-in devices or by their org — never by anything they
 *   declared.
 * - **Site visitors and site members cannot be bucketed at all.** For those
 *   Aglyn is processor: the customer notifies, not us. Their consent record's
 *   `country` lives in the visitor's own `localStorage` and is never written
 *   server-side, by design (AGL-1498). We can tell a customer what was
 *   exposed; we cannot tell them which Member States their visitors are in.
 */

// MARK – SUPERVISORY AUTHORITIES

/** Which statutory regime a filing falls under; they are separate filings. */
export type BreachRegime = 'eu-gdpr' | 'uk-gdpr'

export interface SupervisoryAuthority {
  /** The Member State whose authority receives the filing. */
  memberState: string
  /** The authority's name, as it should appear in the incident log. */
  authority: string
  /** Where the filing actually starts. */
  url: string
  regime: BreachRegime
}

/**
 * ISO 3166-1 alpha-2 → the authority that receives an Art. 33 notification.
 *
 * Keyed by the code `x-vercel-ip-country` and Stripe both use, so no
 * translation layer sits between the stored signal and the filing route.
 *
 * Three things here are easy to get wrong under time pressure and are
 * therefore encoded rather than left to the person holding the clock:
 *
 * - **The UK is a separate regime.** UK GDPR is its own statute with its own
 *   regulator; a GB subject does not fold into an EU filing.
 * - **The EU outermost regions carry their own ISO codes but no authority of
 *   their own.** Réunion, Martinique, Guadeloupe, French Guiana and Mayotte
 *   are legally France and file with the CNIL; Åland is Finland. A runbook
 *   that looks up `RE` and finds nothing concludes "not EU", which is wrong
 *   in the expensive direction.
 * - **Gibraltar sits under the UK regime**, not the EU one.
 *
 * Switzerland is deliberately ABSENT: not EEA, its own FADP, and not an
 * Art. 33 filing.
 */
export const SUPERVISORY_AUTHORITIES: Readonly<
  Record<string, SupervisoryAuthority>
> = {
  AT: { memberState: 'Austria', authority: 'Datenschutzbehörde (DSB)', url: 'https://www.dsb.gv.at/', regime: 'eu-gdpr' },
  BE: { memberState: 'Belgium', authority: 'Autorité de protection des données (APD/GBA)', url: 'https://www.autoriteprotectiondonnees.be/', regime: 'eu-gdpr' },
  BG: { memberState: 'Bulgaria', authority: 'Commission for Personal Data Protection (CPDP)', url: 'https://www.cpdp.bg/', regime: 'eu-gdpr' },
  HR: { memberState: 'Croatia', authority: 'Agencija za zaštitu osobnih podataka (AZOP)', url: 'https://azop.hr/', regime: 'eu-gdpr' },
  CY: { memberState: 'Cyprus', authority: 'Office of the Commissioner for Personal Data Protection', url: 'https://www.dataprotection.gov.cy/', regime: 'eu-gdpr' },
  CZ: { memberState: 'Czechia', authority: 'Úřad pro ochranu osobních údajů (ÚOOÚ)', url: 'https://uoou.gov.cz/', regime: 'eu-gdpr' },
  DK: { memberState: 'Denmark', authority: 'Datatilsynet', url: 'https://www.datatilsynet.dk/', regime: 'eu-gdpr' },
  EE: { memberState: 'Estonia', authority: 'Andmekaitse Inspektsioon (AKI)', url: 'https://www.aki.ee/', regime: 'eu-gdpr' },
  FI: { memberState: 'Finland', authority: 'Tietosuojavaltuutetun toimisto', url: 'https://tietosuoja.fi/', regime: 'eu-gdpr' },
  FR: { memberState: 'France', authority: 'Commission Nationale de l’Informatique et des Libertés (CNIL)', url: 'https://www.cnil.fr/', regime: 'eu-gdpr' },
  DE: { memberState: 'Germany', authority: 'Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI) — note German filings are usually made to the competent Land authority', url: 'https://www.bfdi.bund.de/', regime: 'eu-gdpr' },
  GR: { memberState: 'Greece', authority: 'Hellenic Data Protection Authority (HDPA)', url: 'https://www.dpa.gr/', regime: 'eu-gdpr' },
  HU: { memberState: 'Hungary', authority: 'Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)', url: 'https://naih.hu/', regime: 'eu-gdpr' },
  IE: { memberState: 'Ireland', authority: 'Data Protection Commission (DPC)', url: 'https://www.dataprotection.ie/en/organisations/know-your-obligations/breach-notification', regime: 'eu-gdpr' },
  IT: { memberState: 'Italy', authority: 'Garante per la protezione dei dati personali', url: 'https://www.garanteprivacy.it/', regime: 'eu-gdpr' },
  LV: { memberState: 'Latvia', authority: 'Datu valsts inspekcija (DVI)', url: 'https://www.dvi.gov.lv/', regime: 'eu-gdpr' },
  LT: { memberState: 'Lithuania', authority: 'Valstybinė duomenų apsaugos inspekcija (VDAI)', url: 'https://vdai.lrv.lt/', regime: 'eu-gdpr' },
  LU: { memberState: 'Luxembourg', authority: 'Commission nationale pour la protection des données (CNPD)', url: 'https://cnpd.public.lu/', regime: 'eu-gdpr' },
  MT: { memberState: 'Malta', authority: 'Information and Data Protection Commissioner (IDPC)', url: 'https://idpc.org.mt/', regime: 'eu-gdpr' },
  NL: { memberState: 'Netherlands', authority: 'Autoriteit Persoonsgegevens (AP)', url: 'https://www.autoriteitpersoonsgegevens.nl/', regime: 'eu-gdpr' },
  PL: { memberState: 'Poland', authority: 'Urząd Ochrony Danych Osobowych (UODO)', url: 'https://uodo.gov.pl/', regime: 'eu-gdpr' },
  PT: { memberState: 'Portugal', authority: 'Comissão Nacional de Proteção de Dados (CNPD)', url: 'https://www.cnpd.pt/', regime: 'eu-gdpr' },
  RO: { memberState: 'Romania', authority: 'Autoritatea Naţională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP)', url: 'https://www.dataprotection.ro/', regime: 'eu-gdpr' },
  SK: { memberState: 'Slovakia', authority: 'Úrad na ochranu osobných údajov', url: 'https://dataprotection.gov.sk/', regime: 'eu-gdpr' },
  SI: { memberState: 'Slovenia', authority: 'Informacijski pooblaščenec', url: 'https://www.ip-rs.si/', regime: 'eu-gdpr' },
  ES: { memberState: 'Spain', authority: 'Agencia Española de Protección de Datos (AEPD)', url: 'https://www.aepd.es/', regime: 'eu-gdpr' },
  SE: { memberState: 'Sweden', authority: 'Integritetsskyddsmyndigheten (IMY)', url: 'https://www.imy.se/', regime: 'eu-gdpr' },
  // EEA EFTA — GDPR applies through the EEA Agreement; each has its own DPA.
  IS: { memberState: 'Iceland', authority: 'Persónuvernd', url: 'https://www.personuvernd.is/', regime: 'eu-gdpr' },
  LI: { memberState: 'Liechtenstein', authority: 'Datenschutzstelle (DSS)', url: 'https://www.datenschutzstelle.li/', regime: 'eu-gdpr' },
  NO: { memberState: 'Norway', authority: 'Datatilsynet', url: 'https://www.datatilsynet.no/', regime: 'eu-gdpr' },
  // United Kingdom — a separate statute and a separate filing.
  GB: { memberState: 'United Kingdom', authority: 'Information Commissioner’s Office (ICO)', url: 'https://ico.org.uk/for-organisations/report-a-breach/', regime: 'uk-gdpr' },
}

/**
 * Territories with their own ISO code that file with another state's
 * authority. Resolved before the main table so a lookup can never miss.
 */
const TERRITORY_PARENT: Readonly<Record<string, string>> = {
  // EU outermost regions — legally EU territory, no authority of their own.
  GF: 'FR', // French Guiana
  GP: 'FR', // Guadeloupe
  MQ: 'FR', // Martinique
  RE: 'FR', // Réunion
  YT: 'FR', // Mayotte
  AX: 'FI', // Åland
  // Gibraltar: UK GDPR extends there.
  GI: 'GB',
}

const ISO_ALPHA2 = /^[A-Z]{2}$/

function normaliseCountry(value: string | null | undefined): string | null {
  const code = String(value ?? '').trim().toUpperCase()
  return ISO_ALPHA2.test(code) ? code : null
}

/**
 * The authority for an ISO alpha-2 code, or `null` outside the EEA and UK.
 *
 * `null` means "no Art. 33 filing here", which is a real answer — it is not
 * the same as "we do not know where this person is", and the report keeps the
 * two apart (`outsideScope` vs `unknown`).
 */
export function supervisoryAuthorityFor(
  country: string | null | undefined,
): SupervisoryAuthority | null {
  const code = normaliseCountry(country)
  if (!code) return null
  const resolved = TERRITORY_PARENT[code] ?? code
  return SUPERVISORY_AUTHORITIES[resolved] ?? null
}

// MARK – RESOLVING ONE SUBJECT

/** How a country was arrived at. Never omitted from an output. */
export type CountryProvenance =
  | 'declared'
  | 'billing'
  | 'sign-in-ip'
  | 'ambiguous'
  | 'unknown'

export interface SubjectCountrySignals {
  /** `orgs/{orgId}.contact.address.country` — volunteered, authoritative. */
  declaredCountry?: string | null
  /** `platformRevenue.customerAddress.country` — Stripe billing address. */
  billingCountry?: string | null
  /** Trailing tokens of `users/{uid}/devices.location`, one per device. */
  signInCountries?: readonly (string | null | undefined)[]
}

export interface ResolvedSubjectCountry {
  country: string | null
  provenance: CountryProvenance
  /** Present only for `ambiguous`: the codes that disagreed, sorted. */
  candidates?: string[]
}

/**
 * The country for one data subject, and — inseparably — how we know it.
 *
 * Order is by strength of evidence, not by convenience. The `ambiguous`
 * outcome is the one that matters: two different sign-in countries is not
 * evidence for either, and picking the most recent would manufacture a
 * confident answer out of a person who flew somewhere.
 */
export function resolveSubjectCountry(
  signals: SubjectCountrySignals,
): ResolvedSubjectCountry {
  const declared = normaliseCountry(signals?.declaredCountry)
  if (declared) return { country: declared, provenance: 'declared' }

  const billing = normaliseCountry(signals?.billingCountry)
  if (billing) return { country: billing, provenance: 'billing' }

  const seen = new Set<string>()
  for (const value of signals?.signInCountries ?? []) {
    const code = normaliseCountry(value)
    if (code) seen.add(code)
  }
  if (seen.size === 1) {
    return { country: [...seen][0], provenance: 'sign-in-ip' }
  }
  if (seen.size > 1) {
    return {
      country: null,
      provenance: 'ambiguous',
      candidates: [...seen].sort(),
    }
  }
  return { country: null, provenance: 'unknown' }
}

/**
 * The ISO country out of a `users/{uid}/devices.location` string.
 *
 * `describeSignInClient` joins `x-vercel-ip-city`, `-country-region` and
 * `-country` with `", "`, so the country is the last token — but only when it
 * IS a country code. A record whose last token is a country NAME comes from a
 * different shape and is refused rather than guessed at: mapping names to
 * codes during an incident is how `Ireland` becomes `IR` instead of `IE`.
 */
export function deviceLocationCountry(
  location: string | null | undefined,
): string | null {
  const parts = String(location ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  return normaliseCountry(parts[parts.length - 1])
}

// MARK – THE REPORT

export interface MemberStateFiling {
  country: string
  memberState: string
  authority: string
  url: string
  regime: BreachRegime
  /** People in this bucket. Always equals the sum of `byProvenance`. */
  subjects: number
  byProvenance: {
    declared: number
    billing: number
    'sign-in-ip': number
  }
  /**
   * Every subject here was placed by an IP-derived sign-in location and
   * nothing stronger. The filing may still be right; it is not evidenced.
   */
  inferredOnly: boolean
}

export interface MemberStateExposureReport {
  filings: MemberStateFiling[]
  euFilingCount: number
  ukFilingCount: number
  /** Placed outside the EEA and UK — no Art. 33 filing, a real answer. */
  outsideScope: number
  /** Signals disagreed. Not placed, and not counted as unknown either. */
  ambiguous: number
  /** No usable signal at all. */
  unknown: number
  /** Fraction of the population that landed in a filing bucket. */
  coverage: number
  totalSubjects: number
}

export interface ExposureSubject extends SubjectCountrySignals {
  id?: string
}

/**
 * Bucket a population of data subjects into per-authority filings.
 *
 * The invariant a reader can lean on, and the spec asserts: **the filings
 * plus `unknown` plus `ambiguous` plus `outsideScope` equal the population.**
 * Nobody is dropped. A report that silently omits the people it could not
 * place is the failure this whole module exists to avoid — it reads as
 * completeness, and it is the thing an authority will ask about first.
 */
export function memberStateExposure(
  subjects: readonly ExposureSubject[],
): MemberStateExposureReport {
  const buckets = new Map<string, MemberStateFiling>()
  let outsideScope = 0
  let ambiguous = 0
  let unknown = 0

  for (const subject of subjects ?? []) {
    const resolved = resolveSubjectCountry(subject ?? {})
    if (resolved.provenance === 'ambiguous') {
      ambiguous += 1
      continue
    }
    if (!resolved.country) {
      unknown += 1
      continue
    }
    const authority = supervisoryAuthorityFor(resolved.country)
    if (!authority) {
      outsideScope += 1
      continue
    }
    // Key on the RESOLVED filing country, so Réunion and mainland France land
    // in one CNIL filing rather than two.
    const key = TERRITORY_PARENT[resolved.country] ?? resolved.country
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        country: key,
        memberState: authority.memberState,
        authority: authority.authority,
        url: authority.url,
        regime: authority.regime,
        subjects: 0,
        byProvenance: { declared: 0, billing: 0, 'sign-in-ip': 0 },
        inferredOnly: true,
      }
      buckets.set(key, bucket)
    }
    bucket.subjects += 1
    bucket.byProvenance[
      resolved.provenance as 'declared' | 'billing' | 'sign-in-ip'
    ] += 1
    if (resolved.provenance !== 'sign-in-ip') bucket.inferredOnly = false
  }

  const filings = [...buckets.values()].sort(
    (a, b) => b.subjects - a.subjects || a.country.localeCompare(b.country),
  )
  const placed = filings.reduce((total, filing) => total + filing.subjects, 0)
  const totalSubjects = (subjects ?? []).length
  return {
    filings,
    euFilingCount: filings.filter((f) => f.regime === 'eu-gdpr').length,
    ukFilingCount: filings.filter((f) => f.regime === 'uk-gdpr').length,
    outsideScope,
    ambiguous,
    unknown,
    coverage: totalSubjects === 0 ? 0 : placed / totalSubjects,
    totalSubjects,
  }
}
