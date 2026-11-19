package com.aglyn.contracts

/*
 * A site's BUSINESS DETAILS as Setup → Business profile saves them (business-details.ts, AGL-4136): the name, slogan, phone,
 * email and postal address live on `seo.entity.*`, the social links on `business.socialLinks`, and the save keeps two older
 * copies in step for the readers that still use them: the email in `business.supportEmail` and the address, formatted, in
 * `business.address`. Documents are plain maps, as Firestore hands them out. BusinessDetailsCasesTest replays the
 * TypeScript's own answers. The Apple contracts' BusinessDetails.swift.
 */

private fun trimmed(value: Any?): String = (value as? String)?.trim().orEmpty()

@Suppress("UNCHECKED_CAST")
private fun asMap(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

/**
 * The email address a visitor writes to the business at (`siteContactEmail`): `seo.entity.email`, else the one-block copy
 * `business.supportEmail`, trimmed. Null when the site has neither.
 */
fun siteContactEmail(host: Map<String, Any?>?): String? {
  val email = trimmed(asMap(asMap(host?.get("seo"))?.get("entity"))?.get("email")).take(320)
  val copy = trimmed(asMap(host?.get("business"))?.get("supportEmail")).take(320)
  return email.ifEmpty { copy }.ifEmpty { null }
}

/**
 * The host document as the Business details card is seeded with it (`businessDetailsSeed`): the site's one email in the
 * Email field, so a site whose email so far lived only in the one-block copy shows it there. Everything else as stored.
 */
fun businessDetailsSeed(host: Map<String, Any?>?): Map<String, Any?>? {
  if (host == null) return null
  val seo = asMap(host["seo"])
  val email = siteContactEmail(host) ?: return host
  if (trimmed(asMap(seo?.get("entity"))?.get("email")).isNotEmpty()) return host
  val entity = asMap(seo?.get("entity")).orEmpty() + ("email" to email)
  return host + ("seo" to (seo.orEmpty() + ("entity" to entity)))
}

/**
 * What a Setup → Business profile save writes (`businessDetailsWrite`), from what the card submitted (nested, as the form's
 * values) and what the document stores now: every text trimmed; the email mirrored into `business.supportEmail` (`""` when
 * it was cleared and a copy is stored); the structured address mirrored, as one line, into `business.address`, but only
 * when the structured address changed; social links without an address dropped, each trimmed, up to the most the editor
 * allows.
 */
fun businessDetailsWrite(fields: Map<String, Any?>, stored: Map<String, Any?>?): Map<String, Any?> {
  val seo = asMap(fields["seo"]).orEmpty().toMutableMap()
  val entity = asMap(seo["entity"]).orEmpty().toMutableMap()
  for (key in listOf("name", "slogan", "telephone", "email")) if (entity[key] is String) entity[key] = trimmed(entity[key])
  asMap(entity["address"])?.let { address -> entity["address"] = address.mapValues { (_, value) -> if (value is String) trimmed(value) else value } }
  seo["entity"] = entity

  val business = asMap(fields["business"]).orEmpty().toMutableMap()
  val storedBusiness = asMap(stored?.get("business"))
  val email = trimmed(entity["email"])
  when {
    email.isNotEmpty() -> business["supportEmail"] = email
    trimmed(storedBusiness?.get("supportEmail")).isNotEmpty() -> business["supportEmail"] = ""
    else -> business.remove("supportEmail")
  }

  val before = structuredAddressLine(asMap(asMap(asMap(stored?.get("seo"))?.get("entity"))?.get("address")))
  val after = structuredAddressLine(asMap(entity["address"]))
  if (after != before) {
    when {
      after.isNotEmpty() -> business["address"] = after
      trimmed(storedBusiness?.get("address")).isNotEmpty() -> business["address"] = ""
      else -> business.remove("address")
    }
  }

  (business["socialLinks"] as? List<*>)?.let { links ->
    business["socialLinks"] = links.mapNotNull { asMap(it) }
      .filter { trimmed(it["url"]).isNotEmpty() }
      .take(Contracts.businessSocialLinksMax.toInt())
      .map { mapOf("label" to trimmed(it["label"]), "url" to trimmed(it["url"])) }
  }

  return fields + mapOf("seo" to seo.toMap(), "business" to business.toMap())
}
