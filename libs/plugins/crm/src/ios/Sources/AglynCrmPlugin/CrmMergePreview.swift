// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * SEND EMAIL'S PREVIEW (the Kotlin `CrmMergePreview.kt`; the console's
 * `resolveCrmMergeFields` in `crm-email-templates.ts` and the preview in
 * `crm-send-email-dialog.tsx`): a draft that names a merge field is shown
 * as it will be sent, filled from the record's documents, and the fields
 * with nothing to fill are named under the message.
 */

/// What the resolver reads from (`CrmMergeContext`): the documents as stored.
struct CrmMergeContext {
  var contact: [String: Any]?
  /// The holder whose facet names the contact: the sending site's consent group; nil reads the canonical name.
  var contactGroupID: String?
  var lead: [String: Any]?
  var deal: [String: Any]?
  var senderName: String?
  var senderEmail: String?
  var siteName: String?
}

struct CrmMergeResult: Equatable {
  let text: String
  let unresolved: [String]
}

/// `{{ group.field }}` with an optional `|fallback` (the console's `MERGE_FIELD_PATTERN`).
private let crmMergeFieldPattern = try! NSRegularExpression(
  pattern: #"\{\{\s*([A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)\s*(?:\|([^}]*))?\}\}"#)

/// `hasCrmMergeFields`: whether a draft names a field, so the preview has anything to show.
func crmHasMergeFields(_ text: String) -> Bool {
  crmMergeFieldPattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
}

private func crmTrimmed(_ value: Any?) -> String { (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

/// `splitPersonName`: a name's first word and the rest.
func crmSplitPersonName(_ name: Any?) -> (first: String, last: String) {
  let words = ((name as? String) ?? "").split(whereSeparator: { $0.isWhitespace }).map(String.init)
  return (words.first ?? "", words.dropFirst().joined(separator: " "))
}

/// `normalizeContactEmail`: lower-cased when it is an address, else nil.
func crmNormalizeEmail(_ input: Any?) -> String? {
  let email = ((input as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  guard email.count <= 320, email.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil else { return nil }
  return email
}

/// `formatCrmMergeAmount`: a deal's cents in a fixed en-US currency format, as the server prints it; "" when not a number.
func crmFormatMergeAmount(_ cents: Any?, currency: Any?) -> String {
  guard let number = cents as? NSNumber, !(cents is Bool), number.doubleValue.isFinite else { return "" }
  let code = ((currency as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "usd").uppercased()
  let amount = number.doubleValue / 100
  let formatter = NumberFormatter()
  formatter.locale = Locale(identifier: "en_US")
  formatter.numberStyle = .currency
  formatter.currencyCode = code
  return formatter.string(from: NSNumber(value: amount)) ?? String(format: "%.2f %@", amount, code)
}

private func crmMergeField(_ key: String, _ context: CrmMergeContext) -> String {
  let parts = key.split(separator: ".", maxSplits: 1).map(String.init)
  guard parts.count == 2 else { return "" }
  let (group, field) = (parts[0], parts[1])
  switch group {
  case "contact":
    guard let contact = context.contact else { return "" }
    let groupID = crmTrimmed(context.contactGroupID)
    let facet = (contact["facets"] as? [String: Any])?[groupID] as? [String: Any] ?? [:]
    let facetName = facet["name"] as? String ?? ""
    let name = groupID.isEmpty ? crmTrimmed(contact["name"]) : (facetName.isEmpty ? (contact["name"] as? String ?? "") : facetName)
    let split =
      !crmTrimmed(facet["firstName"]).isEmpty || !crmTrimmed(facet["lastName"]).isEmpty
      ? (first: crmTrimmed(facet["firstName"]), last: crmTrimmed(facet["lastName"])) : crmSplitPersonName(name)
    switch field {
    case "firstName": return split.first
    case "lastName": return split.last
    case "name": return name
    case "email": return crmNormalizeEmail(contact["email"]) ?? ""
    case "company": return crmTrimmed(facet["companyName"])
    case "title": return crmTrimmed(facet["jobTitle"])
    default: return ""
    }
  case "lead":
    guard let lead = context.lead else { return "" }
    let split =
      !crmTrimmed(lead["firstName"]).isEmpty || !crmTrimmed(lead["lastName"]).isEmpty
      ? (first: crmTrimmed(lead["firstName"]), last: crmTrimmed(lead["lastName"])) : crmSplitPersonName(lead["name"])
    switch field {
    case "firstName": return split.first
    case "lastName": return split.last
    case "name": return crmTrimmed(lead["name"])
    case "email": return crmNormalizeEmail(lead["email"]) ?? ""
    case "company": return crmTrimmed(lead["company"])
    case "title": return crmTrimmed(lead["jobTitle"])
    default: return ""
    }
  case "deal":
    guard let deal = context.deal else { return "" }
    switch field {
    case "name": return crmTrimmed(deal["title"])
    case "amount": return crmFormatMergeAmount(deal["amountCents"], currency: deal["currency"])
    default: return ""
    }
  case "sender":
    switch field {
    case "firstName": return crmSplitPersonName(context.senderName).first
    case "name": return crmTrimmed(context.senderName)
    case "email": return crmNormalizeEmail(context.senderEmail) ?? ""
    default: return ""
    }
  case "site": return field == "name" ? crmTrimmed(context.siteName) : ""
  default: return ""
  }
}

/// `resolveCrmMergeFields`: every field replaced (its value, its fallback, or nothing) and the ones with nothing to say.
func crmResolveMergeFields(_ text: String, _ context: CrmMergeContext?) -> CrmMergeResult {
  let context = context ?? CrmMergeContext()
  let source = text as NSString
  var out = ""
  var unresolved: [String] = []
  var at = 0
  for match in crmMergeFieldPattern.matches(in: text, range: NSRange(location: 0, length: source.length)) {
    out += source.substring(with: NSRange(location: at, length: match.range.location - at))
    let key = source.substring(with: match.range(at: 1))
    let fallback =
      match.range(at: 2).location == NSNotFound ? "" : source.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
    let resolved = crmMergeField(key, context)
    let value = resolved.isEmpty ? fallback : resolved
    if value.isEmpty, !unresolved.contains(key) { unresolved.append(key) }
    out += value
    at = match.range.location + match.range.length
  }
  out += source.substring(from: at)
  return CrmMergeResult(text: out, unresolved: unresolved)
}

/// `crmMergeUnresolvedMessage`: what the dialog says under a draft whose fields have nothing to fill.
func crmMergeUnresolvedMessage(_ unresolved: [String]) -> String {
  guard !unresolved.isEmpty else { return "" }
  let noun = unresolved.count == 1 ? "1 field has no value" : "\(unresolved.count) fields have no value"
  return "\(noun): \(unresolved.map(crmMergeFieldToken).joined(separator: ", "))"
}

/// A merge context from plain JSON (the function cases' shape).
func crmMergeContext(_ raw: [String: Any]?) -> CrmMergeContext? {
  guard let raw else { return nil }
  let sender = raw["sender"] as? [String: Any]
  let site = raw["site"] as? [String: Any]
  return CrmMergeContext(
    contact: raw["contact"] as? [String: Any], contactGroupID: raw["contactGroupId"] as? String, lead: raw["lead"] as? [String: Any],
    deal: raw["deal"] as? [String: Any], senderName: sender?["name"] as? String, senderEmail: sender?["email"] as? String,
    siteName: site?["name"] as? String)
}

/// The documents the preview reads (the dialog's `MergeRecords`), fetched once the draft names a field: the contact (a
/// deal's own contact when the record is a deal), the deal, the lead, the sending site's name and the sender. A read
/// that fails leaves its part empty, so the field is named as having no value rather than guessed.
@MainActor
func crmMergeContext(
  _ reader: FirestoreReader, scope: CrmScope, kind: CrmKind, record: [String: Any], siteName: String?
) async -> CrmMergeContext {
  var context = CrmMergeContext()
  switch kind {
  case .contact: context.contact = record
  case .lead: context.lead = record
  case .deal:
    context.deal = record
    if let contactID = (record["contactId"] as? String)?.trimmingCharacters(in: .whitespaces), !contactID.isEmpty {
      context.contact = try? await reader.readOnce(crmPath(scope.orgID, "contacts") + [contactID])?.data
    }
  case .company: break
  }
  context.contactGroupID = scope.hostID.isEmpty ? nil : consentGroupForHost(scope.org, scope.hostID).groupID
  context.siteName = siteName
  let me = try? await reader.readOnce(["users", scope.uid])?.data
  context.senderName = me?["displayName"] as? String
  context.senderEmail = me?["email"] as? String
  return context
}
