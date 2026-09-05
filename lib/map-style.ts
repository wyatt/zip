import type { StyleSpecification } from "maplibre-gl";

// Keep geographic data intact; simplify only its visual presentation.
export function cleanMapStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.filter(layer => !/poi_|one_way|hatching|building-3d|road_area_pattern/.test(layer.id)).map(layer => {
      const id = layer.id;
      if (layer.type === "background") return { ...layer, paint: { ...layer.paint, "background-color": "#f4f5f3" } };
      if (layer.type === "fill") {
        const color = id === "water" ? "#9cdaeb" : /park|wood|grass|cemetery/.test(id) ? "#c9ead2" : /hospital/.test(id) ? "#fae8e6" : /school|pitch/.test(id) ? "#eef0dc" : id === "building" ? "#e6e9e7" : "#f0f1ed";
        return { ...layer, paint: { ...layer.paint, "fill-color": color, "fill-outline-color": color } };
      }
      if (layer.type === "line") {
        const color = /waterway/.test(id) ? "#9cdaeb" : /casing/.test(id) ? "#d4dce1" : /motorway/.test(id) ? "#a8c4df" : /trunk_primary|secondary_tertiary/.test(id) ? "#fff3d1" : /boundary|rail/.test(id) ? "#d9dfe0" : /park/.test(id) ? "#bbddc5" : "#ffffff";
        return { ...layer, paint: { ...layer.paint, "line-color": color } };
      }
      if (layer.type === "symbol") {
        const minor = /highway-name-minor|highway-name-path/.test(id);
        return { ...layer, minzoom: minor ? Math.max(layer.minzoom ?? 0, 17) : layer.minzoom,
          layout: { ...layer.layout, ...(id.startsWith("highway-name") ? { "symbol-spacing": 350, "text-size": 12 } : {}), "text-padding": 6 },
          paint: { ...layer.paint, "text-color": /water/.test(id) ? "#487e95" : "#535d65", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        };
      }
      return layer;
    }),
  };
}
