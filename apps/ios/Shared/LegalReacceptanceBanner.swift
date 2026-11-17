// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// Re-acceptance when the Terms move (the console's `LegalReacceptanceBanner`, AGL-2316): a banner over every screen,
/// answered with I agree, never a wall. The status read fails silent, so a check that could not run never nags someone who
/// has already agreed.
struct LegalReacceptanceBanner: View {
  @Environment(AppModel.self) private var model
  @State private var status: LegalStatus?
  @State private var busy = false
  @State private var accepted = false

  var body: some View {
    Group {
      if !accepted, let status, let copy = LegalReacceptanceCopy.make(status, brand: model.brandName) {
        let origin = model.config?.legalOrigin ?? AglynConfig.defaultLegalOrigin
        HStack(alignment: .top, spacing: AglynSpace.oneAndHalf) {
          Image(systemName: "info.circle").foregroundStyle(AglynColor.info).accessibilityHidden(true)
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(.init("\(copy.lead)[Terms of Service](\(origin)/legal/terms) and [Privacy Policy](\(origin)/legal/privacy)\(copy.tail)"))
              .font(AglynFont.subheadline)
            Text(copy.caption).font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          Button(busy ? "Recording…" : "I agree") { accept() }
            .buttonStyle(.aglynSecondary)
            .controlSize(.small)
            .disabled(busy)
            .accessibilityIdentifier("legal-reaccept")
        }
        .padding(AglynSpace.oneAndHalf)
        .background(AglynColor.info.opacity(0.1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("legal-reacceptance")
      }
    }
    .task(id: model.auth?.user?.uid) {
      status = nil
      accepted = false
      guard model.auth?.user != nil, let api = model.api,
        let body = try? await api.request("/api/auth/legal-acceptance")
      else { return }
      status = LegalStatus(body)
    }
  }

  private func accept() {
    guard let api = model.api else { return }
    busy = true
    Task {
      let ok = (try? await api.request(
        "/api/auth/legal-acceptance", method: .post, body: .object(["context": .string(legalReacceptanceContext)]))) != nil
      if ok { accepted = true }
      busy = false
    }
  }
}
