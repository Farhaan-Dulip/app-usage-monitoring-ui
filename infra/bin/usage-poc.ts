#!/usr/bin/env node
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { UsagePocStack } from '../lib/usage-poc-stack';
import { UsagePocServerlessStack } from '../lib/usage-poc-serverless-stack';

const app = new cdk.App();
const context = (key: string): string => String(app.node.tryGetContext(key) ?? '').trim();

const allowedCidrs = context('allowedCidrs')
  .split(',')
  .map((cidr) => cidr.trim())
  .filter(Boolean);

const stack = new UsagePocStack(app, 'UsagePoc', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: context('region') || 'us-east-1' },
  description: 'App usage monitoring POC: portal, telemetry worker, AI agent and RabbitMQ on ECS Fargate',
  allowedCidrs,
  appsEnabled: context('appsEnabled') === 'true',
  portalRepoPath: path.resolve(__dirname, '..', '..'),
  agentRepoPath: path.resolve(__dirname, '..', context('agentRepoPath') || '../../app-usage-monitor-agent'),
  brokerTlsSecretArn: context('brokerTlsSecretArn'),
  brokerTlsServerName: context('brokerTlsServerName') || 'mq.usage-poc.internal',
  alarmEmail: context('alarmEmail'),
});

cdk.Tags.of(stack).add('project', 'usage-poc');

// Pay-per-use variant (Amplify + Lambda + DynamoDB), deployed independently:
//   npx cdk deploy UsagePocServerless
const serverless = new UsagePocServerlessStack(app, 'UsagePocServerless', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: context('region') || 'us-east-1' },
  description: 'App usage monitoring POC, pay-per-use: Amplify Hosting, Lambda function URLs, DynamoDB',
  portalRepoPath: path.resolve(__dirname, '..', '..'),
  agentRepoPath: path.resolve(__dirname, '..', context('agentRepoPath') || '../../app-usage-monitor-agent'),
  parameterPrefix: context('serverlessParameterPrefix') || '/usage-poc-sls',
});
cdk.Tags.of(serverless).add('project', 'usage-poc');
cdk.Tags.of(serverless).add('variant', 'serverless');
