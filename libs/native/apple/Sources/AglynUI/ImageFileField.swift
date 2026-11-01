// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// What a picture is previewed on: the ground it will be seen on.
public enum AglynImageFileGround: Sendable {
  case light, dark
}

/// The sizes of an image file field (Figma Image file field).
enum AglynImageFileMetrics {
  #if os(macOS)
    static let tile: CGFloat = 44
  #else
    static let tile: CGFloat = 56
  #endif
}

/// Pick one image, see it, and take it away again: a tile on the ground the picture will be seen on, its label, and
/// Choose file (Replace once one is held) with Remove beside it. It hands back the source chosen and nothing else: what a
/// form accepts, what it refuses and where the file goes are the form's, and a form holds one `aglynMediaPicker` for all
/// of its fields, because SwiftUI runs only the last of several file importers. The console's `ImageFileField`; the Kotlin
/// kit's `ImageFileField`.
public struct AglynImageFileField: View {
  let label: String
  let file: PickedFile?
  let ground: AglynImageFileGround?
  let helper: String?
  let error: String?
  let enabled: Bool
  let onChoose: (PickSource) -> Void
  let onRemove: () -> Void

  public init(
    label: String, file: PickedFile?, ground: AglynImageFileGround? = nil, helper: String? = nil, error: String? = nil,
    enabled: Bool = true, onChoose: @escaping (PickSource) -> Void, onRemove: @escaping () -> Void
  ) {
    self.label = label
    self.file = file
    self.ground = ground
    self.helper = helper
    self.error = error
    self.enabled = enabled
    self.onChoose = onChoose
    self.onRemove = onRemove
  }

  /// The sources a picture can come from here: a logo is not a photo taken now.
  @MainActor private var sources: [PickSource] { PickSource.available.filter { $0 != .camera } }

  private var groundColor: Color {
    switch ground {
    case .light: .white
    case .dark: Color(white: 0.13)
    case nil: AglynColor.paper
    }
  }

  @ViewBuilder private var preview: some View {
    if let file, let image = AglynImageFileField.image(file.data) {
      image.resizable().scaledToFit().padding(AglynSpace.half)
    } else {
      Image(systemName: file == nil ? "square.and.arrow.up" : "doc")
        .font(.system(size: 16))
        .foregroundStyle(ground == .dark ? Color(white: 0.7) : Color(white: 0.45))
    }
  }

  private static func image(_ data: Data) -> Image? {
    #if os(iOS)
      UIImage(data: data).map(Image.init(uiImage:))
    #elseif os(macOS)
      NSImage(data: data).map(Image.init(nsImage:))
    #endif
  }

  public var body: some View {
    let shape = RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous)
    let below = error ?? file?.name ?? helper
    HStack(spacing: AglynSpace.oneAndHalf) {
      preview
        .frame(width: AglynImageFileMetrics.tile, height: AglynImageFileMetrics.tile)
        .background(groundColor, in: shape)
        .overlay { shape.strokeBorder(AglynColor.borderStrong) }
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(label).font(AglynFont.subheadline).foregroundStyle(AglynColor.textPrimary)
        if let below {
          Text(below).font(AglynFont.caption).foregroundStyle(error == nil ? AglynColor.secondaryText : AglynColor.error)
            .lineLimit(error == nil ? 1 : nil).truncationMode(.middle)
        }
      }
      Spacer(minLength: AglynSpace.one)
      if file != nil {
        Button("Remove", action: onRemove)
          .buttonStyle(.borderless)
          .disabled(!enabled)
          .accessibilityLabel("Remove \(label)")
          .accessibilityIdentifier("image-file-remove")
      }
      Menu(file == nil ? "Choose file" : "Replace") {
        ForEach(sources) { source in
          Button(source.label) { onChoose(source) }.accessibilityIdentifier("image-file-\(source.rawValue)")
        }
      }
      .fixedSize()
      .disabled(!enabled)
      .accessibilityLabel(file == nil ? "Choose \(label)" : "Replace \(label)")
      .accessibilityIdentifier("image-file-choose")
    }
  }
}
