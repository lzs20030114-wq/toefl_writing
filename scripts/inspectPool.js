const data = JSON.parse(require('fs').readFileSync('data/buildSentence/reserve_pool.json','utf8'));
const qs = Array.isArray(data) ? data : (data.questions || []);
console.log('Total in pool:', qs.length);

const withPf = qs.filter(q => Array.isArray(q.prefilled) && q.prefilled.length > 0);
const noPf = qs.filter(q => {
  return !(Array.isArray(q.prefilled) && q.prefilled.length > 0);
});
console.log('With prefilled:', withPf.length, '('+ Math.round(withPf.length/qs.length*100) +'%)');
console.log('Without prefilled:', noPf.length);

// chunk count distribution
const dist = {};
qs.forEach(q => {
  const eff = (q.chunks||[]).filter(c=>c!==q.distractor).length;
  dist[eff] = (dist[eff]||0)+1;
});
console.log('');
console.log('Effective chunk distribution:');
Object.keys(dist).sort((a,b)=>+a-+b).forEach(k=>console.log(' ',k,'chunks:',dist[k],'qs'));

// chunk word count breakdown
let totalChunks = 0, singleWord = 0, multiWord = 0;
qs.forEach(q => {
  (q.chunks||[]).filter(c=>c!==q.distractor).forEach(c => {
    totalChunks++;
    if (c.trim().split(/\s+/).length === 1) singleWord++;
    else multiWord++;
  });
});
console.log('');
console.log('Chunk type breakdown (excl. distractor):');
console.log('  Single-word:', singleWord, '('+ Math.round(singleWord/totalChunks*100) +'%)');
console.log('  Multi-word:', multiWord, '('+ Math.round(multiWord/totalChunks*100) +'%)');

console.log('');
console.log('--- 3 WITH prefilled:');
withPf.slice(0,3).forEach(function(q,i) {
  const eff = (q.chunks||[]).filter(c=>c!==q.distractor).length;
  console.log((i+1)+'. answer:', q.answer);
  console.log('   prefilled:', JSON.stringify(q.prefilled));
  console.log('   chunks:', JSON.stringify(q.chunks));
  console.log('   eff chunks:', eff, '| ans words:', q.answer.split(/\s+/).length);
});
console.log('');
console.log('--- 3 WITHOUT prefilled:');
noPf.slice(0,3).forEach(function(q,i) {
  const eff = (q.chunks||[]).filter(c=>c!==q.distractor).length;
  console.log((i+1)+'. answer:', q.answer);
  console.log('   chunks:', JSON.stringify(q.chunks));
  console.log('   eff chunks:', eff, '| ans words:', q.answer.split(/\s+/).length);
});
