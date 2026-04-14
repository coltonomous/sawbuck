import { StateGraph, END, Send } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { AgentAnnotation, type AgentState } from './state.js';
import { agentConfig } from './config.js';
import { dispatchScrapes, afterScrapesMerge } from './nodes/scrape.js';
import { scrapeOne } from './nodes/scrape-one.js';
import { triageCandidates } from './nodes/triage.js';
import { enrichPassed } from './nodes/enrich.js';
import { reconcileListings } from './nodes/reconcile.js';
import { evaluateCandidates } from './nodes/evaluate.js';
import { generatePlanOptions } from './nodes/plan-options.js';
import { generateConcepts } from './nodes/render.js';
import { discoverKnowledge } from './nodes/discover-knowledge.js';
import { summarizeRun } from './nodes/summarize.js';

const MAX_SCRAPE_ATTEMPTS = 3;
const MIN_QUALIFIED_TARGET = 1;

/** True if at least one platform still has retry budget. */
function hasScrapeBudget(state: AgentState): boolean {
  const attempts = state.scrapeAttempts;
  return Object.values(attempts).length === 0 || Object.values(attempts).some((a) => a < MAX_SCRAPE_ATTEMPTS);
}

/** True if at least one platform still has eval budget. */
function hasEvalBudget(state: AgentState): boolean {
  const counts = state.evalCount;
  return Object.values(counts).length === 0 || Object.values(counts).some((c) => c < agentConfig.maxEvals);
}

function afterTriage(state: AgentState): 'enrich' | 'dispatchScrapes' | 'summarize' {
  if (state.passedTriage.length > 0) {
    if (!hasEvalBudget(state)) return 'summarize';
    return 'enrich';
  }
  if (hasScrapeBudget(state)) return 'dispatchScrapes';
  return 'summarize';
}

function afterReconcile(state: AgentState): 'evaluate' | 'summarize' {
  if (state.passedTriage.length === 0) return 'summarize';
  return 'evaluate';
}

function afterEvaluate(state: AgentState): 'discoverKnowledge' | 'dispatchScrapes' | 'summarize' {
  if (state.qualifiedListings.length > 0) return 'discoverKnowledge';
  if (hasEvalBudget(state) && hasScrapeBudget(state)) {
    return 'dispatchScrapes';
  }
  return 'summarize';
}

function afterPlanOptions(state: AgentState): 'render' | 'dispatchScrapes' | 'summarize' {
  if (state.listingsWithOptions.length > 0 && process.env.FAL_KEY && state.conceptsRendered < agentConfig.maxListingsRendered) {
    return 'render';
  }
  if (shouldLoop(state)) return 'dispatchScrapes';
  return 'summarize';
}

function afterRender(state: AgentState): 'dispatchScrapes' | 'summarize' {
  if (shouldLoop(state)) return 'dispatchScrapes';
  return 'summarize';
}

function shouldLoop(state: AgentState): boolean {
  return (
    state.qualifiedCount < MIN_QUALIFIED_TARGET &&
    hasEvalBudget(state) &&
    hasScrapeBudget(state)
  );
}

// Graph flow:
// dispatchScrapes → [Send → scrapeOne × N] → mergeScrapes → triage → [retry?] → enrich → reconcile → evaluate → planOptions → render → summarize
const graph = new StateGraph(AgentAnnotation)
  .addNode('dispatchScrapes', dispatchScrapes, { ends: ['scrapeOne'] })
  .addNode('scrapeOne', scrapeOne)
  .addNode('mergeScrapes', afterScrapesMerge)
  .addNode('triage', triageCandidates)
  .addNode('enrich', enrichPassed)
  .addNode('reconcile', reconcileListings)
  .addNode('evaluate', evaluateCandidates)
  .addNode('discoverKnowledge', discoverKnowledge)
  .addNode('planOptions', generatePlanOptions)
  .addNode('render', generateConcepts)
  .addNode('summarize', summarizeRun)
  .addEdge('__start__', 'dispatchScrapes')
  .addEdge('scrapeOne', 'mergeScrapes')
  .addEdge('mergeScrapes', 'triage')
  .addConditionalEdges('triage', afterTriage, {
    enrich: 'enrich',
    dispatchScrapes: 'dispatchScrapes',
    summarize: 'summarize',
  })
  .addEdge('enrich', 'reconcile')
  .addConditionalEdges('reconcile', afterReconcile, {
    evaluate: 'evaluate',
    summarize: 'summarize',
  })
  .addConditionalEdges('evaluate', afterEvaluate, {
    discoverKnowledge: 'discoverKnowledge',
    dispatchScrapes: 'dispatchScrapes',
    summarize: 'summarize',
  })
  .addEdge('discoverKnowledge', 'planOptions')
  .addConditionalEdges('planOptions', afterPlanOptions, {
    render: 'render',
    dispatchScrapes: 'dispatchScrapes',
    summarize: 'summarize',
  })
  .addConditionalEdges('render', afterRender, {
    dispatchScrapes: 'dispatchScrapes',
    summarize: 'summarize',
  })
  .addEdge('summarize', END);

const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL!,
);

// Initialize checkpoint tables (idempotent — safe to call on every startup)
let checkpointerReady: Promise<void> | undefined;
export function initCheckpointer(): Promise<void> {
  if (!checkpointerReady) {
    checkpointerReady = checkpointer.setup();
  }
  return checkpointerReady;
}

export const agentPipeline = graph.compile({ checkpointer });

export { afterTriage, afterReconcile, afterEvaluate, afterPlanOptions, afterRender, MAX_SCRAPE_ATTEMPTS, MIN_QUALIFIED_TARGET };
