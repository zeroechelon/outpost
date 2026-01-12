/**
 * API Key model and validation schemas
 */

import { z } from 'zod';

export const ApiKeyStatusSchema = z.enum(['active', 'revoked', 'expired']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  expiresAt: z.coerce.date().optional(),
  scopes: z.array(z.string()).default(['dispatch', 'status', 'list']),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

export const ApiKeySchema = z.object({
  apiKeyId: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  keyHash: z.string(),
  keyPrefix: z.string(),
  status: ApiKeyStatusSchema,
  scopes: z.array(z.string()),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  lastUsedAt: z.coerce.date().nullable(),
  usageCount: z.number().int().min(0),
});

export type ApiKeyModel = z.infer<typeof ApiKeySchema>;

export const API_KEY_SCOPES = {
  DISPATCH: 'dispatch',
  STATUS: 'status',
  LIST: 'list',
  CANCEL: 'cancel',
  PROMOTE: 'promote',
  ADMIN: 'admin',
} as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES];

/**
 * Convert DynamoDB item to ApiKey model
 */
export function fromDynamoItem(item: Record<string, unknown>): ApiKeyModel {
  return ApiKeySchema.parse({
    apiKeyId: item['apiKeyId'],
    tenantId: item['tenantId'],
    name: item['name'],
    keyHash: item['keyHash'],
    keyPrefix: item['keyPrefix'],
    status: item['status'],
    scopes: item['scopes'],
    createdAt: item['createdAt'],
    expiresAt: item['expiresAt'] ?? null,
    lastUsedAt: item['lastUsedAt'] ?? null,
    usageCount: item['usageCount'] ?? 0,
  });
}

/**
 * Convert ApiKey model to DynamoDB item
 */
export function toDynamoItem(apiKey: ApiKeyModel): Record<string, unknown> {
  return {
    apiKeyId: apiKey.apiKeyId,
    tenantId: apiKey.tenantId,
    name: apiKey.name,
    keyHash: apiKey.keyHash,
    keyPrefix: apiKey.keyPrefix,
    status: apiKey.status,
    scopes: apiKey.scopes,
    createdAt: apiKey.createdAt.toISOString(),
    ...(apiKey.expiresAt !== null ? { expiresAt: apiKey.expiresAt.toISOString() } : {}),
    ...(apiKey.lastUsedAt !== null ? { lastUsedAt: apiKey.lastUsedAt.toISOString() } : {}),
    usageCount: apiKey.usageCount,
  };
}
