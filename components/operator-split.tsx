"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

const MIN = 24;
const MAX = 76;
const STORAGE_KEY = "iris-operator-split";
const OVERLAY_MS = 420;

export function OperatorSplit({
  board,
  map,
  overlay = false,
  panel,
  storageKey = STORAGE_KEY,
}: {
  board: ReactNode;
  map: ReactNode;
  overlay?: boolean;
  panel?: ReactNode;
  storageKey?: string;
}) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [stacked, setStacked] = useState(false);
  const [panelShown, setPanelShown] = useState(overlay);
  const [panelOpen, setPanelOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const overlayBody = panel ?? (overlay ? board : null);
  const held = useRef<ReactNode>(overlayBody);
  if (overlay && overlayBody) held.current = overlayBody;
  const sidebar = panel != null || !overlay ? board : null;
  const layerBody = overlay ? overlayBody : held.current;

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    if (saved >= MIN && saved <= MAX) setSplit(saved);
  }, [storageKey]);
  useEffect(() => {
    window.localStorage.setItem(storageKey, String(Math.round(split)));
  }, [split, storageKey]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const sync = () => setStacked(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!overlay) {
      setPanelOpen(false);
      const timer = window.setTimeout(() => setPanelShown(false), OVERLAY_MS);
      return () => window.clearTimeout(timer);
    }
    setPanelShown(true);
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setPanelOpen(true));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [overlay]);

  const move = useCallback((clientX: number, clientY: number) => {
    const el = root.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = stacked ? (clientY - rect.top) / rect.height : (clientX - rect.left) / rect.width;
    setSplit(Math.min(MAX, Math.max(MIN, ratio * 100)));
  }, [stacked]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    move(event.clientX, event.clientY);
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    move(event.clientX, event.clientY);
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }

  return (
    <div
      ref={root}
      className={`operator-split${dragging ? " dragging" : ""}${overlay ? " overlay" : ""}`}
      style={{
        ["--split" as string]: overlay ? "0%" : `${split}%`,
        ["--gutter" as string]: overlay ? "0px" : "4px",
      }}
    >
      <div className="operator-board" aria-hidden={overlay && panel != null}>
        {sidebar}
      </div>
      <button
        type="button"
        className="operator-gutter"
        aria-label="Resize panels"
        aria-orientation={stacked ? "horizontal" : "vertical"}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={Math.round(split)}
        aria-hidden={overlay}
        tabIndex={overlay ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setSplit(50)}
        onKeyDown={(event) => {
          if (overlay) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            setSplit((value) => Math.max(MIN, value - 2));
          } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            setSplit((value) => Math.min(MAX, value + 2));
          } else if (event.key === "Home") {
            event.preventDefault();
            setSplit(50);
          }
        }}
      />
      <div className="operator-map">{map}</div>
      {panelShown && layerBody && (
        <div className={`operator-job-layer${panelOpen ? " open" : ""}`}>
          {layerBody}
        </div>
      )}
    </div>
  );
}
