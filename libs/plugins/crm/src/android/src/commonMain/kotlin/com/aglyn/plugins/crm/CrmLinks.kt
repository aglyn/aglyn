package com.aglyn.plugins.crm

import com.aglyn.contracts.Contracts
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.ui.FieldOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull

/*
 * WHO AND WHAT AN ACTIVITY IS ABOUT, AS THE LOG DIALOG ASKS IT (the console's
 * `crm-activity-link.ts`; the Apple plugin's `CrmLinks.swift`). **Name** is the
 * contact the entry was with, **Related To** the deal or company it is about,
 * and the company it rolls up to is stamped from them when it is written
 * (`crmActivityCompanyId`). Each rule is replayed against the console's own
 * answers (function-cases.generated.json).
 */

/** What **Related To** names: one company or one deal (`CrmActivityRelated`); [kind] is `company` or `deal`. */
data class CrmRelated(val kind: String, val id: String) {
  /** The record as a picker's row key, `deal:{id}` or `company:{id}`. */
  val key: String get() = "$kind:$id"

  companion object {
    const val COMPANY = "company"
    const val DEAL = "deal"

    fun ofKey(key: String?): CrmRelated? {
      val parts = key?.split(':', limit = 2) ?: return null
      if (parts.size != 2 || parts[0] !in setOf(COMPANY, DEAL) || parts[1].isEmpty()) return null
      return CrmRelated(parts[0], parts[1])
    }
  }
}

/** The log dialog's two fields as a person leaves them (`CrmActivityPicks`). */
data class CrmActivityPicks(val contactId: String?, val related: CrmRelated?) {
  /** An activity attached to nothing is a sentence nobody can find. */
  val linked: Boolean get() = contactId != null || related != null
}

private fun storedId(value: Any?): String? = (value as? String)?.trim()?.takeIf { it.isNotEmpty() }

/**
 * The fields as they open on a record's links (`crmActivityPicksFrom`): a deal outranks the company stamped beside it, and
 * opened from a deal, **Name** defaults to the deal's Primary.
 */
fun crmActivityPicksFrom(link: Map<String, Any?>, primaryContactId: String? = null): CrmActivityPicks {
  val deal = storedId(link["dealId"])
  val company = storedId(link["companyId"])
  return CrmActivityPicks(
    storedId(link["contactId"]) ?: storedId(primaryContactId),
    deal?.let { CrmRelated(CrmRelated.DEAL, it) } ?: company?.let { CrmRelated(CrmRelated.COMPANY, it) },
  )
}

/** The links the fields name, before the company is stamped (`crmActivityLinkFromPicks`). A lead's own log keeps its lead. */
fun crmActivityLinkFromPicks(picks: CrmActivityPicks, leadId: String? = null): Map<String, String> = buildMap {
  picks.contactId?.takeIf { it.isNotEmpty() }?.let { put("contactId", it) }
  picks.related?.let { put(if (it.kind == CrmRelated.DEAL) "dealId" else "companyId", it.id) }
  leadId?.takeIf { it.isNotEmpty() }?.let { put("leadId", it) }
}

/** One row a record picker offers: its key, the name it shows, and the heading it is listed under ("" for none). */
data class CrmPickOption(val key: String, val label: String, val group: String)

/** Where **Related To** lists its rows (`CRM_RELATED_TO_GROUPS`). */
object CrmRelatedToGroup {
  const val OPEN_DEALS = "Open deals"
  const val COMPANIES = "Companies"
  const val DEALS = "Deals"
}

/** Names in the order the console's menus list them (`localeCompare`): letters before case. */
val crmLabelOrder: Comparator<CrmPickOption> = compareBy(String.CASE_INSENSITIVE_ORDER) { it.label }

/**
 * What **Related To** offers, in its menu's order (`crmRelatedToOptions`): the open deals that name the person or the company,
 * each once, then the companies, then every other deal, each group by name. A row is never blank.
 */
fun crmRelatedToOptions(linkedDeals: List<FirestoreDoc>, deals: List<FirestoreDoc>, companies: List<FirestoreDoc>): List<CrmPickOption> {
  fun text(doc: FirestoreDoc, field: String) = doc.data[field] as? String ?: ""
  val open = linkedMapOf<String, CrmPickOption>()
  for (deal in linkedDeals) {
    if (deal.data["status"] != "open") continue
    open[deal.id] = CrmPickOption(CrmRelated(CrmRelated.DEAL, deal.id).key, text(deal, "title").ifEmpty { "Untitled deal" }, CrmRelatedToGroup.OPEN_DEALS)
  }
  fun named(doc: FirestoreDoc, field: String) = text(doc, field).ifEmpty { doc.id }
  val listed = companies.map { CrmPickOption(CrmRelated(CrmRelated.COMPANY, it.id).key, named(it, "name"), CrmRelatedToGroup.COMPANIES) }
  val others = deals.filter { it.id !in open }.map { CrmPickOption(CrmRelated(CrmRelated.DEAL, it.id).key, named(it, "title"), CrmRelatedToGroup.DEALS) }
  return open.values.sortedWith(crmLabelOrder) + listed.sortedWith(crmLabelOrder) + others.sortedWith(crmLabelOrder)
}

/**
 * What **Name** offers (the console's contact picker): a deal's contact roles first under "On this deal", then every other
 * contact under "All contacts"; with no roles to pin, one list by name.
 */
fun crmNameOptions(pinned: List<CrmPickOption>, contacts: List<FieldOption>): List<CrmPickOption> {
  val held = pinned.map { it.key }.toSet()
  val rest = contacts.filter { it.value !in held }.map { CrmPickOption(it.value, it.label, if (pinned.isEmpty()) "" else "All contacts") }.sortedWith(crmLabelOrder)
  return pinned.map { it.copy(group = "On this deal") } + rest
}

/**
 * The deals that name a person or a company, for **Related To**'s first group (the console's `useLinkedDeals` and
 * `useContactRoleDeals`): a contact's as Primary and in any role, and the company's. A contact's other roles are asked only by
 * a reader the rules let skip the scope clause; any other reader reads the deals that name them as Primary.
 */
suspend fun crmLinkedDeals(reader: FirestoreReader, scope: CrmScope, contactId: String?, companyId: String?): List<FirestoreDoc> {
  val recent = listOf(FirestoreOrder("updatedAt", descending = true))
  val queries = buildList {
    if (contactId != null) {
      add(scopedQuery(scope, "deals", listOf(FirestoreFilter("contactId", FilterOp.EQ, contactId)), recent, 25))
      val tokens = scope.readTokens
      if (tokens == null) {
        add(FirestoreQuery(crmPath(scope.orgId, "deals"), filters = listOf(FirestoreFilter("contactRoleContactIds", FilterOp.ARRAY_CONTAINS, contactId)), orderBy = recent, limit = 25))
      } else if (scope.orgWide && tokens.isNotEmpty()) {
        val scoped = tokens.take(MAX_SCOPE_HOSTS).map { "$it${Contracts.scopedSearchJoin}$contactId" }
        add(FirestoreQuery(crmPath(scope.orgId, "deals"), filters = listOf(FirestoreFilter("scopedContactRoleContactIds", FilterOp.ARRAY_CONTAINS_ANY, scoped)), orderBy = recent, limit = 25))
      }
    }
    if (companyId != null) add(scopedQuery(scope, "deals", listOf(FirestoreFilter("companyId", FilterOp.EQ, companyId)), recent, 25))
  }
  // A list this reader may not run costs the menu its lead rows, never the dialog.
  return queries.flatMap { query ->
    try {
      withTimeoutOrNull(6_000) { reader.page(query).docs }.orEmpty()
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      emptyList()
    }
  }
}

/*---------- the marketing opt-in ----------*/

/** The sentence a capture surface shows beside an opt-in for a declared group (`consentGroupDisclosure`), or null. */
fun consentGroupDisclosure(group: ConsentGroup): String? {
  val name = group.name?.takeIf { group.declared && it.isNotEmpty() } ?: return null
  return "You'll receive marketing email from $name, which covers ${group.hostIds.size} sites."
}

/** A string as `JSON.stringify` writes it: quotes, the backslash and control characters escaped, the rest as is. */
private fun jsonStringLiteral(text: String): String = buildString {
  append('"')
  for (char in text) {
    when {
      char == '"' -> append("\\\"")
      char == '\\' -> append("\\\\")
      char == '\b' -> append("\\b")
      char == '\u000C' -> append("\\f")
      char == '\n' -> append("\\n")
      char == '\r' -> append("\\r")
      char == '\t' -> append("\\t")
      char.code < 0x20 -> append("\\u").append(char.code.toString(16).padStart(4, '0'))
      else -> append(char)
    }
  }
  append('"')
}

/**
 * The fingerprint of the sentence the form showed (`consentGroupDisclosureKey`): FNV-1a over the UTF-16 units of the group's
 * id, name and sorted sites as JSON. The route pools the opt-in across the group only while it still matches.
 */
fun consentGroupDisclosureKey(group: ConsentGroup): String? {
  if (consentGroupDisclosure(group) == null) return null
  val text = "[${jsonStringLiteral(group.groupId)},${jsonStringLiteral(group.name.orEmpty())},[${group.hostIds.sorted().joinToString(",") { jsonStringLiteral(it) }}]]"
  var hash = 0x811c9dc5.toInt()
  for (char in text) {
    hash = hash xor char.code
    hash *= 0x01000193
  }
  return hash.toUInt().toString(16).padStart(8, '0')
}

/**
 * The words under New contact's opt-in box (the console's drawer): why it is off with no address, else the group's sentence,
 * what no source site means, and that adding a contact is never itself consent.
 */
fun contactConsentHelp(hasEmail: Boolean, group: ConsentGroup?): String {
  if (!hasEmail) return "Add an email first: there is nowhere to send marketing without one."
  val disclosure = group?.let(::consentGroupDisclosure)?.let { "$it " }.orEmpty()
  val everySite = if (group == null) "With no source site, this records it on every site. " else ""
  return disclosure + everySite + "Tick it only if they agreed. Adding a contact is never itself consent."
}

/** The values key the create form holds the opt-in under; it is never a field of the record. */
const val CONTACT_CONSENT_KEY = "marketingConsent"

/**
 * What New contact sends for the opt-in (`contacts-create`): the box, only with an address, and the sentence's key beside a
 * ticked box so the route can pool it across the group the sentence named.
 */
fun contactConsentFields(values: Map<String, String>, group: ConsentGroup?): Map<String, Any?> {
  val consent = !values["email"].isNullOrBlank() && values[CONTACT_CONSENT_KEY] == "true"
  return buildMap {
    put("marketingConsent", consent)
    if (consent) group?.let(::consentGroupDisclosureKey)?.let { put("disclosedConsentGroup", it) }
  }
}
