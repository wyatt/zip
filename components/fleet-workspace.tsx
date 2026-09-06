"use client";
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AuthGate, type Account } from "./auth-gate";
import { AppShell } from "./app-shell";
import { messageOf } from "./production-workspace";
import { Reload } from "pixelarticons/react/Reload";
import { Trash } from "pixelarticons/react/Trash";
import type { Id } from "@/convex/_generated/dataModel";
import { CapabilityIcon } from "./capability-icon";
import { SESSION_LEASE_MS, type Environment } from "@/lib/operations";
import {
  DRONE_TYPES,
  OPTIONAL_TAGS,
  SIMULATOR_CAPABILITIES,
  capabilitiesFromTags,
  droneTypeById,
  droneTypeByModel,
  generateAircraftName,
  generateHardwareId,
  type OptionalTag,
} from "@/lib/aircraft";

export function FleetWorkspace() {
  return (
    <AuthGate surface="fleet">
      {(account) => (
        <AppShell account={account} surface="fleet">
          <Fleet account={account} />
        </AppShell>
      )}
    </AuthGate>
  );
}

function heartbeatLive(
  session: { retired: boolean; leaseUntil: number } | null | undefined,
  now: number,
) {
  return !!session && !session.retired && session.leaseUntil > now;
}

function Fleet({ account }: { account: Account }) {
  const vehicles = useQuery(
    api.fleet.mine,
    account.operator?.approved ? {} : "skip",
  );
  const agentStatus = useQuery(
    api.fleet.agentStatus,
    account.operator?.approved ? {} : "skip",
  );
  const register = useMutation(api.fleet.register),
    revoke = useMutation(api.fleet.revokeCredentials),
    remove = useMutation(api.fleet.remove);
  const issue = useAction(api.credentials.issueAgentCredential);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: Id<"vehicles">; name: string } | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const tokenIssued = !!agentStatus?.issued || !!credential;
  const liveHeartbeats = (agentStatus?.heartbeats ?? []).filter((beat) =>
    heartbeatLive(beat, now),
  );
  const serverOnline =
    (agentStatus?.lastSeenAt ?? 0) + SESSION_LEASE_MS > now;
  async function provision() {
    setBusy(true);
    setError("");
    try {
      setCredential((await issue({})).token);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace fleet-retro">
      <div className="page-heading">
        <div>
          <h1>My Fleet</h1>
        </div>
        <div className="heading-actions">
          <button
            className="agent-server"
            type="button"
            disabled={account.operator?.approved === false}
            onClick={() => {
              setError("");
              setAgentOpen(true);
            }}
          >
            <span className={serverOnline ? "server-pip on" : "server-pip"} />
            Flight server: {serverOnline ? "Online" : "Offline"}
          </button>
          <button
            className="primary add-aircraft"
            disabled={account.operator?.approved === false}
            onClick={() => {
              setError("");
              setAdding(true);
            }}
          >
            Add aircraft
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="aircraft-grid">
        {(vehicles ?? []).map((vehicle) => {
          const type = droneTypeByModel(vehicle.model);
          const extras = vehicle.capabilities.filter(
            (cap): cap is OptionalTag =>
              OPTIONAL_TAGS.some((tag) => tag.id === cap),
          );
          const online = heartbeatLive(vehicle.session, now);
          return (
            <article className="aircraft-card" key={vehicle._id}>
              <button
                type="button"
                className="remove-aircraft"
                aria-label={`Remove ${vehicle.name}`}
                onClick={() => {
                  setError("");
                  setRemoving({ id: vehicle._id, name: vehicle.name });
                }}
              >
                <Trash width={18} height={18} aria-hidden />
              </button>
              <div className="sprite-well">
                <img src={type.src} alt={type.label} />
              </div>
              <div
                className={
                  online ? "link-banner online" : "link-banner offline"
                }
              >
                {online ? "Online" : "Offline"}
              </div>
              <div className="aircraft-body">
                <h2>{vehicle.name}</h2>
                <p className="aircraft-type">{type.label}</p>
                {extras.length > 0 && (
                  <div className="tag-row">
                    {extras.map((cap) => {
                      const label = OPTIONAL_TAGS.find((tag) => tag.id === cap)?.label ?? cap;
                      return (
                        <span className="cap-icon" key={cap} title={label} aria-label={label}>
                          <CapabilityIcon id={cap} />
                        </span>
                      );
                    })}
                  </div>
                )}
                {vehicle.cameraMp ? (
                  <p className="muted">Camera: {vehicle.cameraMp} MP</p>
                ) : null}
                {vehicle.maxPayloadKg > 0 && (
                  <p className="muted">
                    Payload capacity: {vehicle.maxPayloadKg} kg
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {removing && (
        <RemoveAircraftModal
          name={removing.name}
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            setBusy(true);
            setError("");
            try {
              await remove({ vehicleId: removing.id });
              setRemoving(null);
            } catch (error) {
              setRemoving(null);
              setError(messageOf(error));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {adding && (
        <AddAircraftModal
          account={account}
          taken={(vehicles ?? []).map((vehicle) => vehicle.name)}
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={async (input) => {
            setBusy(true);
            setError("");
            try {
              await register(input);
              if (!agentStatus?.issued && !credential) {
                setCredential((await issue({})).token);
                setAgentOpen(true);
              }
              setAdding(false);
            } catch (error) {
              setError(messageOf(error));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {agentOpen && (
        <AgentServerModal
          tokenIssued={tokenIssued}
          expiresAt={agentStatus?.expiresAt ?? null}
          serverOnline={serverOnline}
          lastSeenAt={agentStatus?.lastSeenAt ?? null}
          heartbeats={liveHeartbeats}
          credential={credential}
          busy={busy}
          canManage={!!account.operator?.approved}
          now={now}
          onClose={() => setAgentOpen(false)}
          onIssue={() => void provision()}
          onRevoke={async () => {
            setError("");
            try {
              await revoke({});
              setCredential(null);
            } catch (error) {
              setError(messageOf(error));
            }
          }}
          onHideCredential={() => setCredential(null)}
        />
      )}
    </main>
  );
}

function relativeAge(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 1) return "just now";
  if (seconds === 1) return "1s ago";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function AgentServerModal({
  tokenIssued,
  expiresAt,
  serverOnline,
  lastSeenAt,
  heartbeats,
  credential,
  busy,
  canManage,
  now,
  onClose,
  onIssue,
  onRevoke,
  onHideCredential,
}: {
  tokenIssued: boolean;
  expiresAt: number | null;
  serverOnline: boolean;
  lastSeenAt: number | null;
  heartbeats: Array<{ vehicleId: string; name: string; lastSeenAt: number; leaseUntil: number; retired: boolean }>;
  credential: string | null;
  busy: boolean;
  canManage: boolean;
  now: number;
  onClose: () => void;
  onIssue: () => void;
  onRevoke: () => Promise<void>;
  onHideCredential: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fleet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="fleet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flight-server-title"
      >
        <div className="modal-head">
          <h2 id="flight-server-title">Flight server</h2>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className={serverOnline ? "server-status online" : "server-status"}>
          <h3>{serverOnline ? "Online" : "Offline"}</h3>
          <p className="muted">
            {serverOnline
              ? `Local flight server heartbeat ${lastSeenAt ? relativeAge(lastSeenAt, now) : "just now"}.`
              : "No live heartbeat. Save a fleet token, then run npm run agent."}
          </p>
          {heartbeats.length > 0 && (
            <ul className="heartbeat-list">
              {heartbeats.map((beat) => (
                <li key={beat.vehicleId}>
                  <span>{beat.name}</span>
                  <span>{relativeAge(beat.lastSeenAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <h3>Fleet token</h3>
        <p className="muted">
          One token covers every aircraft. Save it in <code>.env.agent</code>,
          then run <code>npm run agent</code>.
        </p>
        <div className="token-actions">
          <span className="status">
            {tokenIssued ? "Token issued" : "No token"}
          </span>
          <button disabled={busy || !canManage} onClick={onIssue}>
            {tokenIssued ? "Rotate token" : "Issue token"}
          </button>
          <button
            className="land-button"
            disabled={busy || !tokenIssued}
            onClick={() => void onRevoke()}
          >
            Revoke
          </button>
        </div>
        {expiresAt && !credential && (
          <p className="muted">
            Current token expires {new Date(expiresAt).toLocaleDateString()}.
          </p>
        )}
        {credential && (
          <div className="credential-box">
            <h3>Connect the local flight agent</h3>
            <p className="muted">
              Save this credential in <code>.env.agent</code>. It is shown only
              now.
            </p>
            <pre className="secret-value">IRIS_AGENT_TOKEN={credential}</pre>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(
                  `IRIS_AGENT_TOKEN=${credential}`,
                )
              }
            >
              Copy agent configuration
            </button>
            <button className="text-button" onClick={onHideCredential}>
              Hide credential
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RemoveAircraftModal({
  name,
  busy,
  onClose,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fleet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="fleet-modal compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-aircraft-title"
      >
        <div className="modal-head">
          <h2 id="remove-aircraft-title">Remove aircraft</h2>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p>
          Remove <strong>{name}</strong> from your fleet? This cannot be undone.
        </p>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="land-button"
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddAircraftModal({
  account,
  taken,
  busy,
  onClose,
  onSubmit,
}: {
  account: Account;
  taken: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    hardwareId: string;
    environment: Environment;
    capabilities: ReturnType<typeof capabilitiesFromTags>;
    model: string;
    serviceRadiusM: number;
    maxPayloadKg: number;
            cameraMp?: number;
            launchSiteId?: string;
            launchSiteName: string;
            maxRadiusM: number;
  }) => Promise<void>;
}) {
  const [typeId, setTypeId] = useState(DRONE_TYPES[0].id);
  const [environment, setEnvironment] = useState<Environment>("aircraft");
  const [tags, setTags] = useState<OptionalTag[]>([...DRONE_TYPES[0].tags]);
  const [payloadKg, setPayloadKg] = useState(DRONE_TYPES[0].payloadKg ?? 1);
  const [cameraMp, setCameraMp] = useState(DRONE_TYPES[0].cameraMp ?? 12);
  const [name, setName] = useState(() => generateAircraftName(taken));
  const sites = account.operator?.presetLocations ?? [];
  const [siteName, setSiteName] = useState(sites[0]?.name ?? "");
  const type = useMemo(() => droneTypeById(typeId), [typeId]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  function chooseType(id: string) {
    const next = droneTypeById(id);
    setTypeId(id);
    setTags([...next.tags]);
    setPayloadKg(next.payloadKg ?? 1);
    setCameraMp(next.cameraMp ?? 12);
    setName(generateAircraftName(taken));
  }
  return (
    <div
      className="fleet-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="fleet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-aircraft-title"
      >
        <div className="modal-head">
          <h2 id="add-aircraft-title">Add aircraft</h2>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-preview">
          <div className="sprite-well">
            <img src={type.src} alt={type.label} />
          </div>
          <div className="modal-preview-copy">
            <label className="preview-name">
              Name
              <div className="name-row">
                <input
                  className="generated-name"
                  data-testid="generated-name"
                  aria-label="Name"
                  value={name}
                  maxLength={80}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
                <button
                  type="button"
                  className="name-reload"
                  aria-label="Reload name"
                  onClick={() => setName(generateAircraftName(taken, name))}
                >
                  <Reload width={22} height={22} aria-hidden />
                </button>
              </div>
            </label>
            <label className="preview-type">
              Drone type
              <select
                aria-label="Drone type"
                value={typeId}
                onChange={(e) => chooseType(e.target.value)}
              >
                {DRONE_TYPES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const payload =
              environment === "simulated"
                ? 0
                : tags.includes("payload")
                  ? payloadKg
                  : 0;
            const range = Number(data.get("maxRange"));
            const site = sites.find((entry) => entry.name === String(data.get("launchSite")));
            if (!site) throw new Error("Save launch sites in account settings before registering an aircraft.");
            await onSubmit({
              name,
              hardwareId: generateHardwareId(type.id),
              environment,
              capabilities:
                environment === "simulated"
                  ? SIMULATOR_CAPABILITIES
                  : capabilitiesFromTags(tags),
              model: type.label,
              serviceRadiusM: range,
              maxPayloadKg: environment === "simulated" ? 25 : payload,
              ...(environment === "aircraft" && tags.includes("camera") ? { cameraMp } : {}),
              launchSiteId: site.id,
              launchSiteName: site.name,
              maxRadiusM: range,
            });
          }}
        >
          <label>
            Environment
            <select
              aria-label="Environment"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as Environment)}
            >
              <option value="simulated">Local simulator</option>
              <option value="aircraft">
                Physical aircraft — integration required
              </option>
            </select>
          </label>
          {environment === "aircraft" && (
            <fieldset className="attr-fieldset">
              <legend>Attributes</legend>
              <div className="attr-stack">
                {OPTIONAL_TAGS.map((tag) => {
                  const on = tags.includes(tag.id);
                  return (
                    <div className={on ? "attr-row on" : "attr-row"} key={tag.id}>
                      <button
                        type="button"
                        className={on ? "tag on" : "tag"}
                        aria-pressed={on}
                        disabled={type.known}
                        onClick={() => {
                          if (type.known) return;
                          setTags((current) =>
                            current.includes(tag.id)
                              ? current.filter((id) => id !== tag.id)
                              : [...current, tag.id],
                          );
                        }}
                      >
                        <CapabilityIcon id={tag.id} />
                        {tag.label}
                      </button>
                      {on && tag.id === "camera" && (
                        <input
                          className="attr-input"
                          name="cameraMp"
                          aria-label="Resolution (MP)"
                          type="number"
                          min={0.1}
                          max={200}
                          step={0.1}
                          value={cameraMp}
                          placeholder="Resolution (MP)"
                          readOnly={type.known}
                          required
                          onChange={(event) => setCameraMp(Number(event.target.value))}
                        />
                      )}
                      {on && tag.id === "payload" && (
                        <input
                          className="attr-input"
                          name="payload"
                          aria-label="Maximum payload (kg)"
                          type="number"
                          min={0}
                          max={25}
                          step={0.1}
                          value={payloadKg}
                          placeholder="Maximum payload (kg)"
                          readOnly={type.known}
                          required
                          onChange={(event) => setPayloadKg(Number(event.target.value))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}
          {sites.length === 0 ? (
            <p className="muted">
              Save launch sites in <a href="/settings">account settings</a> before registering an aircraft.
            </p>
          ) : (
            <label>
              Launch site
              <select
                aria-label="Launch site"
                name="launchSite"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                required
              >
                {sites.map((site) => (
                  <option key={site.name} value={site.name}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Max range (m)
            <input
              name="maxRange"
              aria-label="Max range (m)"
              type="number"
              min={100}
              max={100000}
              defaultValue={5000}
              required
            />
          </label>
          <button className="primary" disabled={busy || sites.length === 0}>
            {busy ? "Registering…" : "Register aircraft"}
          </button>
        </form>
      </div>
    </div>
  );
}
