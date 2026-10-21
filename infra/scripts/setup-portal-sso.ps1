<#
Stores the Microsoft Entra ID app behind "Sign in with Microsoft" on the
AllionOne portal in Secrets Manager (usage-poc/shared/portal-sso) and restarts
the EC2 stack's containers so the button appears on the sign-in page.

First, in the Entra admin center (App registrations), on the app you use:
  - Authentication > Add a platform > Web, Redirect URI = the stack output
    PortalSsoRedirectUri (https://<portal>/api/auth/microsoft/callback)
  - Certificates & secrets: a client secret
  - API permissions: Microsoft Graph delegated openid, profile, email
    (User.Read is added by default and is fine)

  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-portal-sso.ps1 `
    -TenantId <Directory (tenant) ID> -ClientId <Application (client) ID>

The client secret is prompted for and never printed. It passes through a
temporary file that is deleted afterwards. -Disconnect removes the secret
(the portal goes back to access-code sign-in only).
#>
param(
  [string]$TenantId = '',
  [string]$ClientId = '',
  [string]$SecretId = 'usage-poc/shared/portal-sso',
  [string]$StackName = 'UsagePocEc2',
  [string]$AwsRegion = 'us-east-1',
  [switch]$Disconnect,
  # Store the secret only; restart the containers yourself later.
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'

if ($Disconnect) {
  aws secretsmanager delete-secret --region $AwsRegion --secret-id $SecretId --force-delete-without-recovery --query Name --output text | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not delete $SecretId." }
  Write-Host "Deleted $SecretId."
} else {
  if (-not $TenantId.Trim() -or -not $ClientId.Trim()) { throw '-TenantId and -ClientId are required.' }
  $secure = Read-Host 'Client secret value (from the app registration)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (-not $clientSecret.Trim()) { throw 'The client secret is empty.' }

  $value = [ordered]@{ tenantId = $TenantId.Trim(); clientId = $ClientId.Trim(); clientSecret = $clientSecret.Trim() }
  $file = Join-Path ([IO.Path]::GetTempPath()) ("portal-sso-{0}.json" -f [guid]::NewGuid())
  try {
    # UTF-8 without BOM: the AWS CLI stores the file content verbatim.
    [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
    $fileUri = 'file://' + ($file -replace '\\', '/')
    aws secretsmanager describe-secret --region $AwsRegion --secret-id $SecretId --query Name --output text 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      aws secretsmanager put-secret-value --region $AwsRegion --secret-id $SecretId --secret-string $fileUri --query Name --output text | Out-Null
    } else {
      aws secretsmanager create-secret --region $AwsRegion --name $SecretId `
        --description 'Entra ID app for Sign in with Microsoft on the portal' `
        --secret-string $fileUri --query Name --output text | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not store $SecretId." }
  } finally {
    Remove-Item $file -Force -ErrorAction SilentlyContinue
    $clientSecret = $null
    $value = $null
  }
  Write-Host "Stored $SecretId."
}

if ($NoRestart) { return }
$instanceId = (aws cloudformation describe-stacks --region $AwsRegion --stack-name $StackName `
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text).Trim()
if (-not $instanceId -or $instanceId -eq 'None') { throw "Stack $StackName has no InstanceId output." }
Write-Host "Restarting the containers on $instanceId..."
aws ssm send-command --region $AwsRegion --instance-ids $instanceId --document-name AWS-RunShellScript `
  --parameters 'commands=["systemctl restart usage-poc.service"]' --query Command.CommandId --output text | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not send the restart command.' }
Write-Host 'Done. In about a minute the sign-in page shows "Sign in with Microsoft".'
