// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// After a write that changes every page of a site (an overlay, an A/B test), what the console's
/// `writeSiteWideChange` does next: stage a `publishOutbox` entry so the drain re-renders the site if
/// this run cannot, ask `/api/screens/revalidate` to re-render it now, and retire the entry when that
/// worked. Like the console, a refused entry is not an error: the revalidate still runs. The Kotlin
/// kit's `publishSiteWideChange`.
public func publishSiteWideChange(api: ConsoleAPIClient, reader: FirestoreReader, hostID: String) async {
  let path = ["publishOutbox", newResourceID()]
  let fields: [String: Any] = [
    "hostId": hostID, "paths": ["/"], "createdAt": FirestoreSentinel.serverTimestamp, "attempts": 0, "entireHost": true,
  ]
  var staged = false
  do {
    try await reader.setDocument(path, fields, merge: false)
    staged = true
  } catch {}
  let answer = try? await api.request("/api/screens/revalidate", method: .post, body: jsonBody(["hostId": hostID, "entireHost": true]))
  if staged, answer?["reason"]?.stringValue == "ok" { try? await reader.deleteDocument(path) }
}
