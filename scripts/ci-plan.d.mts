// Typene til de rene funksjonene i `ci-plan.mjs`, for testene.

export interface MarkerArtifact {
  name: string
  expired: boolean
  workflow_run?: { id: number; repository_id: number; head_repository_id: number } | null
}

export interface RunRef {
  id: number
  html_url: string
}

export interface PlanFacts {
  workflow: 'tester' | 'nettlesertester'
  event: string
  markdownOnly: boolean
  testedMarker: MarkerArtifact | null
  passedNightly: RunRef | null
}

export const TESTED_TREE_PREFIX: string
export function testedTreeArtifact(tree: string): string
export function isMarkdownOnly(changedFiles: string[], markdownImports: string[]): boolean
export function trustedMarker(artifacts: MarkerArtifact[], repositoryId: number): MarkerArtifact | null
export function decide(facts: PlanFacts): { run: boolean; reason: string }
