// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * Where a site's pages are live, as the CONSOLE the app talks to reaches them: the port of the console's
 * `siteLiveUrlForSlug` (libs/aglyn/src/lib/app-utils/site-live-url.ts, AGL-3758). A deployed console links the site's
 * custom domain, else its platform address; a LOCAL console (localhost, a loopback, the Android emulator's 10.0.2.2)
 * links the local tenant, and a preview console (`*.vercel.app`) the tenant preview deployment, both naming the site
 * with `?tenantHost=`. So Visit site and "Open live page" on the local stack open the local site, never production
 * (AGL-4086). function-cases.generated.json replays the console's answers; the Kotlin core's SiteLiveUrl.kt.
 */
public enum SiteLiveURL {
  /// The tenant preview deployment a preview console links (the console's `TENANT_PREVIEW_HOST` default).
  public static let tenantPreviewHost = "aglyn-tenant-git-main-aglyn.vercel.app"
  /// The local tenant a local console links (the console's `TENANT_LOCAL_ORIGIN` default, `nx serve tenant`).
  public static let tenantLocalOrigin = "http://localhost:4500"
  /// The loopbacks and the Android emulator's address for its machine: never a deployment.
  static let localConsoleAddresses: Set<String> = ["127.0.0.1", "::1", "[::1]", "10.0.2.2"]

  /// `localhost`, `*.localhost` and the loopback addresses, which have a local tenant to use.
  public static func isLocalConsole(_ hostname: String) -> Bool {
    hostname == "localhost" || hostname.hasSuffix(".localhost") || localConsoleAddresses.contains(hostname)
  }

  /// A Vercel preview console, or a local one.
  public static func isPreviewConsole(_ hostname: String) -> Bool {
    hostname.hasSuffix(".vercel.app") || isLocalConsole(hostname)
  }

  /// The hostname of a console origin (`http://localhost:4610` → `localhost`), as the console's
  /// `window.location.hostname` reads its own.
  public static func consoleHostname(_ origin: String?) -> String? {
    guard let origin, let host = URLComponents(string: origin)?.host, !host.isEmpty else { return nil }
    return host.lowercased()
  }

  /// The live URL for a site-relative `slug` ("/" is the home), or nil when the site has no address to link.
  /// `consoleHostname` is the console's own; nil reads as a deployed console.
  public static func forSlug(
    subdomain: String?, cname: String?, slug: String, consoleHostname: String?,
    apex: String = HostStatus.defaultTenantApex
  ) -> String? {
    // Published slugs carry a leading slash; the origin ends without one.
    let path = slug == "/" ? "" : String(slug.drop(while: { $0 == "/" }))
    let subdomain = subdomain.flatMap { $0.isEmpty ? nil : $0 }
    if let consoleHostname, isPreviewConsole(consoleHostname) {
      guard let subdomain else { return nil }
      let origin = isLocalConsole(consoleHostname) ? tenantLocalOrigin : "https://\(tenantPreviewHost)"
      return "\(origin)/\(path)?tenantHost=\(encodeURIComponent(subdomain))"
    }
    guard let domain = cname.flatMap({ $0.isEmpty ? nil : $0 }) ?? subdomain.map({ "\($0).\(apex)" }) else { return nil }
    return "https://\(domain)/\(path)"
  }

  /// Visit site's address: the site's home as the console at `consoleOrigin` reaches it.
  public static func home(subdomain: String?, cname: String?, consoleOrigin: String?) -> URL? {
    forSlug(subdomain: subdomain, cname: cname, slug: "/", consoleHostname: consoleHostname(consoleOrigin))
      .flatMap(URL.init(string:))
  }

  /// JavaScript's `encodeURIComponent`: everything but `A–Z a–z 0–9 - _ . ! ~ * ' ( )` is percent-encoded.
  static func encodeURIComponent(_ text: String) -> String {
    var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    allowed.insert(charactersIn: "-_.!~*'()")
    return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
  }
}
