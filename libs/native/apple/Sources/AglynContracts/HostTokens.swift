// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The site's `host.*` variables (host-tokens.ts, AGL-4136) as the Business details card's "What your pages can use" lists
 * them (`hostTokenPreview`): each variable's token, what it is, and the value it would produce on this site. The
 * resolvers are the TypeScript's, read field by field; HostTokensTests replays its answers. The Kotlin contracts'
 * HostTokens.kt.
 */

/// One `host.*` variable as the preview lists it.
public struct HostTokenPreviewRow: Equatable, Sendable {
  public let key: String
  public let type: String
  public let label: String
  public let description: String
  public let whenEmpty: String
  public let token: String
  public let value: String?
  public var set: Bool { value != nil }
}

private func presentText(_ value: Any?) -> String? {
  guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
  return text
}

private func node(_ value: Any?, _ key: String) -> [String: Any]? { (value as? [String: Any])?[key] as? [String: Any] }

/// A phone number as a `tel:` link (`telephoneHref`): its digits, with a leading `+` kept; nil without digits.
public func telephoneHref(_ phone: Any?) -> String? {
  guard let text = presentText(phone) else { return nil }
  let digits = text.filter(\.isNumber).filter(\.isASCII)
  guard !digits.isEmpty else { return nil }
  return "tel:\(text.hasPrefix("+") ? "+" : "")\(digits)"
}

private let socialNetworkHosts: [String: [String]] = [
  "facebook": ["facebook.com", "fb.com"], "instagram": ["instagram.com"], "x": ["x.com", "twitter.com"],
  "linkedin": ["linkedin.com"], "youtube": ["youtube.com", "youtu.be"], "tiktok": ["tiktok.com"],
]

/// The site's profile on one network (`siteSocialProfileUrl`): the first of its profiles whose host is the network's.
public func siteSocialProfileUrl(_ host: [String: Any]?, network: String) -> String? {
  let names = socialNetworkHosts[network] ?? []
  for value in siteProfileUrls(host) {
    guard let hostname = URL(string: value)?.host?.lowercased(), !hostname.isEmpty else { continue }
    if names.contains(where: { hostname == $0 || hostname.hasSuffix(".\($0)") }) { return value }
  }
  return nil
}

private struct HostToken {
  let key: String
  let type: String
  let label: String
  let description: String
  let whenEmpty: String
  let resolve: ([String: Any]) -> String?
}

private func socialToken(_ network: String, _ key: String, _ name: String) -> HostToken {
  HostToken(
    key: key, type: "url", label: "\(name) link",
    description: "The address of the site’s \(name) profile, from Setup → Business profile.", whenEmpty: "omit-block"
  ) { siteSocialProfileUrl($0, network: network) }
}

private func hostTokens(apex: String) -> [HostToken] {
  func entity(_ host: [String: Any]) -> [String: Any]? { node(host["seo"], "entity") }
  func logo(_ host: [String: Any]) -> String? { presentText(host["logoUrl"]) ?? presentText(entity(host)?["logo"]) }
  func areas(_ host: [String: Any]) -> [String] { normalizeAreaServed(entity(host)?["areaServed"]) }
  return [
    HostToken(
      key: "businessName", type: "text", label: "Business name",
      description: "The business name from Setup → Business profile, or the site’s name when none is set.", whenEmpty: "blank"
    ) { presentText(entity($0)?["name"]) ?? presentText($0["displayName"]) },
    HostToken(
      key: "slogan", type: "text", label: "Slogan", description: "A short line about the business, from Setup → Business profile.",
      whenEmpty: "blank"
    ) { presentText(entity($0)?["slogan"]) },
    HostToken(key: "logo", type: "image", label: "Logo", description: "The site’s logo image.", whenEmpty: "omit-block") { logo($0) },
    HostToken(
      key: "logoDark", type: "image", label: "Logo for dark backgrounds",
      description: "The logo to show on a dark background. The site’s logo when it has no dark one.", whenEmpty: "omit-block"
    ) { presentText($0["logoDarkUrl"]) ?? logo($0) },
    HostToken(
      key: "url", type: "url", label: "Site address", description: "The site’s public URL — its custom domain when connected.",
      whenEmpty: "blank"
    ) { host in
      if let custom = presentText(host["cname"]) {
        return "https://\(custom.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression))"
      }
      return presentText(host["subdomain"]).map { "https://\($0).\(apex)" }
    },
    HostToken(
      key: "phone", type: "text", label: "Phone", description: "The business’s phone number, as entered on Setup → Business profile.",
      whenEmpty: "omit-block"
    ) { presentText(entity($0)?["telephone"]) },
    HostToken(
      key: "phoneLink", type: "url", label: "Phone link",
      description: "The phone number as a tel: link, for a Call button’s link. Dropped when the site has no phone.",
      whenEmpty: "omit-block"
    ) { telephoneHref(entity($0)?["telephone"]) },
    HostToken(
      key: "supportEmail", type: "email", label: "Email", description: "The email address visitors write to, from Setup → Business profile.",
      whenEmpty: "omit-block"
    ) { siteContactEmail($0) },
    HostToken(
      key: "address", type: "address", label: "Postal address",
      description: "The business’s postal address from Setup → Business profile, as one block of text.", whenEmpty: "omit-block"
    ) { presentText(structuredAddressLine(entity($0)?["address"] as? [String: Any])) ?? presentText(($0["business"] as? [String: Any])?["address"]) },
    HostToken(
      key: "mainArea", type: "text", label: "Main area",
      description: "The first area served, by its place name: San Antonio, for “San Antonio, TX”. From SEO → Local business.",
      whenEmpty: "blank"
    ) { host in areas(host).first.flatMap { presentText($0.split(separator: ",", omittingEmptySubsequences: false).first.map(String.init)) } },
    HostToken(
      key: "areasServed", type: "text", label: "Areas served",
      description: "Every area served, in order, separated by commas. From SEO → Local business.", whenEmpty: "blank"
    ) { presentText(areas($0).joined(separator: ", ")) },
    HostToken(
      key: "socialLinks", type: "text", label: "Social links", description: "The site’s social profiles, as a list of labeled links.",
      whenEmpty: "omit-block"
    ) { host in
      let links = ((host["business"] as? [String: Any])?["socialLinks"] as? [Any]) ?? []
      let labels = links.compactMap { link -> String? in
        let row = link as? [String: Any]
        return presentText(row?["label"]) ?? presentText(row?["url"])
      }
      return labels.isEmpty ? nil : labels.joined(separator: " · ")
    },
    socialToken("facebook", "facebookUrl", "Facebook"), socialToken("instagram", "instagramUrl", "Instagram"),
    socialToken("x", "xUrl", "X"), socialToken("linkedin", "linkedinUrl", "LinkedIn"), socialToken("youtube", "youtubeUrl", "YouTube"),
    socialToken("tiktok", "tiktokUrl", "TikTok"),
  ]
}

/// Every `host.*` variable, in the console's order, with the value it would produce on `host` (`hostTokenPreview`).
public func hostTokenPreview(_ host: [String: Any]?, apex: String = "aglyn.app") -> [HostTokenPreviewRow] {
  hostTokens(apex: apex).map { token in
    HostTokenPreviewRow(
      key: token.key, type: token.type, label: token.label, description: token.description, whenEmpty: token.whenEmpty,
      token: "{{host.\(token.key)}}", value: host.flatMap { token.resolve($0) })
  }
}
