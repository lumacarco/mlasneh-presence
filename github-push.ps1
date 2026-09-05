param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryUrl
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git non trovato. Installa Git per Windows."
}

if (-not (Test-Path ".\\package.json")) {
    throw "Apri PowerShell nella cartella mlasneh-presence."
}

if (-not (Test-Path ".git")) {
    git init
}

git add .

git rev-parse --verify HEAD *> $null

if ($LASTEXITCODE -eq 0) {
    $changes = git status --porcelain

    if ($changes) {
        git commit -m "Update MLA SNEH presence service"
    }
} else {
    git commit -m "Initial MLA SNEH presence service"
}

git branch -M main

git remote get-url origin *> $null

if ($LASTEXITCODE -eq 0) {
    git remote set-url origin $RepositoryUrl
} else {
    git remote add origin $RepositoryUrl
}

git push -u origin main
