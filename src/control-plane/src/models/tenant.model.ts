/**
 * Tenant model and validation schemas
 */

import { z } from 'zod';

export const TenantStatusSchema = z.enum(['active', 'suspended', 'pending']);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const TenantTierSchema = z.enum(['free', 'starter', 'pro', 'enterprise']);
export type TenantTier = z.infer<typeof TenantTierSchema>;

export const CreateTenantSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  tier: TenantTierSchema.default('free'),
});

export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;

export const TenantSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  tier: TenantTierSchema,
  status: TenantStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  stripeCustomerId: z.string().nullable(),
  usageLimits: z.object({
    maxConcurrentJobs: z.number().int().min(1),
    maxJobsPerDay: z.number().int().min(1),
    maxJobTimeoutSeconds: z.number().int().min(60),
  }),
  currentUsage: z.object({
    concurrentJobs: z.number().int().min(0),
    jobsToday: z.number().int().min(0),
    lastResetDate: z.string(),
  }),
});

export type TenantModel = z.infer<typeof TenantSchema>;

export const DEFAULT_USAGE_LIMITS: Record<TenantTier, TenantModel['usageLimits']> = {
  free: {
    maxConcurrentJobs: 1,
    maxJobsPerDay: 10,
    maxJobTimeoutSeconds: 300,
  },
  starter: {
    maxConcurrentJobs: 3,
    maxJobsPerDay: 50,
    maxJobTimeoutSeconds: 600,
  },
  pro: {
    maxConcurrentJobs: 10,
    maxJobsPerDay: 500,
    maxJobTimeoutSeconds: 1800,
  },
  enterprise: {
    maxConcurrentJobs: 50,
    maxJobsPerDay: 10000,
    maxJobTimeoutSeconds: 3600,
  },
};

/**
 * Convert DynamoDB item to Tenant model
 */
export function fromDynamoItem(item: Record<string, unknown>): TenantModel {
  return TenantSchema.parse({
    tenantId: item['tenantId'],
    name: item['name'],
    email: item['email'],
    tier: item['tier'],
    status: item['status'],
    createdAt: item['createdAt'],
    updatedAt: item['updatedAt'],
    stripeCustomerId: item['stripeCustomerId'] ?? null,
    usageLimits: item['usageLimits'],
    currentUsage: item['currentUsage'],
  });
}

/**
 * Convert Tenant model to DynamoDB item
 */
export function toDynamoItem(tenant: TenantModel): Record<string, unknown> {
  return {
    tenantId: tenant.tenantId,
    name: tenant.name,
    email: tenant.email,
    tier: tenant.tier,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    ...(tenant.stripeCustomerId !== null ? { stripeCustomerId: tenant.stripeCustomerId } : {}),
    usageLimits: tenant.usageLimits,
    currentUsage: tenant.currentUsage,
  };
}
