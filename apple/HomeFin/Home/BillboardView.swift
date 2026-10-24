import CoreImage
import HomeFinKit
import SwiftUI

/// The featured title at the top of Home: Netflix's tall glass-edged poster card on phones, the
/// wide inset billboard on iPad and Mac. Reports the artwork's colour so the page can match it.
struct BillboardView: View {
    var billboard: Billboard
    @Binding var tint: Color
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var inList: Bool?
    @State private var drift = false

    private var item: Item { billboard.item }

    private var artURL: URL? {
        // Textless art: posters usually have the title printed on, and the logo goes on top.
        model.jellyfin?.backdropURL(item, maxWidth: compact ? 1600 : 1920) ?? model.jellyfin?.posterURL(item, maxWidth: 900)
    }

    var body: some View {
        Group {
            if compact { phoneCard } else { wideCard }
        }
        .padding(.horizontal, compact ? 24 : Theme.gutter)
        .onAppear {
            inList = item.userData?.isFavorite == true
            // The artwork drifts very slowly closer while it's on screen.
            withAnimation(.easeOut(duration: 30)) { drift = true }
        }
        .task(id: artURL) {
            if let colour = await ArtworkTint.colour(for: artURL) {
                withAnimation(.easeInOut(duration: 0.8)) { tint = colour }
            }
        }
    }

    // MARK: layouts

    private var phoneCard: some View {
        Button { model.show(item) } label: {
            Artwork(url: artURL)
                .scaleEffect(drift ? 1.05 : 1)
                .aspectRatio(0.7, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .overlay {
                    LinearGradient(colors: [.clear, .black.opacity(0.25), .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
                }
                .clipped()
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) {
            VStack(spacing: 12) {
                title(maxHeight: 100)
                metaLine
                GlassGroup(spacing: 10) {
                    HStack(spacing: 12) {
                        playButton.frame(maxWidth: .infinity)
                        listButton.frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white.opacity(0.18), lineWidth: 1))
        .shadow(color: .black.opacity(0.55), radius: 24, y: 12)
    }

    private var wideCard: some View {
        ZStack(alignment: .bottomLeading) {
            Artwork(url: artURL)
                .scaleEffect(drift ? 1.06 : 1, anchor: .topTrailing)
            LinearGradient(colors: [.black.opacity(0.75), .black.opacity(0.3), .clear], startPoint: .leading, endPoint: .trailing)
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 14) {
                    title(maxHeight: 130)
                    HStack(spacing: 8) {
                        metaLine
                        RatingBadge(rating: item.officialRating)
                    }
                    if let overview = item.overview {
                        Text(overview).font(.system(size: 16)).lineLimit(3).frame(maxWidth: 520, alignment: .leading)
                    }
                    GlassGroup(spacing: 10) {
                        HStack(spacing: 12) {
                            playButton
                            Button { model.show(item) } label: { Label("More Info", systemImage: "info.circle") }
                                .buttonStyle(GlassPillButtonStyle())
                        }
                    }
                }
                Spacer(minLength: 20)
                VStack(alignment: .trailing, spacing: 8) {
                    ForEach(billboard.reasons, id: \.self) { ReasonChip(reason: $0) }
                }
            }
            .padding(36)
        }
        .aspectRatio(16 / 7.2, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.12), lineWidth: 1))
        .foregroundStyle(.white)
    }

    // MARK: pieces

    @ViewBuilder private func title(maxHeight: CGFloat) -> some View {
        if let logo = model.jellyfin?.logoURL(item) {
            Artwork(url: logo, contentMode: .fit)
                .frame(maxWidth: compact ? 270 : 420, maxHeight: maxHeight, alignment: compact ? .bottom : .bottomLeading)
                .shadow(color: .black.opacity(0.5), radius: 8)
        } else {
            Text(item.name ?? "")
                .font(.system(size: compact ? 36 : 54, weight: .black).width(.condensed))
                .textCase(.uppercase)
                .multilineTextAlignment(compact ? .center : .leading)
                .lineLimit(3)
                .minimumScaleFactor(0.6)
                .shadow(color: .black.opacity(0.5), radius: 6)
        }
    }

    /// "Series • Gritty • Thriller": the kind in bold, then genres, as on the Netflix app.
    private var metaLine: some View {
        let kind = item.isSeries ? "Series" : "Film"
        let rest = (item.genres ?? []).prefix(3).joined(separator: "  •  ")
        return Text("\(Text(kind).bold())\(rest.isEmpty ? "" : "  •  " + rest)")
            .font(.system(size: compact ? 15 : 16))
            .foregroundStyle(.white.opacity(0.92))
            .lineLimit(1)
            .shadow(color: .black.opacity(0.5), radius: 4)
    }

    private var playButton: some View {
        Button { model.play(item) } label: {
            Label("Play", systemImage: "play.fill").frame(maxWidth: compact ? .infinity : nil)
        }
        .buttonStyle(PrimaryButtonStyle(height: compact ? 46 : 48))
    }

    private var listButton: some View {
        Button {
            let next = !(inList ?? false)
            withAnimation(Theme.spring) { inList = next }
            Task {
                try? await model.jellyfin?.setFavourite(item.id, next)
                model.homeRevision += 1
            }
        } label: {
            Label("My List", systemImage: inList == true ? "checkmark" : "plus")
                .contentTransition(.symbolEffect(.replace))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(GlassPillButtonStyle(height: 46))
    }
}

/// "No. 4 in Series Today", "Recently added": a small icon tile and the reason, on glass.
struct ReasonChip: View {
    var reason: BillboardReason

    var body: some View {
        HStack(spacing: 8) {
            Group {
                switch reason.kind {
                case .top10:
                    Top10Badge()
                case .new:
                    Image(systemName: "sparkles").font(.system(size: 12, weight: .bold))
                        .frame(width: 22, height: 22).background(RoundedRectangle(cornerRadius: 4).fill(Theme.brand))
                case .love:
                    Image(systemName: "hand.thumbsup.fill").font(.system(size: 11))
                        .frame(width: 22, height: 22).background(RoundedRectangle(cornerRadius: 4).fill(Theme.brand))
                case .star:
                    Image(systemName: "person.fill").font(.system(size: 11))
                        .frame(width: 22, height: 22).background(RoundedRectangle(cornerRadius: 4).fill(Theme.brand))
                }
            }
            Text(reason.text).font(.system(size: 14, weight: .medium))
        }
        .padding(.vertical, 7)
        .padding(.leading, 8)
        .padding(.trailing, 12)
        .glass(in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// The average colour of a piece of artwork, darkened to sit behind a page. Cached per address.
enum ArtworkTint {
    @MainActor private static var cache: [URL: Color] = [:]
    private static let context = CIContext(options: [.workingColorSpace: NSNull()])

    @MainActor
    static func colour(for url: URL?) async -> Color? {
        guard let url else { return nil }
        if let cached = cache[url] { return cached }
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
        let rgb = await Task.detached(priority: .utility) { average(data) }.value
        guard let rgb else { return nil }
        // Keep the hue, lose most of the brightness, so white text stays readable on top.
        let colour = Color(red: rgb.0 * 0.45, green: rgb.1 * 0.45, blue: rgb.2 * 0.45)
        cache[url] = colour
        return colour
    }

    private static func average(_ data: Data) -> (Double, Double, Double)? {
        guard let image = CIImage(data: data),
              let filter = CIFilter(name: "CIAreaAverage", parameters: [
                kCIInputImageKey: image, kCIInputExtentKey: CIVector(cgRect: image.extent)
              ]),
              let output = filter.outputImage else { return nil }
        var pixel = [UInt8](repeating: 0, count: 4)
        context.render(output, toBitmap: &pixel, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        return (Double(pixel[0]) / 255, Double(pixel[1]) / 255, Double(pixel[2]) / 255)
    }
}
