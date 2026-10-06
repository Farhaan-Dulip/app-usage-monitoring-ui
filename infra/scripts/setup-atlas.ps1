<#
Creates the POC MongoDB Atlas cluster and stores its connection string in AWS
Secrets Manager. Run it in a terminal where `atlas auth login` and the AWS CLI
are both signed in:

  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-atlas.ps1

After a redeploy of the Docker stack (new NAT IP), allow the new IP only:

  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-atlas.ps1 -AccessListOnly -NatIp <NatPublicIp output>

The single-server EC2 stack keeps its own entry (a separate comment, so the
two deployments do not remove each other's IP):

  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-atlas.ps1 -AccessListOnly -NatIp <PublicIp output> -Comment 'usage-poc EC2 instance'

Idempotent: reuses the project, cluster, access-list entry and database user
if they already exist (the user's password is rotated and re-stored).
The database password and connection string are never printed.
#>
param(
  [string]$ProjectName = 'usage-poc',
  [string]$ClusterName = 'usage-poc',
  [string]$AtlasRegion = 'US_EAST_1',
  [string]$NatIp = '3.221.132.92',
  [string]$DbUser = 'usage-poc-app',
  [string]$Database = 'app-usage-monitoring',
  [string]$SecretId = 'usage-poc/shared/mongo-uri',
  [string]$AwsRegion = 'us-east-1',
  # Only update the IP access list (keep the database user and stored secret).
  [switch]$AccessListOnly,
  # Access-list entry label; old IPs are replaced only within the same label.
  [string]$Comment = 'usage-poc AWS NAT gateway'
)
$accessComment = $Comment

$ErrorActionPreference = 'Stop'
$atlas = 'C:\Program Files (x86)\MongoDB Atlas CLI\atlas.exe'

function Invoke-Atlas {
  param([string[]]$Arguments, [switch]$AllowFailure)
  # Windows PowerShell 5.1 turns native stderr into errors under 'Stop'; check exit codes instead.
  $ErrorActionPreference = 'Continue'
  $output = & $atlas @Arguments -o json 2>&1
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
    throw "atlas $($Arguments[0..1] -join ' ') failed: $output"
  }
  if ($LASTEXITCODE -ne 0) { return $null }
  $text = ($output | Out-String).Trim()
  if ($text) { return $text | ConvertFrom-Json }
  return $null
}

Write-Host "Checking Atlas login..."
& $atlas auth whoami
if ($LASTEXITCODE -ne 0) { throw 'Not logged in. Run: atlas auth login' }

# Project ------------------------------------------------------------------
$project = (Invoke-Atlas @('projects', 'list')).results | Where-Object { $_.name -eq $ProjectName } | Select-Object -First 1
if (-not $project) {
  $org = (Invoke-Atlas @('organizations', 'list')).results | Select-Object -First 1
  if (-not $org) { throw 'No Atlas organization found for this account.' }
  Write-Host "Creating project '$ProjectName' in organization '$($org.name)'..."
  $project = Invoke-Atlas @('projects', 'create', $ProjectName, '--orgId', $org.id)
}
$projectId = $project.id
Write-Host "Project: $ProjectName ($projectId)"

# Cluster (free M0 on AWS) ---------------------------------------------------
$cluster = Invoke-Atlas @('clusters', 'describe', $ClusterName, '--projectId', $projectId) -AllowFailure
if (-not $cluster) {
  Write-Host "Creating free M0 cluster '$ClusterName' in AWS $AtlasRegion (takes a few minutes)..."
  Invoke-Atlas @('clusters', 'create', $ClusterName, '--projectId', $projectId,
    '--provider', 'AWS', '--region', $AtlasRegion, '--tier', 'M0') | Out-Null
}
$ErrorActionPreference = 'Continue'
& $atlas clusters watch $ClusterName --projectId $projectId
$watchExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($watchExit -ne 0) { throw 'Cluster did not become ready.' }

# Network access: only the current POC NAT gateway -----------------------
$entries = (Invoke-Atlas @('accessLists', 'list', '--projectId', $projectId)).results
if (-not ($entries | Where-Object { $_.ipAddress -eq $NatIp })) {
  Write-Host "Allowing $NatIp ($accessComment)..."
  Invoke-Atlas @('accessLists', 'create', $NatIp, '--type', 'ipAddress',
    '--projectId', $projectId, '--comment', $accessComment) | Out-Null
}
# Remove NAT IPs from earlier deployments (only entries this script created).
$entries | Where-Object { $_.comment -eq $accessComment -and $_.ipAddress -and $_.ipAddress -ne $NatIp } | ForEach-Object {
  Write-Host "Removing old IP $($_.ipAddress) ($accessComment)..."
  Invoke-Atlas @('accessLists', 'delete', $_.ipAddress, '--projectId', $projectId, '--force') -AllowFailure | Out-Null
}
if ($AccessListOnly) {
  Write-Host ''
  Write-Host "Done. Atlas now allows $NatIp."
  return
}

# Database user with a generated password ------------------------------------
$chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

$existingUser = Invoke-Atlas @('dbusers', 'describe', $DbUser, '--projectId', $projectId) -AllowFailure
if ($existingUser) {
  Write-Host "Rotating password for database user '$DbUser'..."
  Invoke-Atlas @('dbusers', 'update', $DbUser, '--projectId', $projectId, '--password', $password,
    '--role', "readWrite@$Database", '--scope', $ClusterName) | Out-Null
} else {
  Write-Host "Creating database user '$DbUser' (readWrite on $Database only)..."
  Invoke-Atlas @('dbusers', 'create', '--username', $DbUser, '--password', $password,
    '--role', "readWrite@$Database", '--scope', $ClusterName, '--projectId', $projectId) | Out-Null
}

# Connection string -> AWS Secrets Manager -----------------------------------
$strings = Invoke-Atlas @('clusters', 'connectionStrings', 'describe', $ClusterName, '--projectId', $projectId)
$srvHost = ($strings.standardSrv -replace '^mongodb\+srv://', '').TrimEnd('/')
if (-not $srvHost) { throw 'Could not read the cluster connection string.' }
$uri = "mongodb+srv://${DbUser}:${password}@${srvHost}/?retryWrites=true&w=majority&appName=usage-poc"

$tempFile = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($tempFile, $uri)
  & aws secretsmanager put-secret-value --region $AwsRegion --secret-id $SecretId --secret-string "file://$tempFile" --query VersionId --output text | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Storing the connection string in $SecretId failed." }
} finally {
  Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
  $password = $null; $uri = $null
}

Write-Host ""
Write-Host "Done. Cluster host: $srvHost"
Write-Host "Connection string stored in AWS Secrets Manager secret '$SecretId' ($AwsRegion)."
