$data = Get-Content 'D:/toefl_writing/toefl_writing/data/buildSentence/questions.json' -Raw | ConvertFrom-Json
$total = 0; $hasPf = 0
foreach ($set in $data.question_sets) {
  foreach ($q in $set.questions) {
    $total++
    if ($q.prefilled -and $q.prefilled.Count -gt 0) { $hasPf++ }
  }
}
Write-Host "Total: $total, HasPrefilled: $hasPf, Ratio: $([math]::Round($hasPf/$total*100,0))%"
