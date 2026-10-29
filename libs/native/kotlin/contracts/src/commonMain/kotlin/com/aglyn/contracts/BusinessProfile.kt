package com.aglyn.contracts

/*
 * A site's BUSINESS PROFILE (business-profile.ts, AGL-3661): what the business is, as everything that writes about it needs
 * to know. Most of it is already stored on the host (the SEO entity, the contact card), so the profile document holds only
 * the services, audience and tone, plus a line about the business and the area for a site whose SEO entity does not say.
 * `resolveBusinessProfile` reads the two together, field by field, with where each value came from, and
 * `businessProfileOwnerWrite` is the owner's save: every field they changed becomes theirs. Documents are plain maps, as
 * Firestore hands them out. BusinessProfileCasesTest replays the TypeScript's own answers.
 */

private val SOURCE_RANK = mapOf("ai" to 1, "start" to 2, "owner" to 3)

private fun profileText(value: Any?, max: Int): String = (value as? String)?.replace(Regex("\\s+"), " ")?.trim()?.take(max) ?: ""

private fun profileTone(value: Any?): String? = (value as? String)?.takeIf { it in Contracts.businessToneOrder }

private fun profileServices(value: Any?): List<String> {
  val items: List<Any?> = when (value) {
    is List<*> -> value
    is String -> value.split(',', '\n')
    else -> emptyList()
  }
  val seen = HashSet<String>()
  val kept = mutableListOf<String>()
  val perItem = (Contracts.businessProfileMaxChars["services"] ?: 60.0).toInt()
  for (item in items) {
    val name = profileText(item, perItem)
    if (name.isEmpty() || !seen.add(name.lowercase())) continue
    kept += name
    if (kept.size >= Contracts.businessProfileMaxServices) break
  }
  return kept
}

/** One field's stored value, sanitized: services a list, tone a known tone or null, anything else a string; empty is `""`, `[]` or null. */
private fun profileField(doc: Map<String, Any?>?, field: String): Any? = when (field) {
  "services" -> profileServices(doc?.get("services"))
  "tone" -> profileTone(doc?.get("tone"))
  else -> profileText(doc?.get(field), (Contracts.businessProfileMaxChars[field] ?: 200.0).toInt())
}

private fun profileEmpty(value: Any?): Boolean = value == null || value == "" || (value is List<*> && value.isEmpty())

private fun sourcesOf(doc: Map<String, Any?>?): Map<*, *> = (doc?.get("sources") as? Map<*, *>).orEmpty()

/** The source a stored, non-empty value carries; the owner's when none is recorded. */
fun businessProfileSourceOf(doc: Map<String, Any?>?, field: String): String? {
  if (profileEmpty(profileField(doc, field))) return null
  val source = sourcesOf(doc)[field] as? String
  return if (source != null && source in SOURCE_RANK) source else "owner"
}

/** Every value a write may carry, sanitized; an absent field stays absent. */
fun sanitizeBusinessProfileValues(values: Map<String, Any?>): Map<String, Any?> {
  val clean = LinkedHashMap<String, Any?>()
  for (field in Contracts.businessProfileFieldOrder) if (field in values) clean[field] = profileField(values, field)
  return clean
}

/**
 * The document the owner's save makes: every field they changed becomes theirs, and a field they left as it was keeps the
 * source it had, so saving after correcting one line does not claim every suggestion on the card.
 */
fun businessProfileOwnerWrite(current: Map<String, Any?>?, edited: Map<String, Any?>): Map<String, Any?> {
  val clean = sanitizeBusinessProfileValues(edited)
  val next = LinkedHashMap<String, Any?>()
  val sources = LinkedHashMap<String, String>()
  for (field in Contracts.businessProfileFieldOrder) {
    val before = profileField(current, field)
    val after = if (field in clean) clean[field] else before
    next[field] = after
    val same = before == after
    if (profileEmpty(after)) {
      // A suggestion the owner deleted is their decision, and recorded as one, so the next prefill does not put it back.
      if (!same) sources[field] = "owner" else if (sourcesOf(current)[field] == "owner") sources[field] = "owner"
      continue
    }
    sources[field] = if (same) businessProfileSourceOf(current, field) ?: "owner" else "owner"
  }
  next["sources"] = sources
  return next
}

/** A resolved value and where it came from: a stored source, the site's own settings, or the workspace defaults. */
data class ResolvedBusinessField<T>(val value: T, val origin: String)

data class ResolvedContact(val email: String?, val phone: String?, val address: String?, val hours: String?)

/** The picture every reader works from: each field's value and where it came from. */
data class ResolvedBusinessProfile(
  val name: ResolvedBusinessField<String>?,
  val whatYouDo: ResolvedBusinessField<String>?,
  val services: ResolvedBusinessField<List<String>>?,
  val serviceArea: ResolvedBusinessField<String>?,
  val audience: ResolvedBusinessField<String>?,
  val tone: ResolvedBusinessField<String>?,
  val toneNotes: ResolvedBusinessField<String>?,
  /** The year the business started (AGL-4092). */
  val founded: ResolvedBusinessField<String>?,
  /** The schema.org business type the SEO entity names, e.g. `Plumber`. */
  val businessType: String?,
  /** Real contact details, each only where the owner entered it in the site's settings. */
  val contact: ResolvedContact,
  /** The site's social and other profiles, https only. */
  val profiles: List<String>,
  val logo: String?,
)

/** A list of places as the SEO entity stores it, or the lines typed into the text box: distinct, trimmed, capped. */
fun normalizeAreaServed(value: Any?): List<String> {
  val items: List<Any?> = when (value) {
    is List<*> -> value
    is String -> value.split(Regex("\r?\n"))
    else -> emptyList()
  }
  val seen = HashSet<String>()
  val areas = mutableListOf<String>()
  for (item in items) {
    if (item !is String) continue
    val name = item.trim().replace(Regex("\\s+"), " ").take(Contracts.areaServedNameMaxLength.toInt())
    if (name.isEmpty() || !seen.add(name.lowercase())) continue
    areas += name
    if (areas.size >= Contracts.areaServedMax.toInt()) break
  }
  return areas
}

private fun Map<String, Any?>?.child(key: String): Map<String, Any?>? = (this?.get(key) as? Map<*, *>)?.mapKeys { it.key.toString() }?.mapValues { it.value }

/** The site's profile URLs: its SEO entity's `sameAs` first, then the social links its footer prints; https only, distinct. */
fun siteProfileUrls(host: Map<String, Any?>?): List<String> {
  val sameAs = (host.child("seo").child("entity")?.get("sameAs") as? List<*>).orEmpty()
  val rendered = (host.child("business")?.get("socialLinks") as? List<*>).orEmpty().map { ((it as? Map<*, *>)?.get("url") as? String).orEmpty() }
  return (sameAs + rendered)
    .map { (it as? String)?.trim()?.take(800).orEmpty() }
    .filter { it.startsWith("https://", ignoreCase = true) }
    .distinct()
    .take(Contracts.authorSameAsMax.toInt())
}

private fun addressLine(host: Map<String, Any?>?): String {
  val parts = host.child("seo").child("entity").child("address")
  val line = listOf("streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry")
    .map { profileText(parts?.get(it), 200) }
    .filter { it.isNotEmpty() }
    .joinToString(", ")
  return line.ifEmpty { profileText(host.child("business")?.get("address"), 400) }
}

/**
 * The profile as every reader sees it, field by field: what the OWNER typed into the site's profile; what the site's own
 * settings say (the SEO entity, the display name); what the guided start or a generator stored on the site's profile; the
 * workspace defaults. Contact details, the logo and the profiles come from the site's settings only.
 */
fun resolveBusinessProfile(host: Map<String, Any?>?, site: Map<String, Any?>? = null, workspace: Map<String, Any?>? = null): ResolvedBusinessProfile {
  val entity = host.child("seo").child("entity")
  val fromSite: Map<String, Any?> = mapOf(
    "whatYouDo" to profileText(entity?.get("description"), (Contracts.businessProfileMaxChars["whatYouDo"] ?: 200.0).toInt()),
    "serviceArea" to normalizeAreaServed(entity?.get("areaServed")).joinToString(", ").take((Contracts.businessProfileMaxChars["serviceArea"] ?: 120.0).toInt()),
  )

  @Suppress("UNCHECKED_CAST")
  fun <T> resolve(field: String): ResolvedBusinessField<T>? {
    val stored = businessProfileSourceOf(site, field)
    if (stored == "owner") return ResolvedBusinessField(profileField(site, field) as T, "owner")
    val own = fromSite[field]
    if (own != null && !profileEmpty(own)) return ResolvedBusinessField(own as T, "site")
    if (stored != null) return ResolvedBusinessField(profileField(site, field) as T, stored)
    if (businessProfileSourceOf(workspace, field) != null) return ResolvedBusinessField(profileField(workspace, field) as T, "workspace")
    return null
  }

  val name = profileText(entity?.get("name"), 200).ifEmpty { profileText(host?.get("displayName"), 200) }
  return ResolvedBusinessProfile(
    name = name.takeIf { it.isNotEmpty() }?.let { ResolvedBusinessField(it, "site") },
    whatYouDo = resolve("whatYouDo"),
    services = resolve("services"),
    serviceArea = resolve("serviceArea"),
    audience = resolve("audience"),
    tone = resolve("tone"),
    toneNotes = resolve("toneNotes"),
    founded = resolve("founded"),
    businessType = profileText(entity?.get("businessType"), 80).ifEmpty { null },
    contact = ResolvedContact(
      email = profileText(entity?.get("email"), 320).ifEmpty { profileText(host.child("business")?.get("supportEmail"), 320) }.ifEmpty { null },
      phone = profileText(entity?.get("telephone"), 64).ifEmpty { null },
      address = addressLine(host).ifEmpty { null },
      hours = profileText(entity?.get("openingHours"), 400).ifEmpty { null },
    ),
    profiles = siteProfileUrls(host),
    logo = profileText(host?.get("logoUrl"), 800).ifEmpty { profileText(entity?.get("logo"), 800) }.ifEmpty { null },
  )
}
