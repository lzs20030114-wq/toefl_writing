# fix-prefilled-ratio.ps1
# Adjusts questions.json so ~67% of questions have prefilled (matching 40/60 TPO ratio).
# Removes prefilled from bare-pronoun-start answers first (TPO NO_GIVEN pattern),
# then randomly from others until target is met.
# When removing prefilled, words are returned to chunks array.

param(
    [string]$DataPath = "$PSScriptRoot\..\data\buildSentence\questions.json",
    [double]$TargetRatio = 0.67
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Loading $DataPath ..."
$raw = Get-Content $DataPath -Raw -Encoding UTF8
$data = $raw | ConvertFrom-Json

# Collect all questions with their set/index references
$allQ = [System.Collections.Generic.List[hashtable]]::new()
foreach ($set in $data.question_sets) {
    for ($i = 0; $i -lt $set.questions.Count; $i++) {
        $q = $set.questions[$i]
        $allQ.Add(@{
            set      = $set
            idx      = $i
            q        = $q
            answer   = [string]$q.answer
            hasPf    = ($null -ne $q.prefilled -and $q.prefilled.Count -gt 0)
        })
    }
}

$total        = $allQ.Count
$targetCount  = [int][math]::Round($total * $TargetRatio)   # 67
$currentHasPf = ($allQ | Where-Object { $_.hasPf }).Count
$needToRemove = $currentHasPf - $targetCount

Write-Host "Total: $total | Currently prefilled: $currentHasPf | Target: $targetCount | To remove: $needToRemove"

if ($needToRemove -le 0) {
    Write-Host "Already at or below target ratio. Nothing to do."
    exit
}

# Classify: bare-pronoun-start answers = TPO NO_GIVEN pattern
$BARE_PRONOUN = '^(I|She|He|They|We|It)\b'
$hasPfList = $allQ | Where-Object { $_.hasPf }
$barePronoun = @($hasPfList | Where-Object { $_.answer -match $BARE_PRONOUN })
$others      = @($hasPfList | Where-Object { $_.answer -notmatch $BARE_PRONOUN })

# Shuffle each group
$barePronoun = $barePronoun | Sort-Object { Get-Random }
$others      = $others      | Sort-Object { Get-Random }

# Select candidates to remove: bare-pronoun first, then random others
$toRemove = [System.Collections.Generic.List[hashtable]]::new()
foreach ($item in $barePronoun) {
    if ($toRemove.Count -ge $needToRemove) { break }
    $toRemove.Add($item)
}
foreach ($item in $others) {
    if ($toRemove.Count -ge $needToRemove) { break }
    $toRemove.Add($item)
}

Write-Host "Removing prefilled from $($toRemove.Count) questions ($($barePronoun.Count | ForEach-Object { [math]::Min($_, $needToRemove) }) bare-pronoun, rest random)..."

# Apply removals
foreach ($item in $toRemove) {
    $q  = $item.set.questions[$item.idx]
    $pf = [string]($q.prefilled[0])

    # Return the prefilled text as a chunk (answer words are preserved in chunks+prefilled)
    # Clone chunks and append the prefilled text
    $newChunks = [System.Collections.Generic.List[string]]::new()
    foreach ($c in $q.chunks) { $newChunks.Add([string]$c) }
    $newChunks.Add($pf)

    $item.set.questions[$item.idx].chunks               = $newChunks.ToArray()
    $item.set.questions[$item.idx].prefilled            = @()
    $item.set.questions[$item.idx].prefilled_positions  = [PSCustomObject]@{}
    Write-Host "  - $($q.id): removed `"$pf`" (answer: $($q.answer.Substring(0, [math]::Min(40,$q.answer.Length)))...)"
}

# Verify final count
$finalHasPf = 0
foreach ($set in $data.question_sets) {
    foreach ($q in $set.questions) {
        if ($q.prefilled -and $q.prefilled.Count -gt 0) { $finalHasPf++ }
    }
}

$data.generated_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
$json = $data | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($DataPath, $json, [System.Text.Encoding]::UTF8)

Write-Host ""
Write-Host "────────────────────────────────"
Write-Host "Final prefilled count : $finalHasPf / $total ($([math]::Round($finalHasPf/$total*100,0))%)"
Write-Host "Target was            : $targetCount / $total ($([int]($TargetRatio*100))%)"
Write-Host "questions.json updated."
