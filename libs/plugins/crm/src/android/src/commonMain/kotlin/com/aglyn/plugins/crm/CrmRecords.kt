package com.aglyn.plugins.crm

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryDeclaration
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.isoDayMillis
import com.aglyn.ui.isoDayOf
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

/*
 * THE CRM'S RECORDS, AS THE CONSOLE'S HUB LISTS, SHOWS AND EDITS THEM.
 *
 * Each object is one collection under `orgs/{orgId}`, listed by the
 * console's own declaration (CONTACT_/LEAD_/COMPANY_/DEAL_/TASK_LIST_…)
 * through the shared planner, with the reader's `visibleTo` scope as the
 * plan's base. A record's fields are described once (a [FieldSpec] and how
 * it is stored), and that one description draws the detail pane and the
 * edit sheet and turns the sheet into the write.
 */

enum class CrmKind(
  val collection: String,
  val singular: String,
  val plural: String,
  val icon: String,
  val listScreen: String,
  val detailScreen: String,
  /** The route parameter that names one record. */
  val param: String,
  /** The field an activity or a task names this record by. */
  val linkField: String,
  /** The custom-field object the Fields section keeps for it. */
  val fieldObject: String?,
) {
  CONTACT("contacts", "Contact", "Contacts", "person", "crm.contacts", "crm.contact", "contact", "contactId", "contact"),
  LEAD("leads", "Lead", "Leads", "person_add", "crm.leads", "crm.lead", "lead", "leadId", "lead"),
  COMPANY("companies", "Company", "Companies", "business", "crm.companies", "crm.company", "company", "companyId", "company"),
  DEAL("deals", "Deal", "Deals", "handshake", "crm.deals", "crm.deal", "deal", "dealId", "deal"),
  ;

  val declaration: ListQueryDeclaration
    get() = when (this) {
      CONTACT -> Contracts.contactListDeclaration
      LEAD -> Contracts.leadListDeclaration
      COMPANY -> Contracts.companyListDeclaration
      DEAL -> Contracts.dealListDeclaration
    }
}

fun crmPath(orgId: String, collection: String) = "orgs/$orgId/$collection"

/** The plan's scope clause: `visibleTo array-contains-any` the reader's tokens. */
fun scopeBase(scope: CrmScope): List<ListQueryFilter> =
  listOf(ListQueryFilter(ListQueryOp.ARRAY_CONTAINS_ANY, "visibleTo", JsonArray(scope.readTokens.map(::JsonPrimitive))))

/** A chip over a list: the clauses it adds to the one query. */
data class CrmFilter(val key: String, val label: String, val clauses: List<ListFilterRequest> = emptyList(), val base: List<ListQueryFilter> = emptyList())

/** The chips each list offers, as the console's views and its Show menu ask them. */
fun crmFilters(kind: CrmKind, scope: CrmScope): List<CrmFilter> {
  val mine = ListFilterRequest("ownerUid", "equals", scope.uid)
  return when (kind) {
    CrmKind.LEAD -> listOf(
      CrmFilter("open", "Open", listOf(ListFilterRequest("status", "isAnyOf", Contracts.nativeCrmLeadOpenStatuses.joinToString(",")))),
      CrmFilter("all", "All"),
    ) + Contracts.nativeCrmLeadStatuses.map { status ->
      CrmFilter(status, Contracts.crmLeadStatusLabels[status] ?: status, listOf(ListFilterRequest("status", "equals", status)))
    } + CrmFilter("mine", "Mine", listOf(mine))
    CrmKind.CONTACT -> listOf(
      CrmFilter("all", "All"),
      CrmFilter("mine", "Mine", listOf(ListFilterRequest("facetKeys", "contains", "${scope.groupId}:owner=${facetKeyValue(scope.uid)}"))),
    ) + Contracts.contactLifecycleStageLabels.map { (stage, label) ->
      CrmFilter(stage, label, listOf(ListFilterRequest("facetKeys", "contains", "${scope.groupId}:stage=${facetKeyValue(stage)}")))
    }
    CrmKind.COMPANY -> listOf(
      CrmFilter("all", "All"),
      CrmFilter("mine", "Mine", listOf(mine)),
      CrmFilter("no-next", "No next activity", listOf(ListFilterRequest("nextTaskAtMs", "isEmpty", ""))),
    )
    CrmKind.DEAL -> listOf(
      CrmFilter("open", "Open", listOf(ListFilterRequest("status", "equals", "open"))),
      CrmFilter("won", "Won", listOf(ListFilterRequest("status", "equals", "won"))),
      CrmFilter("lost", "Lost", listOf(ListFilterRequest("status", "equals", "lost"))),
      CrmFilter("all", "All"),
    )
  }
}

/** `crmFacetKeyValue`: a value as the facet keys store it (the search key, cut to 120). */
fun facetKeyValue(value: String): String = value.trim().replace(Regex("\\s+"), " ").lowercase().take(120)

/**
 * The list's plan, as `useCrmListQuery` builds it: the scope clause as the
 * base, a reader whose reach is some sites searching without the scoped
 * tokens (`crmListDeclarationFor`), and for an org-wide reader a contact's
 * facet clause standing in for the scope (the one array clause a query has),
 * kept only when the plan serves it.
 */
fun crmListPlan(kind: CrmKind, scope: CrmScope, filter: CrmFilter, search: String, pipelineId: String? = null): com.aglyn.contracts.ListQueryPlan {
  val declaration = kind.declaration.let { declaration ->
    if (scope.orgWide || declaration.search?.scoped == null) declaration
    else declaration.copy(search = declaration.search?.copy(scoped = null))
  }
  val extra = filter.base +
    (if (kind == CrmKind.DEAL && pipelineId != null) listOf(ListQueryFilter(ListQueryOp.EQUAL, "pipelineId", JsonPrimitive(pipelineId))) else emptyList())
  val words = search.trim().ifEmpty { null }?.let { listOf(it) }
  val scoped = ListQueryRequest(base = scopeBase(scope) + extra, clauses = filter.clauses, search = words)
  val impliesScope = { clause: ListFilterRequest -> kind == CrmKind.CONTACT && clause.field == "facetKeys" && clause.value.startsWith("${scope.groupId}:") }
  if (scope.orgWide && filter.clauses.any(impliesScope)) {
    val trial = planListQuery(declaration, ListQueryRequest(base = extra, clauses = filter.clauses, search = words))
    if (trial.served.any(impliesScope)) return trial
  }
  return planListQuery(declaration, scoped)
}

fun crmListQuery(kind: CrmKind, scope: CrmScope, filter: CrmFilter, search: String, limit: Int, pipelineId: String? = null): FirestoreQuery =
  crmListPlan(kind, scope, filter, search, pipelineId).toFirestoreQuery(crmPath(scope.orgId, kind.collection), limit)

/*---------- fields ----------*/

/** How a field's string value is stored on the record. */
enum class Stored { TEXT, CENTS, MILLIS, DAY, NUMBER, BOOL }

/** One field: what the sheet shows, and where and how the record keeps it. */
data class CrmField(val spec: FieldSpec, val path: String = spec.key, val stored: Stored = Stored.TEXT, val editable: Boolean = true)

private fun text(key: String, label: String, kind: FieldKind = FieldKind.TEXT, required: Boolean = false) =
  CrmField(FieldSpec(key, label, kind, required))

private fun picklist(key: String, label: String, picklistId: String, picklists: Picklists) =
  CrmField(FieldSpec(key, label, FieldKind.SELECT, options = picklists.options(picklistId)))

private fun owner(key: String, label: String, members: List<CrmMember>, path: String = key) =
  CrmField(FieldSpec(key, label, FieldKind.SELECT, options = members.map { FieldOption(it.uid, it.label) }, emptyLabel = "No owner"), path)

/** The standard fields of each object, in the console's property-card order. */
fun standardFields(kind: CrmKind, picklists: Picklists, members: List<CrmMember>, companies: List<FieldOption>, contacts: List<FieldOption>): List<CrmField> = when (kind) {
  CrmKind.LEAD -> listOf(
    text("name", "Name"),
    CrmField(FieldSpec("email", "Email", FieldKind.EMAIL, required = true), editable = false),
    picklist("salutation", "Salutation", "salutation", picklists),
    text("firstName", "First name"),
    text("lastName", "Last name"),
    text("company", "Company"),
    text("jobTitle", "Title"),
    text("phone", "Phone", FieldKind.PHONE),
    text("mobilePhone", "Mobile", FieldKind.PHONE),
    text("fax", "Fax", FieldKind.PHONE),
    text("website", "Website", FieldKind.URL),
    picklist("leadSource", "Lead source", "leadSource", picklists),
    picklist("industry", "Industry", "industry", picklists),
    picklist("rating", "Rating", "rating", picklists),
    CrmField(FieldSpec("annualRevenue", "Annual revenue", FieldKind.MONEY), "annualRevenueCents", Stored.CENTS),
    CrmField(FieldSpec("numberOfEmployees", "Employees", FieldKind.NUMBER), stored = Stored.NUMBER),
    owner("ownerUid", "Owner", members),
    CrmField(FieldSpec("doNotCall", "Do not call", FieldKind.TOGGLE), stored = Stored.BOOL),
    text("notes", "Notes", FieldKind.MULTILINE),
  )
  CrmKind.CONTACT -> listOf(
    text("name", "Name"),
    CrmField(FieldSpec("email", "Email", FieldKind.EMAIL, required = true), editable = false),
    picklist("salutation", "Salutation", "salutation", picklists),
    text("firstName", "First name"),
    text("lastName", "Last name"),
    text("jobTitle", "Title"),
    text("department", "Department"),
    CrmField(FieldSpec("companyId", "Company", FieldKind.SELECT, options = companies, emptyLabel = "No company")),
    text("phone", "Phone", FieldKind.PHONE),
    text("mobilePhone", "Mobile", FieldKind.PHONE),
    text("homePhone", "Home phone", FieldKind.PHONE),
    text("otherPhone", "Other phone", FieldKind.PHONE),
    text("fax", "Fax", FieldKind.PHONE),
    CrmField(FieldSpec("birthdate", "Birthdate", FieldKind.DATE), stored = Stored.DAY),
    text("assistantName", "Assistant"),
    text("assistantPhone", "Assistant phone", FieldKind.PHONE),
    picklist("leadSource", "Lead source", "leadSource", picklists),
    owner("ownerUid", "Owner", members),
    CrmField(FieldSpec("doNotCall", "Do not call", FieldKind.TOGGLE), stored = Stored.BOOL),
    text("notes", "Notes", FieldKind.MULTILINE),
  )
  CrmKind.COMPANY -> listOf(
    text("name", "Name", required = true),
    text("domain", "Domain"),
    text("website", "Website", FieldKind.URL),
    text("phone", "Phone", FieldKind.PHONE),
    picklist("type", "Type", "accountType", picklists),
    picklist("industry", "Industry", "industry", picklists),
    picklist("rating", "Rating", "rating", picklists),
    picklist("ownership", "Ownership", "ownership", picklists),
    picklist("accountSource", "Account source", "leadSource", picklists),
    CrmField(FieldSpec("annualRevenue", "Annual revenue", FieldKind.MONEY), "annualRevenueCents", Stored.CENTS),
    CrmField(FieldSpec("numberOfEmployees", "Employees", FieldKind.NUMBER), stored = Stored.NUMBER),
    text("accountNumber", "Account number"),
    text("site", "Account site"),
    text("tickerSymbol", "Ticker symbol"),
    text("sicCode", "SIC code"),
    text("fax", "Fax", FieldKind.PHONE),
    CrmField(FieldSpec("parentCompanyId", "Parent company", FieldKind.SELECT, options = companies, emptyLabel = "None")),
    owner("ownerUid", "Owner", members),
    text("notes", "Notes", FieldKind.MULTILINE),
  )
  CrmKind.DEAL -> listOf(
    text("title", "Name", required = true),
    CrmField(FieldSpec("amount", "Amount", FieldKind.MONEY), "amountCents", Stored.CENTS),
    CrmField(FieldSpec("expectedClose", "Close date", FieldKind.DATE), "expectedCloseAtMs", Stored.MILLIS),
    CrmField(FieldSpec("contactId", "Primary contact", FieldKind.SELECT, options = contacts, emptyLabel = "No contact")),
    CrmField(FieldSpec("companyId", "Company", FieldKind.SELECT, options = companies, emptyLabel = "No company")),
    picklist("type", "Type", "opportunityType", picklists),
    picklist("leadSource", "Lead source", "leadSource", picklists),
    text("nextStep", "Next step"),
    CrmField(FieldSpec("probability", "Probability (%)", FieldKind.NUMBER), stored = Stored.NUMBER),
    owner("ownerUid", "Owner", members),
    text("notes", "Notes", FieldKind.MULTILINE),
  )
}

/** A custom field the org defined (`contactFields`), as a field of its object. */
data class CustomFieldDefinition(
  val id: String,
  val key: String,
  val label: String,
  val type: String,
  val options: List<String>,
  val required: Boolean,
  val order: Long,
  val retired: Boolean,
  val obj: String,
)

fun customFieldOf(doc: FirestoreDoc) = CustomFieldDefinition(
  id = doc.id,
  key = doc.string("key") ?: doc.id,
  label = doc.string("label") ?: doc.string("key") ?: doc.id,
  type = doc.string("type") ?: "text",
  options = (doc.data["options"] as? List<*>).orEmpty().mapNotNull { (it as? String) ?: ((it as? Map<*, *>)?.get("label") as? String) },
  required = doc.bool("required") == true,
  order = doc.long("order") ?: 0L,
  retired = doc.data["retiredAt"] != null,
  obj = doc.string("object") ?: "contact",
)

fun customFields(kind: CrmKind, definitions: List<CustomFieldDefinition>): List<CrmField> =
  definitions.filter { !it.retired && it.obj == kind.fieldObject }.sortedBy { it.order }.map { def ->
    val spec = FieldSpec(
      "custom.${def.key}",
      def.label,
      when (def.type) {
        "number" -> FieldKind.NUMBER
        "date" -> FieldKind.DATE
        "select" -> FieldKind.SELECT
        "checkbox" -> FieldKind.TOGGLE
        "url" -> FieldKind.URL
        else -> FieldKind.TEXT
      },
      required = def.required,
      options = def.options.map { FieldOption(it, it) },
    )
    CrmField(
      spec,
      "custom.${def.key}",
      when (def.type) {
        "number" -> Stored.NUMBER
        "date" -> Stored.DAY
        "checkbox" -> Stored.BOOL
        else -> Stored.TEXT
      },
    )
  }

/** A stored value as the sheet holds it. */
fun displayValue(field: CrmField, raw: Any?): String = when (field.stored) {
  Stored.CENTS -> (raw as? Number)?.let { cents ->
    val value = cents.toDouble() / 100
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
  }.orEmpty()
  Stored.MILLIS -> millisOf(raw)?.let(::isoDayOf).orEmpty()
  Stored.DAY -> (raw as? String).orEmpty()
  Stored.NUMBER -> (raw as? Number)?.let { if (it.toDouble() % 1.0 == 0.0) it.toLong().toString() else it.toString() }.orEmpty()
  Stored.BOOL -> if (raw == true) "true" else if (raw == false) "false" else ""
  Stored.TEXT -> when (raw) {
    null -> ""
    is String -> raw
    is List<*> -> raw.joinToString(", ")
    else -> raw.toString()
  }
}

fun millisOf(raw: Any?): Long? = when (raw) {
  is FirestoreTimestamp -> raw.epochMillis
  is Number -> raw.toLong()
  else -> null
}

/** A value read off a record by its dotted path (`custom.size`). */
fun valueAt(data: Map<String, Any?>, path: String): Any? {
  var at: Any? = data
  for (part in path.split('.')) at = (at as? Map<*, *>)?.get(part) ?: return null
  return at
}

/** The sheet's values for a record. */
fun formValues(fields: List<CrmField>, data: Map<String, Any?>): Map<String, String> =
  fields.associate { it.spec.key to displayValue(it, valueAt(data, it.path)) }

/** One sheet value as stored: null for blank. */
fun storedValue(field: CrmField, value: String): Any? {
  val text = value.trim()
  if (text.isEmpty()) return null
  return when (field.stored) {
    Stored.TEXT -> text
    Stored.CENTS -> text.removePrefix("$").replace(",", "").toDoubleOrNull()?.let { kotlin.math.round(it * 100).toLong() }
    Stored.MILLIS -> isoDayMillis(text)?.plus(12 * 3_600_000L)
    Stored.DAY -> text
    Stored.NUMBER -> text.toLongOrNull() ?: text.toDoubleOrNull()
    Stored.BOOL -> text == "true"
  }
}

/**
 * The changes an edit writes: every changed field, a blank one deleted (as
 * the console's drawers delete a cleared optional field), each at its stored
 * path, nested so a custom key merges into the stored `custom` map.
 */
fun changedFields(fields: List<CrmField>, before: Map<String, String>, after: Map<String, String>): Map<String, Any?> {
  val out = linkedMapOf<String, Any?>()
  for (field in fields.filter { it.editable }) {
    val old = before[field.spec.key].orEmpty().trim()
    val new = after[field.spec.key].orEmpty().trim()
    if (old == new) continue
    setPath(out, field.path, storedValue(field, new) ?: FirestoreDelete)
  }
  return out
}

/** Every filled-in field, for a create (no deletes). */
fun createdFields(fields: List<CrmField>, values: Map<String, String>): Map<String, Any?> {
  val out = linkedMapOf<String, Any?>()
  for (field in fields.filter { it.editable }) storedValue(field, values[field.spec.key].orEmpty())?.let { setPath(out, field.path, it) }
  return out
}

@Suppress("UNCHECKED_CAST")
private fun setPath(into: MutableMap<String, Any?>, path: String, value: Any?) {
  val parts = path.split('.')
  var at = into
  for (part in parts.dropLast(1)) at = at.getOrPut(part) { linkedMapOf<String, Any?>() } as MutableMap<String, Any?>
  at[parts.last()] = value
}

/*---------- rows ----------*/

data class CrmRow(
  val id: String,
  val kind: CrmKind,
  val title: String,
  val subtitle: String,
  val chip: String?,
  val data: Map<String, Any?>,
)

fun stageLabel(stage: String?) = stage?.let { Contracts.contactLifecycleStageLabels[it] ?: it }

/** A contact's own fields for this viewer: the holder's facet over the shared record. */
@Suppress("UNCHECKED_CAST")
fun contactView(data: Map<String, Any?>, groupId: String): Map<String, Any?> {
  val facet = (data["facets"] as? Map<String, Any?>)?.get(groupId) as? Map<String, Any?> ?: emptyMap()
  return data + facet.filterValues { it != null } + mapOf("name" to ((facet["name"] as? String)?.takeIf { it.isNotBlank() } ?: data["name"]))
}

fun crmRow(kind: CrmKind, doc: FirestoreDoc, scope: CrmScope, stages: Map<String, String> = emptyMap()): CrmRow {
  val data = if (kind == CrmKind.CONTACT) contactView(doc.data, scope.groupId) else doc.data
  fun s(key: String) = (data[key] as? String)?.takeIf { it.isNotBlank() }
  return when (kind) {
    CrmKind.LEAD -> CrmRow(doc.id, kind, s("name") ?: s("email") ?: "Lead", listOfNotNull(s("email")?.takeIf { it != s("name") }, s("company")).joinToString(" · "), s("statusLabel") ?: s("status")?.let { Contracts.crmLeadStatusLabels[it] ?: it }, data)
    CrmKind.CONTACT -> CrmRow(doc.id, kind, s("name") ?: s("email") ?: "Contact", listOfNotNull(s("email")?.takeIf { it != s("name") }, s("companyName"), s("jobTitle")).joinToString(" · "), stageLabel(s("lifecycleStage")), data)
    CrmKind.COMPANY -> CrmRow(doc.id, kind, s("name") ?: "Company", listOfNotNull(s("domain"), s("industry"), (data["contactsCount"] as? Number)?.toLong()?.takeIf { it > 0 }?.let { if (it == 1L) "1 contact" else "$it contacts" }).joinToString(" · "), s("type"), data)
    CrmKind.DEAL -> CrmRow(
      doc.id, kind, s("title") ?: "Deal",
      listOfNotNull((data["amountCents"] as? Number)?.let { formatCents(it.toLong(), s("currency")) }, s("stageId")?.let { stages[it] ?: it }).joinToString(" · "),
      when (s("status")) { "won" -> "Won"; "lost" -> "Lost"; else -> null }, data,
    )
  }
}

/** Whole-dollar amounts read as the console's deal cards read them. */
fun formatCents(cents: Long, currency: String? = "usd"): String {
  val negative = cents < 0
  val abs = kotlin.math.abs(cents)
  val whole = (abs / 100).toString().reversed().chunked(3).joinToString(",").reversed()
  val fraction = abs % 100
  val symbol = if ((currency ?: "usd").lowercase() == "usd") "$" else (currency ?: "").uppercase() + " "
  return (if (negative) "-" else "") + symbol + whole + if (fraction == 0L) "" else "." + fraction.toString().padStart(2, '0')
}

/*---------- picklists ----------*/

/**
 * The org's picklists: each one's stored values (`crmPicklists/{id}`), else
 * the standard values its definition ships (CRM_PICKLIST_DEFINITIONS).
 * A record stores the label, so a choice's value is its label.
 */
class Picklists(private val stored: Map<String, List<Pair<String, Boolean>>>) {
  fun labels(id: String): List<String> =
    stored[id]?.filter { it.second }?.map { it.first } ?: standardLabels(id)

  fun options(id: String): List<FieldOption> = labels(id).map { FieldOption(it, it) }

  companion object {
    fun standardLabels(id: String): List<String> = Contracts.nativeCrmPicklists.firstOrNull { it.id == id }?.standardLabels.orEmpty()

    fun of(docs: List<FirestoreDoc>): Picklists = Picklists(
      docs.associate { doc ->
        doc.id to (doc.data["values"] as? List<*>).orEmpty().mapNotNull { entry ->
          val value = entry as? Map<*, *> ?: return@mapNotNull null
          val label = value["label"] as? String ?: return@mapNotNull null
          label to (value["active"] != false)
        }
      },
    )
  }
}

/*---------- team ----------*/

data class CrmMember(val uid: String, val label: String, val email: String?)
