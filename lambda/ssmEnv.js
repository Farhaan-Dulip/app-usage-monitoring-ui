// Loads secrets from SSM Parameter Store (SecureString) into process.env at
// cold start, before application modules read their configuration.
// SSM_ENV maps env var names to parameter names, e.g.
//   {"MCP_SERVICE_TOKEN": "/usage-poc-sls/mcp-service-token"}
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

export async function loadSsmEnv(env = process.env, client = new SSMClient({})) {
  const mapping = JSON.parse(env.SSM_ENV || '{}');
  const entries = Object.entries(mapping);
  for (let index = 0; index < entries.length; index += 10) {
    const batch = entries.slice(index, index + 10);
    const { Parameters = [], InvalidParameters = [] } = await client.send(new GetParametersCommand({
      Names: batch.map(([, name]) => name),
      WithDecryption: true,
    }));
    if (InvalidParameters.length) throw new Error(`Missing SSM parameters: ${InvalidParameters.join(', ')}`);
    const values = new Map(Parameters.map((parameter) => [parameter.Name, parameter.Value]));
    batch.forEach(([key, name]) => { env[key] = values.get(name)?.trim(); });
  }
}
