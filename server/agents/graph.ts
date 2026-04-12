import { StateGraph, END, MemorySaver } from '@langchain/langgraph';
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

const MAX_SCRAPE_ATTEMPTS = 3;

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

function afterEvaluate(state: AgentState): 'planOptions' | 'summarize' {
  if (state.qualifiedListings.length === 0) return 'summarize';
  return 'planOptions';
}

function afterPlanOptions(state: AgentState): 'render' | 'summarize' {
  if (state.listingsWithOptions.length === 0) return 'summarize';
  if (state.conceptsRendered >= agentConfig.maxListingsRendered) return 'summarize';
  if (!process.env.FAL_KEY) return 'summarize';
  return 'render';
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
    summarize: 'summarize',
  })
  .addConditionalEdges('planOptions', afterPlanOptions, {
    render: 'render',
    summarize: 'summarize',
  })
  .addEdge('render', 'summarize')
  .addEdge('summarize', END);

const checkpointer = new MemorySaver();

export const agentPipeline = graph.compile({ checkpointer });

export { afterTriage, afterReconcile, afterEvaluate, afterPlanOptions, MAX_SCRAPE_ATTEMPTS };
