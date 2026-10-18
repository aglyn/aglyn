// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/// Where a picture the console stored is shown from in the app: a product photo, a site's favicon, a workspace or
/// store logo, a photo field. The console keeps three generations in those fields (a `media:` reference, a path on
/// its media CDN, an https address) and renders them relative to its own origin (`resolveMediaSrc`). Here a
/// reference becomes the CDN path, qualified for the site being shown; a path is read from `origin`, the console
/// the app talks to; a CDN path gets a `width` the CDN serves a delivery copy at. Nil for nothing, or for anything
/// that is not then an http(s) address, so a stored value can never point an image view anywhere else.
public func mediaPreviewURL(_ value: String?, origin: String, hostID: String?, width: Int = 320) -> URL? {
  let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  guard let resolved = resolveMediaSrc(trimmed.isEmpty ? nil : trimmed, hostID: hostID) else { return nil }
  var base = origin
  while base.hasSuffix("/") { base.removeLast() }
  let address: String
  if resolved.hasPrefix("\(mediaCDNRoute)/") && !resolved.contains("?") {
    address = "\(base)\(resolved)?w=\(width)"
  } else if resolved.hasPrefix("/") && !resolved.hasPrefix("//") {
    address = base + resolved
  } else {
    address = resolved
  }
  guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
    url.host?.isEmpty == false
  else { return nil }
  return url
}
