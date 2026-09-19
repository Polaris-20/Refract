const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
const block=source.slice(source.indexOf('function readGlassMode(){'),source.indexOf('function setGlassDepth('));
function setup(saved={}){
  const storage=new Map(Object.entries(saved)),nodes=new Map(),classes=new Set(),requests=[];
  const buttons=['off','focused','always'].map(mode=>({dataset:{glassMode:mode},setAttribute(k,v){this[k]=v;}}));
  const $=s=>{if(!nodes.has(s))nodes.set(s,{checked:false});return nodes.get(s);};
  const ctx={$, $$:()=>buttons,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    document:{body:{classList:{toggle(k,on){on?classes.add(k):classes.delete(k);}}}},safe:f=>f,
    rpc:(cmd,payload)=>new Promise(resolve=>requests.push({cmd,payload,resolve}))};
  vm.createContext(ctx);vm.runInContext(block,ctx);
  return {ctx,storage,buttons,$,classes,requests,mode:()=>buttons.find(b=>b['aria-pressed']==='true').dataset.glassMode};
}
const native=(mode='focused',extra={})=>({mode,lowEffects:false,supported:true,enabled:true,active:true,keepSupported:true,revision:1,...extra});
(async()=>{
  assert.equal(setup().mode(),'focused');
  assert.equal(setup({'refract.desktopGlass':'false'}).mode(),'off');
  assert.equal(setup({'refract.desktopGlass':'true'}).mode(),'focused');
  assert.equal(setup({'refract.glassMode':'always','refract.desktopGlass':'false'}).mode(),'always');
  assert.equal(setup({'refract.glassMode':'invalid'}).mode(),'focused');
  const t=setup();let pending=t.ctx.setGlassMode('always');
  assert.equal(t.storage.get('refract.glassMode'),'always');assert.equal(t.mode(),'always');
  assert.deepEqual(JSON.parse(JSON.stringify(t.requests[0].payload)),{mode:'always',lowEffects:false});
  t.requests.shift().resolve(native('always'));await pending;
  t.ctx.applyGlassState(native('always',{active:false,revision:2}));assert(t.classes.has('desktop-glass'));
  assert.equal(t.mode(),'always');
  t.$('#low-effects').checked=true;pending=t.ctx.syncDesktopGlass();
  t.requests.shift().resolve(native('always',{lowEffects:true,enabled:false,revision:3}));await pending;
  assert(!t.classes.has('desktop-glass'));assert.equal(t.mode(),'always');assert.equal(t.storage.get('refract.glassMode'),'always');
  t.$('#low-effects').checked=false;pending=t.ctx.syncDesktopGlass();
  t.requests.shift().resolve(native('always',{active:false,revision:4}));await pending;assert(t.classes.has('desktop-glass'));
  pending=t.ctx.setGlassMode('focused');t.requests.shift().resolve(native('focused',{revision:5}));await pending;
  t.ctx.applyGlassState(native('focused',{active:false,revision:6}));assert(t.classes.has('desktop-glass'),'inactive surface stays transparent for the DWM fade');
  const inactiveStatus=t.$('#glass-status').textContent;
  t.ctx.applyGlassState(native('focused',{enabled:false,revision:5}));assert(t.classes.has('desktop-glass'),'late reply must not detach the surface');
  assert.equal(t.$('#glass-status').textContent,inactiveStatus,'late reply must not undo newer focus status');
  t.ctx.applyGlassState(native('always',{enabled:false,revision:7}));assert(t.classes.has('desktop-glass'),'old mode event ignored');
  t.ctx.applyGlassState(native('focused',{revision:8}));assert(t.classes.has('desktop-glass'));
  const first=t.ctx.setGlassMode('always'),second=t.ctx.setGlassMode('off');
  t.requests[1].resolve(native('off',{enabled:false,revision:10}));await second;
  t.requests[0].resolve(native('always',{revision:9}));await first;
  assert.equal(t.mode(),'off');assert(!t.classes.has('desktop-glass'));
  assert.equal(setup(Object.fromEntries(t.storage)).mode(),'off','restart restores selection');
  t.ctx.applyGlassState(native('off',{supported:false,enabled:false,revision:11}));assert(t.buttons.every(b=>b.disabled));
  const f=setup({'refract.glassMode':'always'});f.ctx.applyGlassState(native('always',{active:false,keepSupported:false}));
  assert(f.$('#glass-status').textContent.includes('暂按聚焦时启动'));assert(f.classes.has('desktop-glass'),'fallback still lets DWM animate focus');
  console.log('PASS glass settings: migration, persistence, native focus events, lightweight override, stale replies, rapid selection, unsupported fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
