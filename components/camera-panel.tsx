"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";

export function CameraPanel({ operationId, supported }: { operationId: Id<"operations">; supported: boolean }) {
  const stream = useQuery(api.cameras.forOperation, { operationId });
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(""), [playing, setPlaying] = useState(false), [expired, setExpired] = useState(false);
  useEffect(() => {
    const element = video.current;
    setError(""); setPlaying(false); setExpired(false);
    if (!stream || !element) return;
    const controller = new AbortController();
    let peer: RTCPeerConnection | undefined, resourceUrl: string | undefined, disposeHls: (() => void) | undefined;
    const expiry = setTimeout(() => { setExpired(true); controller.abort(); peer?.close(); disposeHls?.(); element.pause(); element.removeAttribute("src"); element.srcObject = null; }, Math.max(0, stream.expiresAt - Date.now()));
    void (async () => {
      if (stream.protocol === "hls") {
        if (element.canPlayType("application/vnd.apple.mpegurl")) { element.src = stream.url; await element.play(); }
        else {
          const { default: Hls } = await import("hls.js");
          if (controller.signal.aborted) return;
          if (!Hls.isSupported()) throw new Error("HLS playback is unavailable in this browser.");
          const hls = new Hls({ lowLatencyMode: true, maxBufferLength: 5 });
          disposeHls = () => hls.destroy(); hls.attachMedia(element); hls.loadSource(stream.url);
          hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setError("Camera stream interrupted."); });
        }
      } else {
        peer = new RTCPeerConnection();
        peer.addTransceiver("video", { direction: "recvonly" });
        peer.ontrack = event => { element.srcObject = event.streams[0] ?? new MediaStream([event.track]); };
        peer.onconnectionstatechange = () => { if (peer?.connectionState === "failed") setError("Camera connection failed."); };
        await peer.setLocalDescription(await peer.createOffer());
        await new Promise<void>((resolve, reject) => {
          if (peer!.iceGatheringState === "complete") { resolve(); return; }
          const timeout = setTimeout(() => { peer?.removeEventListener("icegatheringstatechange", check); resolve(); }, 3000);
          const check = () => { if (peer!.iceGatheringState === "complete") { clearTimeout(timeout); peer?.removeEventListener("icegatheringstatechange", check); resolve(); } };
          peer!.addEventListener("icegatheringstatechange", check);
          controller.signal.addEventListener("abort", () => { clearTimeout(timeout); reject(new Error("Camera closed")); }, { once: true });
        });
        const response = await fetch(stream.url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: peer.localDescription!.sdp, signal: controller.signal, credentials: "omit" });
        if (!response.ok) throw new Error("Camera negotiation failed.");
        const location = response.headers.get("Location");
        if (location) { const candidate = new URL(location, stream.url); if (candidate.origin === new URL(stream.url).origin) resourceUrl = candidate.href; }
        await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
      }
    })().catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Camera unavailable."); });
    return () => { clearTimeout(expiry); controller.abort(); peer?.close(); disposeHls?.(); element.pause(); element.srcObject = null; element.removeAttribute("src"); if (resourceUrl) void fetch(resourceUrl, { method: "DELETE", credentials: "omit", keepalive: true }).catch(() => undefined); };
  }, [stream?.url, stream?.protocol, stream?.expiresAt]);
  return <section className="camera-panel"><h3>Aircraft camera</h3>{!supported ? <p className="muted">This aircraft adapter does not provide a camera.</p> : !stream ? <p className="muted">Waiting for an authorized camera stream from the aircraft.</p> : <><p className="muted">{expired ? "Camera authorization expired." : playing ? "Live aircraft video" : "Connecting camera…"}</p><video className="live-video" ref={video} autoPlay muted playsInline controls onPlaying={() => setPlaying(true)} onWaiting={() => setPlaying(false)} onError={() => setError("Camera playback failed.")} aria-label="Aircraft camera feed" /></>}{error && <p className="error" role="status">{error}</p>}</section>;
}
