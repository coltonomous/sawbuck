import { StateGraph, END } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { AgentAnnotation, type AgentState } from './state.js';
import { agentConfig } from './config.js';
import { scrapeCategory } from './nodes/scrape.js';
import { triageCandidates } from './nodes/triage.js';
import { enrichPassed } from './nodes/enrich.js';
import { reconcileListings } from './nodes/reconcile.js';
import { evaluateCandidates } from './nodes/evaluate.js';
import { generatePlanOptions } from './nodes/plan-options.js';
import { generateConcepts } from './nodes/render.js';
import { summarizeRun } from './nodes/summarize.js';

const MAX_SCRAPE_ATTEMPTS = 5;
const MIN_QUALIFIED_TARGET = 3;

function afterTriage(state: AgentState): 'enrich' | 'scrape' | 'summarize' {
  if (state.passedTriage.length > 0) {
    if (state.evalCount >= agentConfig.maxEvals) return 'summarize';
    return 'enrich';
  }
  if (state.scrapeAttempts < MAX_SCRAPE_ATTEMPTS) return 'scrape';
  return 'summarize';
}

function afterReconcile(state: AgentState): 'evaluate' | 'summarize' {
  if (state.passedTriage.length === 0) return 'summarize';
  return 'evaluate';
}

function afterEvaluate(state: AgentState): 'planOptions' | 'scrape' | 'summarize' {
  if (state.qualifiedListings.length > 0) return 'planOptions';
  // No qualified listings this iteration — try another page if under caps
  if (
    state.evalCount < agentConfig.maxEvals &&
    state.scrapeAttempts < MAX_SCRAPE_ATTEMPTS
  ) {
    return 'scrape';
  }
  return 'summarize';
}

function afterPlanOptions(state: AgentState): 'render' | 'scrape' | 'summarize' {
  if (state.listingsWithOptions.length > 0 && process.env.FAL_KEY && state.conceptsRendered < agentConfig.maxListingsRendered) {
    return 'render';
  }
  // No render possible — check if we should loop for more qualified listings
  if (shouldLoop(state)) return 'scrape';
  return 'summarize';
}

function afterRender(state: AgentState): 'scrape' | 'summarize' {
  if (shouldLoop(state)) return 'scrape';
  return 'summarize';
}

function shouldLoop(state: AgentState): boolean {
  return (
    state.qualifiedCount < MIN_QUALIFIED_TARGET &&
    state.evalCount < agentConfig.maxEvals &&
    state.scrapeAttempts < MAX_SCRAPE_ATTEMPTS
  );
}

// Graph flow:
// scrape → triage → [retry?] → enrich → reconcile → evaluate → planOptions → render → summarize
const graph = new StateGraph(AgentAnnotation)
  .addNode('scrape', scrapeCategory)
  .addNode('triage', triageCandidates)
  .addNode('enrich', enrichPassed)
  .addNode('reconcile', reconcileListings)
  .addNode('evaluate', evaluateCandidates)
  .addNode('planOptions', generatePlanOptions)
  .addNode('render', generateConcepts)
  .addNode('summarize', summarizeRun)
  .addEdge('__start__', 'scrape')
  .addEdge('scrape', 'triage')
  .addConditionalEdges('triage', afterTriage, {
    enrich: 'enrich',
    scrape: 'scrape',
    summarize: 'summarize',
  })
  .addEdge('enrich', 'reconcile')
  .addConditionalEdges('reconcile', afterReconcile, {
    evaluate: 'evaluate',
    summarize: 'summarize',
  })
  .addConditionalEdges('evaluate', afterEvaluate, {
    planOptions: 'planOptions',
    scrape: 'scrape',
    summarize: 'summarize',
  })
  .addConditionalEdges('planOptions', afterPlanOptions, {
    render: 'render',
    scrape: 'scrape',
    summarize: 'summarize',
  })
  .addConditionalEdges('render', afterRender, {
    scrape: 'scrape',
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
