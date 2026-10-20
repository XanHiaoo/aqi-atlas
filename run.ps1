param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ReportArgs)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$candidates = @(
    (Join-Path $PSScriptRoot '.venv\Scripts\python.exe'),
    (Join-Path $PSScriptRoot '.runtime\python\python.exe')
)
$systemPython = Get-Command python -ErrorAction SilentlyContinue
if ($systemPython -and $systemPython.Source -notlike '*\WindowsApps\*') {
    $candidates += $systemPython.Source
}
$interpreter = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $interpreter) {
    throw 'Python 3.10+ is required. Install Python and run: python -m aqirec --open'
}
# The embeddable Python runtime needs an explicit project path.
& $interpreter -c "import sys; sys.path.insert(0, '.'); from aqirec.cli import main; raise SystemExit(main())" --serve --open @ReportArgs
exit $LASTEXITCODE
