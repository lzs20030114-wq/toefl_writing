const data = JSON.parse(require('fs').readFileSync('data/buildSentence/questions.json','utf8'));
const sets = data.question_sets || [];

let multiWordChunks = [], singleWordChunks = [];
sets.forEach(function(set) {
  (set.questions || []).forEach(function(q) {
    (q.chunks || []).forEach(function(c) {
      if (c === q.distractor) return;
      const w = c.trim().split(/\s+/).length;
      if (w > 1) multiWordChunks.push(c);
      else singleWordChunks.push(c);
    });
  });
});

console.log('Total effective chunks: ' + (multiWordChunks.length + singleWordChunks.length));
console.log('Multi-word: ' + multiWordChunks.length + ' (' + Math.round(multiWordChunks.length/(multiWordChunks.length+singleWordChunks.length)*100) + '%)');

const infinitives = multiWordChunks.filter(function(c){ return c.startsWith('to '); });
const auxRe = /^(had|has|have|is|was|were|been|will|would|could|should|did|does|do) /;
const auxiliaries = multiWordChunks.filter(function(c){ return auxRe.test(c); });
const others = multiWordChunks.filter(function(c){ return !c.startsWith('to ') && !auxRe.test(c); });

console.log('\nMulti-word breakdown:');
console.log('  Infinitives (to+V):', infinitives.length, '|', infinitives.join(', '));
console.log('  Auxiliaries:', auxiliaries.length, '|', auxiliaries.join(', '));
console.log('  Others:', others.length, '|', others.join(', '));

console.log('\nR value distribution:');
const rDist = {};
sets.forEach(function(set) {
  (set.questions || []).forEach(function(q) {
    const pf = Array.isArray(q.prefilled) && q.prefilled.length > 0 ? q.prefilled : null;
    const ansWords = q.answer.trim().split(/\s+/).length;
    const R = pf ? ansWords - pf.reduce(function(s,p){ return s + p.trim().split(/\s+/).length; }, 0) : ansWords;
    rDist[R] = (rDist[R]||0)+1;
  });
});
var rKeys = Object.keys(rDist).sort(function(a,b){return a-b;});
rKeys.forEach(function(r){ console.log('  R=' + r + ': ' + rDist[r] + ' items'); });

// Show questions with R>=9 (risky)
console.log('\nRisky items (R>=9):');
sets.forEach(function(set, si) {
  (set.questions || []).forEach(function(q, qi) {
    const pf = Array.isArray(q.prefilled) && q.prefilled.length > 0 ? q.prefilled : null;
    const ansWords = q.answer.trim().split(/\s+/).length;
    const R = pf ? ansWords - pf.reduce(function(s,p){ return s + p.trim().split(/\s+/).length; }, 0) : ansWords;
    if (R >= 9) {
      console.log('  S'+(si+1)+'Q'+(qi+1)+': pf='+JSON.stringify(pf)+' ans='+ansWords+'w R='+R+' | '+q.answer);
    }
  });
});
