import type { BenchmarkCase, BenchmarkResult, ModelRoutingTable } from './model-provider';
import { createAIClient } from './ai-client';
import { estimateCost } from './usage-tracker';

/**
 * Simple fuzzy accuracy score: how much of the expected output appears in the actual output.
 * Returns 0-1.
 */
function fuzzyAccuracy(actual: string, expected: string): number {
  if (!expected) return 1;
  const normalizedActual = actual.toLowerCase().trim();
  const normalizedExpected = expected.toLowerCase().trim();

  if (normalizedActual === normalizedExpected) return 1;
  if (normalizedActual.includes(normalizedExpected)) return 0.9;

  // Word overlap scoring
  const expectedWords = new Set(normalizedExpected.split(/\s+/));
  const actualWords = new Set(normalizedActual.split(/\s+/));
  let matches = 0;
  for (const word of expectedWords) {
    if (actualWords.has(word)) matches++;
  }
  return expectedWords.size > 0 ? matches / expectedWords.size : 0;
}

/**
 * Run benchmark test cases against configured models.
 * Returns scored results per provider.
 *
 * NOTE: This calls real AI APIs — only run when API keys are configured.
 */
export async function runBenchmark(
  testCases: BenchmarkCase[],
  routingTable: ModelRoutingTable,
): Promise<BenchmarkResult[]> {
  const client = createAIClient(routingTable);
  const results: BenchmarkResult[] = [];

  for (const testCase of testCases) {
    const route = routingTable[testCase.task];
    if (!route) continue;

    const start = performance.now();
    try {
      const result = await client.callModel(testCase.task, testCase.prompt, {
        system: testCase.system,
        maxTokens: 200,
      });

      const accuracy = fuzzyAccuracy(result.text, testCase.expectedOutput);
      const latencyMs = Math.round(performance.now() - start);
      const cost = estimateCost(result.model, result.usage.inputTokens, result.usage.outputTokens);

      results.push({
        case: testCase.name,
        provider: result.provider,
        model: result.model,
        accuracyScore: accuracy,
        latencyMs,
        costEstimate: cost,
      });
    } catch (error) {
      results.push({
        case: testCase.name,
        provider: route.provider,
        model: route.model,
        accuracyScore: 0,
        latencyMs: Math.round(performance.now() - start),
        costEstimate: 0,
      });
    }
  }

  return results;
}

/** Sample benchmark cases for testing */
export const SAMPLE_BENCHMARK_CASES: BenchmarkCase[] = [
  {
    name: 'Email classification - business',
    task: 'classification',
    prompt: 'Classify this email as business or personal: "Meeting rescheduled to 3pm. Please update the project timeline."',
    expectedOutput: 'business',
  },
  {
    name: 'Email classification - personal',
    task: 'classification',
    prompt: 'Classify this email as business or personal: "Happy birthday! Hope you have a great day."',
    expectedOutput: 'personal',
  },
  {
    name: 'Short text generation',
    task: 'writing',
    prompt: 'Write a one-sentence professional email response confirming a meeting at 3pm tomorrow.',
    expectedOutput: 'confirm meeting 3pm tomorrow',
  },
];
