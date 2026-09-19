'use strict';
// Read the shared engine output; visualization never creates a second audio path.
(() => {
  const audio=window.RefractAudio;
  const surfaces=[...document.querySelectorAll('.spectrum-canvas')];
  const toggle=document.querySelector('#spectrum-enabled');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let accent='216,243,149';
  window.addEventListener('refract-theme',e=>{accent=e.detail.accent.join(',');draw();});
  const count=32,levels=new Float32Array(count);
  let context,analyser,bins,ranges=[],initializing=null,frame=0,lastFrame=0,buffering=false;
  let enabled=localStorage.getItem('refract.spectrum')!=='false';
  toggle.checked=enabled;

  function animated(){return enabled&&!document.hidden&&!reduced.matches&&!document.body.classList.contains('low-effects');}
  function visibleSurfaces(){return surfaces.filter(c=>c.clientWidth>0&&c.clientHeight>0);}
  function draw(){
    for(const canvas of visibleSurfaces()){
      const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
      const w=Math.round(width*dpr),h=Math.round(height*dpr);
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
      const ctx=canvas.getContext('2d');if(!ctx)continue;
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
      const step=width/count,bar=Math.max(1,step*.58);
      for(let i=0;i<count;i++){
        const value=levels[i],size=2+value*Math.max(0,height-4);
        ctx.fillStyle=value>.01?`rgba(${accent},${.35+value*.6})`:`rgba(${accent},.25)`;
        ctx.fillRect(i*step+(step-bar)/2,height-size,bar,size);
        if(value>.08){ctx.fillStyle=`rgb(${accent})`;ctx.fillRect(i*step+(step-bar)/2,height-size,bar,1);}
      }
    }
  }
  function stop(){cancelAnimationFrame(frame);frame=0;lastFrame=0;}
  function reset(){stop();levels.fill(0);draw();}
  function tick(now){
    frame=0;
    if(!animated()||!visibleSurfaces().length){reset();return;}
    if(now-lastFrame<1000/30){frame=requestAnimationFrame(tick);return;}
    const elapsed=lastFrame?Math.min(.1,(now-lastFrame)/1000):1/30;lastFrame=now;
    const playing=analyser&&context.state==='running'&&!audio.paused&&!audio.ended&&!buffering&&audio.readyState>=3&&!audio.muted&&audio.volume>0;
    if(playing)analyser.getByteFrequencyData(bins);
    let moving=false;
    for(let i=0;i<count;i++){
      let target=0;
      if(playing){
        const [start,end]=ranges[i];let sum=0;
        for(let j=start;j<end;j++)sum+=bins[j]*bins[j];
        target=Math.sqrt(sum/(end-start))/255;
      }
      // Fast attack and slower release preserve beats without random motion.
      levels[i]+=(target-levels[i])*(1-Math.exp(-elapsed*(target>levels[i]?24:9)));
      if(levels[i]<.002)levels[i]=0;
      moving ||=levels[i]>0;
    }
    draw();if(playing||moving)frame=requestAnimationFrame(tick);else lastFrame=0;
  }
  function wake(){
    if(!animated()){reset();return;}
    if(!frame&&visibleSurfaces().length)frame=requestAnimationFrame(tick);
  }
  function status(message){for(const canvas of surfaces)canvas.parentElement.title=message;}
  async function prepare(){
    if(!enabled)return;
    if(initializing)return initializing;
    initializing=(async()=>{
      try{
        if(!await audio.prepare())throw new Error('音频分析尚未就绪');
        context=audio.context;
        if(analyser!==audio.analyser){
          analyser=audio.analyser;bins=new Uint8Array(analyser.frequencyBinCount);
          const binHz=context.sampleRate/analyser.fftSize,top=Math.min(16000,context.sampleRate/2);
          ranges=Array.from({length:count},(_,i)=>{
            const start=Math.max(1,Math.min(bins.length-1,Math.floor(45*(top/45)**(i/count)/binHz)));
            const end=Math.max(start+1,Math.min(bins.length,Math.ceil(45*(top/45)**((i+1)/count)/binHz)));
            return [start,end];
          });
        }
        status('实时频谱 · 从左到右为低频到高频');wake();
      }catch(error){status('频谱暂不可用：'+error.message);reset();}
    })();
    try{await initializing;}finally{initializing=null;}
  }
  window.RefractSpectrum={prepare};
  toggle.addEventListener('change',()=>{
    enabled=toggle.checked;localStorage.setItem('refract.spectrum',String(enabled));
    if(enabled){void prepare();wake();}else reset();
  });
  audio.addEventListener('playing',()=>{buffering=false;void prepare();wake();});
  for(const name of ['pause','ended','waiting','error'])audio.addEventListener(name,()=>{buffering=true;wake();});
  for(const name of ['emptied','loadstart','seeking'])audio.addEventListener(name,()=>{buffering=true;reset();});
  audio.addEventListener('seeked',()=>{buffering=false;wake();});
  audio.addEventListener('canplay',()=>{buffering=false;wake();});
  audio.addEventListener('volumechange',wake);
  document.addEventListener('visibilitychange',()=>{document.hidden?reset():wake();});
  reduced.addEventListener('change',wake);
  new MutationObserver(wake).observe(document.body,{attributes:true,attributeFilter:['class']});
  const resize=new ResizeObserver(()=>{draw();wake();});surfaces.forEach(canvas=>resize.observe(canvas));
  window.addEventListener('pagehide',stop);
  draw();
})();
