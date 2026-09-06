# Operator earnings (no payments)

iris records an **operator payout quote** on each job. Nothing is charged or paid; the number is a ledger of what the operator would earn.

## Quote

```text
payout = max(floor, round((base + deadhead + task + hover + altitude + payload + area) × kind × surge))
```

Amounts are USD cents.

| Component | Rate |
| --- | --- |
| Base | Flight check $4.00 · Delivery $6.50 · Inspection $8.00 · Search $9.00 |
| Deadhead | $1.20 / km from the assigned aircraft home to the job |
| Task distance | $0.80 / km along waypoints (plus return home) |
| Hover | $0.04 / s |
| Altitude | $0.15 / m above 10 m |
| Payload | $1.50 / kg (delivery) |
| Area | $4.00 / hectare (search / inspection) |
| Kind | Flight check ×0.70 · Delivery ×1.00 · Inspection ×1.15 · Search ×1.25 |
| Floor | $3.00 flight check · $5.00 otherwise |

## Surge

Within 8 km of the job:

```text
demand = open jobs / max(idle aircraft, 1)
surge  = clamp(1.00, 1 + 0.40 × max(0, demand − 0.5), 2.50)
```

Balanced markets stay at 1.00×. A queue with few idle aircraft raises the quote, capped at 2.50×.

## When it is written

- **Available jobs:** live quote for the nearest eligible aircraft (surge can move).
- **Accept:** the quote is snapshotted on the operation (`quotedEarnings`).
- **Complete (landed and disarmed):** `earnedCents` is set to that snapshot and added to the operator’s `lifetimeEarningsCents`.
- **Cancel / close without completion:** no earnings.
