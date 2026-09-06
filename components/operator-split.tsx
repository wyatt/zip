"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

const MIN = 24;
const MAX = 76;
const STORAGE_KEY = "iris-operator-split";

export function OperatorSplit({ board, map, storageKey = STORAGE_KEY }: { board: ReactNode; map: ReactNode; storageKey?: string }) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [stacked, setStacked] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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
      className={dragging ? "operator-split dragging" : "operator-split"}
      style={{ ["--split" as string]: `${split}%` }}
    >
      <div className="operator-board">{board}</div>
      <button
        type="button"
        className="operator-gutter"
        aria-label="Resize panels"
        aria-orientation={stacked ? "horizontal" : "vertical"}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={Math.round(split)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setSplit(50)}
        onKeyDown={(event) => {
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
    </div>
  );
}
