import { z } from 'zod';

/**
 * Shared domain normalization. Mirrors the same transform in
 * `@boardroom/shared`'s CreateMemoryRequestSchema so the MCP-side
 * gate and API-side gate agree on what "ministry" means.
 *
 * Used by every MCP tool that accepts a `domain` input — keeping these in
 * sync prevents F-205-style bypass where a tool accepting `domain: 'Ministry'`
 * forwards the raw value to the audit log before the server normalizes it.
 */
export const DomainSchema = z
  .string()
  .min(1)
  .transform(s => s.trim().toLowerCase());
