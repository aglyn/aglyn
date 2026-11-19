// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * CLICK-TO-CALL (the Kotlin `CrmCall.kt`; the console's `crm-call-actions.tsx`):
 * a record's stored number, dialled in one tap, and the call logged in one
 * more. `crmTelHref` decides what is callable, so every surface agrees; a
 * value it refuses stays plain text rather than a link that rings nothing.
 */

/// `crmTelHref`: a `tel:` link for a number a dialler can take (spaces, brackets, dots and dashes dropped, an optional
/// leading +, 3 to 20 digits), else nil.
func crmTelHref(_ phone: String?) -> String? {
  let text = (phone ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  guard !text.isEmpty else { return nil }
  let compact = text.filter { !$0.isWhitespace && !"().-".contains($0) }
  let digits = compact.hasPrefix("+") ? compact.dropFirst() : Substring(compact)
  guard (3...20).contains(digits.count), digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
  return "tel:\(compact)"
}

/// `CRM_DO_NOT_CALL_HINT`: the sentence every do-not-call hint carries, so a list and a page say one thing.
let crmDoNotCallHint = "Marked do not call — they asked not to be phoned."

/// The number a record's **Call** dials: a person's main number, or the mobile when that is all there is; a company's
/// phone (`CrmCallButton`'s `phone`).
func crmCallNumber(_ kind: CrmKind, _ data: [String: Any]) -> String? {
  func s(_ key: String) -> String? {
    (data[key] as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0.trimmingCharacters(in: .whitespacesAndNewlines) }
  }
  switch kind {
  case .contact, .lead: return s("phone") ?? s("mobilePhone")
  case .company: return s("phone")
  case .deal: return nil
  }
}

/// What **Call** says about the number before anyone taps it (the console's tooltip): no number, one a dialler cannot
/// take, or the do-not-call flag; nil when it dials plainly.
func crmCallReason(_ phone: String?, doNotCall: Bool) -> String? {
  let text = (phone ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return "This record has no phone number" }
  if crmTelHref(text) == nil { return "“\(text)” is not a number a dialer can take" }
  return doNotCall ? crmDoNotCallHint : nil
}

/// The **Call** button's words: a do-not-call person's reads as a warning.
func crmCallLabel(doNotCall: Bool) -> String { doNotCall ? "Call (do not call)" : "Call" }
