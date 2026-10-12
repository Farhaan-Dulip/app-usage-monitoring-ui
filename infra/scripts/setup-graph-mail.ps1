<#
Stores the Microsoft Graph credentials for the AI agent's email intake in
Secrets Manager (usage-poc/shared/graph-mail) and restarts the EC2 stack's
containers so the agent starts watching the mailbox. See docs/email-intake.md
for what IT needs to set up first.

  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-graph-mail.ps1 `
    -TenantId <Directory (tenant) ID> -ClientId <Application (client) ID> `
    -Mailbox license-agent@alliontechnologies.com

The client secret is prompted for and never printed. It passes through a
temporary file that is deleted afterwards.
#>
param(
  [Parameter(Mandatory = $true)][string]$TenantId,
  [Parameter(Mandatory = $true)][string]$ClientId,
  [Parameter(Mandatory = $true)][string]$Mailbox,
  # Comma-separated sender domains allowed to raise requests (default: the mailbox's domain).
  [string]$AllowedSenderDomains = '',
  [string]$SecretId = 'usage-poc/shared/graph-mail',
  [string]$StackName = 'UsagePocEc2',
  [string]$AwsRegion = 'us-east-1',
  # Store the secret only; restart the containers yourself later.
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'

$secure = Read-Host 'Client secret value (from the app registration)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $clientSecret.Trim()) { throw 'The client secret is empty.' }

$value = [ordered]@{
  tenantId = $TenantId.Trim()
  clientId = $ClientId.Trim()
  clientSecret = $clientSecret.Trim()
  mailbox = $Mailbox.Trim().ToLowerInvariant()
}
if ($AllowedSenderDomains.Trim()) { $value.allowedSenderDomains = $AllowedSenderDomains.Trim().ToLowerInvariant() }

$file = Join-Path ([IO.Path]::GetTempPath()) ("graph-mail-{0}.json" -f [guid]::NewGuid())
try {
  # UTF-8 without BOM: the AWS CLI stores the file content verbatim.
  [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  $fileUri = 'file://' + ($file -replace '\\', '/')
  aws secretsmanager describe-secret --region $AwsRegion --secret-id $SecretId --query Name --output text 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    aws secretsmanager put-secret-value --region $AwsRegion --secret-id $SecretId --secret-string $fileUri --query Name --output text | Out-Null
  } else {
    aws secretsmanager create-secret --region $AwsRegion --name $SecretId `
      --description 'Microsoft Graph app credentials for the license agent mailbox' `
      --secret-string $fileUri --query Name --output text | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not store $SecretId." }
} finally {
  Remove-Item $file -Force -ErrorAction SilentlyContinue
  $clientSecret = $null
  $value = $null
}
Write-Host "Stored $SecretId (mailbox $Mailbox)."

if ($NoRestart) { return }
$instanceId = (aws cloudformation describe-stacks --region $AwsRegion --stack-name $StackName `
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text).Trim()
if (-not $instanceId -or $instanceId -eq 'None') { throw "Stack $StackName has no InstanceId output." }
Write-Host "Restarting the containers on $instanceId so the agent picks it up..."
aws ssm send-command --region $AwsRegion --instance-ids $instanceId --document-name AWS-RunShellScript `
  --parameters 'commands=["systemctl restart usage-poc.service"]' --query Command.CommandId --output text | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not send the restart command.' }
Write-Host 'Done. Within a minute the agent log (/usage-poc-ec2/agent) shows "mail-intake: watching ...".'
