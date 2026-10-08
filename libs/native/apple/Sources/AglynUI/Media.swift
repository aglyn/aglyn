// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

#if os(iOS)
  import UIKit
#endif

/// A remote image (a media thumbnail, a site's icon). While it loads, and
/// when it cannot (no URL, offline, not an image), `systemImage` sits on a
/// muted ground in its place.
public struct AglynRemoteImage: View {
  let url: URL?
  let systemImage: String
  let contentMode: ContentMode
  let label: String?

  public init(_ url: URL?, systemImage: String = "photo", contentMode: ContentMode = .fill, label: String? = nil) {
    self.url = url
    self.systemImage = systemImage
    self.contentMode = contentMode
    self.label = label
  }

  private var placeholder: some View {
    ZStack {
      AglynColor.primary.opacity(0.08)
      Image(systemName: systemImage)
        .font(.system(size: 28, weight: .regular))
        .foregroundStyle(AglynColor.tint.opacity(0.7))
    }
  }

  public var body: some View {
    Group {
      if let url {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
          if let image = phase.image {
            image.resizable().aspectRatio(contentMode: contentMode)
          } else {
            placeholder
          }
        }
      } else {
        placeholder
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label ?? "")
    .accessibilityHidden(label == nil)
  }
}

/// A square tile in a media grid: the preview (or the kind's symbol), the
/// file name, and a badge ("Private") in the corner.
public struct AglynMediaTile: View {
  let title: String
  let imageURL: URL?
  let systemImage: String
  let badge: (text: String, tone: AglynTone)?
  let selected: Bool

  public init(
    _ title: String, imageURL: URL?, systemImage: String, badge: (text: String, tone: AglynTone)? = nil,
    selected: Bool = false
  ) {
    self.title = title
    self.imageURL = imageURL
    self.systemImage = systemImage
    self.badge = badge
    self.selected = selected
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Color.clear
        .aspectRatio(1, contentMode: .fit)
        .overlay { AglynRemoteImage(imageURL, systemImage: systemImage) }
        .overlay(alignment: .topLeading) {
          if let badge {
            StatusChip(badge.text, tone: badge.tone)
              .background(AglynColor.paper, in: Capsule())
              .padding(AglynSpace.half)
          }
        }
        .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
      Text(title)
        .font(AglynFont.caption)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.horizontal, AglynSpace.half)
    }
    .padding(AglynSpace.half)
    .background(
      selected ? AglynColor.primary.opacity(0.16) : AglynColor.paper,
      in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous)
    )
    .overlay(
      RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous)
        .strokeBorder(selected ? AglynColor.primary : AglynColor.divider, lineWidth: selected ? 2 : 1)
    )
    .contentShape(RoundedRectangle(cornerRadius: AglynRadius.card))
    .accessibilityElement(children: .combine)
    .accessibilityLabel([title, badge?.text].compactMap { $0 }.joined(separator: ", "))
    .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
  }
}

/// Placeholder tiles while a grid loads, drawn with the system's redaction.
public struct SkeletonGrid: View {
  let count: Int
  let minimum: CGFloat

  public init(count: Int = 9, minimum: CGFloat = 120) {
    self.count = count
    self.minimum = minimum
  }

  public var body: some View {
    ScrollView {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: AglynSpace.one)], spacing: AglynSpace.one) {
        ForEach(0..<count, id: \.self) { _ in
          AglynMediaTile("Loading a file name", imageURL: nil, systemImage: "photo")
        }
      }
      .padding(AglynSpace.two)
    }
    .redacted(reason: .placeholder)
    .disabled(true)
    .accessibilityLabel("Loading")
  }
}

/// Where a picked file comes from.
public enum PickSource: String, CaseIterable, Identifiable, Sendable {
  case photos, camera, files

  public var id: String { rawValue }

  /// How a source reads in a menu.
  public var label: String {
    switch self {
    case .photos: "Photo library"
    case .camera: "Take a photo"
    case .files: "Choose files"
    }
  }

  public var systemImage: String {
    switch self {
    case .photos: "photo.on.rectangle"
    case .camera: "camera"
    case .files: "folder"
    }
  }

  /// The sources this device offers, in the order a menu lists them: the
  /// camera only where there is one (not on a Mac or in the Simulator).
  @MainActor
  public static var available: [PickSource] {
    #if os(iOS)
      UIImagePickerController.isSourceTypeAvailable(.camera) ? [.photos, .camera, .files] : [.photos, .files]
    #else
      [.photos, .files]
    #endif
  }
}

/// A file the person picked or shot, read whole, with the name and type the device gave it.
public struct PickedFile: Sendable {
  public let name: String
  public let mimeType: String
  public let data: Data

  public init(name: String, mimeType: String, data: Data) {
    self.name = name
    self.mimeType = mimeType
    self.data = data
  }

  public var size: Int { data.count }

  /// A file name's type, as the upload route takes it.
  public static func mimeType(forExtension ext: String) -> String {
    UTType(filenameExtension: ext.lowercased())?.preferredMIMEType ?? "application/octet-stream"
  }

  /// A name for a picture with none of its own: `Photo 2026-10-07 at 21.04.12.jpg`.
  public static func photoName(_ ext: String, date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
    return "Photo \(formatter.string(from: date)).\(ext)"
  }
}

extension View {
  /// The device's own pickers, shown while `source` is set: the photo
  /// library (PhotosPicker), the camera (iPhone and iPad), or the file
  /// browser (fileImporter). `onPicked` gets the files read whole; nothing
  /// when the person backs out.
  public func aglynMediaPicker(
    _ source: Binding<PickSource?>, multiple: Bool = true,
    onPicked: @escaping @MainActor ([PickedFile]) -> Void
  ) -> some View {
    modifier(MediaPickerModifier(source: source, multiple: multiple, onPicked: onPicked))
  }
}

private struct MediaPickerModifier: ViewModifier {
  @Binding var source: PickSource?
  let multiple: Bool
  let onPicked: @MainActor ([PickedFile]) -> Void
  @State private var items: [PhotosPickerItem] = []

  private func showing(_ kind: PickSource) -> Binding<Bool> {
    Binding(get: { source == kind }, set: { if !$0, source == kind { source = nil } })
  }

  func body(content: Content) -> some View {
    content
      .photosPicker(
        isPresented: showing(.photos), selection: $items, maxSelectionCount: multiple ? 20 : 1,
        matching: .any(of: [.images, .videos]))
      .fileImporter(isPresented: showing(.files), allowedContentTypes: [.item], allowsMultipleSelection: multiple) {
        result in
        guard case .success(let urls) = result else { return }
        let files = urls.compactMap(Self.read)
        if !files.isEmpty { onPicked(files) }
      }
      #if os(iOS)
        .fullScreenCover(isPresented: showing(.camera)) {
          CameraCapture { data in
            source = nil
            if let data { onPicked([PickedFile(name: PickedFile.photoName("jpg"), mimeType: "image/jpeg", data: data)]) }
          }
          .ignoresSafeArea()
        }
      #endif
      .onChange(of: items) { _, picked in
        guard !picked.isEmpty else { return }
        items = []
        Task { @MainActor in
          var files: [PickedFile] = []
          for item in picked {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first
            let ext = type?.preferredFilenameExtension ?? "jpg"
            files.append(
              PickedFile(
                name: PickedFile.photoName(ext), mimeType: type?.preferredMIMEType ?? "application/octet-stream",
                data: data))
          }
          if !files.isEmpty { onPicked(files) }
        }
      }
  }

  private static func read(_ url: URL) -> PickedFile? {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return PickedFile(
      name: url.lastPathComponent, mimeType: PickedFile.mimeType(forExtension: url.pathExtension), data: data)
  }
}

#if os(iOS)
  /// The system camera, for one photo; answers its JPEG bytes, or nil when cancelled.
  struct CameraCapture: UIViewControllerRepresentable {
    let onDone: (Data?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.delegate = context.coordinator
      return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
      let onDone: (Data?) -> Void
      init(onDone: @escaping (Data?) -> Void) { self.onDone = onDone }

      func imagePickerController(
        _ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
      ) {
        onDone((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.9))
      }

      func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onDone(nil) }
    }
  }
#endif
