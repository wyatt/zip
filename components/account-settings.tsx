"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AuthGate, type Account } from "./auth-gate";
import { AppShell } from "./app-shell";
import { FlightMap } from "./flight-map";
import { messageOf } from "./production-workspace";
import { useBrowserLocation } from "./use-browser-location";
import type { GeoPoint } from "@/lib/operations";

type DraftLocation = { id?: string; name: string; lat: string; lon: string };

function parsedPoint(location: DraftLocation): GeoPoint | null {
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function AccountSettings() {
  return (
    <AuthGate surface="settings">
      {(account) => (
        <AppShell account={account} surface="settings">
          <LocationSettings account={account} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function LocationSettings({ account }: { account: Account }) {
  const save = useMutation(api.accounts.savePresetLocations);
  const { point: here } = useBrowserLocation();
  const [locations, setLocations] = useState<DraftLocation[]>(() =>
    (account.operator?.presetLocations ?? []).map((location) => ({
      id: location.id,
      name: location.name,
      lat: String(location.lat),
      lon: String(location.lon),
    })),
  );
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  function update(index: number, patch: Partial<DraftLocation>) {
    setLocations((current) => current.map((location, i) => (i === index ? { ...location, ...patch } : location)));
  }
  function chooseOnMap(point: GeoPoint) {
    setLocations((current) => {
      if (picking === null || !current[picking]) return current;
      return current.map((location, i) =>
        i === picking ? { ...location, lat: point.lat.toFixed(5), lon: point.lon.toFixed(5) } : location,
      );
    });
  }
  const draft = picking !== null ? locations[picking] : undefined;
  const selected = draft ? parsedPoint(draft) ?? undefined : undefined;
  return (
    <main className="workspace operator-retro settings-page">
      <div className="page-heading">
        <div>
          <h1>Account settings</h1>
          <p className="muted">Launch sites are saved on your account and chosen when you register aircraft.</p>
        </div>
      </div>
      <section className="panel">
        <h2>Launch sites</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            setStatus("");
            try {
              await save({
                locations: locations.map((location) => ({
                  ...(location.id ? { id: location.id } : {}),
                  name: location.name,
                  lat: Number(location.lat),
                  lon: Number(location.lon),
                })),
                serviceRadiusM: account.operator?.serviceRadiusM,
              });
              setStatus("Locations saved");
            } catch (caught) {
              setError(messageOf(caught));
            } finally {
              setBusy(false);
            }
          }}
        >
          {locations.map((location, index) => (
            <div className={picking === index ? "location-row picking" : "location-row"} key={index}>
              <label>
                Name
                <input
                  value={location.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  required
                  maxLength={40}
                />
              </label>
              <label>
                Latitude
                <input
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  value={location.lat}
                  onChange={(event) => update(index, { lat: event.target.value })}
                  required
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  value={location.lon}
                  onChange={(event) => update(index, { lon: event.target.value })}
                  required
                />
              </label>
              <button
                type="button"
                className="map-pick"
                aria-pressed={picking === index}
                onClick={() => setPicking((current) => (current === index ? null : index))}
              >
                Choose on map
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocations((current) => current.filter((_, i) => i !== index));
                  setPicking((current) => {
                    if (current === null) return null;
                    if (index === current) return null;
                    if (index < current) return current - 1;
                    return current;
                  });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {picking !== null && (
            <FlightMap
              chrome={false}
              home={selected ?? here}
              selected={selected}
              hideHome
              selectedLabel={draft?.name || "Launch site"}
              onSelect={chooseOnMap}
            />
          )}
          <div className="settings-form-actions">
            <button
              type="button"
              onClick={() => {
                setPicking(null);
                setLocations((current) => [...current, { name: "", lat: "", lon: "" }]);
              }}
            >
              Add location
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save locations"}
            </button>
          </div>
          {status && <p className="muted">{status}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
