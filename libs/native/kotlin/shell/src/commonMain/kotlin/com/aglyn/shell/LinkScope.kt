package com.aglyn.shell

import com.aglyn.core.WorkspaceState
import com.aglyn.pluginhost.DeepLinks

/**
 * The workspace and site a link belongs to, as far as the person's memberships name them: a console link's
 * `/{orgSlug}/hosts/{subdomain}/…`, a stored notification's `/{hostDocId}/…`, or a notification row's own ids. A link
 * opens there, never in whichever workspace happened to be on screen (AGL-3911: an AI job notification from another site
 * opened that job's screen over the wrong site's jobs, every field "—").
 */
internal data class LinkScope(val orgId: String, val hostId: String? = null, val hostSubdomain: String? = null)

/** The query parameter an AI job notice carries to open AI jobs on that job (`AI_JOB_LINK_PARAM`). */
internal const val AI_JOB_LINK_PARAM = "aiJob"

/** Where [link] belongs, when it names a workspace (or a site of the one on screen) the person holds; null otherwise. */
internal fun linkScopeOf(link: String, workspace: WorkspaceState): LinkScope? {
  val path = DeepLinks.consolePathOf(link)?.substringBefore('?') ?: return null
  val split = DeepLinks.splitConsoleScope(path)
  val first = split.orgSlug ?: return null
  workspace.orgs.firstOrNull { it.slug == first }?.let { org ->
    val site = split.hostSlug?.let { host -> workspace.sites.firstOrNull { it.orgId == org.id && it.subdomain == host } }
    return LinkScope(org.id, site?.id, split.hostSlug)
  }
  // A stored link (`normalizeNotificationLink`'s input) leads with the site's document id.
  workspace.sites.firstOrNull { it.id == first }?.let { return LinkScope(it.orgId, it.id, it.subdomain.ifEmpty { null }) }
  return null
}

/** The site of [scope] among the workspace's loaded sites, by id or by subdomain. */
private fun siteOf(scope: LinkScope, workspace: WorkspaceState) = workspace.sites.firstOrNull { site ->
  site.orgId == scope.orgId && ((scope.hostId != null && site.id == scope.hostId) || (scope.hostSubdomain != null && site.subdomain == scope.hostSubdomain))
}

/** Whether the workspace's sites on screen are [scope]'s workspace's, fully loaded. */
private fun sitesLoadedFor(scope: LinkScope, workspace: WorkspaceState) =
  workspace.ready && workspace.org?.id == scope.orgId && workspace.sites.all { it.orgId == scope.orgId }

/**
 * Whether the workspace on screen is where [scope] points, or as close as it will get: its workspace, with its site
 * picked, or with its sites loaded and none of them the link's (the screen then says what it cannot find).
 */
internal fun linkScopeSettled(scope: LinkScope, workspace: WorkspaceState): Boolean {
  if (workspace.org?.id != scope.orgId) return false
  if (scope.hostId == null && scope.hostSubdomain == null) return true
  val current = workspace.site
  if (current != null && (current.id == scope.hostId || (scope.hostSubdomain != null && current.subdomain == scope.hostSubdomain))) return true
  return sitesLoadedFor(scope, workspace) && siteOf(scope, workspace) == null
}

/**
 * The next pick on the way to [scope]: the workspace (with its site when its id is known), then the site once the
 * workspace's sites have loaded; null when nothing is left to pick.
 */
internal fun linkScopePick(scope: LinkScope, workspace: WorkspaceState): Pair<String, String?>? {
  if (workspace.org?.id != scope.orgId) return scope.orgId to scope.hostId
  if (!sitesLoadedFor(scope, workspace)) return null
  val site = siteOf(scope, workspace) ?: return null
  return if (site.id == workspace.site?.id) null else scope.orgId to site.id
}

/**
 * An AI job notice's `…?aiJob={id}` (already URL-encoded) as the AI jobs path native screens answer: the console opens AI jobs on that job from
 * the dashboard it links, so the app opens the job. Any other link is returned as it is.
 */
internal fun withAiJobPath(link: String): String {
  val full = DeepLinks.consolePathOf(link) ?: return link
  val at = full.indexOf('?')
  if (at < 0) return link
  val path = full.substring(0, at)
  val params = full.substring(at + 1).split('&').map { it.substringBefore('=') to it.substringAfter('=', "") }
  val jobId = params.firstOrNull { it.first == AI_JOB_LINK_PARAM }?.second?.takeIf { it.isNotEmpty() } ?: return link
  if (DeepLinks.splitConsoleScope(path).rest.trimEnd('/').isNotEmpty()) return link
  val rest = params.filter { it.first != AI_JOB_LINK_PARAM }.joinToString("&") { (key, value) -> "$key=$value" }
  return "${path.trimEnd('/')}/ai-jobs/$jobId" + if (rest.isEmpty()) "" else "?$rest"
}
