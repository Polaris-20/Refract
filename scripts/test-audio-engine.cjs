'use strict';
const assert=require('node:assert/strict');
const {RefractAudioEngine}=require('../web/audio-engine.js');
if(!global.CustomEvent)global.CustomEvent=class extends Event{constructor(name,{detail}={}){super(name);this.detail=detail;}};
class Param{
  constructor(value=1){this.value=value;this.curves=[];this.calls=[];}
  cancelScheduledValues(time){this.calls.push(['cancel',time]);}
  cancelAndHoldAtTime(time){this.calls.push(['hold',time]);}
  setValueAtTime(value,time){this.value=value;this.calls.push(['set',value,time]);}
  setTargetAtTime(value,time){this.value=value;this.calls.push(['target',value,time]);}
  linearRampToValueAtTime(value,time){this.value=value;this.calls.push(['ramp',value,time]);}
  setValueCurveAtTime(values,time,duration){this.curves.push({values,time,duration});}
}
class Node{constructor(){this.gain=new Param();this.connections=[];}connect(target){this.connections.push(target);return target;}}
class Context{
  constructor(){this.state='suspended';this.currentTime=0;this.sampleRate=48000;this.destination={};this.sources=[];}
  async resume(){this.state='running';}
  createGain(){return new Node();}
  createDynamicsCompressor(){const n=new Node();for(const k of ['threshold','knee','ratio','attack','release'])n[k]=new Param();return n;}
  createAnalyser(){return Object.assign(new Node(),{frequencyBinCount:2048});}
  createMediaElementSource(media){assert(!this.sources.some(n=>n.media===media),'one source per element');const n=new Node();n.media=media;this.sources.push(n);return n;}
}
class Media extends EventTarget{
  constructor(){super();this.dataset={};this.attrs={};this.duration=30;this.currentTime=0;this.readyState=0;this.paused=true;this.ended=false;this.error=null;this.volume=1;this.muted=false;this.seeking=false;this.defer=false;this.failPlay=false;}
  get src(){return this.attrs.src||'';}set src(value){this.attrs.src=value;this.error=null;}
  getAttribute(name){return this.attrs[name]??null;}removeAttribute(name){delete this.attrs[name];}
  load(){this.currentTime=0;this.ended=false;this.readyState=this.src&&!this.defer?4:0;this.dispatchEvent(new Event(this.src?'loadedmetadata':'emptied'));if(this.readyState>=3)this.dispatchEvent(new Event('canplay'));}
  async play(){if(this.failPlay)throw new Error('decode failed');this.paused=false;this.ended=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));}
  pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'));}}
}
const intervals=new Set(),savedSet=global.setInterval,savedClear=global.clearInterval;
global.setInterval=fn=>{intervals.add(fn);return fn;};global.clearInterval=fn=>intervals.delete(fn);global.AudioContext=Context;
const song=id=>({id,src:`https://media.refract.local/audio/${id}`});
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
let count=0;function check(name,condition){assert(condition,name);count++;console.log('PASS '+name);}
(async()=>{
  let media=[new Media(),new Media()],engine=new RefractAudioEngine(media),commits=[];
  await engine.switchTo(song('a'),{commit:()=>commits.push('a')});
  check('initial playback has exactly one active deck',engine.dataset.track==='a'&&media.filter(m=>!m.paused).length===1);
  engine.setNext(song('b'));const old=engine.media;old.currentTime=26;
  check('preloading does not replace or start current song',engine.dataset.track==='a'&&media[1-engine.active].paused&&engine.nextDuration('b')===30);
  await engine.switchTo(song('b'),{seconds:4,commit:()=>commits.push('b')});
  check('crossfade runs both decks and commits incoming song once',engine.crossfading&&media.every(m=>!m.paused)&&commits.join(',')==='a,b');
  let endedEvents=0;engine.addEventListener('ended',()=>endedEvents++);old.dispatchEvent(new Event('ended'));
  check('outgoing ended event cannot skip another song',endedEvents===0);
  const a=engine.fade.outgoing.gain.gain.curves.at(-1),b=engine.decks[engine.active].gain.gain.curves.at(-1);
  check('equal power ramps preserve summed energy',a.duration===4&&a.values.every((v,i)=>Math.abs(v*v+b.values[i]*b.values[i]-1)<.000001));
  engine.volume=.3;engine.muted=true;
  check('master volume and mute cover both decks',engine.master.gain.value===0&&media.every(m=>m.volume===1));engine.muted=false;check('unmute restores selected volume',engine.master.gain.value===.3);
  const active=engine.media;engine.pause();check('pause stops both decks and cancels tail',media.every(m=>m.paused)&&!engine.crossfading);
  await engine.play();check('resume starts only incoming song',engine.media===active&&!active.paused&&media[1-engine.active].paused);
  engine.setNext(song('c'));await engine.switchTo(song('c'),{seconds:4});engine.currentTime=12;
  check('seeking cancels outgoing tail',!engine.crossfading&&media[1-engine.active].paused&&engine.currentTime===12);
  const before=engine.media;const spare=media[1-engine.active];spare.defer=true;
  const pending=engine.switchTo(song('d'),{seconds:4});await settle();engine.pause();await pending;
  check('pause during loading cannot start a stale song',engine.media===before&&media.every(m=>m.paused)&&!engine.switching);
  spare.defer=false;await engine.play();spare.failPlay=true;
  await assert.rejects(engine.switchTo(song('bad'),{seconds:4}));
  check('failed incoming playback preserves outgoing song',engine.media===before&&!before.paused&&spare.paused);spare.failPlay=false;
  const committed=engine.dataset.track;
  await engine.switchTo(song('obsolete'),{seconds:4,valid:()=>false});
  check('changed queue rejects obsolete target',engine.dataset.track===committed&&spare.paused);
  await engine.switchTo(song('e'),{seconds:.35});check('manual transition is short',engine.fade.outgoing.gain.gain.curves.at(-1).duration===.35);
  engine.setNext(null);engine.context.currentTime=2;engine._tick();check('audio clock completes fade and releases old file',!engine.crossfading&&!media[1-engine.active].getAttribute('src'));
  check('sources are reused without duplicate output paths',engine.context.sources.length===2&&engine.context.sources.every(n=>n.connections.length===1)&&engine.master.connections.filter(n=>n===engine.context.destination).length===1);
  engine.pause();media[1-engine.active].duration=2;await engine.play();await engine.switchTo(song('short'),{seconds:12});
  check('short incoming songs cap the overlap',engine.fade.outgoing.gain.gain.curves.at(-1).duration===1);
  engine.releaseTrack('short');check('tag editing releases both matching media handles',media.every(m=>m.dataset.track!=='short'));
  engine.pause();
  let resume;engine.context.state='suspended';engine.context.resume=()=>new Promise(r=>{resume=()=>{engine.context.state='running';r();};});
  const playing=engine.play();await settle();engine.pause();resume();await playing;check('pause wins over asynchronous resume',media.every(m=>m.paused));
  media=[new Media(),new Media()];engine=new RefractAudioEngine(media);await engine.switchTo(song('rapid-a'));
  const rapidCommits=[];media[1-engine.active].defer=true;
  const firstRequest=engine.switchTo(song('rapid-b'),{commit:()=>rapidCommits.push('b')});await settle();
  media[1-engine.active].defer=false;const lastRequest=engine.switchTo(song('rapid-c'),{commit:()=>rapidCommits.push('c')});
  await Promise.all([firstRequest,lastRequest]);check('rapid requests only commit the latest target',rapidCommits.join(',')==='c'&&engine.dataset.track==='rapid-c');engine.pause();
  global.AudioContext=undefined;media=[new Media(),new Media()];engine=new RefractAudioEngine(media);
  await engine.switchTo(song('plain-a'));await engine.switchTo(song('plain-b'),{seconds:4});
  check('no Web Audio falls back to single ordinary playback',!engine.crossfading&&media.filter(m=>!m.paused).length===1&&engine.media.volume===1);
  engine.pause();check('all playback timers are released',intervals.size===0);
  console.log(`${count} audio engine checks passed; no audio hardware or windows used.`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.setInterval=savedSet;global.clearInterval=savedClear;});
