export type LaunchSiteInput = { id?: string; name: string; lat: number; lon: number };
export type LaunchSite = { id: string; name: string; lat: number; lon: number };

export function assignLaunchSiteIds(locations: LaunchSiteInput[]): LaunchSite[] {
  const seen = new Set<string>();
  return locations.map((location, index) => {
    const name = location.name.trim();
    const base = (location.id ?? "").trim() || `site-${slug(name) || String(index)}`;
    let id = base, n = 2;
    while (seen.has(id)) id = `${base}-${n++}`;
    seen.add(id);
    return { id, name, lat: location.lat, lon: location.lon };
  });
}

export function resolveLaunchSite(
  sites: LaunchSite[],
  ref: { launchSiteId?: string; launchSiteName?: string },
): LaunchSite | null {
  if (ref.launchSiteId) {
    const byId = sites.find(site => site.id === ref.launchSiteId);
    if (byId) return byId;
  }
  if (ref.launchSiteName) {
    const byName = sites.find(site => site.name === ref.launchSiteName);
    if (byName) return byName;
  }
  return null;
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
