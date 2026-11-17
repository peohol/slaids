#!/usr/bin/env node
/**
 * Avgjør om en CI-kjøring har noe nytt å kontrollere.
 *
 * Arbeidsflytene kjører alltid jobben med samme navn, så de påkrevde sjekkene
 * på `main` får et svar hver gang. Dette skriptet bestemmer bare om de tunge
 * stegene (installasjon, tester, bygg) trengs, eller om nøyaktig den samme
 * kontrollen allerede er gjort og kan vises til. Det skriver `kjor=true` eller
 * `kjor=false` til `GITHUB_OUTPUT`, og begrunnelsen til jobbsammendraget.
 *
 * Tre tilfeller hoppes over, og alle bygger på at det som kontrolleres er
 * identisk med noe som allerede er kontrollert, eller ikke kan påvirke det:
 *
 * - **Tester, push til `main`:** En PR-kjøring tester flettecommiten til PR-en
 *   og `main`. Når PR-en slås sammen uten at `main` har flyttet seg, får den
 *   nye commiten på `main` nøyaktig samme Git-tre (samme filer, byte for byte).
 *   En vellykket PR-kjøring legger igjen et lite artefakt oppkalt etter treet
 *   den testet (`testet-tre-<tre>`); finnes det for treet på `main`, er koden
 *   allerede testet. Har `main` flyttet seg, er treet nytt og alt kjøres.
 * - **Nettlesertester, natt:** Hele suiten har allerede bestått på nøyaktig
 *   denne commiten i en tidligere nattlig kjøring. En kjøring som feilet,
 *   kjøres alltid igjen, så en rød natt aldri blir grønn av seg selv.
 * - **Nettlesertester, PR:** Bare Markdown-filer er endret, og ingen kode
 *   importerer Markdown, så appen nettlesertestene bygger er den samme.
 *   Enhetstestene leser noen av dokumentene, så «Tester» kjøres som vanlig.
 *
 * Er noe uklart (API-et svarer ikke, historikken mangler), kjøres alt: å teste
 * én gang for mye er billig, å hoppe over en test som trengtes er det ikke.
 *
 * Bruk: `node scripts/ci-plan.mjs tester` eller `… nettlesertester`, i en
 * GitHub Actions-jobb med `actions: read`. Ingen avhengigheter, med vilje: det
 * kjører før `npm ci`, så en kjøring som hoppes over koster sekunder.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Prefikset på markørartefaktet en vellykket PR-kjøring av «Tester» laster opp. */
export const TESTED_TREE_PREFIX = 'testet-tre-'

/** Navnet på markøren for et gitt Git-tre. */
export function testedTreeArtifact(tree) {
  return `${TESTED_TREE_PREFIX}${tree}`
}

/**
 * Om en endring består av Markdown alene.
 *
 * `markdownImports` er filene som importerer en `.md`-fil i kode; finnes det
 * noen, kan dokumentasjon havne i appen, og regelen gjelder ikke.
 */
export function isMarkdownOnly(changedFiles, markdownImports) {
  if (changedFiles.length === 0) return false
  if (markdownImports.length > 0) return false
  return changedFiles.every((file) => /\.md$/i.test(file))
}

/**
 * Et artefakt fra en tidligere kjøring som viser at treet er testet.
 *
 * Bare artefakter fra dette repoet teller: en PR fra en fork kjører sin egen
 * versjon av arbeidsflyten og kunne ellers laste opp en markør uten å ha
 * kjørt testene. Et utløpt artefakt teller ikke heller.
 */
export function trustedMarker(artifacts, repositoryId) {
  return (
    artifacts.find(
      (artifact) =>
        !artifact.expired &&
        artifact.workflow_run?.repository_id === repositoryId &&
        artifact.workflow_run?.head_repository_id === repositoryId,
    ) ?? null
  )
}

/** Hva som skal gjøres, ut fra hendelsen og det som er slått opp. */
export function decide({ workflow, event, markdownOnly, testedMarker, passedNightly }) {
  if (workflow === 'tester' && event === 'push' && testedMarker) {
    return {
      run: false,
      reason:
        `Nøyaktig samme kode (samme Git-tre) besto typesjekk, lint, enhetstester og bygg i ` +
        `PR-kjøringen ${testedMarker.workflow_run.id}. Den kjøres ikke en gang til.`,
    }
  }
  if (workflow === 'nettlesertester' && event === 'schedule' && passedNightly) {
    return {
      run: false,
      reason:
        `Hele suiten besto allerede på denne commiten i nattkjøringen ${passedNightly.id} ` +
        `(${passedNightly.html_url}). Ingenting er endret siden.`,
    }
  }
  if (workflow === 'nettlesertester' && event === 'pull_request' && markdownOnly) {
    return {
      run: false,
      reason:
        'PR-en endrer bare Markdown, og ingen kode importerer Markdown, så appen ' +
        'nettlesertestene bygger er uendret. Enhetstestene i «Tester» kjøres som vanlig.',
    }
  }
  return { run: true, reason: '' }
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function lines(text) {
  return text.split('\n').filter(Boolean)
}

/**
 * Filene en PR endrer: flettecommiten mot sin første forelder, `main`.
 *
 * Uten gjenkjenning av omdøping: ellers ville en kodefil omdøpt til `.md` bare
 * vises med det nye navnet, og PR-en se ut som ren dokumentasjon.
 */
function changedFiles() {
  return lines(git('diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'))
}

/** Kodefiler som importerer en Markdown-fil (også `?raw` og lignende). */
function markdownImports() {
  try {
    return lines(
      git('grep', '-lE', String.raw`(from|import\(?)\s*['"][^'"]*\.md(\?[^'"]*)?['"]`, '--', ':!*.md'),
    )
  } catch (error) {
    // `git grep` avslutter med 1 når ingenting passer.
    if (error.status === 1) return []
    throw error
  }
}

async function github(path, env) {
  const response = await fetch(`${env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`GitHub svarte ${response.status} på ${path}`)
  return response.json()
}

async function lookUp(workflow, env) {
  const repo = env.GITHUB_REPOSITORY
  const event = env.GITHUB_EVENT_NAME
  const facts = { workflow, event, markdownOnly: false, testedMarker: null, passedNightly: null }

  if (workflow === 'tester' && event === 'push') {
    const tree = git('rev-parse', 'HEAD^{tree}')
    const name = encodeURIComponent(testedTreeArtifact(tree))
    const [{ artifacts }, { id: repositoryId }] = await Promise.all([
      github(`/repos/${repo}/actions/artifacts?name=${name}&per_page=20`, env),
      github(`/repos/${repo}`, env),
    ])
    facts.testedMarker = trustedMarker(artifacts, repositoryId)
  }

  if (workflow === 'nettlesertester' && event === 'schedule') {
    const { workflow_runs: runs } = await github(
      `/repos/${repo}/actions/workflows/e2e.yml/runs?event=schedule&status=success` +
        `&head_sha=${env.GITHUB_SHA}&per_page=1`,
      env,
    )
    facts.passedNightly = runs.find((run) => String(run.id) !== env.GITHUB_RUN_ID) ?? null
  }

  if (workflow === 'nettlesertester' && event === 'pull_request') {
    facts.markdownOnly = isMarkdownOnly(changedFiles(), markdownImports())
  }

  return facts
}

async function main() {
  const workflow = process.argv[2]
  if (workflow !== 'tester' && workflow !== 'nettlesertester') {
    throw new Error('Bruk: node scripts/ci-plan.mjs tester|nettlesertester')
  }
  const env = process.env

  let decision
  try {
    decision = decide(await lookUp(workflow, env))
  } catch (error) {
    console.log(`::warning::Kunne ikke avgjøre om kjøringen kan hoppes over (${error.message}). Kjører alt.`)
    decision = { run: true, reason: '' }
  }

  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `kjor=${decision.run}\n`)
  if (!decision.run) {
    console.log(decision.reason)
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `## Ingenting nytt å kontrollere\n\n${decision.reason}\n`)
    }
  } else {
    console.log('Kjører hele kontrollen.')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
