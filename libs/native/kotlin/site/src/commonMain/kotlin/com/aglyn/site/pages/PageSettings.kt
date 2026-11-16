package com.aglyn.site.pages

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.PlanFeatureDefaults
import com.aglyn.core.firestoreNow
import com.aglyn.core.jsonValue
import com.aglyn.core.publishSiteWideChange
import com.aglyn.core.sha256Hex

/*
 * A page's own publishing and access settings, as the console's page view
 * reads and writes them (`screens/[screenId]/versions/[versionId]/view`): the
 * scheduled publish or unpublish (`publishSchedule`, AGL-113, the plan's
 * `scheduledPublishing`), who may see the page (`visibility` +
 * `protection.passwordHash`, AGL-113), and whether only the site's team sees
 * it once it is live (`host.previewScreens`, AGL-4086). The Apple kit's
 * PageSettings.swift.
 */

/** The plan feature that carries scheduled publishing. */
const val SCHEDULED_PUBLISHING_FEATURE = "scheduledPublishing"

/**
 * Who may see a page: the console's `HostScreenVisibility` values its Page
 * Access card offers, in its order, with its words. Every choice but Public
 * keeps the page out of search results and the sitemap (AGL-1263).
 */
enum class PageVisibility(val value: Long, val label: String, val hint: String) {
  PUBLIC(2, "Public", "Anyone with the link; listed in navigation and offered to search engines."),
  UNLISTED(6, "Unlisted", "Reachable by URL only — kept out of search results and the sitemap."),
  PASSWORD(24, "Password protected", "Visitors must enter the page password; kept out of search results."),
  MEMBERS(40, "Members only", "Requires site membership (enforced once site sign-in ships); kept out of search results."),
  ;

  companion object {
    fun of(value: Long): PageVisibility? = entries.firstOrNull { it.value == value }
  }
}

/** A page's one schedule, as `publishSchedule` stores it. */
data class PageSchedule(val action: String, val versionId: String?, val publishAt: FirestoreTimestamp?, val status: String) {
  val isUnpublish: Boolean get() = action == "unpublish"

  companion object {
    fun from(value: Any?): PageSchedule? {
      val map = value as? Map<*, *> ?: return null
      val action = map["action"] as? String ?: return null
      return PageSchedule(action, map["versionId"] as? String, map["publishAt"] as? FirestoreTimestamp, map["status"] as? String ?: "")
    }
  }
}

/** What the page's Schedule and Page access sections read from the screen document. */
data class PageSettings(val visibilityValue: Long, val hasPassword: Boolean, val schedule: PageSchedule?) {
  /** The choice the select shows; null for a stored value the section does not offer. */
  val visibility: PageVisibility? get() = PageVisibility.of(visibilityValue)

  /** The schedule still waiting to run. */
  val pending: PageSchedule? get() = schedule?.takeIf { it.status == "pending" }

  /** A schedule that came due and did not run, with the console's chip words; dismissing it clears the field. */
  val skippedLabel: String?
    get() = when (schedule?.status) {
      "skipped-unentitled" -> "Did not ${if (schedule.isUnpublish) "unpublish" else "publish"} — plan does not include scheduling"
      "skipped-unroutable" -> "Did not publish — no available address"
      else -> null
    }

  /** The console's explanation beside a skipped schedule. */
  val skippedHelp: String?
    get() = when (schedule?.status) {
      "skipped-unentitled" ->
        "Scheduled publishing is a ${PlanFeatureDefaults.grantedFrom[SCHEDULED_PUBLISHING_FEATURE] ?: "Pro"} feature. " +
          "This schedule came due on a plan without it, so it was not applied — and it will not run later if you " +
          "upgrade. Schedule it again to publish."
      "skipped-unroutable" ->
        "The scheduled publish ran, but this page has no address it could be published at — its slug (or a parent " +
          "page's) is missing, or another page is already published at that path. Set the slug below, publish or fix " +
          "the parent, then schedule it again."
      else -> null
    }

  companion object {
    fun from(doc: FirestoreDoc?): PageSettings = PageSettings(
      visibilityValue = doc?.long("visibility") ?: PageVisibility.PUBLIC.value,
      hasPassword = ((doc?.data?.get("protection") as? Map<*, *>)?.get("passwordHash") as? String)?.isNotEmpty() == true,
      schedule = PageSchedule.from(doc?.data?.get("publishSchedule")),
    )
  }
}

/** The pending schedule's chip: "Publishes 2026-11-20 09:00 UTC". */
fun pageScheduleLabel(schedule: PageSchedule, format: (Long) -> String): String =
  "${if (schedule.isUnpublish) "Unpublishes" else "Publishes"} ${schedule.publishAt?.let { format(it.epochMillis) }.orEmpty()}".trimEnd()

/** Whether one page of the site is in preview (`host.previewScreens[id] == true`), as `isScreenInPreview`. */
fun isPageInPreview(host: Map<String, Any?>?, pageId: String): Boolean = (host?.get("previewScreens") as? Map<*, *>)?.get(pageId) == true

/** Whether the whole site is in preview, as `isHostInPreview`: only an explicit `true` is. */
fun isSiteInPreview(host: Map<String, Any?>?): Boolean = host?.get("preview") == true

/** The Page access section's line under its Preview switch. */
fun pagePreviewCaption(siteInPreview: Boolean, pageInPreview: Boolean): String = when {
  siteInPreview -> "The whole site is in preview, so visitors see none of it yet. Make it public in Admin → Error pages."
  pageInPreview -> "Visitors get your 404 page here until you switch this off."
  else -> "Switch it on to keep this page to your team after you publish it."
}

/** The page password as the console stores it: SHA-256 of the typed text, lowercase hex. */
fun pagePasswordHash(password: String): String = sha256Hex(password)

/** The schedule dialog's first time, as the console's: the next whole hour. */
fun defaultScheduleMillis(now: Long): Long = (now + 3_600_000L).let { it - it.mod(3_600_000L) }

/** The console's sentence for a locked control: "Scheduled publishing is included from Business." */
fun schedulingLockReason(): String =
  PlanFeatureDefaults.grantedFrom[SCHEDULED_PUBLISHING_FEATURE]?.let { "Scheduled publishing is included from $it." }
    ?: "Scheduled publishing is a paid add-on."

/** The console's upsell under the schedule buttons. */
fun schedulingUpsell(): String =
  "Schedule this page to go live, or come down, at a set date and time." +
    (PlanFeatureDefaults.grantedFrom[SCHEDULED_PUBLISHING_FEATURE]?.let { " Included from $it." } ?: "")

private fun timestamp(millis: Long) = FirestoreTimestamp(millis.floorDiv(1000L), (millis.mod(1000L) * 1_000_000).toInt())

/**
 * A page's settings writes, the console page view's own: the screen document
 * updated in place, then the live page's cached copy dropped
 * (`announceLiveScreenChange`) when the page has an address; the preview
 * switch on the host beside the routing map, announced to the whole site as
 * `updateHostDocument` does.
 */
class PageSettingsApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String) {
  private fun path(id: String) = "hosts/$hostId/screens/$id"

  /** Drops the live page's cache so visitors get the change now; never fails the save before it. */
  private suspend fun announce(id: String, livePath: String?) {
    if (livePath == null) return
    runCatching { api.request("/api/screens/revalidate", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId, "screenId" to id))) }
  }

  /** Who may see the page. Leaving password mode drops the stored hash, so protection does not silently linger. */
  suspend fun setVisibility(id: String, visibility: PageVisibility, hadPassword: Boolean, livePath: String?) {
    writer.update(
      path(id),
      buildMap {
        put("visibility", visibility.value)
        if (visibility != PageVisibility.PASSWORD && hadPassword) put("protection", FirestoreDelete)
      },
    )
    announce(id, livePath)
  }

  /** Saves the page password (its hash), or removes protection when it is blank. */
  suspend fun setPassword(id: String, password: String, livePath: String?) {
    val value = password.trim()
    writer.update(path(id), mapOf("protection" to if (value.isEmpty()) FirestoreDelete else mapOf("passwordHash" to pagePasswordHash(value))))
    announce(id, livePath)
  }

  /** The page's one pending schedule: publish [versionId], or unpublish, at [atMillis]. */
  suspend fun schedule(id: String, unpublish: Boolean, versionId: String?, atMillis: Long) {
    val schedule = buildMap<String, Any?> {
      put("action", if (unpublish) "unpublish" else "publish")
      if (!unpublish && versionId != null) put("versionId", versionId)
      put("publishAt", timestamp(atMillis))
      put("status", "pending")
      put("createdAt", firestoreNow())
    }
    writer.update(path(id), mapOf("publishSchedule" to schedule))
  }

  /** Cancels the schedule, or dismisses one that came due and did not run. */
  suspend fun cancelSchedule(id: String) {
    writer.update(path(id), mapOf("publishSchedule" to FirestoreDelete))
  }

  /** One page in preview: once published, only the site's team sees it. */
  suspend fun setPreview(id: String, enabled: Boolean) {
    writer.merge("hosts/$hostId", mapOf("previewScreens" to mapOf(id to if (enabled) true else FirestoreDelete)))
    publishSiteWideChange(api, writer, hostId)
  }
}
