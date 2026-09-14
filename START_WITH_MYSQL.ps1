$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$env:CLOVIS_STORAGE = "mysql"
$env:CLOVIS_DB_HOST = "clovisstar.com"
$env:CLOVIS_DB_NAME = "clovisstar_script101ab"
$env:CLOVIS_DB_USER = "clovisstar_92scripts101"

$securePassword = Read-Host "Enter Clovis Star app database password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:CLOVIS_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

npm install
npm run db:init
npm run serve

