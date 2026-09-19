const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
function setup(){
  const state={tracks:['a','b','c'].map(id=>({id,src:id})),queue:['a','b','c'],current:'a',upcoming:[],history:[],shuffle:false,repeat:0};
  const calls=[];
  const audio={paused:false,ended:false,seeking:false,switching:false,crossfading:false,readyState:4,duration:30,currentTime:20,dataset:{track:'a'},
    nextDuration:()=>30,setNext(t){this.preloaded=t?.id;},pause(){this.paused=true;},async play(){this.paused=false;},
    async switchTo(t,options){calls.push({id:t.id,...options});if(!options.valid())return false;options.commit();this.dataset.track=t.id;this.currentTime=0;return true;}};
  const context={state,audio,calls,track:(id=state.current)=>state.tracks.find(t=>t.id===id),localStorage:{setItem(){}},render(){},renderNow(){},updateTransport(){},loadingAudio:0,desktopBuffering:false,crossfadeEnabled:true,crossfadeSeconds:4,autoAttempt:'',autoStarting:false};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function play(id,'),source.indexOf('async function importMusic(')),context);return context;
}
let count=0;function check(name,condition){assert(condition,name);count++;console.log('PASS '+name);}
(async()=>{
  let t=setup();t.syncNextPreload();check('preload keeps queue and current intact',t.audio.preloaded==='b'&&t.state.current==='a'&&t.state.queue.join(',')==='a,b,c');
  await t.tryAutomaticTransition();check('no early automatic overlap',t.calls.length===0);
  t.audio.currentTime=26;await t.tryAutomaticTransition();check('configured boundary starts one automatic crossfade',t.calls.length===1&&t.calls[0].id==='b'&&t.calls[0].seconds===4&&t.state.current==='b');
  check('commit updates history and preloads following song',t.state.history.join(',')==='a'&&t.audio.preloaded==='c');
  t=setup();t.state.shuffle=true;t.state.upcoming=['c','b'];t.syncNextPreload();t.syncNextPreload();check('shuffle preload never consumes next entry',t.state.upcoming.join(',')==='c,b'&&t.audio.preloaded==='c');
  t.audio.currentTime=27;await t.tryAutomaticTransition();check('shuffle entry is consumed only after commit',t.state.current==='c'&&t.state.upcoming.join(',')==='b');
  for(const mode of ['disabled','paused','single-repeat','already-mixing']){
    t=setup();t.audio.currentTime=27;if(mode==='disabled')t.crossfadeEnabled=false;if(mode==='paused')t.audio.paused=true;if(mode==='single-repeat')t.state.repeat=2;if(mode==='already-mixing')t.audio.crossfading=true;
    await t.tryAutomaticTransition();check(mode+' blocks automatic transition',t.calls.length===0);
  }
  t=setup();t.state.current='c';t.audio.currentTime=27;await t.tryAutomaticTransition();check('end of queue stops without wrapping',t.calls.length===0);
  t.state.repeat=1;await t.tryAutomaticTransition();check('list repeat wraps through a crossfade',t.calls[0].id==='a');
  t=setup();t.state.tracks[1].missing=true;check('missing files are excluded from next candidate',t.peekNext()==='c');
  t=setup();await t.next();check('manual skip uses short fade',t.calls[0].seconds===.35);
  t=setup();t.crossfadeEnabled=false;await t.next();check('disabled transitions use immediate handoff',t.calls[0].seconds===0);
  t=setup();t.audio.nextDuration=()=>2;t.audio.currentTime=26;await t.tryAutomaticTransition();check('short next track delays overlap to safe window',t.calls.length===0);t.audio.currentTime=29;await t.tryAutomaticTransition();check('short next track transitions in its limited window',t.calls.length===1);
  t=setup();t.audio.nextDuration=()=>Infinity;t.audio.currentTime=29;await t.tryAutomaticTransition();check('unknown duration does not cut current track early',t.calls.length===0);
  t=setup();let finish;t.audio.switchTo=async(track,options)=>{t.calls.push(options);await new Promise(r=>finish=r);if(!options.valid())return false;options.commit();return true;};
  t.audio.currentTime=27;const pending=t.tryAutomaticTransition();await t.tryAutomaticTransition();check('repeated clock ticks cannot enqueue duplicate transitions',t.calls.length===1);t.state.queue=['a','c'];finish();await pending;check('queue replacement invalidates pending automatic target',t.state.current==='a');
  console.log(`${count} transition routing checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
