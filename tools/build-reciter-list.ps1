<#
.SYNOPSIS
    Builds reciters.json for the audio page (/QuranAudio/) from its reciter folders.

.DESCRIPTION
    The recitations have their own page of the site, next to this app: the
    QuranAudio folder, served at /QuranAudio/. This script scans that folder
    and writes the JSON list of the reciters for the picker in the app (and in
    its تنزيل panel). The folder name becomes the id, and the display name is
    the folder name with "-" and "_" turned into spaces.

    Run this again after adding, renaming or removing reciter folders. Each
    folder is expected to hold the ayah files as <sura><ayah>.mp3 with three
    digits each, for example 002255.mp3, plus a <sura>000.mp3 basmala file.

.PARAMETER Path
    The audio folder to scan. Defaults to the QuranAudio folder next to this
    project, which is where it sits on the domain.

.EXAMPLE
    ./tools/build-reciter-list.ps1

.EXAMPLE
    ./tools/build-reciter-list.ps1 -Path D:\sites\QuranAudio
#>
[CmdletBinding()]
param(
    [string]$Path
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$audioRoot = if ($Path) { $Path } else { Join-Path (Split-Path -Parent $root) 'QuranAudio' }
$target = Join-Path $audioRoot 'reciters.json'

if (-not (Test-Path $audioRoot)) {
    throw "The folder $audioRoot does not exist. Pass the audio folder with -Path."
}

$reciters = @(Get-ChildItem -Directory -Path $audioRoot | Sort-Object Name | ForEach-Object {
    # The file count and the total size let the app say how big a download of
    # that reciter is before it starts (see offline.js).
    $files = @(Get-ChildItem -File -Path $_.FullName)
    [pscustomobject]@{
        id    = $_.Name
        name  = ($_.Name -replace '[-_]+', ' ').Trim()
        files = $files.Count
        bytes = ($files | Measure-Object -Property Length -Sum).Sum
    }
})

if ($reciters.Count -eq 0) {
    throw "No reciter folders were found in $audioRoot."
}

$json = ConvertTo-Json -InputObject $reciters -Depth 2
[System.IO.File]::WriteAllText($target, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host ("Wrote {0} reciters to {1}" -f $reciters.Count, $target)
$reciters | ForEach-Object { Write-Host ("  {0}  ->  {1}" -f $_.id, $_.name) }
