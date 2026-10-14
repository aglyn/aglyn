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
 * THE WORDS A SITE'S OWN STATUS PAGES SAY, IN THE SITE'S LANGUAGE (AGL-3771).
 *
 * The 404 and the error screen are the platform's, not the site owner's, so
 * their words are the platform's too. A Spanish site (Panaderia El Trigal,
 * beta.249) answered a missing page with "We can’t find that page" and "Go to
 * the homepage". Each line is English, then the same words in the languages
 * below, the ones the AI's own page labels speak (`ai-layout-labels.ts`); a
 * site in a language not listed keeps the English.
 */

/** Every line the status pages write themselves, in English. */
export const SITE_STATUS_COPY_EN = {
  notFoundTitle: 'We can’t find that page',
  notFoundMessage:
    'The link may be out of date, or the page may have been moved or removed. Everything else on the site is still here.',
  errorTitle: 'Something went wrong',
  errorMessage:
    'This page didn’t load properly. Trying again often fixes it — if it doesn’t, the rest of the site is still available.',
  tryAgain: 'Try again',
  /** The search box's label. */
  searchLabel: 'Search this site',
  /** The search box's button, and the footer's link to the search page. */
  search: 'Search',
  goHome: 'Go to the homepage',
  /** The footer's link home. */
  home: 'Home',
  /** The header's navigation landmark. */
  siteNav: 'Site',
  /** The site's mark, a link home, as a screen reader names it; `{name}` is the site's. */
  markHome: '{name} home',
} as const

export type SiteStatusCopy = Record<keyof typeof SITE_STATUS_COPY_EN, string>

/** The same lines in each language listed, by its two-letter code. */
const COPY: Readonly<Record<string, SiteStatusCopy>> = {
  es: {
    notFoundTitle: 'No encontramos esa página',
    notFoundMessage:
      'Es posible que el enlace sea antiguo o que la página se haya movido o eliminado. Todo lo demás del sitio sigue aquí.',
    errorTitle: 'Algo salió mal',
    errorMessage:
      'Esta página no se cargó bien. Volver a intentarlo suele resolverlo; si no, el resto del sitio sigue disponible.',
    tryAgain: 'Intentar de nuevo',
    searchLabel: 'Buscar en este sitio',
    search: 'Buscar',
    goHome: 'Ir a la página de inicio',
    home: 'Inicio',
    siteNav: 'Sitio',
    markHome: 'Inicio de {name}',
  },
  fr: {
    notFoundTitle: 'Nous ne trouvons pas cette page',
    notFoundMessage:
      'Le lien est peut-être ancien, ou la page a été déplacée ou supprimée. Tout le reste du site est toujours là.',
    errorTitle: 'Un problème est survenu',
    errorMessage:
      'Cette page ne s’est pas chargée correctement. Réessayer suffit souvent ; sinon, le reste du site reste disponible.',
    tryAgain: 'Réessayer',
    searchLabel: 'Rechercher sur ce site',
    search: 'Rechercher',
    goHome: 'Aller à l’accueil',
    home: 'Accueil',
    siteNav: 'Site',
    markHome: 'Accueil de {name}',
  },
  pt: {
    notFoundTitle: 'Não encontramos essa página',
    notFoundMessage:
      'O link pode estar desatualizado, ou a página pode ter sido movida ou removida. Todo o resto do site continua aqui.',
    errorTitle: 'Algo deu errado',
    errorMessage:
      'Esta página não carregou direito. Tentar de novo costuma resolver; se não, o resto do site continua disponível.',
    tryAgain: 'Tentar de novo',
    searchLabel: 'Pesquisar neste site',
    search: 'Pesquisar',
    goHome: 'Ir para a página inicial',
    home: 'Início',
    siteNav: 'Site',
    markHome: 'Início de {name}',
  },
  de: {
    notFoundTitle: 'Diese Seite finden wir nicht',
    notFoundMessage:
      'Der Link ist vielleicht veraltet, oder die Seite wurde verschoben oder entfernt. Alles andere auf der Website ist noch da.',
    errorTitle: 'Etwas ist schiefgelaufen',
    errorMessage:
      'Diese Seite wurde nicht richtig geladen. Ein erneuter Versuch hilft oft – wenn nicht, ist der Rest der Website weiterhin verfügbar.',
    tryAgain: 'Erneut versuchen',
    searchLabel: 'Diese Website durchsuchen',
    search: 'Suchen',
    goHome: 'Zur Startseite',
    home: 'Startseite',
    siteNav: 'Website',
    markHome: 'Startseite von {name}',
  },
  it: {
    notFoundTitle: 'Non troviamo questa pagina',
    notFoundMessage:
      'Il link potrebbe essere vecchio, oppure la pagina è stata spostata o rimossa. Tutto il resto del sito è ancora qui.',
    errorTitle: 'Qualcosa è andato storto',
    errorMessage:
      'Questa pagina non si è caricata correttamente. Riprovare spesso risolve; altrimenti, il resto del sito è ancora disponibile.',
    tryAgain: 'Riprova',
    searchLabel: 'Cerca in questo sito',
    search: 'Cerca',
    goHome: 'Vai alla home page',
    home: 'Home',
    siteNav: 'Sito',
    markHome: 'Home di {name}',
  },
}

/** The two-letter code of a site's language, `es` of `es-MX`; empty for none. */
export function siteStatusLanguageOf(language: string | null | undefined): string {
  return (language ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? ''
}

/** The status pages' lines in a site's language, or in English where it is not listed. */
export function siteStatusCopy(language: string | null | undefined): SiteStatusCopy {
  return COPY[siteStatusLanguageOf(language)] ?? SITE_STATUS_COPY_EN
}
