const data = JSON.parse(require('fs').readFileSync('data/buildSentence/reserve_pool.json','utf8'));
const qs = Array.isArray(data) ? data : (data.questions||[]);
const types = {}, diff = {easy:0,medium:0,hard:0};
qs.forEach(function(q) {
  types[q.answer_type] = (types[q.answer_type]||0)+1;
  const d = q._meta && q._meta.difficulty;
  if (d && diff[d] !== undefined) diff[d]++;
});
console.log('Pool:', qs.length, 'questions');
console.log('Difficulty: easy='+diff.easy+' medium='+diff.medium+' hard='+diff.hard);
console.log('Types:');
Object.entries(types).sort(function(a,b){return b[1]-a[1];}).forEach(function(e){
  console.log(' ', e[0]+':', e[1]);
});
