<#
Connects (or disconnects) an AI tool vendor for the portal's AI Tools page.
Until a vendor is connected the page shows sample data for it; once its admin
credential is stored, the page shows live organisation data.

  # Claude: Anthropic Console > Settings > Admin keys (sk-ant-admin...)
  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor Claude

  # Codex: OpenAI Admin console > Credentials > Admin keys, workspace-scoped,
  # with codex.enterprise.analytics.read
  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor Codex -CodexWorkspaceId <workspace id>

  # GitHub Copilot: token of an org owner/billing manager with
  # manage_billing:copilot or read:org
  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor Copilot -GithubOrg <org>

  # Back to sample data for a vendor
  powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor Copilot -Disconnect

Keys are prompted for and never printed; they pass through a temporary file
that is deleted. Other vendors' stored values are kept.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('Claude', 'Codex', 'Copilot', 'GithubOAuth')][string]$Vendor,
  # -Vendor GithubOAuth: client ID of a GitHub OAuth app (its secret is prompted),
  # enabling "Sign in with GitHub" in the portal's Connect dialog.
  [string]$GithubOAuthClientId = '',
  [string]$CodexWorkspaceId = '',
  # Override if OpenAI's reference gives a different Codex analytics route.
  [string]$CodexAnalyticsUrl = '',
  [string]$GithubOrg = '',
  # GitHub logins are not emails: "login=email,login2=email2" links Copilot seats
  # to people (tracker pages). Can be updated on its own with -Vendor Copilot.
  [string]$GithubLoginEmails = '',
  [switch]$Disconnect,
  [string]$SecretId = 'usage-poc/shared/ai-tools',
  [string]$StackName = 'UsagePocEc2',
  [string]$AwsRegion = 'us-east-1',
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'

$fields = @{
  Claude  = @('anthropicAdminKey')
  Codex   = @('codexAdminKey', 'codexWorkspaceId', 'codexAnalyticsUrl')
  Copilot = @('githubToken', 'githubOrg', 'githubLoginEmails')
  GithubOAuth = @('githubOAuthClientId', 'githubOAuthClientSecret')
}

# Current values (if the secret exists), kept for the other vendors.
$current = @{}
$existing = aws secretsmanager get-secret-value --region $AwsRegion --secret-id $SecretId --query SecretString --output text 2>$null
$secretExists = $LASTEXITCODE -eq 0
if ($secretExists -and $existing) {
  ($existing | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $current[$_.Name] = $_.Value }
}
$existing = $null

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if ($Disconnect) {
  $fields[$Vendor] | ForEach-Object { $current.Remove($_) }
} else {
  switch ($Vendor) {
    'Claude' {
      $key = Read-Secret 'Anthropic Admin API key (sk-ant-admin...)'
      if (-not $key.StartsWith('sk-ant-admin')) { throw 'That is not an Admin API key (they start with sk-ant-admin).' }
      $current.anthropicAdminKey = $key
    }
    'Codex' {
      if (-not $CodexWorkspaceId.Trim()) { throw 'Pass -CodexWorkspaceId (ChatGPT Enterprise workspace ID).' }
      $current.codexAdminKey = Read-Secret 'OpenAI Admin key with codex.enterprise.analytics.read'
      $current.codexWorkspaceId = $CodexWorkspaceId.Trim()
      if ($CodexAnalyticsUrl.Trim()) { $current.codexAnalyticsUrl = $CodexAnalyticsUrl.Trim() }
    }
    'GithubOAuth' {
      if (-not $GithubOAuthClientId.Trim()) { throw 'Pass -GithubOAuthClientId (from the GitHub OAuth app).' }
      $current.githubOAuthClientId = $GithubOAuthClientId.Trim()
      $current.githubOAuthClientSecret = Read-Secret 'GitHub OAuth app client secret'
    }
    'Copilot' {
      if ($GithubLoginEmails.Trim()) { $current.githubLoginEmails = $GithubLoginEmails.Trim() }
      if ($GithubLoginEmails.Trim() -and -not $GithubOrg.Trim() -and $current.githubToken) { break }  # mapping-only update
      if (-not $GithubOrg.Trim()) { throw 'Pass -GithubOrg (the GitHub organization that owns the Copilot subscription).' }
      $current.githubToken = Read-Secret 'GitHub token (manage_billing:copilot or read:org)'
      $current.githubOrg = $GithubOrg.Trim()
    }
  }
  if (($fields[$Vendor] | Select-Object -First 1 | ForEach-Object { $current[$_] }) -eq '') { throw 'The key is empty.' }
}

$file = Join-Path ([IO.Path]::GetTempPath()) ("ai-tools-{0}.json" -f [guid]::NewGuid())
try {
  [IO.File]::WriteAllText($file, ($current | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  $fileUri = 'file://' + ($file -replace '\\', '/')
  if ($secretExists) {
    aws secretsmanager put-secret-value --region $AwsRegion --secret-id $SecretId --secret-string $fileUri --query Name --output text | Out-Null
  } else {
    aws secretsmanager create-secret --region $AwsRegion --name $SecretId `
      --description 'Admin credentials for the AI Tools page (Claude, Codex, Copilot)' `
      --secret-string $fileUri --query Name --output text | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not store $SecretId." }
} finally {
  Remove-Item $file -Force -ErrorAction SilentlyContinue
  $current = $null
}
Write-Host ($(if ($Disconnect) { "$Vendor disconnected (sample data)." } else { "$Vendor credential stored in $SecretId." }))

if ($NoRestart) { return }
$instanceId = (aws cloudformation describe-stacks --region $AwsRegion --stack-name $StackName `
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text).Trim()
if (-not $instanceId -or $instanceId -eq 'None') { throw "Stack $StackName has no InstanceId output." }
aws ssm send-command --region $AwsRegion --instance-ids $instanceId --document-name AWS-RunShellScript `
  --parameters 'commands=["systemctl restart usage-poc.service"]' --query Command.CommandId --output text | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not send the restart command.' }
Write-Host 'Containers restarting; in about a minute open AI Tools and click Refresh.'
