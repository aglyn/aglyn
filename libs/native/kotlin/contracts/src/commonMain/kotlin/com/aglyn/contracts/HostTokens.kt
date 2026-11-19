package com.aglyn.contracts

/*
 * The site's `host.*` variables (host-tokens.ts, AGL-4136) as the Business details card's "What your pages can use" lists
 * them (`hostTokenPreview`): each variable's token, what it is, and the value it would produce on this site. The
 * resolvers are the TypeScript's, read field by field; HostTokensCasesTest replays its answers. The Apple contracts'
 * HostTokens.swift.
 */

/** One `host.*` variable as the preview lists it. */
data class HostTokenPreviewRow(
  val key: String,
  val type: String,
  val label: String,
  val description: String,
  val whenEmpty: String,
  val token: String,
  val value: String?,
) {
  val set: Boolean get() = value != null
}

private fun trimmedText(value: Any?): String? = (value as? String)?.trim()?.ifEmpty { null }

@Suppress("UNCHECKED_CAST")
private fun node(value: Any?, key: String): Map<String, Any?>? = (value as? Map<String, Any?>)?.get(key) as? Map<String, Any?>

/** A phone number as a `tel:` link (`telephoneHref`): its digits, with a leading `+` kept; null without digits. */
fun telephoneHref(phone: Any?): String? {
  val text = trimmedText(phone) ?: return null
  val digits = text.filter { it in '0'..'9' }
  if (digits.isEmpty()) return null
  return "tel:${if (text.startsWith("+")) "+" else ""}$digits"
}

private val SOCIAL_NETWORK_HOSTS = mapOf(
  "facebook" to listOf("facebook.com", "fb.com"),
  "instagram" to listOf("instagram.com"),
  "x" to listOf("x.com", "twitter.com"),
  "linkedin" to listOf("linkedin.com"),
  "youtube" to listOf("youtube.com", "youtu.be"),
  "tiktok" to listOf("tiktok.com"),
)

private val URL_HOST = Regex("^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?(\\[[^\\]]*\\]|[^/?#:]*)")

/** The site's profile on one network (`siteSocialProfileUrl`): the first of its profiles whose host is the network's. */
fun siteSocialProfileUrl(host: Map<String, Any?>?, network: String): String? {
  val names = SOCIAL_NETWORK_HOSTS[network].orEmpty()
  for (value in siteProfileUrls(host)) {
    if (value.any { it.isWhitespace() }) continue
    val hostname = URL_HOST.find(value)?.groupValues?.get(1)?.lowercase()?.ifEmpty { null } ?: continue
    if (names.any { hostname == it || hostname.endsWith(".$it") }) return value
  }
  return null
}

private class HostToken(
  val key: String,
  val type: String,
  val label: String,
  val description: String,
  val whenEmpty: String,
  val resolve: (Map<String, Any?>) -> String?,
)

private fun socialToken(network: String, key: String, name: String) = HostToken(
  key, "url", "$name link", "The address of the site’s $name profile, from Setup → Business profile.", "omit-block",
) { siteSocialProfileUrl(it, network) }

private fun hostTokens(apex: String): List<HostToken> {
  fun entity(host: Map<String, Any?>) = node(host["seo"], "entity")
  fun logo(host: Map<String, Any?>) = trimmedText(host["logoUrl"]) ?: trimmedText(entity(host)?.get("logo"))
  fun areas(host: Map<String, Any?>) = normalizeAreaServed(entity(host)?.get("areaServed"))
  return listOf(
    HostToken("businessName", "text", "Business name", "The business name from Setup → Business profile, or the site’s name when none is set.", "blank") {
      trimmedText(entity(it)?.get("name")) ?: trimmedText(it["displayName"])
    },
    HostToken("slogan", "text", "Slogan", "A short line about the business, from Setup → Business profile.", "blank") { trimmedText(entity(it)?.get("slogan")) },
    HostToken("logo", "image", "Logo", "The site’s logo image.", "omit-block") { logo(it) },
    HostToken("logoDark", "image", "Logo for dark backgrounds", "The logo to show on a dark background. The site’s logo when it has no dark one.", "omit-block") {
      trimmedText(it["logoDarkUrl"]) ?: logo(it)
    },
    HostToken("url", "url", "Site address", "The site’s public URL — its custom domain when connected.", "blank") { host ->
      trimmedText(host["cname"])?.let { "https://${it.replace(Regex("^https?://"), "")}" } ?: trimmedText(host["subdomain"])?.let { "https://$it.$apex" }
    },
    HostToken("phone", "text", "Phone", "The business’s phone number, as entered on Setup → Business profile.", "omit-block") { trimmedText(entity(it)?.get("telephone")) },
    HostToken("phoneLink", "url", "Phone link", "The phone number as a tel: link, for a Call button’s link. Dropped when the site has no phone.", "omit-block") {
      telephoneHref(entity(it)?.get("telephone"))
    },
    HostToken("supportEmail", "email", "Email", "The email address visitors write to, from Setup → Business profile.", "omit-block") { siteContactEmail(it) },
    HostToken("address", "address", "Postal address", "The business’s postal address from Setup → Business profile, as one block of text.", "omit-block") {
      trimmedText(structuredAddressLine(entity(it)?.get("address") as? Map<*, *>)) ?: trimmedText(node(it, "business")?.get("address"))
    },
    HostToken("mainArea", "text", "Main area", "The first area served, by its place name: San Antonio, for “San Antonio, TX”. From SEO → Local business.", "blank") {
      areas(it).firstOrNull()?.let { area -> trimmedText(area.split(',').first()) }
    },
    HostToken("areasServed", "text", "Areas served", "Every area served, in order, separated by commas. From SEO → Local business.", "blank") {
      trimmedText(areas(it).joinToString(", "))
    },
    HostToken("socialLinks", "text", "Social links", "The site’s social profiles, as a list of labeled links.", "omit-block") { host ->
      val labels = (node(host, "business")?.get("socialLinks") as? List<*>).orEmpty().mapNotNull { link ->
        val row = link as? Map<*, *>
        trimmedText(row?.get("label")) ?: trimmedText(row?.get("url"))
      }
      labels.joinToString(" · ").ifEmpty { null }
    },
    socialToken("facebook", "facebookUrl", "Facebook"),
    socialToken("instagram", "instagramUrl", "Instagram"),
    socialToken("x", "xUrl", "X"),
    socialToken("linkedin", "linkedinUrl", "LinkedIn"),
    socialToken("youtube", "youtubeUrl", "YouTube"),
    socialToken("tiktok", "tiktokUrl", "TikTok"),
  )
}

/** Every `host.*` variable, in the console's order, with the value it would produce on [host] (`hostTokenPreview`). */
fun hostTokenPreview(host: Map<String, Any?>?, apex: String = "aglyn.app"): List<HostTokenPreviewRow> =
  hostTokens(apex).map { token ->
    HostTokenPreviewRow(token.key, token.type, token.label, token.description, token.whenEmpty, "{{host.${token.key}}}", host?.let { token.resolve(it) })
  }
