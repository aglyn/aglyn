package com.aglyn.pluginhost

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * What the site's SEO page hands the widgets in its `hostSeo` zone (the console's `ConsoleHostSeoZoneProps`): the stored
 * `seo` settings, as the form was seeded with them, and the way to propose values for the form.
 */
class SeoZone(
  /** The site's stored `seo` settings. */
  val seo: Map<String, Any?>?,
  /** The target keyword lines the SEO check above was last run with, one page a line (`/pricing: plans, pricing`); blank before a run. */
  val keywords: String,
  /**
   * Puts [values] in the SEO form as unsaved edits, keyed by the form's field names (`seo.title`,
   * `seo.entity.description`, `seo.agent.whenToUse`). The same key twice applies once; the form's Save is the write.
   */
  val proposeDraft: (values: Map<String, String>, key: String) -> Unit,
)

/** The SEO page's zone, while one of its widgets is drawn; null anywhere else. */
val LocalSeoZone = staticCompositionLocalOf<SeoZone?> { null }
