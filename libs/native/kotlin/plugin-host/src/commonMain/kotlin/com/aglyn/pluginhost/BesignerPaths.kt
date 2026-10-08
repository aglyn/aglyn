package com.aglyn.pluginhost

/**
 * The Besigner's pages: the only web content the apps show. These are the
 * console's `(editor)` route group (`apps/console/app/(editor)`), and nothing
 * else. Every other console page is a native screen, so a path these rules do
 * not name never opens in a web view.
 */
object BesignerPaths {
  /** Under `/{orgSlug}/hosts/{hostSlug}`. */
  private val SITE = listOf(
    Regex("^/theme$"),
    Regex("^/templates/[^/]+/(besigner|preview)$"),
    Regex("^/emails/[^/]+/versions/[^/]+/besigner$"),
    Regex("^/screens/[^/]+/versions/[^/]+(/(besigner|preview|view))?$"),
    // Components, layouts and every plugin's declared Besigner document.
    Regex("^/[^/]+/[^/]+/versions/[^/]+/(besigner|preview)$"),
  )

  /** The staff console's editor pages. */
  private val STAFF = listOf(
    Regex("^/admin/emails/[^/]+/versions/[^/]+/besigner$"),
    Regex("^/admin/sites/[^/]+/preview/[^/]+/[^/]+$"),
  )

  /** Whether [path], a whole console path (its query and fragment ignored), is a Besigner page. */
  fun isBesignerPath(path: String): Boolean {
    val bare = path.substringBefore('#').substringBefore('?')
    if (bare.isEmpty() || !bare.startsWith("/") || bare.contains("//") || bare.split('/').any { it == ".." || it == "." }) return false
    if (STAFF.any { it.matches(bare) }) return true
    val scope = DeepLinks.splitConsoleScope(bare)
    if (scope.hostSlug.isNullOrEmpty()) return false
    return SITE.any { it.matches(scope.rest) }
  }

  /** The Besigner on one page's working version, under the picked site. */
  fun screen(screenId: String, versionId: String): String = "/screens/$screenId/versions/$versionId/besigner"

  /** A reusable component's version in the Besigner (`COMPONENT_BESIGNER`), or its preview. */
  fun component(componentId: String, versionId: String, preview: Boolean = false): String =
    "/components/$componentId/versions/$versionId/${if (preview) "preview" else "besigner"}"

  /** A shared layout's version in the Besigner (`LAYOUT_BESIGNER`), or its preview. */
  fun layout(layoutId: String, versionId: String, preview: Boolean = false): String =
    "/layouts/$layoutId/versions/$versionId/${if (preview) "preview" else "besigner"}"

  /** A template in the Besigner (`TEMPLATE_BESIGNER`; templates have no versions), or its preview. */
  fun template(templateId: String, preview: Boolean = false): String = "/templates/$templateId/${if (preview) "preview" else "besigner"}"
}
