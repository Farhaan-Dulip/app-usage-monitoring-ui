import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as sns from 'aws-cdk-lib/aws-sns';
import { ipAllowListCode, parseIpv4Cidr } from './ip-allowlist';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

export interface UsagePocStackProps extends cdk.StackProps {
  /** IPv4 CIDRs allowed to open the portal (enforced at CloudFront). */
  allowedCidrs: string[];
  /** Portal and worker need MongoDB; keep them at 0 tasks until the Atlas secret is set. */
  appsEnabled: boolean;
  portalRepoPath: string;
  agentRepoPath: string;
  /** Secret created by infra/scripts/generate-broker-tls.sh --upload ({ca, cert, key}). */
  brokerTlsSecretArn: string;
  /** Name in the broker certificate; Trackers set RABBITMQ_TLS_SERVER_NAME to it. */
  brokerTlsServerName: string;
  /** Kept outside the stack so `cdk destroy` / redeploy keeps the values. */
  mongoUriSecretArn: string;
  openAiKeySecretArn: string;
  alarmEmail?: string;
}

const VHOST = 'app_usage';
const MONGO_DATABASE = 'app-usage-monitoring';

export class UsagePocStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: UsagePocStackProps) {
    super(scope, id, props);

    if (!props.brokerTlsSecretArn) {
      throw new Error('Set context brokerTlsSecretArn (run infra/scripts/generate-broker-tls.sh --upload).');
    }
    const allowedRanges = props.allowedCidrs.map(parseIpv4Cidr);
    if (!allowedRanges.length) {
      throw new Error('Set context allowedCidrs, e.g. -c allowedCidrs=203.0.113.10/32 (the portal has no login yet).');
    }

    // ---------------------------------------------------------------- network
    // One NAT gateway (POC cost) with a fixed public IP for the Atlas allow-list.
    const natEip = new ec2.CfnEIP(this, 'NatEip', { domain: 'vpc' });
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      natGatewayProvider: ec2.NatProvider.gateway({ eipAllocationIds: [natEip.attrAllocationId] }),
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
      ],
    });
    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'usage-poc',
      defaultCloudMapNamespace: {
        name: 'usage-poc.local',
        type: servicediscovery.NamespaceType.HTTP,
        useForServiceConnect: true,
      },
    });

    // ---------------------------------------------------------------- secrets
    // Generated per deployment; rotated by each redeploy.
    const generatedSecret = (id: string, name: string, description: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: name,
        description,
        generateSecretString: { passwordLength: 40, excludePunctuation: true },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    // Hand-entered values live outside the stack so a teardown keeps them.
    if (!props.mongoUriSecretArn || !props.openAiKeySecretArn) {
      throw new Error('Set context mongoUriSecretArn and openAiKeySecretArn (secrets usage-poc/shared/*).');
    }
    const mongoUri = secretsmanager.Secret.fromSecretCompleteArn(this, 'MongoUri', props.mongoUriSecretArn);
    const openAiKey = secretsmanager.Secret.fromSecretCompleteArn(this, 'OpenAiKey', props.openAiKeySecretArn);
    const serviceToken = generatedSecret('ServiceToken', 'usage-poc/mcp-service-token', 'Portal <-> agent shared token');
    const brokerAdmin = generatedSecret('BrokerAdmin', 'usage-poc/rabbitmq-admin', 'RabbitMQ admin password');
    const brokerTracker = generatedSecret('BrokerTracker', 'usage-poc/rabbitmq-tracker', 'RabbitMQ tracker (laptop) password');
    const brokerWorker = generatedSecret('BrokerWorker', 'usage-poc/rabbitmq-worker', 'RabbitMQ worker password');
    const brokerTls = secretsmanager.Secret.fromSecretCompleteArn(this, 'BrokerTls', props.brokerTlsSecretArn);

    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: `/usage-poc/${name.toLowerCase()}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    // --------------------------------------------------------- security groups
    const sg = (id: string, description: string) =>
      new ec2.SecurityGroup(this, id, { vpc, description, allowAllOutbound: true });
    const albSg = sg('AlbSg', 'Internal ALB behind CloudFront VPC origin');
    const portalSg = sg('PortalSg', 'Portal tasks');
    const workerSg = sg('WorkerSg', 'Telemetry worker tasks');
    const agentSg = sg('AgentSg', 'AI agent tasks');
    const brokerSg = sg('BrokerSg', 'RabbitMQ task');
    const nlbSg = sg('BrokerNlbSg', 'Public TLS entry point for Trackers');

    portalSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'ALB to portal');
    portalSg.addIngressRule(agentSg, ec2.Port.tcp(3000), 'Agent MCP tools to portal');
    agentSg.addIngressRule(portalSg, ec2.Port.tcp(3002), 'Portal to agent chat');
    brokerSg.addIngressRule(workerSg, ec2.Port.tcp(5672), 'Worker AMQP (in VPC)');
    brokerSg.addIngressRule(nlbSg, ec2.Port.tcp(5671), 'NLB to broker TLS');
    // Laptops roam, so the TLS port is open; the private CA and per-role passwords protect it.
    nlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5671), 'Trackers (AMQPS)');

    // ------------------------------------------------------- portal entry point
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: false,
      securityGroup: albSg,
      vpcSubnets: privateSubnets,
    });
    const listener = alb.addListener('Http', { port: 80, open: false });
    // Agent-only endpoints are never served to browsers.
    listener.addAction('DenyMcp', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/mcp', '/api/mcp/*'])],
      action: elbv2.ListenerAction.fixedResponse(403, { contentType: 'text/plain', messageBody: 'Forbidden' }),
    });

    const ipAllowList = new cloudfront.Function(this, 'IpAllowList', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'usage-poc: allow only approved IPv4 ranges',
      code: cloudfront.FunctionCode.fromInline(ipAllowListCode(allowedRanges)),
    });
    const distribution = new cloudfront.Distribution(this, 'PortalCdn', {
      comment: 'usage-poc portal',
      // IPv4 only so the allow-list sees every viewer address.
      enableIpv6: false,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.VpcOrigin.withApplicationLoadBalancer(alb, {
          httpPort: 80,
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          readTimeout: cdk.Duration.seconds(30),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [{ function: ipAllowList, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
    });
    const portalUrl = `https://${distribution.distributionDomainName}`;

    // The internal ALB only accepts CloudFront's VPC-origin ENIs. CloudFront
    // matches them by security-group reference (a VPC CIDR rule is not enough),
    // and creates that group only once the VPC origin exists, so look it up after.
    const vpcOriginSgLookup = new cr.AwsCustomResource(this, 'VpcOriginSgLookup', {
      onUpdate: {
        service: 'EC2',
        action: 'describeSecurityGroups',
        parameters: {
          Filters: [
            { Name: 'vpc-id', Values: [vpc.vpcId] },
            { Name: 'group-name', Values: ['CloudFront-VPCOrigins-Service-SG'] },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${vpc.node.addr}-cloudfront-vpc-origin-sg`),
        outputPaths: ['SecurityGroups.0.GroupId'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });
    vpcOriginSgLookup.node.addDependency(distribution);
    // A standalone rule (not inline on albSg) avoids a dependency cycle:
    // ALB SG -> lookup -> distribution -> VPC origin -> ALB -> ALB SG.
    new ec2.CfnSecurityGroupIngress(this, 'AlbFromVpcOrigin', {
      groupId: albSg.securityGroupId,
      sourceSecurityGroupId: vpcOriginSgLookup.getResponseField('SecurityGroups.0.GroupId'),
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      description: 'CloudFront VPC origin',
    });

    // ----------------------------------------------------------------- images
    const portalImage = ecs.ContainerImage.fromDockerImageAsset(
      new DockerImageAsset(this, 'PortalImage', { directory: props.portalRepoPath, platform: Platform.LINUX_AMD64 })
    );
    const agentImage = ecs.ContainerImage.fromDockerImageAsset(
      new DockerImageAsset(this, 'AgentImage', { directory: props.agentRepoPath, platform: Platform.LINUX_AMD64 })
    );
    const brokerImage = ecs.ContainerImage.fromDockerImageAsset(
      new DockerImageAsset(this, 'BrokerImage', {
        directory: path.join(__dirname, '..', 'rabbitmq'),
        platform: Platform.LINUX_AMD64,
      })
    );

    const appDesiredCount = props.appsEnabled ? 1 : 0;
    const rollingDeploy = { circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 };

    // ------------------------------------------------------------------ broker
    const brokerFs = new efs.FileSystem(this, 'BrokerData', {
      vpc,
      vpcSubnets: privateSubnets,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    brokerFs.connections.allowDefaultPortFrom(brokerSg);
    const brokerAccessPoint = brokerFs.addAccessPoint('BrokerAccessPoint', {
      path: '/rabbitmq',
      // uid/gid 999 = rabbitmq user in the official image.
      createAcl: { ownerUid: '999', ownerGid: '999', permissions: '750' },
      posixUser: { uid: '999', gid: '999' },
    });

    const brokerTask = new ecs.FargateTaskDefinition(this, 'BrokerTask', { cpu: 512, memoryLimitMiB: 1024 });
    brokerTask.addVolume({
      name: 'data',
      efsVolumeConfiguration: {
        fileSystemId: brokerFs.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: { accessPointId: brokerAccessPoint.accessPointId, iam: 'ENABLED' },
      },
    });
    brokerFs.grant(brokerTask.taskRole, 'elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite', 'elasticfilesystem:ClientRootAccess');
    const brokerContainer = brokerTask.addContainer('rabbitmq', {
      image: brokerImage,
      portMappings: [
        { name: 'amqp', containerPort: 5672 },
        { name: 'amqps', containerPort: 5671 },
        { name: 'management', containerPort: 15672 },
      ],
      environment: { POC_VHOST: VHOST },
      secrets: {
        RABBITMQ_TLS_CA: ecs.Secret.fromSecretsManager(brokerTls, 'ca'),
        RABBITMQ_TLS_CERT: ecs.Secret.fromSecretsManager(brokerTls, 'cert'),
        RABBITMQ_TLS_KEY: ecs.Secret.fromSecretsManager(brokerTls, 'key'),
        ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(brokerAdmin),
        TRACKER_PASSWORD: ecs.Secret.fromSecretsManager(brokerTracker),
        WORKER_PASSWORD: ecs.Secret.fromSecretsManager(brokerWorker),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'rabbitmq-diagnostics -q ping'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120),
      },
      stopTimeout: cdk.Duration.seconds(60),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'rabbitmq', logGroup: logGroup('Broker') }),
    });
    brokerContainer.addMountPoints({ containerPath: '/var/lib/rabbitmq', sourceVolume: 'data', readOnly: false });

    const brokerService = new ecs.FargateService(this, 'Broker', {
      cluster,
      serviceName: 'rabbitmq',
      taskDefinition: brokerTask,
      desiredCount: 1,
      securityGroups: [brokerSg],
      vpcSubnets: privateSubnets,
      // Never run two brokers on the same data directory: stop, then start.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      enableExecuteCommand: true,
      serviceConnectConfiguration: { services: [{ portMappingName: 'amqp', dnsName: 'rabbitmq', port: 5672 }] },
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, 'BrokerNlb', {
      vpc,
      internetFacing: true,
      securityGroups: [nlbSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    nlb.addListener('Amqps', { port: 5671, protocol: elbv2.Protocol.TCP }).addTargets('Broker', {
      port: 5671,
      protocol: elbv2.Protocol.TCP,
      targets: [brokerService.loadBalancerTarget({ containerName: 'rabbitmq', containerPort: 5671 })],
      healthCheck: { protocol: elbv2.Protocol.TCP, interval: cdk.Duration.seconds(30) },
      deregistrationDelay: cdk.Duration.seconds(15),
    });

    // ------------------------------------------------------------------ portal
    const portalLogs = logGroup('Portal');
    const portalTask = new ecs.FargateTaskDefinition(this, 'PortalTask', { cpu: 512, memoryLimitMiB: 1024 });
    portalTask.addContainer('portal', {
      image: portalImage,
      portMappings: [{ name: 'portal', containerPort: 3000, appProtocol: ecs.AppProtocol.http }],
      environment: {
        NODE_ENV: 'production',
        MONGO_DATABASE,
        APP_TIME_ZONE: 'Asia/Colombo',
        CORS_ORIGIN: portalUrl,
        ASSISTANT_AGENT_URL: 'http://ai-agent:3002/api/assistant/chat',
        ASSISTANT_AGENT_TIMEOUT_MS: '25000',
        TELEMETRY_RETENTION_DAYS: '30',
      },
      secrets: {
        MONGO_URI: ecs.Secret.fromSecretsManager(mongoUri),
        MCP_SERVICE_TOKEN: ecs.Secret.fromSecretsManager(serviceToken),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'portal', logGroup: portalLogs }),
    });
    const portalService = new ecs.FargateService(this, 'Portal', {
      cluster,
      serviceName: 'portal',
      taskDefinition: portalTask,
      desiredCount: appDesiredCount,
      securityGroups: [portalSg],
      vpcSubnets: privateSubnets,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      enableExecuteCommand: true,
      serviceConnectConfiguration: { services: [{ portMappingName: 'portal', dnsName: 'portal', port: 3000 }] },
      ...rollingDeploy,
    });
    listener.addTargets('Portal', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [portalService],
      healthCheck: { path: '/health', healthyHttpCodes: '200', interval: cdk.Duration.seconds(15) },
      deregistrationDelay: cdk.Duration.seconds(15),
    });

    // ------------------------------------------------------------------ worker
    const workerLogs = logGroup('Worker');
    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', { cpu: 256, memoryLimitMiB: 512 });
    workerTask.addContainer('worker', {
      image: portalImage,
      command: ['node', 'workers/telemetryConsumer.js'],
      environment: {
        NODE_ENV: 'production',
        MONGO_DATABASE,
        APP_TIME_ZONE: 'Asia/Colombo',
        RABBITMQ_HOST: 'rabbitmq',
        RABBITMQ_PORT: '5672',
        RABBITMQ_USERNAME: 'worker',
        RABBITMQ_VHOST: VHOST,
        TELEMETRY_RETENTION_DAYS: '30',
      },
      secrets: {
        MONGO_URI: ecs.Secret.fromSecretsManager(mongoUri),
        RABBITMQ_PASSWORD: ecs.Secret.fromSecretsManager(brokerWorker),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logGroup: workerLogs }),
    });
    const workerService = new ecs.FargateService(this, 'Worker', {
      cluster,
      serviceName: 'telemetry-worker',
      taskDefinition: workerTask,
      desiredCount: appDesiredCount,
      securityGroups: [workerSg],
      vpcSubnets: privateSubnets,
      serviceConnectConfiguration: {},
      ...rollingDeploy,
    });
    workerService.node.addDependency(brokerService);

    // -------------------------------------------------------------------- agent
    const agentTask = new ecs.FargateTaskDefinition(this, 'AgentTask', { cpu: 256, memoryLimitMiB: 512 });
    agentTask.addContainer('ai-agent', {
      image: agentImage,
      portMappings: [{ name: 'ai-agent', containerPort: 3002, appProtocol: ecs.AppProtocol.http }],
      environment: {
        NODE_ENV: 'production',
        PORTAL_API_URL: 'http://portal:3000',
        OPENAI_MODEL: 'gpt-5-mini',
        AGENT_DEADLINE_MS: '20000',
        PORTAL_TOOL_TIMEOUT_MS: '8000',
      },
      secrets: {
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(openAiKey),
        MCP_SERVICE_TOKEN: ecs.Secret.fromSecretsManager(serviceToken),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3002/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(20),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'agent', logGroup: logGroup('Agent') }),
    });
    new ecs.FargateService(this, 'Agent', {
      cluster,
      serviceName: 'ai-agent',
      taskDefinition: agentTask,
      desiredCount: 1,
      securityGroups: [agentSg],
      vpcSubnets: privateSubnets,
      enableExecuteCommand: true,
      serviceConnectConfiguration: { services: [{ portMappingName: 'ai-agent', dnsName: 'ai-agent', port: 3002 }] },
      ...rollingDeploy,
    });

    // ------------------------------------------------------------------ alarms
    const alarmTopic = new sns.Topic(this, 'Alarms', { topicName: 'usage-poc-alarms' });
    if (props.alarmEmail) alarmTopic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    const logAlarm = (id: string, group: logs.LogGroup, phrase: string, threshold: number, description: string) => {
      const metric = new logs.MetricFilter(this, `${id}Filter`, {
        logGroup: group,
        filterPattern: logs.FilterPattern.literal(`"${phrase}"`),
        metricNamespace: 'UsagePoc',
        metricName: id,
        metricValue: '1',
        defaultValue: 0,
      }).metric({ statistic: 'Sum', period: cdk.Duration.minutes(5) });
      new cloudwatch.Alarm(this, `${id}Alarm`, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
    };
    logAlarm('AgentFallbacks', portalLogs, 'Monitoring agent unavailable', 3,
      'Portal is answering chat from the database fallback because the AI agent failed.');
    logAlarm('WorkerRestarts', workerLogs, 'Exiting so the supervisor restarts', 1,
      'Telemetry worker lost its RabbitMQ connection and restarted.');

    // ----------------------------------------------------------------- outputs
    new cdk.CfnOutput(this, 'PortalUrl', { value: portalUrl });
    new cdk.CfnOutput(this, 'BrokerHost', { value: nlb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'TrackerRabbitmqUrl', {
      value: `amqps://tracker:<password from usage-poc/rabbitmq-tracker>@${nlb.loadBalancerDnsName}:5671/${VHOST}`,
    });
    new cdk.CfnOutput(this, 'TrackerTlsServerName', { value: props.brokerTlsServerName });
    new cdk.CfnOutput(this, 'NatPublicIp', { value: natEip.ref, description: 'Add to the MongoDB Atlas IP access list' });
    new cdk.CfnOutput(this, 'MongoUriSecret', { value: mongoUri.secretName });
    new cdk.CfnOutput(this, 'OpenAiKeySecret', { value: openAiKey.secretName });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
  }
}
