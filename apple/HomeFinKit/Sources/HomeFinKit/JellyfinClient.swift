import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Jellyfin's REST API, as one signed-in user on this device.
public struct JellyfinClient: Sendable {
    public let server: URL
    public let device: DeviceIdentity
    public let token: String?
    public let userId: String?
    let http: HTTP

    /// Fields every row card, the billboard and More Info need.
    public static let itemFields = "Overview,Genres,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,DateCreated,PremiereDate,Status"
    static let imageTypes = "Primary,Backdrop,Thumb,Logo"

    public init(server: URL, device: DeviceIdentity, token: String? = nil, userId: String? = nil, session: URLSession = .shared) {
        self.server = server
        self.device = device
        self.token = token
        self.userId = userId
        self.http = HTTP(session: session)
    }

    /// The same client after signing in.
    public func signedIn(token: String, userId: String) -> JellyfinClient {
        JellyfinClient(server: server, device: device, token: token, userId: userId, session: http.session)
    }

    // MARK: requests

    func request(_ path: String, query: [String: String?] = [:], method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: HTTP.url(server, path, query))
        request.httpMethod = method
        request.setValue(device.authorization(token: token), forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    func get<T: Decodable>(_ path: String, _ query: [String: String?] = [:]) async throws -> T {
        try await http.decode(T.self, request(path, query: query))
    }

    func send(_ path: String, method: String = "POST", query: [String: String?] = [:], json: Any? = nil) async throws {
        let body = try json.map { try JSONSerialization.data(withJSONObject: $0) }
        _ = try await http.data(request(path, query: query, method: method, body: body))
    }

    var uid: String { userId ?? "" }

    // MARK: server and sign-in

    public func publicInfo() async throws -> PublicSystemInfo {
        try await get("/System/Info/Public")
    }

    public func authenticate(username: String, password: String) async throws -> AuthenticationResult {
        let body = try JSONSerialization.data(withJSONObject: ["Username": username, "Pw": password])
        return try await http.decode(AuthenticationResult.self, request("/Users/AuthenticateByName", method: "POST", body: body))
    }

    public func currentUser() async throws -> JellyfinUser {
        try await get("/Users/Me")
    }

    /// Ends this device's session (the token stops working).
    public func logout() async {
        try? await send("/Sessions/Logout")
    }

    // MARK: browsing

    public func views() async throws -> [Item] {
        let result: ItemsResult = try await get("/UserViews", ["userId": uid])
        return result.items
    }

    public func resume(limit: Int = 20) async throws -> [Item] {
        let result: ItemsResult = try await get("/UserItems/Resume", [
            "userId": uid, "Limit": String(limit), "MediaTypes": "Video", "Fields": Self.itemFields,
            "EnableImageTypes": Self.imageTypes, "ImageTypeLimit": "1"
        ])
        return result.items
    }

    public func nextUp(limit: Int = 20) async throws -> [Item] {
        let result: ItemsResult = try await get("/Shows/NextUp", [
            "userId": uid, "Limit": String(limit), "Fields": Self.itemFields, "EnableImageTypes": Self.imageTypes,
            "ImageTypeLimit": "1", "EnableResumable": "false"
        ])
        return result.items
    }

    public func latest(parentId: String? = nil, limit: Int = 20) async throws -> [Item] {
        try await get("/Items/Latest", [
            "userId": uid, "ParentId": parentId, "Limit": String(limit), "Fields": Self.itemFields,
            "EnableImageTypes": Self.imageTypes, "ImageTypeLimit": "1", "GroupItems": "true"
        ])
    }

    /// `/Items` with the usual card fields; pass any other Jellyfin query parameters in `query`.
    public func items(_ query: [String: String?]) async throws -> [Item] {
        var full: [String: String?] = ["userId": uid, "Recursive": "true", "Fields": Self.itemFields,
                                       "EnableImageTypes": Self.imageTypes, "ImageTypeLimit": "1"]
        full.merge(query) { _, new in new }
        let result: ItemsResult = try await get("/Items", full)
        return result.items
    }

    /// Films and series, best rated first: what Home's genre rows and the billboard choose from.
    public func catalogue(limit: Int = 300) async throws -> [Item] {
        try await items(["IncludeItemTypes": "Movie,Series", "SortBy": "CommunityRating,SortName", "SortOrder": "Descending",
                         "Limit": String(limit), "Fields": Self.itemFields + ",People"])
    }

    /// My List: favourite films and series, newest first.
    public func favourites(limit: Int = 50) async throws -> [Item] {
        try await items(["IncludeItemTypes": "Movie,Series", "Filters": "IsFavorite", "SortBy": "DatePlayed,DateCreated",
                         "SortOrder": "Descending", "Limit": String(limit)])
    }

    /// Films and episodes played most recently (what "Because you watched" is seeded from).
    public func recentlyPlayed(limit: Int = 20) async throws -> [Item] {
        try await items(["IncludeItemTypes": "Movie,Episode", "Filters": "IsPlayed", "SortBy": "DatePlayed",
                         "SortOrder": "Descending", "Limit": String(limit)])
    }

    public func item(_ id: String) async throws -> Item {
        var item: Item = try await get("/Items/\(id)", ["userId": uid, "Fields": Self.itemFields + ",People,MediaSources"])
        if item.people != nil { item.people = Array(item.people!.prefix(20)) }
        return item
    }

    public func items(ids: [String]) async throws -> [Item] {
        guard !ids.isEmpty else { return [] }
        let found = try await items(["Ids": ids.joined(separator: ",")])
        let order = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
        return found.sorted { (order[$0.id] ?? 0) < (order[$1.id] ?? 0) }
    }

    public func similar(to id: String, limit: Int = 16) async throws -> [Item] {
        let result: ItemsResult = try await get("/Items/\(id)/Similar", ["userId": uid, "Limit": String(limit), "Fields": Self.itemFields])
        return result.items
    }

    public func seasons(seriesId: String) async throws -> [Item] {
        let result: ItemsResult = try await get("/Shows/\(seriesId)/Seasons", ["userId": uid, "Fields": "ChildCount"])
        return result.items
    }

    public func episodes(seriesId: String, seasonId: String) async throws -> [Item] {
        let result: ItemsResult = try await get("/Shows/\(seriesId)/Episodes", [
            "userId": uid, "SeasonId": seasonId, "Fields": "Overview,RunTimeTicks", "EnableImageTypes": "Primary,Thumb", "ImageTypeLimit": "1"
        ])
        return result.items
    }

    /// The episode to play for a series: Next Up (or resumable), otherwise the first episode.
    public func episodeToPlay(seriesId: String) async throws -> Item? {
        let next: ItemsResult = try await get("/Shows/NextUp", ["userId": uid, "SeriesId": seriesId, "Limit": "1", "Fields": Self.itemFields])
        if let first = next.items.first { return first }
        let firstEpisode = try await items(["ParentId": seriesId, "IncludeItemTypes": "Episode", "SortBy": "ParentIndexNumber,IndexNumber", "Limit": "1"])
        return firstEpisode.first
    }

    public func search(_ term: String, limit: Int = 40) async throws -> [Item] {
        try await items(["searchTerm": term, "IncludeItemTypes": "Movie,Series", "Limit": String(limit)])
    }

    // MARK: user data

    public func setFavourite(_ id: String, _ favourite: Bool) async throws {
        try await send("/UserFavoriteItems/\(id)", method: favourite ? "POST" : "DELETE", query: ["userId": uid])
    }

    /// Thumbs up (true), down (false) or neither (nil).
    public func setRating(_ id: String, likes: Bool?) async throws {
        if let likes {
            try await send("/UserItems/\(id)/Rating", method: "POST", query: ["userId": uid, "likes": likes ? "true" : "false"])
        } else {
            try await send("/UserItems/\(id)/Rating", method: "DELETE", query: ["userId": uid])
        }
    }

    public func setPlayed(_ id: String, _ played: Bool) async throws {
        try await send("/UserPlayedItems/\(id)", method: played ? "POST" : "DELETE", query: ["userId": uid])
    }

    /// "Sign in a TV": approve the Quick Connect code a TV or phone app shows, as this user.
    public func authorizeQuickConnect(code: String) async throws {
        try await send("/QuickConnect/Authorize", query: ["code": code.trimmingCharacters(in: .whitespaces), "userId": uid])
    }

    // MARK: images

    public enum ImageType: String, Sendable {
        case primary = "Primary", backdrop = "Backdrop", thumb = "Thumb", logo = "Logo"
    }

    public func imageURL(_ itemId: String, _ type: ImageType, tag: String?, maxWidth: Int, index: Int? = nil) -> URL? {
        guard let tag else { return nil }
        let path = index.map { "/Items/\(itemId)/Images/\(type.rawValue)/\($0)" } ?? "/Items/\(itemId)/Images/\(type.rawValue)"
        return HTTP.url(server, path, ["tag": tag, "maxWidth": String(maxWidth), "quality": "85"])
    }

    /// 16:9 art for a card: the title's thumb or backdrop, an episode's own still, or its series' art.
    public func landscapeURL(_ item: Item, maxWidth: Int = 640, preferEpisodeStill: Bool = false) -> URL? {
        if preferEpisodeStill, item.isEpisode, let url = imageURL(item.id, .primary, tag: item.imageTags?["Primary"], maxWidth: maxWidth) {
            return url
        }
        if let url = imageURL(item.id, .thumb, tag: item.imageTags?["Thumb"], maxWidth: maxWidth) { return url }
        if let url = imageURL(item.id, .backdrop, tag: item.backdropImageTags?.first, maxWidth: maxWidth) { return url }
        if let parent = item.parentThumbItemId, let url = imageURL(parent, .thumb, tag: item.parentThumbImageTag, maxWidth: maxWidth) { return url }
        if let parent = item.parentBackdropItemId, let url = imageURL(parent, .backdrop, tag: item.parentBackdropImageTags?.first, maxWidth: maxWidth) { return url }
        return imageURL(item.id, .primary, tag: item.imageTags?["Primary"], maxWidth: maxWidth)
    }

    public func backdropURL(_ item: Item, maxWidth: Int = 1920) -> URL? {
        if let url = imageURL(item.id, .backdrop, tag: item.backdropImageTags?.first, maxWidth: maxWidth) { return url }
        if let parent = item.parentBackdropItemId { return imageURL(parent, .backdrop, tag: item.parentBackdropImageTags?.first, maxWidth: maxWidth) }
        return landscapeURL(item, maxWidth: maxWidth)
    }

    public func posterURL(_ item: Item, maxWidth: Int = 400) -> URL? {
        if !item.isEpisode, let url = imageURL(item.id, .primary, tag: item.imageTags?["Primary"], maxWidth: maxWidth) { return url }
        if let series = item.seriesId { return imageURL(series, .primary, tag: item.seriesPrimaryImageTag, maxWidth: maxWidth) }
        return nil
    }

    /// The title treatment (logo) for an item or its series.
    public func logoURL(_ item: Item, maxWidth: Int = 600) -> URL? {
        if let url = imageURL(item.id, .logo, tag: item.imageTags?["Logo"], maxWidth: maxWidth) { return url }
        if let parent = item.parentLogoItemId { return imageURL(parent, .logo, tag: item.parentLogoImageTag, maxWidth: maxWidth) }
        return nil
    }
}
