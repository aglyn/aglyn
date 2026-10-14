// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynUI
import SwiftUI

/// The rights confirmation an audio upload needs (AGL-3716), asked once for a batch: every audio file in it is
/// named, and the one sentence the uploader ticks is the sentence the server stores beside who ticked it and
/// when. Upload stays off until it is ticked, and the box starts unticked every time: a confirmation carried
/// over from an earlier batch would answer a question about different files.
struct AudioRightsSheet: View {
  let files: [PickedFile]
  let onAnswer: (Bool) -> Void
  @State private var confirmed = false

  private var names: [String] { files.filter(isAudioFile).map(\.name) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(
            (names.count == 1 ? "You are uploading \"\(names[0])\"." : "You are uploading \(names.count) audio files: \(names.joined(separator: ", ")).")
              + " Only upload music you made, or have a license to publish. Tracks by other artists cannot be played on your site without their permission, and are taken down when the rights holder reports them."
          )
          Toggle(audioRightsStatement, isOn: $confirmed).accessibilityIdentifier("audio-rights-confirm")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Confirm your rights to this audio")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { onAnswer(false) } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Upload") { onAnswer(true) }.disabled(!confirmed).accessibilityIdentifier("audio-rights-upload")
        }
      }
    }
    .frame(minWidth: 380, minHeight: 320)
    .interactiveDismissDisabled()
  }
}
