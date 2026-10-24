import HomeFinKit
import SwiftUI

/// The featured title at the top of Home: a tall poster card on phones, Netflix's wide inset
/// billboard on iPad and Mac, with Play, My List / More Info and the "why" chips.
struct BillboardView: View {
    var billboard: Billboard
    @Environment(AppModel.self) private var model
    @Environment(\.isCompactLayout) private var compact
    @State private var inList: Bool?
    @State private var drift = false

    private var item: Item { billboard.item }

    var body: some View {
        Group {
            if compact { phoneCard } else { wideCard }
        }
        .padding(.horizontal, Theme.gutter)
        .onAppear {
            inList = item.userData?.isFavorite == true
            // The artwork drifts very slowly closer while it's on screen.
            withAnimation(.easeOut(duration: 30)) { drift = true }
        }
    }

    // MARK: layouts

    private var phoneCard: some View {
        ZStack(alignment: .bottom) {
            Artwork(url: model.jellyfin?.posterURL(item, maxWidth: 800) ?? model.jellyfin?.backdropURL(item, maxWidth: 1080))
                .scaleEffect(drift ? 1.05 : 1)
            LinearGradient(colors: [.clear, .black.opacity(0.3), .black.opacity(0.9)], startPoint: .center, endPoint: .bottom)
            VStack(spacing: 12) {
                title(maxHeight: 90)
                Text(metaLine).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.9))
                HStack(spacing: 10) {
                    playButton.frame(maxWidth: .infinity)
                    listButton.frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
        .aspectRatio(0.72, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white.opacity(0.12), lineWidth: 1))
        .shadow(color: .black.opacity(0.6), radius: 20, y: 10)
    }

    private var wideCard: some View {
        ZStack(alignment: .bottomLeading) {
            Artwork(url: model.jellyfin?.backdropURL(item, maxWidth: 1920))
                .scaleEffect(drift ? 1.06 : 1, anchor: .topTrailing)
            LinearGradient(colors: [.black.opacity(0.75), .black.opacity(0.3), .clear], startPoint: .leading, endPoint: .trailing)
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 14) {
                    title(maxHeight: 130)
                    HStack(spacing: 8) {
                        Text(metaLine).font(.system(size: 15, weight: .bold))
                        RatingBadge(rating: item.officialRating)
                    }
                    if let overview = item.overview {
                        Text(overview).font(.system(size: 16)).lineLimit(3).frame(maxWidth: 520, alignment: .leading)
                    }
                    HStack(spacing: 12) {
                        playButton
                        NavigationLink(value: item) { Text("More Info") }
                            .buttonStyle(SecondaryButtonStyle())
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
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .foregroundStyle(.white)
    }

    // MARK: pieces

    @ViewBuilder private func title(maxHeight: CGFloat) -> some View {
        if let logo = model.jellyfin?.logoURL(item) {
            Artwork(url: logo, contentMode: .fit)
                .frame(maxWidth: compact ? 260 : 420, maxHeight: maxHeight, alignment: compact ? .center : .bottomLeading)
        } else {
            Text(item.name ?? "")
                .font(.system(size: compact ? 34 : 54, weight: .black))
                .multilineTextAlignment(compact ? .center : .leading)
                .shadow(color: .black.opacity(0.5), radius: 6)
        }
    }

    private var metaLine: String {
        var parts: [String] = []
        if compact {
            parts = Array((item.genres ?? []).prefix(3))
        } else {
            parts.append(item.isSeries ? "Series" : "Film")
            if let genre = item.genres?.first { parts.append(genre) }
            if let year = item.productionYear { parts.append(String(year)) }
            if item.isSeries, let seasons = item.childCount { parts.append(seasons == 1 ? "1 Season" : "\(seasons) Seasons") }
        }
        return parts.joined(separator: " • ")
    }

    private var playButton: some View {
        Button { model.play(item) } label: {
            Label("Play", systemImage: "play.fill").frame(maxWidth: compact ? .infinity : nil)
        }
        .buttonStyle(PrimaryButtonStyle())
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
        .buttonStyle(SecondaryButtonStyle())
    }
}

/// "No. 4 in Series Today", "Recently added": a small icon tile and the reason.
struct ReasonChip: View {
    var reason: BillboardReason

    var body: some View {
        HStack(spacing: 8) {
            Group {
                switch reason.kind {
                case .top10:
                    VStack(spacing: -2) {
                        Text("TOP").font(.system(size: 6, weight: .heavy))
                        Text("10").font(.system(size: 11, weight: .black))
                    }
                case .new: Image(systemName: "sparkles").font(.system(size: 12, weight: .bold))
                case .love: Image(systemName: "hand.thumbsup.fill").font(.system(size: 11))
                case .star: Image(systemName: "person.fill").font(.system(size: 11))
                }
            }
            .frame(width: 22, height: 22)
            .background(RoundedRectangle(cornerRadius: 4).fill(Theme.brand))
            Text(reason.text).font(.system(size: 14, weight: .medium))
        }
        .padding(.vertical, 7)
        .padding(.leading, 8)
        .padding(.trailing, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
        .environment(\.colorScheme, .dark)
    }
}
