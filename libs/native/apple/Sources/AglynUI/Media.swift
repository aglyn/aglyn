// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import ImageIO
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

/// A brand picture in a small square: a workspace's logo or a site's favicon, its dark-appearance art in dark mode
/// when there is one, and `fallback` (the kit's symbol) while there is none, while it loads, or when it fails.
///
/// Opaque art (a photo, a solid tile) fills the square and loses its corners to `cornerRadius`, which costs nothing.
/// Art on a transparent ground (a logo mark) is drawn whole: fitted, and shrunk only as far as the shape needs for
/// every visible pixel to clear its edges (`AglynBrandArt.scale`). A favicon is drawn edge to edge for a browser tab,
/// so filling a circle with it cuts its corners off.
public struct AglynBrandPicture<Fallback: View>: View {
  @Environment(\.colorScheme) private var scheme
  @State private var loaded: (url: URL, picture: AglynBrandImage)?
  let url: URL?
  let darkURL: URL?
  let size: CGFloat
  let cornerRadius: CGFloat
  let fallback: Fallback

  public init(
    _ url: URL?, darkURL: URL? = nil, size: CGFloat, cornerRadius: CGFloat,
    @ViewBuilder fallback: () -> Fallback
  ) {
    self.url = url
    self.darkURL = darkURL
    self.size = size
    self.cornerRadius = cornerRadius
    self.fallback = fallback()
  }

  public var body: some View {
    if let shown = (scheme == .dark ? darkURL : nil) ?? url {
      // A picture already decoded draws on the first frame, so a row scrolled back into view does not flash its
      // fallback.
      let picture = loaded?.url == shown ? loaded?.picture : AglynBrandImageLoader.cached(shown)
      Group {
        if let picture {
          drawn(picture)
        } else {
          fallback
        }
      }
      .frame(width: size, height: size)
      .accessibilityHidden(true)
      .task(id: shown) {
        guard AglynBrandImageLoader.cached(shown) == nil,
              let picture = await AglynBrandImageLoader.load(shown) else { return }
        loaded = (shown, picture)
      }
    } else {
      fallback
    }
  }

  @ViewBuilder
  private func drawn(_ picture: AglynBrandImage) -> some View {
    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    let image = Image(decorative: picture.image, scale: 1).resizable()
    if picture.art.opaqueCorners {
      image.scaledToFill()
        .frame(width: size, height: size)
        .clipShape(shape)
    } else {
      let scale = picture.art.scale(cornerFraction: size > 0 ? cornerRadius / size : 0.5)
      image.scaledToFit()
        .frame(width: size * scale, height: size * scale)
        .frame(width: size, height: size)
        .clipShape(shape)
    }
  }
}

/// Where a brand picture's art has ink. `ink` holds, for each row of pixels that has any, the outer corner of its
/// outermost visible pixel on each side, measured from the picture's center in units of its longer side. The badge's
/// shape is convex and symmetric, so those are the only points that can cross its edge.
public struct AglynBrandArt: Equatable, Sendable {
  /// The room a brand mark keeps from its badge's edge, as a fraction of the badge's side.
  public static let margin: CGFloat = 0.06
  /// Pixels at or below this opacity are ground, not art: anti-aliasing haze, not a visible edge.
  static let inkAlpha: CGFloat = 0.06
  /// The longest side a picture is read at: the badges are small, and a larger read only costs time.
  static let readSide = 128

  public let ink: [CGPoint]
  /// Whether all four corners are opaque: a photo or a solid tile rather than a mark on a clear ground.
  public let opaqueCorners: Bool

  public init(ink: [CGPoint], opaqueCorners: Bool) {
    self.ink = ink
    self.opaqueCorners = opaqueCorners
  }

  /// The art of a `width` × `height` picture whose opacity at a pixel (0…1) is `alphaAt`.
  public init(width: Int, height: Int, alphaAt: (_ x: Int, _ y: Int) -> CGFloat) {
    guard width > 0, height > 0 else {
      self.init(ink: [], opaqueCorners: false)
      return
    }
    let corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    let opaque = corners.allSatisfy { alphaAt($0.0, $0.1) >= 0.95 }
    let unit = CGFloat(max(width, height))
    let midX = CGFloat(width) / 2, midY = CGFloat(height) / 2
    var points: [CGPoint] = []
    for y in 0..<height {
      guard let left = (0..<width).first(where: { alphaAt($0, y) > Self.inkAlpha }),
            let right = (left..<width).reversed().first(where: { alphaAt($0, y) > Self.inkAlpha }) else { continue }
      // The pixel's edge farthest from the center, on each axis.
      let rowY = max(abs(CGFloat(y) - midY), abs(CGFloat(y + 1) - midY)) / unit
      points.append(CGPoint(x: abs(CGFloat(left) - midX) / unit, y: rowY))
      points.append(CGPoint(x: abs(CGFloat(right + 1) - midX) / unit, y: rowY))
    }
    self.init(ink: points, opaqueCorners: opaque)
  }

  /// Reads `image`'s ink at no more than `readSide` pixels a side. A picture that cannot be read counts as opaque, so
  /// it fills as it always has.
  public init(image: CGImage) {
    let longer = max(image.width, image.height)
    let factor = longer > Self.readSide ? CGFloat(Self.readSide) / CGFloat(longer) : 1
    let width = max(1, Int((CGFloat(image.width) * factor).rounded()))
    let height = max(1, Int((CGFloat(image.height) * factor).rounded()))
    guard let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ), let data = context.data else {
      self.init(ink: [], opaqueCorners: true)
      return
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    let bytes = data.bindMemory(to: UInt8.self, capacity: width * height * 4)
    // Rows come out bottom-up or top-down depending on the context; the measure is symmetric, so either reads the same.
    self.init(width: width, height: height) { x, y in CGFloat(bytes[(y * width + x) * 4 + 3]) / 255 }
  }

  /// How far to shrink art fitted to a badge (its longer side the badge's side) so that all of its ink lies inside
  /// the badge's shape, `margin` in from its edge: 1 when it already does, since art is never enlarged past its fit.
  /// `cornerFraction` is the shape's corner radius as a fraction of its side: 0 for a square, 0.5 for a circle.
  public func scale(cornerFraction: CGFloat, margin: CGFloat = Self.margin) -> CGFloat {
    let half = 0.5 - margin
    let radius = max(0, min(max(cornerFraction, 0), 0.5) - margin)
    let straight = half - radius
    var scale: CGFloat = 1
    for point in ink {
      let x = abs(point.x), y = abs(point.y)
      let far = max(x, y)
      guard far > 0 else { continue }
      var limit = half / far
      // Past the straight part of both edges the point meets the corner's arc instead: the larger root of
      // |k·(x, y) − (straight, straight)| = radius.
      if radius > 0, limit * min(x, y) > straight {
        let norm = x * x + y * y
        let reach = -straight * straight * (x - y) * (x - y) + radius * radius * norm
        limit = min(limit, (straight * (x + y) + max(reach, 0).squareRoot()) / norm)
      }
      scale = min(scale, limit)
    }
    return scale
  }
}

/// A decoded brand picture and where its art has ink.
final class AglynBrandImage {
  let image: CGImage
  let art: AglynBrandArt

  init(image: CGImage, art: AglynBrandArt) {
    self.image = image
    self.art = art
  }
}

/// Fetches and decodes brand pictures, kept by URL so every badge showing one logo reads it once.
enum AglynBrandImageLoader {
  private static let cache: NSCache<NSURL, AglynBrandImage> = {
    let cache = NSCache<NSURL, AglynBrandImage>()
    cache.countLimit = 120
    return cache
  }()

  static func cached(_ url: URL) -> AglynBrandImage? {
    cache.object(forKey: url as NSURL)
  }

  /// The picture at `url`, or nil when it cannot be fetched or is not an image.
  static func load(_ url: URL) async -> AglynBrandImage? {
    if let hit = cached(url) { return hit }
    guard let (data, response) = try? await URLSession.shared.data(from: url) else { return nil }
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
    let picture = AglynBrandImage(image: image, art: AglynBrandArt(image: image))
    cache.setObject(picture, forKey: url as NSURL)
    return picture
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
