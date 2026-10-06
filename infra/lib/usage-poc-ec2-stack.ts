import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { ipAllowListCode, parseIpv4Cidr } from './ip-allowlist';

export interface UsagePocEc2StackProps extends cdk.StackProps {
  /** IPv4 CIDRs allowed to open the portal (enforced at CloudFront). */
  allowedCidrs: string[];
  portalRepoPath: string;
  agentRepoPath: string;
  /** Shared with the ECS stack: same private CA, so Trackers keep their ca.pem. */
  brokerTlsSecretArn: string;
  brokerTlsServerName: string;
  mongoUriSecretArn: string;
  openAiKeySecretArn: string;
  /** Managed prefix list com.amazonaws.global.cloudfront.origin-facing in this region. */
  cloudFrontPrefixListId: string;
  instanceType: string;
}

const VHOST = 'app_usage';
const MONGO_DATABASE = 'app-usage-monitoring';
const COMPOSE_VERSION = 'v2.29.7';

/**
 * Low-cost variant of the Docker deployment: the same four containers under
 * Docker Compose on one EC2 instance, with no NAT gateway or load balancers.
 * CloudFront (free HTTPS address) fronts the portal on port 80; the instance
 * only accepts CloudFront's origin-facing addresses there, and the portal also
 * requires CloudFront's secret X-Origin-Verify header. Trackers reach RabbitMQ
 * directly on the Elastic IP over TLS (5671).
 *
 * Any change to the images or this file replaces the instance (new user data);
 * the Elastic IP moves to the new one, so Atlas and Trackers keep working.
 * RabbitMQ data lives on the instance disk: messages still queued during a
 * replacement are lost, but Trackers only delete samples once the broker
 * confirms them, and the worker drains the queue every few seconds.
 */
export class UsagePocEc2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: UsagePocEc2StackProps) {
    super(scope, id, props);

    const allowedRanges = props.allowedCidrs.map(parseIpv4Cidr);
    if (!allowedRanges.length) throw new Error('Set context allowedCidrs.');
    if (!props.brokerTlsSecretArn || !props.mongoUriSecretArn || !props.openAiKeySecretArn) {
      throw new Error('Set context brokerTlsSecretArn, mongoUriSecretArn and openAiKeySecretArn.');
    }

    // ---------------------------------------------------------------- network
    // Public subnet only: the instance has its own public IP, so no NAT gateway.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const hostSg = new ec2.SecurityGroup(this, 'HostSg', {
      vpc,
      description: 'usage-poc EC2 host: CloudFront to portal, Trackers to RabbitMQ TLS',
      allowAllOutbound: true,
    });
    hostSg.addIngressRule(ec2.Peer.prefixList(props.cloudFrontPrefixListId), ec2.Port.tcp(80), 'CloudFront origin-facing');
    // Laptops roam, so the TLS port is open; the private CA and per-role passwords protect it.
    hostSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5671), 'Trackers (AMQPS)');

    // Fixed public IP: Atlas allow-list, Tracker broker host and CloudFront origin.
    const eip = new ec2.CfnEIP(this, 'Eip', { domain: 'vpc', tags: [{ key: 'Name', value: 'usage-poc-ec2' }] });
    // CloudFront origins need a host name; EC2 publishes one for every public IP.
    const publicDnsName = cdk.Fn.join('', [
      'ec2-',
      cdk.Fn.join('-', cdk.Fn.split('.', eip.attrPublicIp)),
      this.region === 'us-east-1' ? '.compute-1.amazonaws.com' : `.${this.region}.compute.amazonaws.com`,
    ]);

    // ---------------------------------------------------------------- secrets
    const generatedSecret = (id: string, name: string, description: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: name,
        description,
        generateSecretString: { passwordLength: 40, excludePunctuation: true },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    const mongoUri = secretsmanager.Secret.fromSecretCompleteArn(this, 'MongoUri', props.mongoUriSecretArn);
    const openAiKey = secretsmanager.Secret.fromSecretCompleteArn(this, 'OpenAiKey', props.openAiKeySecretArn);
    const brokerTls = secretsmanager.Secret.fromSecretCompleteArn(this, 'BrokerTls', props.brokerTlsSecretArn);
    const serviceToken = generatedSecret('ServiceToken', 'usage-poc-ec2/mcp-service-token', 'Portal <-> agent shared token');
    const originVerify = generatedSecret('OriginVerify', 'usage-poc-ec2/origin-verify', 'CloudFront -> portal X-Origin-Verify header');
    const brokerAdmin = generatedSecret('BrokerAdmin', 'usage-poc-ec2/rabbitmq-admin', 'RabbitMQ admin password');
    const brokerTracker = generatedSecret('BrokerTracker', 'usage-poc-ec2/rabbitmq-tracker', 'RabbitMQ tracker (laptop) password');
    const brokerWorker = generatedSecret('BrokerWorker', 'usage-poc-ec2/rabbitmq-worker', 'RabbitMQ worker password');

    // ------------------------------------------------------------------ portal
    const ipAllowList = new cloudfront.Function(this, 'IpAllowList', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'usage-poc-ec2: approved IPv4 ranges; agent-only paths blocked',
      // The ECS stack blocks /api/mcp at its internal load balancer; here
      // CloudFront is the only public path to the portal, so block it here.
      code: cloudfront.FunctionCode.fromInline(ipAllowListCode(allowedRanges, ['/api/mcp'])),
    });
    // Forward only what the portal reads. Origin is left out on purpose: the
    // browser and portal share CloudFront's address, so CORS never applies.
    const originRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'PortalOriginRequests', {
      comment: 'usage-poc-ec2 portal',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('X-Client-Id', 'Content-Type', 'Accept'),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });
    const distribution = new cloudfront.Distribution(this, 'PortalCdn', {
      comment: 'usage-poc portal (single EC2 host)',
      // IPv4 only so the allow-list sees every viewer address.
      enableIpv6: false,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: new origins.HttpOrigin(publicDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
          readTimeout: cdk.Duration.seconds(30),
          customHeaders: { 'X-Origin-Verify': originVerify.secretValue.unsafeUnwrap() },
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy,
        functionAssociations: [{ function: ipAllowList, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
    });
    const portalUrl = `https://${distribution.distributionDomainName}`;

    // ----------------------------------------------------------------- images
    // Same directories as the ECS stack, so unchanged code reuses the same images.
    const portalImage = new DockerImageAsset(this, 'PortalImage', { directory: props.portalRepoPath, platform: Platform.LINUX_AMD64 });
    const agentImage = new DockerImageAsset(this, 'AgentImage', { directory: props.agentRepoPath, platform: Platform.LINUX_AMD64 });
    const brokerImage = new DockerImageAsset(this, 'BrokerImage', {
      directory: path.join(__dirname, '..', 'rabbitmq'),
      platform: Platform.LINUX_AMD64,
    });

    const logGroups = Object.fromEntries(
      ['rabbitmq', 'portal', 'worker', 'agent', 'host'].map((name) => [
        name,
        new logs.LogGroup(this, `${name}Logs`, {
          logGroupName: `/usage-poc-ec2/${name}`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      ])
    );

    // ---------------------------------------------------------------- instance
    const role = new iam.Role(this, 'HostRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      // Shell access through Session Manager; no SSH port or key pair.
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    for (const secret of [mongoUri, openAiKey, brokerTls, serviceToken, originVerify, brokerAdmin, brokerTracker, brokerWorker]) {
      secret.grantRead(role);
    }
    for (const image of [portalImage, agentImage, brokerImage]) image.repository.grantPull(role);
    for (const group of Object.values(logGroups)) group.grantWrite(role);

    const log = (name: string) => `
    logging:
      driver: awslogs
      options:
        awslogs-region: ${this.region}
        awslogs-group: ${logGroups[name].logGroupName}
        awslogs-stream: ${name}`;

    // Secret values reach the containers as pass-through environment
    // variables set by start.sh; nothing secret is written to disk.
    const compose = `name: usage-poc
services:
  rabbitmq:
    image: ${brokerImage.imageUri}
    restart: unless-stopped
    ports: ["5671:5671"]
    environment:
      POC_VHOST: ${VHOST}
      RABBITMQ_TLS_CA:
      RABBITMQ_TLS_CERT:
      RABBITMQ_TLS_KEY:
      ADMIN_PASSWORD:
      TRACKER_PASSWORD:
      WORKER_PASSWORD:
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
      - /opt/usage-poc/30-ec2.conf:/etc/rabbitmq/conf.d/30-ec2.conf:ro
    mem_limit: 768m
    stop_grace_period: 60s
    healthcheck:
      test: ["CMD-SHELL", "rabbitmq-diagnostics -q ping"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 120s${log('rabbitmq')}

  portal:
    image: ${portalImage.imageUri}
    restart: unless-stopped
    ports: ["80:3000"]
    environment:
      NODE_ENV: production
      MONGO_DATABASE: ${MONGO_DATABASE}
      APP_TIME_ZONE: Asia/Colombo
      CORS_ORIGIN: ${portalUrl}
      ASSISTANT_AGENT_URL: http://ai-agent:3002/api/assistant/chat
      ASSISTANT_AGENT_TIMEOUT_MS: "25000"
      TELEMETRY_RETENTION_DAYS: "30"
      MONGO_URI:
      MCP_SERVICE_TOKEN:
      ORIGIN_VERIFY_SECRET:
    mem_limit: 384m${log('portal')}

  worker:
    image: ${portalImage.imageUri}
    restart: unless-stopped
    command: ["node", "workers/telemetryConsumer.js"]
    depends_on:
      rabbitmq:
        condition: service_healthy
    environment:
      NODE_ENV: production
      MONGO_DATABASE: ${MONGO_DATABASE}
      APP_TIME_ZONE: Asia/Colombo
      RABBITMQ_HOST: rabbitmq
      RABBITMQ_PORT: "5672"
      RABBITMQ_USERNAME: worker
      RABBITMQ_PASSWORD: \${WORKER_PASSWORD}
      RABBITMQ_VHOST: ${VHOST}
      TELEMETRY_RETENTION_DAYS: "30"
      MONGO_URI:
    mem_limit: 256m${log('worker')}

  ai-agent:
    image: ${agentImage.imageUri}
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORTAL_API_URL: http://portal:3000
      OPENAI_MODEL: gpt-5-mini
      AGENT_DEADLINE_MS: "20000"
      PORTAL_TOOL_TIMEOUT_MS: "8000"
      OPENAI_API_KEY:
      MCP_SERVICE_TOKEN:
    mem_limit: 256m
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3002/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s${log('agent')}

volumes:
  rabbitmq-data:
`;

    const registry = `${this.account}.dkr.ecr.${this.region}.amazonaws.com`;
    const startScript = `#!/bin/bash
# Fetches secrets, signs in to ECR and starts the containers. Runs at every boot.
set -euo pipefail
export AWS_REGION=${this.region} AWS_DEFAULT_REGION=${this.region}
secret() { aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text; }
tls=$(secret ${brokerTls.secretArn})
export RABBITMQ_TLS_CA=$(jq -r .ca <<<"$tls")
export RABBITMQ_TLS_CERT=$(jq -r .cert <<<"$tls")
export RABBITMQ_TLS_KEY=$(jq -r .key <<<"$tls")
unset tls
export ADMIN_PASSWORD=$(secret ${brokerAdmin.secretArn})
export TRACKER_PASSWORD=$(secret ${brokerTracker.secretArn})
export WORKER_PASSWORD=$(secret ${brokerWorker.secretArn})
export MONGO_URI=$(secret ${mongoUri.secretArn})
export OPENAI_API_KEY=$(secret ${openAiKey.secretArn})
export MCP_SERVICE_TOKEN=$(secret ${serviceToken.secretArn})
export ORIGIN_VERIFY_SECRET=$(secret ${originVerify.secretArn})
aws ecr get-login-password | docker login --username AWS --password-stdin ${registry}
cd /opt/usage-poc
for attempt in 1 2 3 4 5; do docker compose pull --quiet && break; sleep 15; done
docker compose up -d --remove-orphans
`;

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'exec > >(tee -a /var/log/usage-poc-setup.log) 2>&1',
      // The Elastic IP is attached just after launch and replaces the launch IP,
      // which would cut off downloads in flight; wait for it first.
      'imds() { curl -fs -H "X-aws-ec2-metadata-token: $(curl -fs -X PUT http://169.254.169.254/latest/api/token -H \'X-aws-ec2-metadata-token-ttl-seconds: 60\')" "http://169.254.169.254/latest/meta-data/$1"; }',
      `for attempt in $(seq 1 120); do [ "$(imds public-ipv4 || true)" = "${eip.attrPublicIp}" ] && break; sleep 5; done`,
      // 1 GB swap: headroom for image pulls and Node start-up on a 2 GB host.
      'if [ ! -f /swapfile ]; then dd if=/dev/zero of=/swapfile bs=1M count=1024 && chmod 600 /swapfile && mkswap /swapfile; fi',
      'swapon /swapfile || true',
      "grep -q '^/swapfile' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab",
      'dnf install -y docker jq',
      // Compose plugin from Docker's GitHub release (not packaged for Amazon Linux), checksum-verified.
      'mkdir -p /usr/libexec/docker/cli-plugins',
      'cd /usr/libexec/docker/cli-plugins',
      `curl -fsSL --retry 5 -o docker-compose https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64`,
      `curl -fsSL --retry 5 -o docker-compose.sha256 https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64.sha256`,
      `echo "$(cut -d' ' -f1 docker-compose.sha256)  docker-compose" | sha256sum -c -`,
      'chmod 0755 docker-compose && rm docker-compose.sha256',
      'systemctl enable --now docker',
      'mkdir -p /opt/usage-poc',
      `cat > /opt/usage-poc/docker-compose.yml <<'COMPOSE_EOF'\n${compose}COMPOSE_EOF`,
      // RabbitMQ sizes its memory alarm from the host's RAM; give it the container's limit.
      "printf 'total_memory_available_override_value = 768MB\\n' > /opt/usage-poc/30-ec2.conf",
      `cat > /opt/usage-poc/start.sh <<'START_EOF'\n${startScript}START_EOF`,
      'chmod 0700 /opt/usage-poc/start.sh',
      `cat > /etc/systemd/system/usage-poc.service <<'UNIT_EOF'
[Unit]
Description=usage-poc containers
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/opt/usage-poc/start.sh
ExecStop=/usr/bin/docker compose --project-directory /opt/usage-poc down
Restart=on-failure
RestartSec=30
TimeoutStartSec=900

[Install]
WantedBy=multi-user.target
UNIT_EOF`,
      'systemctl daemon-reload',
      'systemctl enable --now usage-poc.service'
    );

    const instance = new ec2.Instance(this, 'Host', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: hostSg,
      role,
      userData,
      userDataCausesReplacement: true,
      requireImdsv2: true,
      // Standard credits: a busy CPU slows down instead of adding charges.
      creditSpecification: ec2.CpuCredits.STANDARD,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(16, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }),
        },
      ],
    });
    cdk.Tags.of(instance).add('Name', 'usage-poc-ec2');
    new ec2.CfnEIPAssociation(this, 'EipAssociation', {
      allocationId: eip.attrAllocationId,
      instanceId: instance.instanceId,
    });

    // ----------------------------------------------------------------- outputs
    new cdk.CfnOutput(this, 'PortalUrl', { value: portalUrl });
    new cdk.CfnOutput(this, 'BrokerHost', { value: eip.attrPublicIp });
    new cdk.CfnOutput(this, 'TrackerTlsServerName', { value: props.brokerTlsServerName });
    new cdk.CfnOutput(this, 'TrackerSecret', { value: brokerTracker.secretName });
    new cdk.CfnOutput(this, 'PublicIp', { value: eip.attrPublicIp, description: 'Add to the MongoDB Atlas IP access list' });
    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
  }
}
