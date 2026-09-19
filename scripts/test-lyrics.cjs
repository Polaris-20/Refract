const assert=require('node:assert/strict');
const {parse,activeIndex}=require('../web/lyrics-parser.js');
const checks=[];function check(name,fn){fn();checks.push({name,passed:true});}
check('BOM CRLF and decimal precision',()=>assert.deepEqual(parse('\uFEFF[00:01.2]一\r\n[00:02.03]二\r\n[00:03.456]三').lines.map(l=>l.time),[1.2,2.03,3.456]));
check('multiple timestamps sort correctly',()=>assert.deepEqual(parse('[00:09][00:01]重复\n[00:04]中间').lines.map(l=>l.time),[1,4,9]));
check('same timestamp combines translations without repeats',()=>assert.equal(parse('[00:01]你好\n[00:01]Hello\n[00:01]你好').lines[0].text,'你好\nHello'));
check('positive offset advances and negative delays',()=>{assert.equal(parse('[00:01]甲\n[offset:500]').lines[0].time,.5);assert.equal(parse('[offset:-500]\n[00:01]甲').lines[0].time,1.5);});
check('offset preserves order before zero',()=>assert.deepEqual(parse('[offset:5000]\n[00:01]甲\n[00:02]乙').lines.map(l=>l.time),[-4,-3]));
check('metadata is excluded and plain LRC remains readable',()=>assert.deepEqual(parse('[ti:标题]\n[ar:歌手]\n无时间轴').lines,[{time:null,text:'无时间轴'}]));
check('TXT leaves all text literal',()=>assert.equal(parse('[00:01]文字\n[ar:文字]','a.TXT').lines[0].text,'[00:01]文字'));
check('empty timestamps retain instrumental gap',()=>assert.equal(parse('[00:01]甲\n[00:02]').lines[1].text,''));
check('active index handles prelude exact boundary and backwards seek',()=>{const l=parse('[00:01]甲\n[00:02]乙').lines;assert.equal(activeIndex(l,0),-1);assert.equal(activeIndex(l,2),1);assert.equal(activeIndex(l,1.1),0);});
check('malformed timestamp is plain text',()=>assert.equal(parse('[00:99]甲').timed,false));
check('enhanced LRC retains words with line timing',()=>assert.equal(parse('[00:01]<00:01.2>甲<00:02.3>乙').lines[0].text,'甲乙'));
check('HTML remains literal',()=>assert.equal(parse('[00:01]<b>甲</b>').lines[0].text,'<b>甲</b>'));
check('excessive expanded timestamps are bounded',()=>assert.throws(()=>parse('[00:01]'.repeat(10001)+'甲')));
console.log(JSON.stringify({passed:true,checks},null,2));
