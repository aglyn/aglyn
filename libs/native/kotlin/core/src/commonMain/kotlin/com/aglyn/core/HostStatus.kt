package com.aglyn.core

/** Whether a site is serving its pages, as the console's Sites list reports it. */
enum class HostStatusKind { LIVE, DRAFT, MAINTENANCE, SUSPENDED }

data class HostStatus(
  val kind: HostStatusKind,
  /** `Live`, `Draft`, `Maintenance`, `Suspended`. */
  val label: String,
  /** Why, in one sentence. */
  val detail: String,
  val publishedPages: Int,
) {
  companion object {
    fun publishedScreenCount(host: Map<String, Any?>?): Int = (host?.get("screens") as? Map<*, *>)?.size ?: 0

    /**
     * The port of the console's `describeHostStatus`. Order matters: a
     * suspended site is not live whatever it has published, and a site in
     * maintenance serves the maintenance page rather than its pages.
     */
    fun describe(host: Map<String, Any?>?, nowMillis: Long): HostStatus {
      val published = publishedScreenCount(host)
      val suspendedAt = (host?.get("suspendedAt") as? Number)?.toLong()
      if (suspendedAt != null && suspendedAt != 0L) {
        val until = (host["suspendedUntilMs"] as? Number)?.toLong()
        if (until == null || until == 0L || until > nowMillis) {
          return HostStatus(HostStatusKind.SUSPENDED, "Suspended", "This site is serving a lockdown notice instead of content.", published)
        }
      }
      if (host?.get("maintenance") == true) {
        return HostStatus(HostStatusKind.MAINTENANCE, "Maintenance", "Every path serves the maintenance page.", published)
      }
      if (published > 0) {
        return HostStatus(HostStatusKind.LIVE, "Live", "$published published page${if (published == 1) "" else "s"}.", published)
      }
      return HostStatus(HostStatusKind.DRAFT, "Draft", "Nothing published yet — visitors see the placeholder.", 0)
    }
  }
}

/** The platform domain sites are served on, as the console's TENANT_APEX defaults it. */
const val DEFAULT_TENANT_APEX = "aglyn.app"

/** A site's own address on the platform domain, or null without a subdomain. */
fun siteAddress(subdomain: String?, apex: String = DEFAULT_TENANT_APEX): String? =
  subdomain?.takeIf { it.isNotBlank() }?.let { "$it.$apex" }
