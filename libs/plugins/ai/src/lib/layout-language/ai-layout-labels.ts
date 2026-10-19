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
 * THE WORDS THE PLATFORM WRITES ON A PAGE ITSELF, IN THE SITE'S LANGUAGE (AGL-3760).
 *
 * The model writes a page's copy in the language its brief is in; a few
 * labels are the compiler's own — the button under a featured list that opens
 * the whole of it, a post card's link, a store's fixed lines. A Spanish
 * guided start (beta.246) showed "See all" under "Lo que horneamos". Each
 * label is English, then the same words in the languages below; a site in a
 * language not listed keeps the English.
 */

/** The labels the compiler and the frame place, in English. */
export const AI_LAYOUT_LABELS_EN = {
  /** The button under a featured band of the site's records that opens the whole list. */
  seeAll: 'See all',
  /** The same, for the blog's posts. */
  allPosts: 'All posts',
  /** The same, for the site's music. */
  allMusic: 'All music',
  /** The same, for the site's events. */
  allEvents: 'All events',
  /** The button a storefront's hero, or a featured band of products, opens the shop with. */
  shopAll: 'Shop all',
  /** A post card's link to the post. */
  readPost: 'Read the post',
  /** A record card's link to the record's own page. */
  viewDetails: 'View details',
  /** A store's newsletter sign-up button. */
  subscribe: 'Subscribe',
  /** A store's reviews band, where neither the design nor the plan heads it. */
  reviewsHeading: 'What our customers say',
  /** A store's sign-up band, where neither the design nor the plan heads it. */
  signupHeading: 'Join our newsletter',
  /** The header's link to a store's account page. */
  account: 'Account',
  /** The footer's heading over a store's account and policy links. */
  customerCare: 'Customer care',
  /** A store's announcement bar, where its design gave it no line. */
  storeAnnouncement: 'Shop the full collection',
  /** The way into the shop beside the design's own announcement. */
  shopNow: 'Shop now',
  /** A store's Product grid while the store lists nothing yet. */
  storeEmptyTitle: 'New pieces are on the way',
  storeEmptyText: 'Our first pieces are being finished now. Get in touch and we will let you know the moment they land.',
  storeEmptyTextAlone: 'Our first pieces are being finished now. Check back soon.',
  /** The way to get in touch under that empty grid, where the site has a page for it. */
  getInTouch: 'Get in touch',
  /** A stock photo's alt text where the library's own words cannot describe it in the site's language. */
  illustrativePhoto: 'Illustrative photo',
  /** The footer's heading over the business's phone and email (AGL-3979). */
  contact: 'Contact',
} as const

export type AiLayoutLabel = keyof typeof AI_LAYOUT_LABELS_EN

type Labels = Record<AiLayoutLabel, string>

/** The same labels in each language listed, by its two-letter code. */
const LABELS: Readonly<Record<string, Labels>> = {
  es: {
    seeAll: 'Ver todo',
    allPosts: 'Todas las entradas',
    allMusic: 'Toda la música',
    allEvents: 'Todos los eventos',
    shopAll: 'Ver la tienda',
    readPost: 'Leer la entrada',
    viewDetails: 'Ver detalles',
    subscribe: 'Suscribirme',
    reviewsHeading: 'Lo que dicen nuestros clientes',
    signupHeading: 'Suscríbete a nuestro boletín',
    account: 'Mi cuenta',
    customerCare: 'Atención al cliente',
    storeAnnouncement: 'Descubre toda la colección',
    shopNow: 'Comprar ahora',
    storeEmptyTitle: 'Pronto llegarán nuevas piezas',
    storeEmptyText: 'Estamos terminando nuestras primeras piezas. Escríbenos y te avisaremos en cuanto lleguen.',
    storeEmptyTextAlone: 'Estamos terminando nuestras primeras piezas. Vuelve pronto.',
    getInTouch: 'Escríbenos',
    illustrativePhoto: 'Foto ilustrativa',
    contact: 'Contacto',
  },
  fr: {
    seeAll: 'Tout voir',
    allPosts: 'Tous les articles',
    allMusic: 'Toute la musique',
    allEvents: 'Tous les événements',
    shopAll: 'Voir la boutique',
    readPost: 'Lire l’article',
    viewDetails: 'Voir les détails',
    subscribe: 'S’abonner',
    reviewsHeading: 'Ce que disent nos clients',
    signupHeading: 'Abonnez-vous à notre newsletter',
    account: 'Mon compte',
    customerCare: 'Service client',
    storeAnnouncement: 'Découvrez toute la collection',
    shopNow: 'Acheter',
    storeEmptyTitle: 'De nouvelles pièces arrivent bientôt',
    storeEmptyText: 'Nous terminons nos premières pièces. Écrivez-nous et nous vous préviendrons dès leur arrivée.',
    storeEmptyTextAlone: 'Nous terminons nos premières pièces. Revenez bientôt.',
    getInTouch: 'Écrivez-nous',
    illustrativePhoto: 'Photo d’illustration',
    contact: 'Nous contacter',
  },
  pt: {
    seeAll: 'Ver tudo',
    allPosts: 'Todos os posts',
    allMusic: 'Todas as músicas',
    allEvents: 'Todos os eventos',
    shopAll: 'Ver a loja',
    readPost: 'Ler o post',
    viewDetails: 'Ver detalhes',
    subscribe: 'Inscrever-me',
    reviewsHeading: 'O que dizem nossos clientes',
    signupHeading: 'Assine nossa newsletter',
    account: 'Minha conta',
    customerCare: 'Atendimento ao cliente',
    storeAnnouncement: 'Conheça toda a coleção',
    shopNow: 'Comprar agora',
    storeEmptyTitle: 'Novas peças estão a caminho',
    storeEmptyText: 'Estamos finalizando nossas primeiras peças. Fale conosco e avisaremos assim que chegarem.',
    storeEmptyTextAlone: 'Estamos finalizando nossas primeiras peças. Volte em breve.',
    getInTouch: 'Fale conosco',
    illustrativePhoto: 'Imagem ilustrativa',
    contact: 'Contato',
  },
  de: {
    seeAll: 'Alle ansehen',
    allPosts: 'Alle Beiträge',
    allMusic: 'Alle Musik',
    allEvents: 'Alle Veranstaltungen',
    shopAll: 'Zum Shop',
    readPost: 'Beitrag lesen',
    viewDetails: 'Details ansehen',
    subscribe: 'Abonnieren',
    reviewsHeading: 'Was unsere Kunden sagen',
    signupHeading: 'Abonnieren Sie unseren Newsletter',
    account: 'Mein Konto',
    customerCare: 'Kundenservice',
    storeAnnouncement: 'Entdecken Sie die ganze Kollektion',
    shopNow: 'Jetzt kaufen',
    storeEmptyTitle: 'Neue Stücke sind unterwegs',
    storeEmptyText: 'Unsere ersten Stücke werden gerade fertig. Schreiben Sie uns, und wir melden uns, sobald sie da sind.',
    storeEmptyTextAlone: 'Unsere ersten Stücke werden gerade fertig. Schauen Sie bald wieder vorbei.',
    getInTouch: 'Kontakt aufnehmen',
    illustrativePhoto: 'Symbolbild',
    contact: 'Kontakt',
  },
  it: {
    seeAll: 'Vedi tutto',
    allPosts: 'Tutti gli articoli',
    allMusic: 'Tutta la musica',
    allEvents: 'Tutti gli eventi',
    shopAll: 'Vai al negozio',
    readPost: 'Leggi l’articolo',
    viewDetails: 'Vedi dettagli',
    subscribe: 'Iscriviti',
    reviewsHeading: 'Cosa dicono i nostri clienti',
    signupHeading: 'Iscriviti alla nostra newsletter',
    account: 'Il mio account',
    customerCare: 'Assistenza clienti',
    storeAnnouncement: 'Scopri tutta la collezione',
    shopNow: 'Acquista ora',
    storeEmptyTitle: 'Nuovi pezzi in arrivo',
    storeEmptyText: 'Stiamo finendo i nostri primi pezzi. Scrivici e ti avviseremo appena arrivano.',
    storeEmptyTextAlone: 'Stiamo finendo i nostri primi pezzi. Torna presto.',
    getInTouch: 'Scrivici',
    illustrativePhoto: 'Immagine illustrativa',
    contact: 'Contatti',
  },
}

/** A language code's two-letter language, lowercase: `es` of `es-MX`; empty for none. */
export function aiLayoutLanguageOf(language: string | null | undefined): string {
  return typeof language === 'string' ? (/^([a-z]{2})(?:[-_]|$)/i.exec(language.trim())?.[1] ?? '').toLowerCase() : ''
}

/** Whether a site's language is one other than English: a code that names one. */
export function aiLayoutSpeaksOtherThanEnglish(language: string | null | undefined): boolean {
  const code = aiLayoutLanguageOf(language)
  return code !== '' && code !== 'en'
}

/** A label the platform places, in the site's language where it is listed, else in English. */
export function aiLayoutLabel(key: AiLayoutLabel, language?: string | null): string {
  return LABELS[aiLayoutLanguageOf(language)]?.[key] ?? AI_LAYOUT_LABELS_EN[key]
}
