import { Annotation } from '@langchain/langgraph';

// Re-export from integration types so consumers don't need to know the path
export type { ScrapedCandidate } from '../integrations/common/types.js';

export interface TriageResult {
  isWoodFurniture: boolean;
  hasFlipPotential: boolean;
  furnitureType: string;
  reasoning: string;
  confidenceScore: number;
}

export interface TriagedCandidate extends ScrapedCandidate {
  triageResult: TriageResult;
}

export interface EvaluationResult {
  furnitureType: string;
  furnitureStyle: string;
  conditionScore: number;
  woodSpecies: string | null;
  estimatedValue: number;
  dealScore: number;
  flipRecommendation: 'strong_buy' | 'buy' | 'maybe' | 'pass';
  refinishingPotential: 'high' | 'medium' | 'low';
  profitVerdict: string;
}

export interface EvaluatedCandidate extends TriagedCandidate {
  listingId: number;
  evaluation: EvaluationResult;
}

export interface RefinishingOption {
  difficulty: 'simple' | 'moderate' | 'full';
  label: string;
  summary: string;
  estimatedHours: number;
  estimatedMaterialCost: number;
  estimatedResalePrice: number;
}

export interface ListingWithOptions extends EvaluatedCandidate {
  options: RefinishingOption[];
}

export interface ConceptRenderResult {
  listingId: number;
  difficulty: string;
  conceptImageUrl: string;
  localPath: string;
  prompt: string;
}

export interface AgentError {
  node: string;
  message: string;
  timestamp: string;
}

export interface RunSummary {
  scraped: number;
  triaged: number;
  passedTriage: number;
  evaluated: number;
  qualified: number;
  rendered: number;
  errors: number;
}

export interface AgentState {
  runId: string;
  startedAt: string;
  scrapedCandidates: ScrapedCandidate[];
  triagedCandidates: TriagedCandidate[];
  passedTriage: TriagedCandidate[];
  evaluatedCandidates: EvaluatedCandidate[];
  qualifiedListings: EvaluatedCandidate[];
  listingsWithOptions: ListingWithOptions[];
  conceptRenders: ConceptRenderResult[];
  haikuTriaged: number;
  sonnetEvaluated: number;
  conceptsRendered: number;
  scrapeAttempts: number;
  errors: AgentError[];
  summary: RunSummary | null;
}

// LangGraph Annotation — defines how state fields merge between nodes
export const AgentAnnotation = Annotation.Root({
  runId: Annotation<string>,
  startedAt: Annotation<string>,

  scrapedCandidates: Annotation<ScrapedCandidate[]>({
    reducer: (prev, next) => next, // replace on each scrape
    default: () => [],
  }),
  triagedCandidates: Annotation<TriagedCandidate[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  passedTriage: Annotation<TriagedCandidate[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  evaluatedCandidates: Annotation<EvaluatedCandidate[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  qualifiedListings: Annotation<EvaluatedCandidate[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  listingsWithOptions: Annotation<ListingWithOptions[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  conceptRenders: Annotation<ConceptRenderResult[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),

  // Counters
  haikuTriaged: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  sonnetEvaluated: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  conceptsRendered: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  scrapeAttempts: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  errors: Annotation<AgentError[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  summary: Annotation<RunSummary | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});
