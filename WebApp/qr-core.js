(()=>{
  'use strict';
  // Build 358: QR codes on financial documents (transfer advice, cheque verification, ZATCA tax invoice).
  // ISO/IEC 18004 byte mode, error correction level M, versions 1–20 (up to 666 bytes), all eight masks scored by the
  // standard penalty rules. Output is an SVG string with a four-module quiet zone; nothing is fetched.
  const VERSION='GH-QR-358.1.0';
  // [EC codewords per block, blocks in group 1, data codewords per block in group 1, blocks in group 2, data per block]
  const LEVEL_M=[null,[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],
    [30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],[28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42]];
  const ALIGN=[null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90]];
  const MAX_VERSION=20,FORMAT_M=0;
  const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
  {let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&256)x^=0x11d;}for(let i=255;i<512;i++)EXP[i]=EXP[i-255];}
  const mul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
  function generator(degree){let poly=[1];for(let i=0;i<degree;i++){const next=new Array(poly.length+1).fill(0);for(let j=0;j<poly.length;j++){next[j]^=poly[j];next[j+1]^=mul(poly[j],EXP[i]);}poly=next;}return poly;}
  function remainder(data,degree){const gen=generator(degree),out=[...data,...new Array(degree).fill(0)];for(let i=0;i<data.length;i++){const factor=out[i];if(!factor)continue;for(let j=0;j<gen.length;j++)out[i+j]^=mul(gen[j],factor);}return out.slice(data.length);}
  const dataCapacity=version=>{const [,b1,d1,b2,d2]=LEVEL_M[version];return b1*d1+b2*d2;};
  function utf8(text){return Array.from(new TextEncoder().encode(String(text??'')));}
  function chooseVersion(bytes){for(let v=1;v<=MAX_VERSION;v++){const countBits=v<10?8:16;if(4+countBits+bytes.length*8<=dataCapacity(v)*8)return v;}throw new Error('qr-too-long');}
  function codewords(bytes,version){
    const bits=[],push=(value,length)=>{for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);};
    push(4,4);push(bytes.length,version<10?8:16);for(const byte of bytes)push(byte,8);
    const capacity=dataCapacity(version)*8;push(0,Math.min(4,capacity-bits.length));while(bits.length%8)bits.push(0);
    const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));for(let pad=0;data.length<capacity/8;pad++)data.push(pad%2?0x11:0xec);
    const [ec,b1,d1,b2,d2]=LEVEL_M[version],blocks=[];let offset=0;
    for(let i=0;i<b1+b2;i++){const size=i<b1?d1:d2,block=data.slice(offset,offset+size);offset+=size;blocks.push({data:block,ec:remainder(block,ec)});}
    const out=[],longest=Math.max(d1,d2);for(let i=0;i<longest;i++)for(const block of blocks)if(i<block.data.length)out.push(block.data[i]);for(let i=0;i<ec;i++)for(const block of blocks)out.push(block.ec[i]);
    return out;
  }
  function build(bytes){
    const version=chooseVersion(bytes),size=version*4+17,modules=Array.from({length:size},()=>new Array(size).fill(false)),fixed=Array.from({length:size},()=>new Array(size).fill(false));
    const set=(x,y,dark)=>{modules[y][x]=dark;fixed[y][x]=true;};
    const finder=(cx,cy)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=size||y>=size)continue;const d=Math.max(Math.abs(dx),Math.abs(dy));set(x,y,d!==2&&d!==4);}};
    for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
    finder(3,3);finder(size-4,3);finder(3,size-4);
    const align=ALIGN[version],last=align.length-1;
    for(let i=0;i<align.length;i++)for(let j=0;j<align.length;j++){if((i===0&&j===0)||(i===0&&j===last)||(i===last&&j===0))continue;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(align[i]+dx,align[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);}
    const drawFormat=mask=>{const data=(FORMAT_M<<3)|mask;let rem=data;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);const bits=((data<<10)|rem)^0x5412,bit=i=>((bits>>>i)&1)===1;
      for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));
      for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true);};
    drawFormat(0);
    if(version>=7){let rem=version;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);const bits=(version<<12)|rem;for(let i=0;i<18;i++){const dark=((bits>>>i)&1)===1,a=size-11+i%3,b=Math.floor(i/3);set(a,b,dark);set(b,a,dark);}}
    const data=codewords(bytes,version);let index=0;
    for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){const x=right-j,upward=((right+1)&2)===0,y=upward?size-1-vert:vert;if(!fixed[y][x]&&index<data.length*8){modules[y][x]=((data[index>>>3]>>>(7-(index&7)))&1)===1;index++;}}}
    const MASKS=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,x=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
    const apply=mask=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fixed[y][x]&&MASKS[mask](x,y))modules[y][x]=!modules[y][x];};
    let best=0,bestScore=Infinity;for(let mask=0;mask<8;mask++){apply(mask);drawFormat(mask);const score=penalty(modules);if(score<bestScore){bestScore=score;best=mask;}apply(mask);}
    apply(best);drawFormat(best);return {version,size,mask:best,modules};
  }
  function penalty(m){
    const size=m.length;let score=0,dark=0;
    const lines=[];for(let i=0;i<size;i++){lines.push(m[i]);lines.push(m.map(row=>row[i]));}
    for(const line of lines){let run=1;for(let i=1;i<=size;i++){if(i<size&&line[i]===line[i-1])run++;else{if(run>=5)score+=3+run-5;run=1;}}
      const text=line.map(v=>v?'1':'0').join('');for(const pattern of ['10111010000','00001011101'])for(let at=text.indexOf(pattern);at>=0;at=text.indexOf(pattern,at+1))score+=40;}
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){if(m[y][x])dark++;if(x<size-1&&y<size-1){const c=m[y][x];if(m[y][x+1]===c&&m[y+1][x]===c&&m[y+1][x+1]===c)score+=3;}}
    score+=Math.max(0,Math.ceil(Math.abs(dark*20-size*size*10)/(size*size))-1)*10;return score;
  }
  function matrix(text){return build(utf8(text));}
  function svg(text,options={}){
    const {size,modules}=matrix(text),quiet=4,total=size+quiet*2,ink=/^#[0-9a-f]{6}$/i.test(String(options.ink||''))?options.ink:'#111111';let path='';
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(modules[y][x])path+=`M${x+quiet} ${y+quiet}h1v1h-1z`;
    const label=String(options.label||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `<svg class="${options.className?String(options.className).replace(/[^a-z0-9 _-]/gi,''):'gh-qr'}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img"${label?` aria-label="${label}"`:''}><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="${ink}"/></svg>`;
  }
  // ZATCA phase-1 QR: TLV (tag, length, UTF-8 value) of seller, VAT number, timestamp, total with VAT, VAT, in Base64.
  function zatcaPayload({seller,vatNumber,timestamp,total,vat}){
    const bytes=[];[[1,seller],[2,vatNumber],[3,timestamp],[4,total],[5,vat]].forEach(([tag,value])=>{const data=utf8(value);if(data.length>255)throw new Error('qr-tlv-too-long');bytes.push(tag,data.length,...data);});
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return typeof btoa==='function'?btoa(binary):Buffer.from(binary,'binary').toString('base64');
  }
  const API=Object.freeze({VERSION,MAX_VERSION,matrix,svg,zatcaPayload});
  globalThis.GH_QR=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
})();
