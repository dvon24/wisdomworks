import { eq, and, desc } from 'drizzle-orm';
import { getDb } from './client';
import { governanceRules, governanceEvaluations } from './schema';
import type { RuleEffect, EvaluationResult } from './schema';

export interface GovernanceCheckRequest {
  tenantId: string;
  agentId: string;
  action: string;
}

export interface GovernanceCheckResult {
  permitted: boolean;
  effect: RuleEffect;
  ruleId: string | null;
  reasoning: string;
}

/**
 * Evaluate governance rules for an agent action.
 * Checks active rules for the tenant, matching by scope and action.
 * Higher priority rules evaluated first. First match wins.
 * If no rules match, action is denied by default (fail-closed).
 */
export async function evaluateGovernance(
  request: GovernanceCheckRequest,
): Promise<GovernanceCheckResult> {
  const db = getDb();

  // Get active rules for this tenant, ordered by priority (highest first)
  const rules = await db
    .select()
    .from(governanceRules)
    .where(
      and(
        eq(governanceRules.tenantId, request.tenantId),
        eq(governanceRules.active, true),
      ),
    )
    .orderBy(desc(governanceRules.priority));

  // Find first matching rule
  for (const rule of rules) {
    if (matchesRule(rule, request)) {
      const result: GovernanceCheckResult = {
        permitted: rule.effect === 'allow',
        effect: rule.effect as RuleEffect,
        ruleId: rule.id,
        reasoning: `Rule '${rule.ruleType}' (${rule.effect}) matched: scope=${rule.scope}, action=${rule.action}`,
      };

      // Log the evaluation
      await logGovernanceEvaluation(request, rule.id, result);

      return result;
    }
  }

  // No matching rule — deny by default (fail-closed)
  const defaultResult: GovernanceCheckResult = {
    permitted: false,
    effect: 'deny',
    ruleId: null,
    reasoning: 'No matching governance rule — denied by default (fail-closed)',
  };

  await logGovernanceEvaluation(request, null, defaultResult);

  return defaultResult;
}

function matchesRule(
  rule: typeof governanceRules.$inferSelect,
  request: GovernanceCheckRequest,
): boolean {
  // Check action match
  if (rule.action !== '*' && rule.action !== request.action) {
    return false;
  }

  // Check scope match
  if (rule.scope === 'global') return true;
  if (rule.scope === `agent:${request.agentId}`) return true;
  if (rule.scope === `action:${request.action}`) return true;

  return false;
}

async function logGovernanceEvaluation(
  request: GovernanceCheckRequest,
  ruleId: string | null,
  result: GovernanceCheckResult,
): Promise<void> {
  const db = getDb();
  const evaluationResult: EvaluationResult = result.permitted ? 'permitted' : 'blocked';

  await db.insert(governanceEvaluations).values({
    tenantId: request.tenantId,
    ruleId,
    agentId: request.agentId,
    action: request.action,
    result: evaluationResult,
    reasoning: result.reasoning,
  });
}
