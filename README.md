# Slaids

Nettleserbasert presentasjonseditor for 16:9-presentasjoner med matematisk stram
soneinndeling. Slaids prøver ikke å gjenskape PowerPoint – styrken er det motsatte
av fri plassering: innhold tvinges inn i et rekursivt sonetre der **avstanden
mellom alt synlig innhold alltid er nøyaktig den samme**, uansett hvor dypt
layoutet er nestet.

> `IMPLEMENTATION_PLAN.md` er normativ spesifikasjon.
> `docs/archive/VISION.original-2026-08-20.md` er den opprinnelige visjonen, bevart som historikk.

## Kjerneidé

- Hver slide rendres i et fast logisk designrom på `1600 × 900` og skaleres uniformt.
- Layoutet er et rekursivt tre: `split` har barn og aldri innhold, `leaf` har innhold og aldri barn.
- Splits har 2–10 barn med eksplisitte forholdstall (`[1, 2]`, `[0.5, 1]` og `[2, 4]` er ekvivalente).
- En ren geometry engine (`src/domain/geometry.ts`) regner ut alle rektangler.
  Det globale gapet `G` løses aritmetisk – `usable = L - G × (n - 1)` – slik at
  nesting aldri kan doble en avstand.
- Editor, miniatyrbilder, presentasjonsmodus og innholdsmåling bruker samme
  renderer og samme geometri.

## Funksjonalitet i dag

**Bibliotek**

- opprett presentasjon med tittel, global bakgrunnsfarge og globale fonter
- åpne, gi nytt navn, dupliser (inkludert filer), slett med bekreftelse
- mapper, og flytting av presentasjoner mellom dem
- eksport og import av `.slaids`-sikkerhetskopi (zip med manifest, data og filer)

**Slides**

- opprett med eller uten overskriftssone, dupliser, slett, endre rekkefølge (DnD)
- overskriftssonen er deterministisk: én linje, fast høyde, tekst som ikke får plass avvises

**Soneredigering**

- stiplede sonegrenser, slør med backdrop blur over valgt subtre, handlingsknapper
- hit-testing via geometry engine – klikk i gapet velger supersonen
- piltastnavigering opp/ned/venstre/høyre med wraparound, og klikkbar breadcrumb
- splitt sone (2–10 barn) med orientering, forholdstall og live geometri-preview
- rediger eksisterende splitting; innhold som mister sonen sin kan reddes til sandkassen
- dra i gapet mellom subsoner for å justere forholdstall direkte
- minimumsstørrelse valideres for hele subtreet, ikke bare for det enkelte bladet

**Innhold**

- beholder (transparent), kort uten tittel, kort med tittel
- 1–6 subfelt per kort med egne forholdstall, orientering og skillelinjer
- rik tekst via Tiptap: avsnitt, overskrift (pilledesign), fet/kursiv/understreket,
  punktlister, nummererte lister, sitat, kode, lenker og tabeller
- bilder og SVG som filer i IndexedDB, enkle vektorfigurer, 12 × 4-fargepalett
  med automatisk tekstfarge etter kontrast
- referanser med avledet nummerering (`1–3, 5, 6, 8–10`) og automatisk genererte referanseslides
- sandkasse for innhold som midlertidig er utenfor en sone, med fit-bevisst DnD
- strukturell utklippstavle (Ctrl+C/X/V i sonemodus) og normalisert ekstern paste
- idé-panel og layout-maler
- angre/gjør om, autosave med eksplisitt status

**Innholdsgrense**

Innhold som ikke får plass i sonen sin blir avvist: redigeringen rulles tilbake til
siste gyldige dokument (aldri midt i en IME-komposisjon), og strukturelle
operasjoner som ikke har plass til innholdet blokkeres eller flytter innholdet til
sandkassen.

## Kom i gang

```bash
npm install
npm run dev          # http://localhost:5173
```

## Utviklingskommandoer

| Kommando            | Hva den gjør                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Vite dev-server                               |
| `npm run build`     | Typecheck + produksjonsbuild                  |
| `npm run preview`   | Serverer produksjonsbuilden på port 4173      |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm run lint`      | ESLint                                        |
| `npm test`          | Vitest (domene, geometri, schema, persistens) |
| `npm run e2e`       | Playwright (bygger og serverer selv)          |

Playwright laster normalt ned egen nettleser. I miljøer uten nedlasting kan du
peke på en eksisterende Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/sti/til/chrome npm run e2e
```

## Arkitektur

```
src/
  domain/        headless kjerne: typer, geometry engine, layouttre, kommandoer,
                 Zod-schema, migrasjoner, referanser, farger, fit
  persistence/   SlaidsRepository + Dexie/IndexedDB, assets, .slaids-backup
  state/         Zustand-store, autosave, DOM-måling, utklippstavle
  ui/            React-komponenter (bibliotek, editor, slide-renderer, visning)
```

Regler som gjelder overalt:

- **UI muterer aldri domeneobjekter direkte.** All strukturendring går gjennom
  typede kommandoer i `src/domain/commands/`, som returnerer `Ok`/`Err`.
- Domene-, geometri- og repository-lagene er React-uavhengige, slik at et senere
  REST/MCP-API kan bygges på nøyaktig de samme kommandoene.
- Alt som lagres har `schemaVersion` og valideres med Zod ved innlasting.

## Ikke bygget ennå

Supabase, innlogging, REST-API, MCP-server og agenttokens er bevisst utenfor
scope i denne fasen. Repository-abstraksjonen og kommandolaget er laget slik at
de kan legges til uten å skrive om domenemodellen.
