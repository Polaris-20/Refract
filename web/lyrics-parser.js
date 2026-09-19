'use strict';
// Local LRC, TXT, JSON and SRT parsing. Times are normalized to seconds.
(function(root){
  function parse(text, name='lyrics.lrc'){
    const raw=String(text||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
    if(raw.length>10000)throw new Error('歌词行数过多。');
    if(/\.srt$/i.test(name))return parseSrt(raw.join('\n'));
    if(/\.json$/i.test(name))return parseJson(raw.join('\n'));
    if(/\.txt$/i.test(name))return {timed:false,lines:raw.filter(x=>x.trim()).map(text=>({time:null,text}))};
    let offset=0;const entries=[],plain=[];
    for(const line of raw){
      const adjustment=line.match(/^\s*\[offset:([+-]?\d+)\]\s*$/i);
      if(adjustment){offset=Number(adjustment[1])/1000;continue;}
      if(/^\s*(?:\[[a-z]+:[^\]]*\]\s*)+$/i.test(line))continue;
      const tags=[...line.matchAll(/\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]/g)];
      if(!tags.length){if(line.trim())plain.push({time:null,text:line});continue;}
      const content=line.replace(/\[\d+:[0-5]\d(?:\.\d{1,3})?\]/g,'').replace(/<\d+:[0-5]\d(?:\.\d{1,3})?>/g,'').trim();
      for(const tag of tags){
        if(entries.length>=10000)throw new Error('歌词时间标记过多。');
        entries.push({time:Number(tag[1])*60+Number(tag[2])+Number('0.'+(tag[3]||'0')),text:content});
      }
    }
    if(!entries.length)return {timed:false,lines:plain};
    entries.sort((a,b)=>a.time-b.time);
    const lines=[];
    for(const entry of entries){
      const time=entry.time-offset,last=lines.at(-1);
      if(last&&Math.abs(last.time-time)<.00001){if(entry.text&&!last.text.split('\n').includes(entry.text))last.text=[last.text,entry.text].filter(Boolean).join('\n');}
      else lines.push({time,text:entry.text});
    }
    return {timed:true,lines};
  }
  function lastStarted(lines,time){let low=0,high=lines.length;while(low<high){const mid=(low+high)>>>1;if(lines[mid].time<=time)low=mid+1;else high=mid;}return low-1;}

  function timestamp(value,unit='s'){
    if(typeof value==='string'&&value.includes(':')){
      const match=value.trim().match(/^(?:(\d+):)?(\d+):([0-5]\d)(?:[.,](\d{1,3}))?$/);
      if(!match||(match[1]!==undefined&&Number(match[2])>=60))throw new Error('时间应为秒数或 00:00:01.500 这样的时间码。');
      const seconds=Number(match[1]||0)*3600+Number(match[2])*60+Number(match[3])+Number('0.'+(match[4]||'0'));
      if(!Number.isFinite(seconds)||seconds>Number.MAX_SAFE_INTEGER)throw new Error('时间码数值过大。');
      return seconds;
    }
    if(!(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())))throw new Error('歌词时间必须是有效数字。');
    const number=Number(value)/(unit==='ms'?1000:1);
    if(!Number.isFinite(number)||number<0||number>Number.MAX_SAFE_INTEGER)throw new Error('歌词时间必须是有限的非负数。');
    return number;
  }
  function normalize(entries){
    if(!entries.length||!entries.some(l=>l.text.trim()))throw new Error('没有找到歌词正文。');
    if(entries.length>10000)throw new Error('歌词最多支持 10000 条。');
    entries.sort((a,b)=>a.time-b.time);
    // Merge bilingual cues only when their full intervals match.
    const lines=[],seen=new Map();
    for(const entry of entries){
      const key=entry.time+':'+(entry.end??''),previous=seen.get(key);
      if(previous){if(!previous.text.split('\n').includes(entry.text))previous.text+='\n'+entry.text;}
      else{lines.push(entry);seen.set(key,entry);}
    }
    return {timed:true,lines};
  }
  function parseSrt(text){
    const blocks=text.trim().split(/\n[ \t]*\n+/),entries=[];
    for(let i=0;i<blocks.length;i++){
      const lines=blocks[i].trim().split('\n');if(/^\d+$/.test(lines[0]))lines.shift();
      const timing=lines.shift()?.match(/^(\d{2,}:[0-5]\d:[0-5]\d[,.]\d{3})\s*-->\s*(\d{2,}:[0-5]\d:[0-5]\d[,.]\d{3})\s*$/);
      if(!timing)throw new Error(`SRT 第 ${i+1} 段时间格式不正确，请使用 00:00:01,000 --> 00:00:03,000。`);
      const time=timestamp(timing[1]),end=timestamp(timing[2]);
      if(end<=time)throw new Error(`SRT 第 ${i+1} 段结束时间必须晚于开始时间。`);
      // Render basic styling as plain text; never insert subtitle markup into HTML.
      const content=lines.join('\n').replace(/<\/?(?:b|i|u|s|font)(?:\s[^>]*)?>/gi,'').trim();
      if(!content)throw new Error(`SRT 第 ${i+1} 段缺少歌词正文。`);
      entries.push({time,end,text:content});
    }
    return normalize(entries);
  }
  function parseJson(text){
    let value;try{value=JSON.parse(text);}catch{throw new Error('JSON 格式不正确，请检查引号、逗号和括号。');}
    let unit='s',rows=null,embedded=null;
    for(let depth=0;depth<5;depth++){
      if(Array.isArray(value)){rows=value;break;}
      if(typeof value==='string'){embedded=value;break;}
      if(!value||typeof value!=='object')break;
      const declared=value.timeUnit??value.unit;
      if(declared!==undefined){
        if(['ms','millisecond','milliseconds'].includes(declared))unit='ms';
        else if(['s','second','seconds'].includes(declared))unit='s';
        else throw new Error('JSON timeUnit 只支持 s（秒）或 ms（毫秒）。');
      }
      const next=['lines','segments','subtitles','body','lyrics','lrc','lyric','data'].find(k=>value[k]!==undefined&&value[k]!==null);
      if(!next)break;value=value[next];
    }
    if(embedded!==null){
      const result=parse(embedded,'embedded.lrc');
      if(!result.lines.some(l=>l.text.trim()))throw new Error('JSON 内没有可用的歌词正文。');
      return result;
    }
    if(!rows)throw new Error('未识别这个 JSON 结构。支持 time/text 数组、lines/lyrics/segments/body 数组，或 lrc.lyric 中的歌词。');
    if(!rows.length||rows.length>10000)throw new Error('JSON 歌词应包含 1–10000 条。');
    const pick=(row,keys)=>keys.find(k=>row[k]!==undefined&&row[k]!==null);
    const parsed=rows.map((row,i)=>{
      if(typeof row==='string')return {time:null,text:row};
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error(`JSON 第 ${i+1} 条应为歌词对象。`);
      const textKey=pick(row,['text','content','words','lyric','lyrics','sentence']);
      if(!textKey||typeof row[textKey]!=='string'||!row[textKey].trim())throw new Error(`JSON 第 ${i+1} 条缺少 text、content 或 words 文本。`);
      const translation=row.translation;
      if(translation!==undefined&&typeof translation!=='string')throw new Error(`JSON 第 ${i+1} 条 translation 应为文本。`);
      const text=[row[textKey],translation].filter(Boolean).join('\n');
      const startKey=pick(row,['startTimeMs','startMs','timeMs','time','start','startTime','timestamp','from']);
      const endKey=pick(row,['endTimeMs','endMs','end','endTime','to']);
      const durationKey=pick(row,['durationMs','duration']);
      if(!startKey){if(endKey||durationKey)throw new Error(`JSON 第 ${i+1} 条缺少开始时间。`);return {time:null,text};}
      const time=timestamp(row[startKey],/Ms$/.test(startKey)?'ms':unit);
      let end;
      // Spotify exports often use endTimeMs: "0" for unspecified line endings.
      if(endKey&&!(textKey==='words'&&endKey==='endTimeMs'&&String(row[endKey])==='0'))end=timestamp(row[endKey],/Ms$/.test(endKey)?'ms':unit);
      else if(durationKey)end=time+timestamp(row[durationKey],durationKey==='durationMs'?'ms':unit);
      if(end!==undefined&&end<=time)throw new Error(`JSON 第 ${i+1} 条结束时间必须晚于开始时间。`);
      return end===undefined?{time,text}:{time,end,text};
    });
    const timed=parsed.filter(l=>l.time!==null).length;
    if(timed&&timed!==parsed.length)throw new Error('JSON 的时间不完整：请为每条歌词提供时间，或全部使用纯文本。');
    if(timed)return normalize(parsed);
    const lines=parsed.filter(l=>l.text.trim());if(!lines.length)throw new Error('JSON 没有歌词正文。');
    return {timed:false,lines};
  }
  function activeIndices(lines,time){
    const latest=lastStarted(lines,time),result=[];
    for(let i=0;i<=latest;i++){
      const line=lines[i];
      if(line.end!==undefined?time<line.end:i===latest||line.time===lines[latest].time)result.push(i);
    }
    return result;
  }
  function activeIndex(lines,time){return activeIndices(lines,time).at(-1)??-1;}
  const api={parse,activeIndex,activeIndices};if(typeof module!=='undefined')module.exports=api;else root.RefractLyrics=api;
})(globalThis);
