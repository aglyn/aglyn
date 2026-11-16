// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A site's BUSINESS DETAILS as Setup → Business profile saves them (business-details.ts, AGL-4136): the name, slogan,
 * phone, email and postal address live on `seo.entity.*`, the social links on `business.socialLinks`, and the save keeps
 * two older copies in step for the readers that still use them: the email in `business.supportEmail` and the address,
 * formatted, in `business.address`. Documents are plain maps, as Firestore hands them out. BusinessDetailsTests replays
 * the TypeScript's own answers. The Kotlin contracts' BusinessDetails.kt.
 */

private func trimmed(_ value: Any?) -> String { (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

private func asMap(_ value: Any?) -> [String: Any]? { value as? [String: Any] }

/// The email address a visitor writes to the business at (`siteContactEmail`): `seo.entity.email`, else the one-block
/// copy `business.supportEmail`, trimmed. Nil when the site has neither.
public func siteContactEmail(_ host: [String: Any]?) -> String? {
  func text(_ value: Any?) -> String { String(decoding: Array(trimmed(value).utf16.prefix(320)), as: UTF16.self) }
  let email = text(asMap(asMap(host?["seo"])?["entity"])?["email"])
  let copy = text(asMap(host?["business"])?["supportEmail"])
  return !email.isEmpty ? email : (!copy.isEmpty ? copy : nil)
}

/// The host document as the Business details card is seeded with it (`businessDetailsSeed`): the site's one email in the
/// Email field, so a site whose email so far lived only in the one-block copy shows it there. Everything else as stored.
public func businessDetailsSeed(_ host: [String: Any]?) -> [String: Any]? {
  guard let host else { return nil }
  let seo = asMap(host["seo"])
  guard let email = siteContactEmail(host), trimmed(asMap(seo?["entity"])?["email"]).isEmpty else { return host }
  var entity = asMap(seo?["entity"]) ?? [:]
  entity["email"] = email
  var nextSeo = seo ?? [:]
  nextSeo["entity"] = entity
  var next = host
  next["seo"] = nextSeo
  return next
}

/// What a Setup → Business profile save writes (`businessDetailsWrite`), from what the card submitted (nested, as the
/// form's values) and what the document stores now: every text trimmed; the email mirrored into `business.supportEmail`
/// (`""` when it was cleared and a copy is stored); the structured address mirrored, as one line, into `business.address`,
/// but only when the structured address changed; social links without an address dropped, each trimmed, up to the most
/// the editor allows.
public func businessDetailsWrite(_ fields: [String: Any], stored: [String: Any]?) -> [String: Any] {
  var seo = asMap(fields["seo"]) ?? [:]
  var entity = asMap(seo["entity"]) ?? [:]
  for key in ["name", "slogan", "telephone", "email"] where entity[key] is String { entity[key] = trimmed(entity[key]) }
  if var address = asMap(entity["address"]) {
    for (key, value) in address where value is String { address[key] = trimmed(value) }
    entity["address"] = address
  }
  seo["entity"] = entity

  var business = asMap(fields["business"]) ?? [:]
  let storedBusiness = asMap(stored?["business"])
  let email = trimmed(entity["email"])
  if !email.isEmpty {
    business["supportEmail"] = email
  } else if !trimmed(storedBusiness?["supportEmail"]).isEmpty {
    business["supportEmail"] = ""
  } else {
    business["supportEmail"] = nil
  }

  let before = structuredAddressLine(asMap(asMap(asMap(stored?["seo"])?["entity"])?["address"]))
  let after = structuredAddressLine(asMap(entity["address"]))
  if after != before {
    if !after.isEmpty {
      business["address"] = after
    } else if !trimmed(storedBusiness?["address"]).isEmpty {
      business["address"] = ""
    } else {
      business["address"] = nil
    }
  }

  if let links = business["socialLinks"] as? [Any] {
    business["socialLinks"] = links.compactMap { $0 as? [String: Any] }.filter { !trimmed($0["url"]).isEmpty }
      .prefix(ContractValues.shared.businessSocialLinksMax)
      .map { ["label": trimmed($0["label"]), "url": trimmed($0["url"])] as [String: Any] }
  }

  var out = fields
  out["seo"] = seo
  out["business"] = business
  return out
}
