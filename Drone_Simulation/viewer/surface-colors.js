// Shared material palette for the 3D landscape and the north-up scan view.
export const surfaceTones=Object.freeze({grass:'#578b39',trees:'#367346',building:'#a5a8aa',road:'#85878a',water:'#337b91'});
const grass=new Set([27,34,37,43,46,51,61,71,81,83,86]);
const trees=new Set([23,24,25,26,35,38,40,41,44,52,53,54,62,63,64,72,73,74,84]);
export function coverStyle(code){
  if(grass.has(code))return 1;if(trees.has(code))return 2;
  if(code===21)return 3;if([20,22,31,32].includes(code))return 4;
  if([10,11,12,13,14].includes(code))return 5;return 0;
}
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const srgb=v=>Math.round(255*Math.min(1,Math.max(0,v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055)));
const tones=[null,...Object.values(surfaceTones).map(hex=>[1,3,5].map(i=>linear(parseInt(hex.slice(i,i+2),16)/255)))];
// Same linear-light luminance/detail and class mapping as the terrain shader.
// The 2D mosaic has no directional lighting or cast shadows of its own.
export function surfaceRGB(rgb,code){
  const photo=rgb.map(v=>linear(v/255)),group=coverStyle(code);
  const detail=Math.min(1.45,Math.max(.5,Math.sqrt((photo[0]*.2126+photo[1]*.7152+photo[2]*.0722)/.20)));
  const color=!group?photo:group===3?tones[group]:tones[group].map((v,i)=>group===4?photo[i]*.3+v*detail*.7:v*detail);
  return color.map(srgb);
}

// Clean 2D cartography: remove aerial shadows from lawn, roofs and pavement.
// Retain a little canopy texture so individual tree groups remain legible.
export function mapSurfaceRGB(rgb,code){
  const group=coverStyle(code);
  if(group===1)return [104,155,63];
  if(group===3)return [184,187,182];
  if(group===4)return code===20?[169,172,168]:[205,204,190];
  if(group===5)return [67,132,150];
  if(group===2){
    const lum=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)/255;
    const detail=.88+.20*lum;
    return [53,112,66].map(v=>Math.round(v*detail));
  }
  return rgb;
}
