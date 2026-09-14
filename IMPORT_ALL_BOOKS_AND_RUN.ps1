$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host "Running full Clovis Star corpus import..."
node scripts/ingest-books.js

Write-Host "Checking required files..."
npm run health

Write-Host "Starting account-backed Clovis Star server at http://127.0.0.1:4173"
npm run serve

