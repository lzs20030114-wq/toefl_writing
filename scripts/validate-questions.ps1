# Validates that chunks + prefilled exactly reconstruct the answer for every question
$DataPath = "$PSScriptRoot\..\data\buildSentence\questions.json"
$data = Get-Content $DataPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-Words([string]$s) {
    return ($s -replace '[.,!?;:]', '' -split '\s+') | Where-Object { $_ -ne '' }
}

$errors = 0; $ok = 0

foreach ($set in $data.question_sets) {
    foreach ($q in $set.questions) {
        $ansWords  = @(Get-Words $q.answer)
        $pfWords   = @(); if ($q.prefilled -and $q.prefilled.Count -gt 0) { $pfWords = @(Get-Words $q.prefilled[0]) }
        $chunkWords = @(); foreach ($c in $q.chunks) { if ($c -ne $q.distractor) { $chunkWords += @(Get-Words $c) } }

        $allWords = ($chunkWords + $pfWords | Sort-Object) -join ' '
        $ansNorm  = ($ansWords | Sort-Object) -join ' '

        if ($allWords -ne $ansNorm) {
            Write-Host "  FAIL $($q.id): answer=[$ansNorm] vs chunks+pf=[$allWords]" -ForegroundColor Red
            $errors++
        } else { $ok++ }
    }
}

Write-Host ""
Write-Host "OK: $ok  FAIL: $errors"
