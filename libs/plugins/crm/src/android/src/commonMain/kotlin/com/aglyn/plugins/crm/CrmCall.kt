package com.aglyn.plugins.crm

/*
 * CLICK-TO-CALL (the Apple `CrmCall.swift`; the console's `crm-call-actions.tsx`): a record's stored number, dialled in one
 * tap, and the call logged in one more. `crmTelHref` decides what is callable, so every surface agrees; a value it refuses
 * stays plain text rather than a link that rings nothing.
 */

private val TEL_DROPPED = Regex("[\\s().-]")
private val TEL_NUMBER = Regex("^\\+?\\d{3,20}$")

/** `crmTelHref`: a `tel:` link for a number a dialler can take (spaces, brackets, dots and dashes dropped, an optional leading +, 3 to 20 digits), else null. */
fun crmTelHref(phone: String?): String? {
  val text = phone?.trim().orEmpty()
  if (text.isEmpty()) return null
  val compact = text.replace(TEL_DROPPED, "")
  return if (TEL_NUMBER.matches(compact)) "tel:$compact" else null
}

/** `CRM_DO_NOT_CALL_HINT`: the sentence every do-not-call hint carries, so a list and a page say one thing. */
const val CRM_DO_NOT_CALL_HINT = "Marked do not call — they asked not to be phoned."

/** The number a record's **Call** dials: a person's main number, or the mobile when that is all there is; a company's phone. */
fun crmCallNumber(kind: CrmKind, data: Map<String, Any?>): String? {
  fun s(key: String) = (data[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }
  return when (kind) {
    CrmKind.CONTACT, CrmKind.LEAD -> s("phone") ?: s("mobilePhone")
    CrmKind.COMPANY -> s("phone")
    CrmKind.DEAL -> null
  }
}

/** What **Call** says about the number before anyone taps it (the console's tooltip); null when it dials plainly. */
fun crmCallReason(phone: String?, doNotCall: Boolean): String? {
  val text = phone?.trim().orEmpty()
  return when {
    text.isEmpty() -> "This record has no phone number"
    crmTelHref(text) == null -> "“$text” is not a number a dialer can take"
    doNotCall -> CRM_DO_NOT_CALL_HINT
    else -> null
  }
}

/** The **Call** button's words: a do-not-call person's reads as a warning. */
fun crmCallLabel(doNotCall: Boolean): String = if (doNotCall) "Call (do not call)" else "Call"
