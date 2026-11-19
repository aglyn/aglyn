package com.aglyn.plugins.crm

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.formatCurrencyFieldValue
import com.aglyn.core.FirestoreReader

/*
 * SEND EMAIL'S PREVIEW (the Apple `CrmMergePreview.swift`; the console's `resolveCrmMergeFields` in
 * `crm-email-templates.ts` and the preview in `crm-send-email-dialog.tsx`): a draft that names a merge field is shown as
 * it will be sent, filled from the record's documents, and the fields with nothing to fill are named under the message.
 */

/** What the resolver reads from (`CrmMergeContext`): the documents as stored. */
data class CrmMergeContext(
  val contact: Map<String, Any?>? = null,
  /** The holder whose facet names the contact: the sending site's consent group; null reads the canonical name. */
  val contactGroupId: String? = null,
  val lead: Map<String, Any?>? = null,
  val deal: Map<String, Any?>? = null,
  val senderName: String? = null,
  val senderEmail: String? = null,
  val siteName: String? = null,
)

data class CrmMergeResult(val text: String, val unresolved: List<String>)

/** `{{ group.field }}` with an optional `|fallback` (the console's `MERGE_FIELD_PATTERN`). */
private val crmMergeFieldPattern = Regex("""\{\{\s*([A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)\s*(?:\|([^}]*))?\}\}""")

/** `hasCrmMergeFields`: whether a draft names a field, so the preview has anything to show. */
fun crmHasMergeFields(text: String): Boolean = crmMergeFieldPattern.containsMatchIn(text)

private fun trimmed(value: Any?): String = (value as? String)?.trim().orEmpty()

/** `splitPersonName`: a name's first word and the rest. */
fun crmSplitPersonName(name: Any?): Pair<String, String> {
  val words = (name as? String).orEmpty().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
  return (words.firstOrNull().orEmpty()) to words.drop(1).joinToString(" ")
}

private val crmEmailPattern = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""")

/** `normalizeContactEmail`: lower-cased when it is an address, else null. */
fun crmNormalizeEmail(input: Any?): String? {
  val email = (input as? String).orEmpty().trim().lowercase()
  return email.takeIf { it.length <= 320 && crmEmailPattern.matches(it) }
}

/** `formatCrmMergeAmount`: a deal's cents as money; "" when not a number. */
fun crmFormatMergeAmount(cents: Any?, currency: Any?): String {
  val number = (cents as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: return ""
  val code = ((currency as? String)?.ifEmpty { null } ?: "usd").uppercase()
  return formatCurrencyFieldValue(number, code)
}

private fun crmMergeField(key: String, context: CrmMergeContext): String {
  val (group, field) = key.split(".", limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } ?: return ""
  return when (group) {
    "contact" -> {
      val contact = context.contact ?: return ""
      val groupId = trimmed(context.contactGroupId)
      val facet = ((contact["facets"] as? Map<*, *>)?.get(groupId) as? Map<*, *>).orEmpty()
      val facetName = facet["name"] as? String
      val name = if (groupId.isEmpty()) trimmed(contact["name"]) else facetName?.ifEmpty { null } ?: (contact["name"] as? String).orEmpty()
      val parts = if (trimmed(facet["firstName"]).isNotEmpty() || trimmed(facet["lastName"]).isNotEmpty()) trimmed(facet["firstName"]) to trimmed(facet["lastName"]) else crmSplitPersonName(name)
      when (field) {
        "firstName" -> parts.first
        "lastName" -> parts.second
        "name" -> name
        "email" -> crmNormalizeEmail(contact["email"]).orEmpty()
        "company" -> trimmed(facet["companyName"])
        "title" -> trimmed(facet["jobTitle"])
        else -> ""
      }
    }
    "lead" -> {
      val lead = context.lead ?: return ""
      val parts = if (trimmed(lead["firstName"]).isNotEmpty() || trimmed(lead["lastName"]).isNotEmpty()) trimmed(lead["firstName"]) to trimmed(lead["lastName"]) else crmSplitPersonName(lead["name"])
      when (field) {
        "firstName" -> parts.first
        "lastName" -> parts.second
        "name" -> trimmed(lead["name"])
        "email" -> crmNormalizeEmail(lead["email"]).orEmpty()
        "company" -> trimmed(lead["company"])
        "title" -> trimmed(lead["jobTitle"])
        else -> ""
      }
    }
    "deal" -> {
      val deal = context.deal ?: return ""
      when (field) {
        "name" -> trimmed(deal["title"])
        "amount" -> crmFormatMergeAmount(deal["amountCents"], deal["currency"])
        else -> ""
      }
    }
    "sender" -> when (field) {
      "firstName" -> crmSplitPersonName(context.senderName).first
      "name" -> trimmed(context.senderName)
      "email" -> crmNormalizeEmail(context.senderEmail).orEmpty()
      else -> ""
    }
    "site" -> if (field == "name") trimmed(context.siteName) else ""
    else -> ""
  }
}

/** `resolveCrmMergeFields`: every field replaced (its value, its fallback, or nothing) and the ones with nothing to say. */
fun crmResolveMergeFields(text: String, context: CrmMergeContext?): CrmMergeResult {
  val ctx = context ?: CrmMergeContext()
  val unresolved = LinkedHashSet<String>()
  val rendered = crmMergeFieldPattern.replace(text) { match ->
    val key = match.groupValues[1]
    val value = crmMergeField(key, ctx).ifEmpty { match.groups[2]?.value?.trim().orEmpty() }
    if (value.isEmpty()) unresolved.add(key)
    value
  }
  return CrmMergeResult(rendered, unresolved.toList())
}

/** `crmMergeUnresolvedMessage`: what the dialog says under a draft whose fields have nothing to fill. */
fun crmMergeUnresolvedMessage(unresolved: List<String>): String {
  if (unresolved.isEmpty()) return ""
  val noun = if (unresolved.size == 1) "1 field has no value" else "${unresolved.size} fields have no value"
  return "$noun: ${unresolved.joinToString(", ") { crmMergeFieldToken(it) }}"
}

/** A merge context from plain JSON (the function cases' shape). */
@Suppress("UNCHECKED_CAST")
fun crmMergeContext(raw: Map<String, Any?>?): CrmMergeContext? {
  raw ?: return null
  val sender = raw["sender"] as? Map<String, Any?>
  return CrmMergeContext(
    contact = raw["contact"] as? Map<String, Any?>, contactGroupId = raw["contactGroupId"] as? String, lead = raw["lead"] as? Map<String, Any?>,
    deal = raw["deal"] as? Map<String, Any?>, senderName = sender?.get("name") as? String, senderEmail = sender?.get("email") as? String,
    siteName = (raw["site"] as? Map<String, Any?>)?.get("name") as? String,
  )
}

/** `duplicateDisplayName`: the copy's default name, "Copy of …" once, within the name's limit. */
fun crmDuplicateDisplayName(source: String?): String {
  val name = source.orEmpty().trim().ifEmpty { "Untitled" }
  val base = if (name.startsWith(Contracts.duplicateNamePrefix)) name else Contracts.duplicateNamePrefix + name
  return base.take(Contracts.duplicateNameMax.toInt())
}

/**
 * The documents the preview reads (the dialog's `MergeRecords`), fetched once the draft names a field: the contact (a
 * deal's own contact when the record is a deal), the deal, the lead, the sending site's name and the sender. A read that
 * fails leaves its part empty, so the field is named as having no value rather than guessed.
 */
suspend fun crmMergeContextFor(reader: FirestoreReader, scope: CrmScope, kind: CrmKind, record: Map<String, Any?>): CrmMergeContext {
  suspend fun read(path: String): Map<String, Any?>? = runCatching { reader.get(path)?.data }.getOrNull()
  val hostId = scope.hostId?.ifEmpty { null }
  val contact = when (kind) {
    CrmKind.CONTACT -> record
    CrmKind.DEAL -> (record["contactId"] as? String)?.trim()?.ifEmpty { null }?.let { read("${crmPath(scope.orgId, "contacts")}/$it") }
    else -> null
  }
  val me = read("users/${scope.uid}")
  return CrmMergeContext(
    contact = contact,
    contactGroupId = hostId?.let { consentGroupForHost(scope.org, it).groupId },
    lead = record.takeIf { kind == CrmKind.LEAD },
    deal = record.takeIf { kind == CrmKind.DEAL },
    senderName = me?.get("displayName") as? String,
    senderEmail = me?.get("email") as? String,
    siteName = hostId?.let { read("hosts/$it") }?.get("displayName") as? String,
  )
}
