/**
 * Configuration loader for Outpost V2 Control Plane
 * Reads configuration from environment variables with validation
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const ConfigSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),

  // AWS
  awsRegion: z.string().default('us-east-1'),

  // DynamoDB
  dynamodb: z.object({
    jobsTable: z.string().default('outpost-jobs'),
    tenantsTable: z.string().default('outpost-tenants'),
    apiKeysTable: z.string().default('outpost-api-keys'),
    auditTable: z.string().default('outpost-audit'),
  }),

  // ECS
  ecs: z.object({
    clusterArn: z.string().optional(),
    workerTaskDefinition: z.string().optional(),
    workerSecurityGroup: z.string().optional(),
    workerSubnetIds: z.array(z.string()).default([]),
  }),

  // EFS
  efs: z.object({
    fileSystemId: z.string().optional(),
    accessPointId: z.string().optional(),
    mountPath: z.string().default('/mnt/workspaces'),
  }),

  // S3
  s3: z.object({
    outputBucket: z.string().default('outpost-outputs'),
    workspaceBucket: z.string().default('outpost-workspaces'),
  }),

  // Secrets Manager
  secretsApiKeysArn: z.string().optional(),

  // CloudWatch
  cloudwatch: z.object({
    logGroup: z.string().default('/outpost/control-plane'),
    logStreamPrefix: z.string().default('control-plane'),
  }),

  // Worker
  worker: z.object({
    maxPoolSize: z.coerce.number().int().min(1).max(100).default(10),
    idleTimeoutSeconds: z.coerce.number().int().min(60).max(3600).default(300),
    taskTimeoutSeconds: z.coerce.number().int().min(60).max(86400).default(3600),
  }),

  // Logging
  log: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    pretty: z.coerce.boolean().default(false),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

function parseSubnetIds(value: string | undefined): string[] {
  if (value === undefined || value === '') {
    return [];
  }
  return value.split(',').map((s) => s.trim());
}

function loadConfig(): Config {
  const rawConfig = {
    nodeEnv: process.env['NODE_ENV'],
    port: process.env['PORT'],
    host: process.env['HOST'],
    awsRegion: process.env['AWS_REGION'],
    dynamodb: {
      jobsTable: process.env['DYNAMODB_JOBS_TABLE'],
      tenantsTable: process.env['DYNAMODB_TENANTS_TABLE'],
      apiKeysTable: process.env['DYNAMODB_API_KEYS_TABLE'],
      auditTable: process.env['DYNAMODB_AUDIT_TABLE'],
    },
    ecs: {
      clusterArn: process.env['ECS_CLUSTER_ARN'],
      workerTaskDefinition: process.env['ECS_WORKER_TASK_DEFINITION'],
      workerSecurityGroup: process.env['ECS_WORKER_SECURITY_GROUP'],
      workerSubnetIds: parseSubnetIds(process.env['ECS_WORKER_SUBNET_IDS']),
    },
    efs: {
      fileSystemId: process.env['EFS_FILE_SYSTEM_ID'],
      accessPointId: process.env['EFS_ACCESS_POINT_ID'],
      mountPath: process.env['EFS_MOUNT_PATH'],
    },
    s3: {
      outputBucket: process.env['S3_OUTPUT_BUCKET'],
      workspaceBucket: process.env['S3_WORKSPACE_BUCKET'],
    },
    secretsApiKeysArn: process.env['SECRETS_API_KEYS_ARN'],
    cloudwatch: {
      logGroup: process.env['CLOUDWATCH_LOG_GROUP'],
      logStreamPrefix: process.env['CLOUDWATCH_LOG_STREAM_PREFIX'],
    },
    worker: {
      maxPoolSize: process.env['WORKER_MAX_POOL_SIZE'],
      idleTimeoutSeconds: process.env['WORKER_IDLE_TIMEOUT_SECONDS'],
      taskTimeoutSeconds: process.env['WORKER_TASK_TIMEOUT_SECONDS'],
    },
    log: {
      level: process.env['LOG_LEVEL'],
      pretty: process.env['LOG_PRETTY'],
    },
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (configInstance === null) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// For testing - allows resetting config
export function resetConfig(): void {
  configInstance = null;
}

export default getConfig;
