'use strict';
(() => {
  const fallback={accent:[216,243,149],tint:[101,114,90]};
  function palette(pixels){
    const bins=new Map();
    for(let i=0;i<pixels.length;i+=4){
      const [r,g,b,a]=pixels.slice(i,i+4),hi=Math.max(r,g,b),lo=Math.min(r,g,b);
      if(a<160||hi<32||lo>238||hi-lo<20)continue;
      const key=(r>>5)*64+(g>>5)*8+(b>>5),weight=(hi-lo)/255+.3;
      const bin=bins.get(key)||{weight:0,r:0,g:0,b:0};bin.weight+=weight;bin.r+=r*weight;bin.g+=g*weight;bin.b+=b*weight;bins.set(key,bin);
    }
    const best=[...bins.values()].sort((a,b)=>b.weight-a.weight)[0];
    if(!best)return fallback;
    const rgb=[best.r,best.g,best.b].map(v=>v/best.weight),hi=Math.max(...rgb),lo=Math.min(...rgb),delta=hi-lo;
    let h=hi===rgb[0]?((rgb[1]-rgb[2])/delta)%6:hi===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4;
    h=(h*60+360)%360;
    function hsl(s,l){const a=s*Math.min(l,1-l);return [0,8,4].map(n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))));});}
    return {accent:hsl(.65,.77),tint:hsl(.38,.38)};
  }
  if(typeof module!=='undefined'){module.exports={palette,fallback};return;}
  let enabled=localStorage.getItem('refract.coverColors')!=='false',generation=0,lastUrl='';
  const cache=new Map(),toggle=document.querySelector('#cover-colors');toggle.checked=enabled;
  function apply(value){
    document.body.style.setProperty('--accent',`rgb(${value.accent})`);
    document.body.style.setProperty('--accent-rgb',value.accent.join(','));
    document.body.style.setProperty('--tint',`rgb(${value.tint})`);
    window.dispatchEvent(new CustomEvent('refract-theme',{detail:value}));
  }
  async function update(url=''){
    lastUrl=url;const token=++generation;
    if(!enabled||!url){apply(fallback);return;}
    if(cache.has(url)){apply(cache.get(url));return;}
    // Keep the old palette until the new image is ready, then interpolate the colors.
    try{
      const image=new Image();image.crossOrigin='anonymous';image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,32,32);
      const value=palette(ctx.getImageData(0,0,32,32).data);
      if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(url,value);
      if(token===generation&&enabled)apply(value);
    }catch{if(token===generation)apply(fallback);}
  }
  toggle.onchange=()=>{enabled=toggle.checked;localStorage.setItem('refract.coverColors',enabled);void update(lastUrl);};
  window.RefractColors={update};
})();
