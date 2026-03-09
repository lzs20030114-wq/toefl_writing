const data = JSON.parse(require('fs').readFileSync('data/buildSentence/questions.json','utf8'));
const sets = data.question_sets || [];

const lenDist = {1:0, 2:0, 3:0, 4:0};
let totalPf = 0, totalQ = 0;

sets.forEach(function(set, si) {
  console.log('=== Set', si+1, '===');
  (set.questions || []).forEach(function(q, qi) {
    totalQ++;
    const pf = Array.isArray(q.prefilled) && q.prefilled.length > 0 ? q.prefilled : null;
    const ansWords = q.answer ? q.answer.trim().split(/\s+/).length : 0;
    const chunks = q.chunks || [];
    const eff = chunks.filter(function(c){ return c !== q.distractor; }).length;
    const R = pf ? ansWords - pf.reduce(function(s,p){ return s + p.trim().split(/\s+/).length; }, 0) : ansWords;

    if (pf) {
      totalPf++;
      const wc = pf[0].trim().split(/\s+/).length;
      lenDist[wc] = (lenDist[wc] || 0) + 1;
      console.log(
        (qi+1) + '. pf=' + JSON.stringify(pf) + ' (' + pf[0].trim().split(/\s+/).length + 'w)',
        '| ans=' + ansWords + 'w R=' + R + ' eff=' + eff,
        '| ' + q.answer
      );
    } else {
      console.log(
        (qi+1) + '. [no prefilled]',
        '| ans=' + ansWords + 'w eff=' + eff,
        '| ' + q.answer
      );
    }
  });
  console.log('');
});

console.log('=== SUMMARY ===');
console.log('Prefilled: ' + totalPf + '/' + totalQ + ' (' + Math.round(totalPf/totalQ*100) + '%) [TPO: 67%]');
console.log('Length distribution (of prefilled items):');
var total = Object.values(lenDist).reduce(function(a,b){return a+b;},0);
[1,2,3,4].forEach(function(k){
  if(lenDist[k]) console.log('  ' + k + '-word: ' + lenDist[k] + ' (' + Math.round(lenDist[k]/total*100) + '%) [TPO: '+(k==1?'10%':k==2?'56%':'34%')+']');
});
