import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface UsagePocServerlessStackProps extends cdk.StackProps {
  portalRepoPath: string;
  agentRepoPath: string;
  /** Prefix of the SecureString parameters created by scripts/setup-serverless-secrets.sh. */
  parameterPrefix: string;
}

// Optional MongoDB driver add-ons the portal never loads; keep them out of the bundle.
const MONGODB_OPTIONAL_MODULES = [
  'kerberos', '@mongodb-js/zstd', 'snappy', 'aws4', 'mongodb-client-encryption',
  'gcp-metadata', 'socks', '@aws-sdk/credential-providers',
];

/**
 * Pay-per-use variant of the POC. Nothing here bills by the hour:
 * Amplify Hosting (UI) -> Lambda function URLs (portal API, AI agent, telemetry
 * ingest) -> DynamoDB on-demand. Secrets live in SSM Parameter Store.
 */
export class UsagePocServerlessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: UsagePocServerlessStackProps) {
    super(scope, id, props);
    const prefix = props.parameterPrefix.replace(/\/$/, '');
    const parameter = (name: string) => `${prefix}/${name}`;

    // ------------------------------------------------------------------- data
    const portalTable = new dynamodb.TableV2(this, 'PortalTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const telemetryTable = new dynamodb.TableV2(this, 'TelemetryTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'expires_at',
      globalSecondaryIndexes: [{
        indexName: 'byReceived',
        partitionKey: { name: 'gpk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'gsk', type: dynamodb.AttributeType.STRING },
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -------------------------------------------------------------- functions
    // Parameter ARNs are built from names (not resource references) so functions
    // can read values written later by other resources without dependency cycles.
    const readParameters = new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: `${prefix.replace(/^\//, '')}/*` })],
    });
    const decryptParameters = new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
    });

    const nodeFunction = (id: string, options: {
      entry: string; projectRoot: string; memorySize: number; timeout: cdk.Duration;
      environment: Record<string, string>; description: string;
    }) => {
      const fn = new NodejsFunction(this, id, {
        entry: options.entry,
        projectRoot: options.projectRoot,
        depsLockFilePath: path.join(options.projectRoot, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: options.memorySize,
        timeout: options.timeout,
        description: options.description,
        environment: { NODE_ENV: 'production', ...options.environment },
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        bundling: {
          format: OutputFormat.ESM,
          target: 'node22',
          mainFields: ['module', 'main'],
          // CommonJS dependencies (express, ...) need `require` inside an ESM bundle.
          banner: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
          externalModules: ['@aws-sdk/*', ...MONGODB_OPTIONAL_MODULES],
          minify: true,
          sourceMap: false,
        },
      });
      fn.addToRolePolicy(readParameters);
      fn.addToRolePolicy(decryptParameters);
      return fn;
    };

    const dataEnvironment = {
      DATA_STORE: 'dynamodb',
      PORTAL_TABLE: portalTable.tableName,
      TELEMETRY_TABLE: telemetryTable.tableName,
      TELEMETRY_RETENTION_DAYS: '30',
      APP_TIME_ZONE: 'Asia/Colombo',
    };

    const portalFn = nodeFunction('PortalApi', {
      entry: path.join(props.portalRepoPath, 'lambda', 'portal.js'),
      projectRoot: props.portalRepoPath,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      description: 'usage-poc portal API (Express on Lambda, DynamoDB)',
      environment: {
        ...dataEnvironment,
        ASSISTANT_AGENT_TIMEOUT_MS: '25000',
        SSM_ENV: JSON.stringify({
          MCP_SERVICE_TOKEN: parameter('mcp-service-token'),
          ASSISTANT_AGENT_URL: parameter('agent-url'),
          CORS_ORIGIN: parameter('portal-origin'),
        }),
      },
    });
    portalTable.grantReadWriteData(portalFn);
    telemetryTable.grantReadWriteData(portalFn);
    const portalUrl = portalFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const ingestFn = nodeFunction('TelemetryIngest', {
      entry: path.join(props.portalRepoPath, 'lambda', 'ingest.js'),
      projectRoot: props.portalRepoPath,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      description: 'usage-poc Tracker telemetry ingest over HTTPS',
      environment: {
        ...dataEnvironment,
        SSM_ENV: JSON.stringify({ INGEST_TOKEN: parameter('ingest-token') }),
      },
    });
    telemetryTable.grantWriteData(ingestFn);
    const ingestUrl = ingestFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const agentFn = nodeFunction('AiAgent', {
      entry: path.join(props.agentRepoPath, 'lambda.js'),
      projectRoot: props.agentRepoPath,
      memorySize: 512,
      timeout: cdk.Duration.seconds(25),
      description: 'usage-poc AI agent (OpenAI tool loop over portal MCP endpoints)',
      environment: {
        PORTAL_API_URL: portalUrl.url,
        OPENAI_MODEL: 'gpt-5-mini',
        AGENT_DEADLINE_MS: '20000',
        PORTAL_TOOL_TIMEOUT_MS: '8000',
        SSM_ENV: JSON.stringify({
          OPENAI_API_KEY: parameter('openai-api-key'),
          MCP_SERVICE_TOKEN: parameter('mcp-service-token'),
        }),
      },
    });
    const agentUrl = agentFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    new ssm.StringParameter(this, 'AgentUrlParameter', {
      parameterName: parameter('agent-url'),
      stringValue: `${agentUrl.url}api/assistant/chat`,
      description: 'AI agent chat endpoint read by the portal function at cold start',
    });

    // ---------------------------------------------------------------- hosting
    const basicAuth = new secretsmanager.Secret(this, 'PortalBasicAuth', {
      description: 'usage-poc serverless portal password (Amplify basic auth, user usage-poc)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'usage-poc' }),
        generateStringKey: 'password',
        passwordLength: 24,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const app = new amplify.CfnApp(this, 'PortalApp', {
      name: 'usage-poc-serverless',
      platform: 'WEB',
      description: 'usage-poc portal UI (pay-per-use deployment)',
      customRules: [
        // Same-origin API: Amplify proxies /api/* to the portal function URL.
        { source: '/api/<*>', target: `${portalUrl.url}api/<*>`, status: '200' },
        { source: '/health', target: `${portalUrl.url}health`, status: '200' },
        // Single-page app: everything that is not a static file serves index.html.
        {
          source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>',
          target: '/index.html',
          status: '200',
        },
      ],
    });
    const branch = new amplify.CfnBranch(this, 'PortalBranch', {
      appId: app.attrAppId,
      branchName: 'main',
      stage: 'PRODUCTION',
      enableAutoBuild: false,
      basicAuthConfig: {
        enableBasicAuth: true,
        username: 'usage-poc',
        password: basicAuth.secretValueFromJson('password').unsafeUnwrap(),
      },
    });
    const portalOrigin = `https://${branch.branchName}.${app.attrDefaultDomain}`;
    new ssm.StringParameter(this, 'PortalOriginParameter', {
      parameterName: parameter('portal-origin'),
      stringValue: portalOrigin,
      description: 'Browser origin of the Amplify-hosted portal (CORS allow-list)',
    });

    // ---------------------------------------------------------------- outputs
    new cdk.CfnOutput(this, 'PortalUrl', { value: portalOrigin });
    new cdk.CfnOutput(this, 'PortalLogin', {
      value: `user usage-poc; password in Secrets Manager ${basicAuth.secretName} (key "password")`,
    });
    new cdk.CfnOutput(this, 'AmplifyAppId', { value: app.attrAppId });
    new cdk.CfnOutput(this, 'AmplifyBranch', { value: branch.branchName });
    new cdk.CfnOutput(this, 'IngestUrl', { value: ingestUrl.url });
    new cdk.CfnOutput(this, 'IngestTokenParameter', { value: parameter('ingest-token') });
    new cdk.CfnOutput(this, 'PortalApiUrl', { value: portalUrl.url });
    new cdk.CfnOutput(this, 'PortalTableName', { value: portalTable.tableName });
    new cdk.CfnOutput(this, 'TelemetryTableName', { value: telemetryTable.tableName });
  }
}
