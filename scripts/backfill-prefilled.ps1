# backfill-prefilled.ps1
# Adds prefilled (given word) hints to questions in questions.json.
# Length weights: 1-word ~10%, 2-word ~56%, 3-word ~34%  (from 32 TPO reference questions)
# Run: powershell -ExecutionPolicy Bypass -File scripts\backfill-prefilled.ps1

param(
    [string]$DataPath = "$PSScriptRoot\..\data\buildSentence\questions.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── constants ──────────────────────────────────────────────────────────────────

$FUNCTION_WORDS = @("the","a","an","to","of","and","or","but","from","that","this","it",
    "in","on","at","for","with","by","as","if","then","than","so","be",
    "is","are","was","were","am","do","does","did","have","has","had",
    "before","after","about","into","over","under","already","please")

$PREP_START_WORDS = @("to","in","on","at","for","with","from","about","into","over","under","before","after","by")

$FW_SET = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($w in $FUNCTION_WORDS) { [void]$FW_SET.Add($w) }

$PREP_SET = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($w in $PREP_START_WORDS) { [void]$PREP_SET.Add($w) }

# TPO-calibrated length weights
$LEN_WEIGHTS = @{ 1 = 0.10; 2 = 0.56; 3 = 0.34 }

# ── helpers ────────────────────────────────────────────────────────────────────

function Get-Words([string]$s) {
    $s = $s -replace '[.,!?;:]', ''
    return ($s.Trim() -split '\s+') | Where-Object { $_ -ne '' }
}

function Test-ValidSpan([string[]]$spanWords) {
    if ($spanWords.Count -lt 1 -or $spanWords.Count -gt 3) { return $false }
    foreach ($w in $spanWords) {
        if ($w -match '[.,!?;:]') { return $false }
    }
    if ($spanWords.Count -eq 1 -and $FW_SET.Contains($spanWords[0])) { return $false }
    if ($PREP_SET.Contains($spanWords[0])) { return $false }
    $joined = ($spanWords -join " ").ToLower()
    if ($joined -match '^(to|in|on|at|for|with|from|about|into|over|under|before|after|by)\s+(a|an|the)$') { return $false }
    return $true
}

function Get-WeightedLength([int[]]$possibleLens) {
    $total = 0.0
    foreach ($l in $possibleLens) { $total += $LEN_WEIGHTS[$l] }
    if ($total -le 0) { return $possibleLens[0] }
    $r = (Get-Random -Minimum 0.0 -Maximum $total)
    foreach ($l in $possibleLens) {
        $r -= $LEN_WEIGHTS[$l]
        if ($r -le 0) { return $l }
    }
    return $possibleLens[$possibleLens.Count - 1]
}

function Get-StartByDistribution([int]$n) {
    $maxStart = [Math]::Max(0, $n - 2)
    if ($maxStart -eq 0) { return 0 }
    $frontEnd  = [Math]::Max(0, [Math]::Floor($maxStart * 0.2))
    $backStart = [Math]::Max(0, [Math]::Floor($maxStart * 0.8))
    $front = @(); $mid = @(); $back = @()
    for ($i = 0; $i -le $maxStart; $i++) {
        if ($i -le $frontEnd)    { $front += $i }
        elseif ($i -ge $backStart) { $back += $i }
        else                      { $mid  += $i }
    }
    $roll = Get-Random -Minimum 0.0 -Maximum 1.0
    $bucket = if ($roll -lt 0.2) { $front } elseif ($roll -lt 0.8) { $mid } else { $back }
    if ($bucket.Count -eq 0) { $bucket = 0..($maxStart) }
    return $bucket[(Get-Random -Maximum $bucket.Count)]
}

function Split-Chunks([object[]]$chunks, [string]$distractor, [int]$spanStart, [int]$spanLen) {
    $distractorNorm = $distractor.Trim().ToLower()
    $wordPos = 0
    $result = [System.Collections.Generic.List[string]]::new()

    foreach ($chunk in $chunks) {
        $chunkLower = $chunk.Trim().ToLower()
        if ($chunkLower -eq $distractorNorm) {
            $result.Add($chunk)
            continue
        }

        $chunkWords = @(Get-Words $chunk)
        $chunkStart = $wordPos
        $chunkEnd   = $wordPos + $chunkWords.Count
        $wordPos    = $chunkEnd
        $spanEnd    = $spanStart + $spanLen

        if ($chunkEnd -le $spanStart -or $chunkStart -ge $spanEnd) {
            $result.Add($chunk)
        } else {
            $beforeLen = [Math]::Max(0, $spanStart - $chunkStart)
            $afterStart = [Math]::Min($chunkWords.Count, $spanEnd - $chunkStart)
            if ($beforeLen -gt 0) {
                $result.Add(($chunkWords[0..($beforeLen - 1)] -join " "))
            }
            if ($afterStart -lt $chunkWords.Count) {
                $result.Add(($chunkWords[$afterStart..($chunkWords.Count - 1)] -join " "))
            }
        }
    }
    return $result.ToArray()
}

function Add-Prefilled([hashtable]$q) {
    # Already has prefilled
    $pf = $q.prefilled
    if ($null -ne $pf -and ($pf -is [array] -or $pf -is [System.Collections.ArrayList]) -and $pf.Count -gt 0) {
        return $q
    }

    $ansWords = @(Get-Words $q.answer)
    $n = $ansWords.Count
    if ($n -lt 5) { return $q }

    $distractorNorm = if ($q.distractor) { $q.distractor.Trim().ToLower() } else { "" }

    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        $start = Get-StartByDistribution $n
        $maxLen = [Math]::Min(3, $n - $start - 1)
        if ($maxLen -lt 1) { continue }

        $possibleLens = [int[]]@()
        for ($len = 1; $len -le $maxLen; $len++) {
            $remaining = $n - $len
            if ($remaining -ge 4) { $possibleLens += $len }
        }
        if ($possibleLens.Count -eq 0) { continue }

        $len = Get-WeightedLength $possibleLens
        $span = @($ansWords[$start..($start + $len - 1)])
        $spanText = ($span -join " ").ToLower()

        if ($spanText -eq $distractorNorm) { continue }
        if (-not (Test-ValidSpan $span)) { continue }

        $newChunks = Split-Chunks $q.chunks $distractorNorm $start $len

        $q.prefilled = @($spanText)
        $q.prefilled_positions = @{ $spanText = $start }
        $q.chunks = $newChunks
        return $q
    }
    return $q
}

# ── main ───────────────────────────────────────────────────────────────────────

Write-Host "Loading $DataPath ..."
$raw = Get-Content $DataPath -Raw -Encoding UTF8
$data = $raw | ConvertFrom-Json

$modified  = 0
$skipped   = 0
$alreadyHad = 0

foreach ($set in $data.question_sets) {
    for ($i = 0; $i -lt $set.questions.Count; $i++) {
        $qObj = $set.questions[$i]
        # Convert PSCustomObject to hashtable for mutation
        $q = @{}
        $qObj.PSObject.Properties | ForEach-Object { $q[$_.Name] = $_.Value }
        # Ensure chunks is a plain array
        if ($q.chunks -is [System.Object[]]) { $q.chunks = @($q.chunks) }

        $pf = $q.prefilled
        $hasPf = ($null -ne $pf) -and (($pf -is [array] -and $pf.Count -gt 0) -or ($pf -is [string] -and $pf -ne ""))
        if ($hasPf) { $alreadyHad++; continue }

        $updated = Add-Prefilled $q

        $newPf = $updated.prefilled
        $gotPf = ($null -ne $newPf) -and ($newPf -is [array]) -and ($newPf.Count -gt 0)
        if ($gotPf) {
            # Write back
            $set.questions[$i].prefilled            = $updated.prefilled
            $set.questions[$i].prefilled_positions  = [PSCustomObject]$updated.prefilled_positions
            $set.questions[$i].chunks               = $updated.chunks
            $modified++
            Write-Host ("  + {0}: `"{1}`" @pos {2}" -f $q.id, $updated.prefilled[0], $updated.prefilled_positions[$updated.prefilled[0]])
        } else {
            Write-Warning ("  - {0}: no valid span found" -f $q.id)
            $skipped++
        }
    }
}

$data.generated_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
$json = $data | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($DataPath, $json, [System.Text.Encoding]::UTF8)

Write-Host ""
Write-Host "────────────────────────────────"
Write-Host ("Already had prefilled : {0}" -f $alreadyHad)
Write-Host ("Newly added           : {0}" -f $modified)
Write-Host ("Skipped (no span)     : {0}" -f $skipped)
Write-Host "questions.json updated."
