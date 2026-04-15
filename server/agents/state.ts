import { Annotation } from '@langchain/langgraph';
import type { ScrapedCandidate, Region } from '../integrations/common/types.js';

export type { ScrapedCandidate };

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

export interface FinishConcept {
  finishType: string;
  label: string;
  summary: string;
}

export interface ListingWithOptions extends EvaluatedCandidate {
  concepts: FinishConcept[];
}

export interface ConceptRenderResult {
  listingId: number;
  finishType: string;
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
  reconciled: number;
  evaluated: number;
  qualified: number;
  rendered: number;
  errors: number;
}

export interface ScrapeTask {
  platform: string;
  region: Region;
  page: number;
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
  removedIds: string[]; // externalIds of listings confirmed gone (404)
  reconciledCount: number;
  triageCount: Record<string, number>; // per-platform triage budget
  evalCount: Record<string, number>; // per-platform eval budget
  qualifiedCount: number;
  conceptsRendered: number;
  scrapeAttempts: Record<string, number>; // per-platform retry budget
  seenExternalIds: string[]; // track IDs across retries to avoid re-triaging
  scrapeTask: ScrapeTask | null; // current task for scrapeOne node (set by Send)
  errors: AgentError[];
  summary: RunSummary | null;
}

// LangGraph Annotation — defines how state fields merge between nodes
export const AgentAnnotation = Annotation.Root({
  runId: Annotation<string>,
  startedAt: Annotation<string>,

  scrapedCandidates: Annotation<ScrapedCandidate[]>({
    reducer: (prev, next) => [...prev, ...next], // append — fan-out results merge
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

  removedIds: Annotation<string[]>({
    reducer: (prev, next) => [...new Set([...prev, ...next])],
    default: () => [],
  }),
  reconciledCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  // Counters
  triageCount: Annotation<Record<string, number>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  evalCount: Annotation<Record<string, number>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  qualifiedCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  conceptsRendered: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  scrapeAttempts: Annotation<Record<string, number>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  seenExternalIds: Annotation<string[]>({
    reducer: (prev, next) => [...new Set([...prev, ...next])],
    default: () => [],
  }),
  scrapeTask: Annotation<ScrapeTask | null>({
    reducer: (_prev, next) => next,
    default: () => null,
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
