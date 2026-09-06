const HEADER_BYTES=24;

function magic(bytes){return String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3]);}

export function decodeTerrainBuffer(buffer){
  const bytes=new Uint8Array(buffer);
  if(bytes.byteLength<HEADER_BYTES||magic(bytes)!=='RT16')throw new Error('Invalid regional terrain tile');
  const view=new DataView(buffer),version=view.getUint8(4),flags=view.getUint8(5);
  if(version!==1||(flags&1)!==1)throw new Error('Unsupported regional terrain encoding');
  const rows=view.getUint16(6,true),cols=view.getUint16(8,true),base=view.getFloat32(10,true),
    scale=view.getFloat32(14,true),count=view.getUint32(18,true),maskBytes=Math.ceil(count/8);
  const expected=HEADER_BYTES+count*3+maskBytes;
  if(!rows||!cols||rows*cols!==count||!Number.isFinite(base)||!(scale>0)||bytes.byteLength!==expected)
    throw new Error('Misaligned regional terrain tile');
  const quantized=new Uint16Array(buffer,HEADER_BYTES,count),codes=new Uint8Array(buffer,HEADER_BYTES+count*2,count),
    measured=new Uint8Array(buffer,HEADER_BYTES+count*3,maskBytes),heights=new Float32Array(count);
  for(let i=0;i<count;i++)heights[i]=quantized[i]===65535?NaN:base+quantized[i]*scale;
  return {rows,cols,heights,codes,measured,measuredPacked:true,base,scale};
}

async function gunzip(buffer){
  if(typeof DecompressionStream!=='undefined'){
    const stream=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  const zlib=typeof process!=='undefined'&&typeof process.getBuiltinModule==='function'?process.getBuiltinModule('node:zlib'):null;
  if(zlib?.gunzipSync){
    const out=zlib.gunzipSync(Buffer.from(buffer));
    return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
  }
  throw new Error('This runtime cannot decompress regional terrain tiles');
}

export async function fetchTerrain(url,signal){
  const response=await fetch(url,{signal});
  if(!response.ok)throw new Error(`Regional tile: HTTP ${response.status}`);
  let buffer=await response.arrayBuffer(),bytes=new Uint8Array(buffer);
  if(bytes[0]===0x1f&&bytes[1]===0x8b)buffer=await gunzip(buffer);
  return decodeTerrainBuffer(buffer);
}

export function isMeasured(tile,index){
  return tile.measuredPacked?!!(tile.measured[index>>3]&(1<<(index&7))):!!tile.measured[index];
}
