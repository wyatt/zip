import * as THREE from 'three';

import { surfaceTones } from './surface-colors.js';
export { coverStyle } from './surface-colors.js';

/** Land-cover palette on aerial tops, short color bands on display sides.
 * Existing instanceColor carries the display group; data/geometry are untouched.
 */
export function createPhotoMaterial(texture, width, depth, height = 100) {
  const material = new THREE.MeshStandardMaterial({map:texture,roughness:.94,metalness:0});
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      photoSize:{value:new THREE.Vector2(width,depth)},
      grassTone:{value:new THREE.Color(surfaceTones.grass)},
      treeTone:{value:new THREE.Color(surfaceTones.trees)},
      wallTone:{value:new THREE.Color(surfaceTones.building)},
      roadTone:{value:new THREE.Color(surfaceTones.road)},
      waterTone:{value:new THREE.Color(surfaceTones.water)},
      cutTone:{value:new THREE.Color('#35424b')},
    });
    const shared = `
      uniform vec2 photoSize;
      varying vec2 vPhotoUv;
      varying float vPhotoTop;
      varying float vOuterSide;
      varying vec3 vCutPosition;
      varying float vCutDepth;
      varying float vCover;
      varying float vBuildingWall;
      varying float vCutShade;
    `;
    shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>'+shared)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vec4 p = instanceMatrix * vec4(position,1.0);
        vPhotoUv = vec2(p.x/photoSize.x+0.5,0.5-p.z/photoSize.y);
        vPhotoTop = step(0.5,normal.y);
        vCover = instanceColor.r;
        vBuildingWall = instanceColor.g;
        vCutDepth = instanceMatrix[3].y*2.0-p.y;
        vCutPosition = p.xyz;
        vCutShade = 0.94+normal.x*0.06+normal.z*0.03;
        vOuterSide = max(
          step(photoSize.x*0.5-0.01,abs(p.x))*step(0.5,abs(normal.x)),
          step(photoSize.y*0.5-0.01,abs(p.z))*step(0.5,abs(normal.z)));
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>','#include <common>'+shared+`
      uniform vec3 grassTone, treeTone, wallTone, roadTone, waterTone, cutTone;
    `).replace('#include <color_fragment>','// instanceColor is a display-group tag, not an RGB multiplier.')
      .replace('#include <map_fragment>',`
        vec3 photo = texture2D(map,clamp(vPhotoUv,vec2(0.0),vec2(1.0))).rgb;
        float lum = dot(photo,vec3(0.2126,0.7152,0.0722));
        float detail = clamp(sqrt(lum/0.20),0.50,1.45);
        vec3 topColor = photo;
        vec3 sideColor = cutTone;
        float bandDepth = 0.8;
        if (vCover>0.5 && vCover<1.5) {
          topColor = grassTone*detail; sideColor=grassTone*0.8;
        } else if (vCover>1.5 && vCover<2.5) {
          topColor=treeTone*detail; sideColor=treeTone*0.8; bandDepth=4.0;
        } else if (vCover>2.5 && vCover<3.5) {
          topColor=wallTone;
          sideColor=wallTone;
        } else if (vCover>3.5 && vCover<4.5) {
          topColor=mix(photo,roadTone*detail,0.7); sideColor=roadTone;
        } else if (vCover>4.5) {
          topColor=waterTone*detail; sideColor=waterTone;
        }
        // These are short illustrative bands, not inferred building/ground heights.
        float sideWeight=1.0-smoothstep(bandDepth*0.35,bandDepth,vCutDepth);
        vec3 sides=mix(cutTone,sideColor,sideWeight);
        if (vBuildingWall>0.5) {
          sides=wallTone;
          sideColor=wallTone;
        }
        diffuseColor.rgb *= mix(sides,topColor,vPhotoTop);
      `).replace('#include <opaque_fragment>',`
        // Perimeter cut stays neutral, with at most an 0.8 m colored edge.
        vec3 blocks=floor(vCutPosition/1.5);
        float grain=fract(sin(dot(blocks,vec3(12.9898,78.233,37.719)))*43758.5453);
        vec3 cut=cutTone*(0.98+floor(grain*4.0)*0.015)*vCutShade;
        float rim=1.0-smoothstep(0.2,0.8,vCutDepth);
        outgoingLight=mix(outgoingLight,mix(cut,sideColor*vCutShade,rim),vOuterSide);
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey=()=> 'uniform-grey-buildings-v8';
  return material;
}

/** Decorative stone blocks belong to the existing display plinth only. */
export function createBaseMaterial() {
  const material = new THREE.MeshStandardMaterial({color:0x34433e,roughness:1});
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vBasePosition;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvBasePosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying vec3 vBasePosition;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec3 cell = floor(vBasePosition / 1.5);
        float grain = fract(sin(dot(cell, vec3(12.9898,78.233,37.719))) * 43758.5453);
        diffuseColor.rgb *= 0.78 + floor(grain * 4.0) * 0.12;
      `);
  };
  material.customProgramCacheKey = () => 'stone-display-base-v1';
  return material;
}
