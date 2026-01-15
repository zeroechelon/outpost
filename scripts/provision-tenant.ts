#!/usr/bin/env tsx
/**
 * Tenant Provisioning Script
 *
 * Creates a new tenant and generates an API key for Outpost v2.0
 *
 * Usage:
 *   AWS_PROFILE=soc npx tsx scripts/provision-tenant.ts "Tenant Name" "email@example.com" [tier]
 *
 * Example:
 *   AWS_PROFILE=soc npx tsx scripts/provision-tenant.ts "Blueprint Project" "blueprint@zeroechelon.io" pro
 */

import { TenantRepository } from '../src/control-plane/src/repositories/tenant.repository.js';
import { ApiKeyRepository } from '../src/control-plane/src/repositories/api-key.repository.js';
import type { TenantTier } from '../src/control-plane/src/models/tenant.model.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: provision-tenant.ts <name> <email> [tier]');
    console.error('  tier: free | starter | pro | enterprise (default: pro)');
    process.exit(1);
  }

  const [name, email, tierArg] = args;
  const tier = (tierArg || 'pro') as TenantTier;

  if (!['free', 'starter', 'pro', 'enterprise'].includes(tier)) {
    console.error(`Invalid tier: ${tier}`);
    console.error('Valid tiers: free, starter, pro, enterprise');
    process.exit(1);
  }

  console.log('🚀 Provisioning tenant...');
  console.log(`   Name: ${name}`);
  console.log(`   Email: ${email}`);
  console.log(`   Tier: ${tier}`);
  console.log('');

  try {
    const tenantRepo = new TenantRepository();
    const apiKeyRepo = new ApiKeyRepository();

    // Create tenant
    console.log('📝 Creating tenant...');
    const tenant = await tenantRepo.create({
      name,
      email,
      tier,
    });

    console.log(`✅ Tenant created: ${tenant.tenantId}`);
    console.log(`   Status: ${tenant.status}`);
    console.log(`   Limits: ${tenant.usageLimits.maxConcurrentJobs} concurrent, ${tenant.usageLimits.maxJobsPerDay} jobs/day`);
    console.log('');

    // Generate API key
    console.log('🔑 Generating API key...');
    const { apiKey: apiKeyModel, rawKey } = await apiKeyRepo.create(tenant.tenantId, {
      name: `${name} Production Key`,
      scopes: ['dispatch', 'status', 'cancel'],
    });

    console.log(`✅ API key generated: ${apiKeyModel.apiKeyId}`);
    console.log(`   Prefix: ${apiKeyModel.keyPrefix}`);
    console.log('');

    // Output credentials
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 CREDENTIALS (save to .env):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`OUTPOST_TENANT_ID=${tenant.tenantId}`);
    console.log(`OUTPOST_API_KEY=${rawKey}`);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  SECURITY WARNING:');
    console.log('   - This API key will only be shown ONCE');
    console.log('   - Store it securely (password manager, secrets manager)');
    console.log('   - Never commit it to version control');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    // Summary
    console.log('📊 Summary:');
    console.log(`   Tenant ID: ${tenant.tenantId}`);
    console.log(`   API Key ID: ${apiKeyModel.apiKeyId}`);
    console.log(`   Created: ${tenant.createdAt.toISOString()}`);
    console.log('');
    console.log('✅ Provisioning complete.');

  } catch (error) {
    console.error('');
    console.error('❌ Provisioning failed:');
    console.error(error);
    process.exit(1);
  }
}

main();
