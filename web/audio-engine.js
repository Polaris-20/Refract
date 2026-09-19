'use strict';
// Two reusable media elements. Only this engine owns their Web Audio sources.
(() => {
  const abortError=()=>new DOMException('Playback request replaced','AbortError');
  class RefractAudioEngine extends EventTarget {
    constructor(elements){
      super();this.decks=elements.map(media=>({media,source:null,gain:null,level:0}));this.active=0;this.decks[0].level=1;
      this.context=null;this.master=null;this.analyser=null;this.graphReady=false;this.initializing=null;
      this._volume=1;this._muted=false;this.version=0;this.pending=null;this.fade=null;this.nextTrack=null;this.pump=null;
      const events=['timeupdate','loadedmetadata','durationchange','emptied','loadstart','play','playing','pause','ended','error','waiting','canplay','seeking','seeked','ratechange'];
      this.decks.forEach((deck,index)=>{
        deck.media.crossOrigin='anonymous';
        for(const name of events)deck.media.addEventListener(name,()=>{
          if(index!==this.active)return;
          if(name==='playing')this._startPump();
          if(name==='error'){this.finishTransition();this._stopPump();}
          if(name==='pause'||name==='ended')this._stopPump();
          this.dispatchEvent(new Event(name));
        });
      });
      this._syncVolume();
    }
    get media(){return this.decks[this.active].media;}
    get dataset(){return this.media.dataset;}
    get src(){return this.media.src;}
    set src(value){this.cancelPending();this.finishTransition();this._clear(this.decks[1-this.active]);this.media.src=value;}
    get currentTime(){return this.media.currentTime;}
    set currentTime(value){this.cancelPending();this.finishTransition();this.media.currentTime=value;}
    get duration(){return this.media.duration;}
    get paused(){return this.media.paused;}
    get ended(){return this.media.ended;}
    get seeking(){return this.media.seeking;}
    get readyState(){return this.media.readyState;}
    get switching(){return !!this.pending;}
    get crossfading(){return !!this.fade;}
    get volume(){return this._volume;}
    set volume(value){this._volume=Math.max(0,Math.min(1,Number(value)||0));this._syncVolume();this.dispatchEvent(new Event('volumechange'));}
    get muted(){return this._muted;}
    set muted(value){this._muted=!!value;this._syncVolume();this.dispatchEvent(new Event('volumechange'));}
    getAttribute(name){return this.media.getAttribute(name);}
    removeAttribute(name){this.cancelPending();this.finishTransition();this._clear(this.decks[1-this.active]);this.media.removeAttribute(name);if(name==='src')delete this.media.dataset.track;}
    load(){this.cancelPending();this.finishTransition();this.media.load();}
    _syncVolume(){
      const volume=this._muted?0:this._volume;
      if(this.master&&this.context){const now=this.context.currentTime;this.master.gain.cancelScheduledValues(now);this.master.gain.setTargetAtTime(volume,now,.008);}
      for(const deck of this.decks){deck.media.muted=false;deck.media.volume=deck.source?1:deck.level*volume;}
    }
    async prepare(){
      if(this.initializing)return this.initializing;
      this.initializing=(async()=>{
        try{
          const Type=globalThis.AudioContext||globalThis.webkitAudioContext;
          if(!Type)return false;
          this.context ||=new Type();
          if(this.context.state!=='running')await this.context.resume();
          if(this.context.state!=='running')return false;
          if(!this.master){
            this.mix=this.context.createGain();
            // Catch overlapping peaks without adding an extra audible output path.
            this.limiter=this.context.createDynamicsCompressor();
            this.limiter.threshold.value=-1;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.003;this.limiter.release.value=.12;
            this.master=this.context.createGain();this.master.gain.value=this._muted?0:this._volume;
            this.mix.connect(this.limiter);this.limiter.connect(this.master);this.master.connect(this.context.destination);
            this.analyser=this.context.createAnalyser();this.analyser.fftSize=4096;this.analyser.minDecibels=-85;this.analyser.maxDecibels=-20;this.analyser.smoothingTimeConstant=.65;
            this.master.connect(this.analyser);
          }
          for(const deck of this.decks){
            if(!deck.source){
              deck.gain=this.context.createGain();deck.gain.gain.value=deck.level;deck.gain.connect(this.mix);
              deck.source=this.context.createMediaElementSource(deck.media);deck.source.connect(deck.gain);
            }
          }
          this.graphReady=true;this._syncVolume();return true;
        }catch(error){
          this.graphReady=false;this._syncVolume();
          this.dispatchEvent(new CustomEvent('enginewarning',{detail:'平滑过渡暂不可用，已尝试恢复普通播放。'}));return false;
        }
      })();
      try{return await this.initializing;}finally{this.initializing=null;}
    }
    _setLevel(deck,value,smooth=false){
      deck.level=value;
      if(deck.gain&&this.context){
        const p=deck.gain.gain,now=this.context.currentTime;
        if(p.cancelAndHoldAtTime)p.cancelAndHoldAtTime(now);else p.cancelScheduledValues(now);
        if(smooth)p.linearRampToValueAtTime(value,now+.025);else p.setValueAtTime(value,now);
      }else deck.media.volume=value*(this._muted?0:this._volume);
    }
    _clear(deck){
      this._setLevel(deck,0);deck.media.pause();
      if(deck.media.getAttribute('src')){deck.media.removeAttribute('src');delete deck.media.dataset.track;deck.media.load();}
    }
    cancelPending(){
      this.version++;
      if(this.pending){this.pending.controller.abort();this.pending=null;const standby=this.decks[1-this.active];standby.media.pause();this._setLevel(standby,0);}
    }
    finishTransition(){
      if(!this.fade)return;
      const outgoing=this.fade.outgoing;this.fade=null;
      this._setLevel(this.decks[this.active],1,true);this._clear(outgoing);
      this.dispatchEvent(new Event('transitionend'));
    }
    async play(){
      this.cancelPending();const token=this.version;await this.prepare();if(token!==this.version)return false;
      if(this.decks[this.active].source&&this.context.state!=='running')throw new Error('音频设备尚未就绪，请再次点击播放。');
      this._setLevel(this.decks[this.active],1);await this.media.play();if(token!==this.version)return false;this._startPump();return true;
    }
    pause(){this.cancelPending();this.finishTransition();for(const d of this.decks)d.media.pause();this._stopPump();}
    releaseTrack(id){
      this.cancelPending();this.finishTransition();
      if(this.nextTrack?.id===id)this.nextTrack=null;
      for(const deck of this.decks)if(deck.media.dataset.track===id)this._clear(deck);
    }
    _stage(deck,track,retry=false){
      if(deck.media.dataset.track===track.id&&deck.media.getAttribute('src')===track.src&&!(retry&&deck.media.error))return;
      this._clear(deck);deck.media.preload='auto';deck.media.dataset.track=track.id;deck.media.src=track.src;deck.media.load();
    }
    setNext(track){this.nextTrack=track;this._preload();}
    _preload(){
      if(this.pending||this.fade)return;
      const deck=this.decks[1-this.active];
      if(!this.nextTrack||this.nextTrack.id===this.dataset.track){if(deck.media.getAttribute('src'))this._clear(deck);return;}
      this._stage(deck,this.nextTrack);
    }
    nextDuration(id){const d=this.decks[1-this.active].media;return d.dataset.track===id&&d.readyState>=3&&!d.error?d.duration:NaN;}
    _ready(media,signal){
      if(signal.aborted)return Promise.reject(abortError());
      if(media.error)return Promise.reject(new Error('下一首文件无法解码。'));
      if(media.readyState>=3)return Promise.resolve();
      return new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);media.removeEventListener('canplay',ok);media.removeEventListener('error',bad);signal.removeEventListener('abort',cancel);};
        const ok=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(new Error('音乐文件无法读取或解码。'));},cancel=()=>{cleanup();reject(abortError());};
        const timer=setTimeout(()=>{cleanup();reject(new Error('音乐加载超时，原歌曲继续播放。'));},15000);
        media.addEventListener('canplay',ok);media.addEventListener('error',bad);signal.addEventListener('abort',cancel,{once:true});
      });
    }
    async switchTo(track,{seconds=0,commit=()=>{},valid=()=>true}={}){
      this.cancelPending();this.finishTransition();
      const token=this.version;
      if(this.dataset.track===track.id){if(!await this.play())return false;commit();return true;}
      const incoming=this.decks[1-this.active],outgoing=this.decks[this.active],controller=new AbortController();
      const operation={controller,token};this.pending=operation;
      try{
        const graph=await this.prepare();if(token!==this.version)throw abortError();
        if(outgoing.source&&this.context.state!=='running')throw new Error('音频设备尚未就绪。');
        this._stage(incoming,track,true);this._setLevel(incoming,0);
        await this._ready(incoming.media,controller.signal);if(token!==this.version||!valid())throw abortError();
        await incoming.media.play();if(token!==this.version||!valid())throw abortError();
        const remaining=outgoing.media.duration-outgoing.media.currentTime;
        const length=graph&&!outgoing.media.paused&&!outgoing.media.ended&&outgoing.media.readyState>=3?Math.max(0,Math.min(seconds,Number.isFinite(remaining)?remaining:0,Number.isFinite(incoming.media.duration)?incoming.media.duration/2:0)):0;
        if(length>.04){
          const now=this.context.currentTime,n=65,a=new Float32Array(n),b=new Float32Array(n);
          for(let i=0;i<n;i++){const t=i/(n-1)*Math.PI/2;a[i]=Math.cos(t);b[i]=Math.sin(t);}
          for(const deck of [outgoing,incoming]){deck.gain.gain.cancelAndHoldAtTime?.(now);deck.gain.gain.cancelScheduledValues(now);}
          outgoing.gain.gain.setValueCurveAtTime(a,now,length);incoming.gain.gain.setValueCurveAtTime(b,now,length);
          this.fade={outgoing,until:now+length};
        }else{this._clear(outgoing);this._setLevel(incoming,1);}
        this.active=1-this.active;this.pending=null;commit();
        this.dispatchEvent(new CustomEvent('trackchange',{detail:{id:track.id,seconds:length}}));
        for(const name of ['loadedmetadata','timeupdate','play','playing'])this.dispatchEvent(new Event(name));
        this._startPump();return true;
      }catch(error){
        if(token===this.version){incoming.media.pause();this._setLevel(incoming,0);}
        if(error.name==='AbortError')return false;
        throw error;
      }finally{if(this.pending===operation)this.pending=null;}
    }
    _startPump(){if(!this.pump)this.pump=setInterval(()=>this._tick(),100);}
    _stopPump(){clearInterval(this.pump);this.pump=null;}
    _tick(){
      if(this.fade&&this.context.currentTime>=this.fade.until)this.finishTransition();
      if(!this.pending&&!this.fade)this._preload();
      if(!this.paused&&!this.ended)this.dispatchEvent(new Event('transitioncheck'));
    }
  }
  if(typeof module!=='undefined'){module.exports={RefractAudioEngine};return;}
  window.RefractAudio=new RefractAudioEngine([document.querySelector('#audio'),document.querySelector('#audio-next')]);
  window.addEventListener('pagehide',()=>window.RefractAudio.pause());
})();
