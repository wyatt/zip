"""Conservative 2D A*, exact cell-footprint segment validation, no smoothing."""
import heapq
import math
import numpy as np
from scipy.ndimage import maximum_filter
from shapely import Point, LineString, box

EMPTY = lambda: np.empty((0, 3), dtype=np.float64)


def segment_valid(a, b, z, nofly, transform, domain, horizontal, vertical):
    """Test the complete segment against every intersected/nearby cell footprint.

    Use the lower endpoint elevation over the entire segment: exact for horizontal
    and vertical segments, conservative for any sloping segment. Touching a blocked
    pixel edge/corner counts as intersection. Horizontal clearance is Euclidean.
    """
    a, b = np.asarray(a), np.asarray(b)
    geom = Point(a[:2]) if np.array_equal(a[:2], b[:2]) else LineString([a[:2], b[:2]])
    if not domain.covers(geom):
        return False
    lo_x, lo_y, hi_x, hi_y = geom.bounds
    r = transform.a
    c0 = math.floor((lo_x-horizontal-transform.c) / r) - 1
    c1 = math.floor((hi_x+horizontal-transform.c) / r) + 1
    r0 = math.floor((transform.f-hi_y-horizontal) / r) - 1
    r1 = math.floor((transform.f-lo_y+horizontal) / r) + 1
    grid = box(transform.c, transform.f-z.shape[0]*r,
               transform.c+z.shape[1]*r, transform.f)
    # Cannot certify clearance into unacquired space.
    if not grid.covers(box(lo_x-horizontal, lo_y-horizontal, hi_x+horizontal, hi_y+horizontal)):
        return False
    for row in range(max(0, r0), min(z.shape[0]-1, r1)+1):
        for col in range(max(0, c0), min(z.shape[1]-1, c1)+1):
            x, y = transform * (col, row)
            cell = box(x, y-r, x+r, y)
            if geom.distance(cell) <= horizontal + 1e-9:
                if nofly[row, col] or not np.isfinite(z[row, col]):
                    return False
                if float(z[row, col]) + vertical > min(a[2], b[2]):
                    return False
    return True


def route(start, end, z, nofly, domain_mask, transform, domain, cfg):
    cruise = cfg.cruise_elevation_m
    h, v = cfg.horizontal_clearance_m, cfg.vertical_clearance_m
    validate = lambda a, b: segment_valid(a, b, z, nofly, transform, domain, h, v)
    # A stationary candidate needs only its actual location/elevation validated.
    if np.array_equal(start, end):
        if validate(start, start):
            return np.asarray([start], dtype=np.float64), "candidate_path", "Validated stationary waypoint"
        return EMPTY(), "endpoint_blocked", "Stationary point lacks surface/airspace clearance"
    up, down = np.array(start, dtype=float), np.array(end, dtype=float)
    up[2] = down[2] = cruise
    if not validate(start, up) or not validate(down, end):
        return EMPTY(), "endpoint_blocked", "A complete endpoint vertical connection fails clearance"
    r = transform.a
    base = ~np.isfinite(z) | nofly | (z + v > cruise) | ~domain_mask
    # Square dilation by a whole extra cell protects arbitrary positions within
    # endpoint cells and corners, conservatively exceeding requested clearance.
    radius = math.ceil(h / r) + 1
    blocked = maximum_filter(base, size=2*radius+1, mode="constant", cval=1)
    rows, cols = z.shape

    def index(p):
        col = math.floor((p[0]-transform.c) / r)
        row = math.floor((transform.f-p[1]) / r)
        return row, col

    def point(cell):
        row, col = cell
        x, y = transform * (col+0.5, row+0.5)
        return np.array([x, y, cruise], dtype=np.float64)

    s, t = index(start), index(end)
    if any(not (0 <= cell[0] < rows and 0 <= cell[1] < cols) or blocked[cell] for cell in (s, t)):
        return EMPTY(), "endpoint_blocked", "Endpoint grid cell blocked after conservative horizontal clearance"
    if not validate(up, point(s)) or not validate(point(t), down):
        return EMPTY(), "endpoint_blocked", "Endpoint-to-grid connector fails segment validation"
    g = np.full(z.shape, np.inf, dtype=np.float64)
    parent = np.full(z.shape, -1, dtype=np.int64)
    closed = np.zeros(z.shape, dtype=bool)
    g[s] = 0.0
    heuristic = lambda a: math.hypot(a[0]-t[0], a[1]-t[1])
    queue = [(heuristic(s), 0.0, s[0], s[1])]
    expanded = 0
    while queue:
        _, cost, row, col = heapq.heappop(queue)
        if closed[row, col] or cost != g[row, col]:
            continue
        if expanded >= cfg.max_search_nodes:
            return EMPTY(), "search_budget_exhausted", "A* expansion limit reached"
        expanded += 1
        closed[row, col] = True
        if (row, col) == t:
            cells = [t]
            while cells[-1] != s:
                p = int(parent[cells[-1]])
                cells.append(divmod(p, cols))
            cells.reverse()
            points = [np.asarray(start), up] + [point(cell) for cell in cells] + [down, np.asarray(end)]
            points = [p for i, p in enumerate(points) if i == 0 or not np.array_equal(p, points[i-1])]
            if not all(validate(a, b) for a, b in zip(points, points[1:])):
                return EMPTY(), "segment_validation_failed", "Candidate failed complete segment validation"
            return np.asarray(points, dtype=np.float64), "candidate_path", f"Validated candidate; {expanded} A* expansions"
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            rr, cc = row+dr, col+dc
            if not (0 <= rr < rows and 0 <= cc < cols) or blocked[rr, cc] or closed[rr, cc]:
                continue
            if dr and dc and (blocked[row, cc] or blocked[rr, col]):
                continue
            ng = cost + math.hypot(dr, dc)
            if ng < g[rr, cc]:
                if len(queue) >= cfg.max_search_queue:
                    return EMPTY(), "search_budget_exhausted", "A* priority queue limit reached"
                g[rr, cc] = ng
                parent[rr, cc] = row*cols+col
                heapq.heappush(queue, (ng+heuristic((rr, cc)), ng, rr, cc))
    return EMPTY(), "no_path", "No connected path through known, clear, in-domain cells"
