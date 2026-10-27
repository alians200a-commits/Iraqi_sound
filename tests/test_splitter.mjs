import assert from 'node:assert/strict';
import {splitScript} from '../public/chunker.mjs';
for(const input of [
  'شلونكم شباب؟ اليوم راح نحچي عن موضوع الكيمياء. '.repeat(70),
  'هلا والله وياكم. '.repeat(190),
  'أهلين شكو ماكو',
  '\n \n ',
]){
  const pieces=splitScript(input,170,65);
  assert(pieces.every(s=>s.length<=170 && s.length>0));
  assert.equal(pieces.join(' '),input.replace(/\s+/gu,' ').trim());
}
console.log('PASS: Iraqi Arabic splitting preserves all words, limits each segment');
