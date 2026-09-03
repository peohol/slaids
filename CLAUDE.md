# CLAUDE.md – Slaids

Nettleserbasert presentasjonseditor med rigid, matematisk sonelayout.

## Normative kilder

- `IMPLEMENTATION_PLAN.md` er **eneste** normative spesifikasjon. Les den før strukturelle endringer.
- `docs/archive/VISION.original-2026-08-20.md` er historisk kontekst, **ikke** normativ.
- `VISION.md` i repo-roten er bare en peker til de to over, og har ikke krav i seg.

## Kjerneinvariants

- Fast logisk designrom: `1600 × 900`. Skaleres uniformt til viewport.
- Layout er et rekursivt tre: `split` har `children` og aldri `content`; `leaf` har `content` og aldri `children`.
- Kort og beholdere deler den samme `CardBody`: en beholder er et gjennomsiktig kort.
- `children.length === weights.length`; 2–10 barn; alle weights er endelige tall `> 0`.
- Nøyaktig ett globalt gap `G` mellom alt synlig innhold. Nesting skal aldri doble gap.
  Strukturelle noder har aldri egen margin/padding som påvirker layoutgeometri.
  Temaet skalerer `G` sammen med alle andre avstander (`spacing`) – det er
  fortsatt én avstand, bare en annen. `src/domain/metrics.ts` er eneste
  utledning av tema-skalerte tokens; geometrimotoren, DOM-en og estimatoren
  leser alle den samme.
- `src/domain/geometry.ts` er eneste sannhetskilde for rects – både rendering og hit-testing.
- Persistens har to moduser, og valget tas ett sted: `src/persistence/activeRepository.ts`.
  Finnes både `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` er Supabase primærlagring;
  finnes ingen av dem er det IndexedDB via Dexie (lokal utvikling og tester). Dette er en
  **modus, ikke en fallback**: en konfigurert Supabase som er nede skal gi en forståelig feil,
  aldri stille lokal lagring – to konkurrerende sannhetskilder er verre enn en synlig feil.
  Aldri `localStorage` for presentasjoner/assets.
- Finnes **nøyaktig én** av variablene er det ingen modus, men en konfigurasjonsfeil: appen
  stopper med en oppstartsfeil og velger verken Supabase eller Dexie. Lokal lagring der ville
  betydd at produksjon stille skrev til nettleseren fordi en deploy-variabel manglet.
- I Supabase-modus kreves innlogging før bibliotek/editor monteres. Auth er Supabase Auth
  (delt prosjekt med Huskis) – aldri et eget bruker-/passordsystem. `owner_id` settes alltid
  fra den autentiserte sesjonen, og secret/service-role-nøkler skal aldri finnes i frontend.
- Utlogging bruker alltid `signOut({ scope: 'local' })`. Auth-prosjektet deles med Huskis, og
  global scope ville logget brukeren ut av Huskis på alle enheter.
- Å forlate editoren er et lagringspunkt. Autosave holder det ventende snapshotet i minnet
  og slutter å prøve på nytt når editoren unmountes, så «Tilbake» flusher først og blir
  stående hvis skrivingen ikke gikk igjennom. Ingen parallell flush i cleanup som kan race.
- Deling er **publisering, ikke samarbeid**, og bryter derfor ikke énbruker-modellen:
  en delt lenke gir ingen konto og ingen Auth-bruker, bare lesetilgang til én publisert
  kopi. Det finnes to dokumenter: den private arbeidskopien (`document`) og et sanitert
  snapshot (`shared_document`). Snapshotet bygges
  i `src/domain/sharing.ts` ved å liste opp hva som skal med – aldri ved å slette felter fra
  arbeidskopien, slik at et nytt felt på `Presentation` er privat til noen med vilje
  publiserer det. `sandbox`, `ideas`, `folderId`, `owner_id`, ubrukte filer og usiterte
  referanser forlater aldri arbeidskopien.
- `anon` har ingen tilgang til `slaids_presentations`. Den eneste offentlige inngangen er
  Edge Function-en `slaids-share`, som slår opp på token, svarer med snapshotet, og serverer
  en fil bare når nøyaktig det publiserte snapshotet lister den. Ingen listeform, ingen
  skrivetilgang, og samme generelle 404 for alt som ikke gir tilgang – ellers blir
  endepunktet en informasjonskanal. Service-role-nøkkelen finnes bare i funksjonens eget
  miljø, aldri i Vite, Vercel eller nettleseren.
- Delingsstatus er ikke en del av `Presentation`. Den bor på raden, og det er dét som gjør at
  den ikke kan angres med Ctrl+Z, ikke følger med `.slaids`-eksport/import, og ikke arves av
  en duplisering. En kopi starter alltid som ikke delt.
- `share_token` roteres både ved aktivering og ved deaktivering, så en tilbakekalt lenke
  aldri blir gyldig igjen. Publisering venter på at autosave har landet: en feilet lagring
  publiserer ingenting, og bryteren blir stående av.
- En ren endring av `is_shared`, `share_token` eller `shared_document` er ikke en redigering
  av dokumentet, og øker verken `version` eller `updated_at`. Ellers ville publisering gjort
  den åpne editorens kjente versjon utdatert og laget en falsk samtidighetskonflikt ved neste
  autosave. Den ekte optimistiske låsen gjelder fortsatt for `document`, `title`, `folder_id`
  og `slide_count`.
- Sidene i et dekk er `forside → authored slides → avledede referansesider → avledet QR-side`.
  De to første er lagret, de to siste ikke. QR-siden er ikke en `Slide` og ligger aldri i
  `presentation.slides`; den er et eget medlem av `DeckPage`-unionen i `src/domain/pages.ts`
  og finnes bare mens delingen er på.
- **Hver presentasjon har nøyaktig én forside, alltid først.** Den er et felt (`cover`) på
  `DeckSource`, ikke et element i `slides` – derfor er «alle presentasjoner har en forside»
  en egenskap ved typen, ikke en regel en kommando må huske, og ingen kommando kan slette
  den, flytte den eller lage en til. Den er ikke en `Slide`: intet layouttre, ingen soner,
  ingen soneredigering. Tittel og undertittel er én linje hver, alltid midtstilt (skjemaet
  har ikke noe justeringsattributt å sette), og de kan ikke sitere – et citation-nummer
  utledes av første forekomst blant slidene, så en citation der ville tegnet en tom pille.
  Se `IMPLEMENTATION_PLAN.md` §8.5.
- Forsidens pillefarge er samtidig dekkets standardfarge for de pilleformede overskriftene
  i innholdet. «Bruker standardfargen» betyr **ikke** samme hex-kode: en overskrift ingen
  har valgt farge for lagrer ingen farge (`color: null`) og males av
  `--slaids-heading-pill`, som settes fra `cover.pillColor`. Derfor treffer en endring på
  forsiden hver slik overskrift – også de som lages senere – uten at ett eneste lagret
  dokument endres. En overskrift som *har* fått en farge, beholder den.
- **Alt** under `/s/` er offentlig og går aldri gjennom `AuthGate` – grensen er stien, ikke
  tokenet. En avkortet eller feilskrevet lenke tilhører den som fikk den, og skal møte
  «Denne delingslenken er ikke aktiv», aldri eierens innlogging. Et syntaktisk umulig token
  besvares lokalt, uten et kall til delings-endepunktet. `src/Root.tsx` velger rute én gang,
  over porten, og den delte visningen monterer ingen privat komponent. Bilder i delt visning
  hentes gjennom delings-endepunktet, aldri gjennom det autentiserte repositoryet – valget
  tas av `AssetSourceProvider`, ikke av en gren inne i rendereren.
- Agent-API-et over HTTP ligger under `/api/agent/v1/` og er tynt: autentiser, valider,
  oversett til Agent Core-input, kall inn, oversett svaret. Ingen domeneregler der.
  Operasjonsnavn, JSON Schema og scopes hentes fra `describeOperations()` – aldri en
  andre, håndholdt kopi av kontrakten.
- Adressene til agent-API-et – MCP-endepunktet inkludert – rutes av **én statisk funksjon**
  (`api/agent/v1.ts`) pluss en eksplisitt rewrite i `vercel.json` for
  `/api/agent/v1/:__slaidsPath*` – aldri av en `[...path]`-catch-all. Catch-allen deployet grønt og svarte på `/api/agent/v1/operations`,
  mens `/api/agent/v1/operations/<navn>` – adressen hver eneste operasjon kalles på – fikk
  Vercels egen tekst-404 og aldri nådde koden. Rewriten leverer resten av stien i
  `AGENT_API_PATH_PARAM`, og `agentApiUrl` i `src/routing.ts` setter adressen sammen igjen og
  fjerner parameteren før ruting – query-strengen er input for en råopplasting, og et felt
  plattformen la til ville blitt avvist av et strengt skjema. `src/server/agent/deployment.test.ts`
  følger en adresse med to ledd hele veien fra `vercel.json` til operasjonens eget svar.
  Hver `.ts`-fil under `api/` blir et offentlig endepunkt, så det ligger nøyaktig én der.
- MCP ligger på `POST /api/agent/v1/mcp`, i den samme funksjonen og bak det samme tokenet
  som REST. Transporten er **Streamable HTTP, tilstandsløs**: én JSON-RPC-melding per POST,
  svar som `application/json`, ingen `Mcp-Session-Id`, ingen SSE-strøm (`GET` og `DELETE`
  svarer `405`), ingen batcher. Tokenet er identiteten på hver melding, og den eneste
  tilstanden mellom to kall er presentasjonens `revision` – det er dét som gjør endepunktet
  riktig på en plattform som kan svare fra to kalde instanser.
- **Slaids annonserer bare protokollrevisjonen den faktisk implementerer**, i dag `2025-06-18`
  alene. `2025-03-26` ville lovet en klient at endepunktet tar imot JSON-RPC-batcher, som det
  avviser, og `2024-11-05` ville lovet den gamle HTTP+SSE-transporten med to endepunkter som
  ikke finnes her. `negotiateProtocolVersion` svarer aldri med en revisjon som ikke står i
  `SUPPORTED_MCP_PROTOCOL_VERSIONS`, og `MCP-Protocol-Version` valideres mot den samme listen.
  Mangler headeren, leses den som den ene revisjonen serveren har – aldri som spesifikasjonens
  `2025-03-26`-fallback, siden den ikke er implementert.
- `Origin` valideres på MCP-endepunktet, som Streamable HTTP krever mot DNS rebinding, og
  Slaids validerer den ved å **avvise enhver forespørsel som bærer en**. Å sammenligne
  `Origin` med forespørselens egen vert er verdiløst: i angrepet er begge sider angriperens –
  siden ligger på `evil.example`, DNS-en peker om til denne serveren, og nettleseren sender
  `Host: evil.example` og `Origin: https://evil.example`, som matcher. En sjekk som
  sammenligner en forespørsel med seg selv beviser ingenting. Den betrodde listen må komme fra
  et sted angriperen ikke styrer, og Slaids har ingen browser-origin å betro: en MCP-klient er
  et program, ikke en side, og sender ingen `Origin`. Sjekken skjer før kroppen leses.
  Skal en browser-basert MCP-klient noen gang støttes, må de betrodde origin-ene leses fra
  servermiljøet – aldri fra forespørselen.
- **REST og MCP deler `src/server/agent/invoke.ts`.** Begge kaller `authorizeOperation` og
  `performOperation`, i den rekkefølgen. «Samme operasjon gir samme svar og samme feil over
  begge transportene» er derfor en egenskap ved koden, ikke et løfte om to adaptere skrevet
  nøye. Alt som er igjen i adapterne er serialisering.
- MCP-verktøylisten genereres av `describeOperations()` – navn (med `slaids_`-prefikset som
  navnerom), beskrivelse, JSON Schema og scopes er operasjonens egne. **Det finnes ikke ett
  eneste operasjonsnavn som streng i `src/server/mcp/`**, og en test håndhever det: en
  håndskrevet liste ville blitt oppdaget først den dagen den manglet en ny operasjon.
- I MCP avgjøres det av **om et ekte verktøy fikk bestemme** hvor en avvisning havner, ikke av
  hvor alvorlig den er. Kjørte en operasjon og sa nei – innhold som ikke får plass, stale
  revisjon, noe som ikke finnes, et scope tokenet mangler – er det et *resultat* med
  `isError: true` og hele feilobjektet i `structuredContent.error`: en agent skal lese koden og
  handle på den, og de fleste klienter viser et resultat til modellen og en JSON-RPC-feil til
  loggen. Var kallet aldri gyldig – uparsbar JSON, ukjent metode, en batch, et verktøy som ikke
  finnes (`UNKNOWN_OPERATION`), eller argumenter som ikke passer verktøyets skjema
  (`INVALID_INPUT`) – er det en JSON-RPC-feil, med det samme feilobjektet i `data`.
  Referanseimplementasjonen trekker streken nøyaktig der (begge er `InvalidParams` i den), og
  `NEVER_A_VALID_CALL` i `src/server/mcp/server.ts` er den ene listen som avgjør det.
- Konvolutten (`jsonrpc.ts`) og metodenes egne parametre (`requests.ts`) valideres hver for seg,
  begge før dispatch. En melding kan være en helt gyldig JSON-RPC-forespørsel og likevel være
  et kall ingen MCP-metode kunne ta imot – `initialize` uten `clientInfo`, en `cursor` som er et
  tall – og da er svaret `INVALID_PARAMS`, aldri stille ignorering. `id: null` er ugyldig MCP og
  besvares som en ugyldig forespørsel, aldri som en notifikasjon: en klient som sendte den
  venter på svar, og `202` med stillhet er det ene den ikke kan håndtere.
- Auditen skiller ikke på transport, og skal ikke gjøre det: et `tools/call` skrives ned
  under operasjonens eget navn med statusen feilkoden ville hatt over HTTP, så REST og MCP
  kan leses i én spørring. Bare protokolltrafikken har egne navn (`mcp:initialize`,
  `mcp:tools/list`).
- **Temaet styres av agenten gjennom den samme kommandoen som modalen.**
  `get_presentation` bærer temaet – ingen egen `get_theme`, fordi flaten skal være
  liten og en agent som har lest presentasjonen har lest temaet – og `set_theme`
  setter det via `setTheme`. Ingen validering, klamping eller temalogikk i
  agentlaget. Fonter navngis med id fra `src/domain/fonts.ts`, og det publiserte
  fontenumet **genereres fra katalogen**; en andre liste ville blitt oppdaget
  først den dagen editoren fikk en font agenten ikke kunne velge. Luft og
  skriftstørrelse publiseres med domenets eget intervall (`SPACING_RANGE`,
  `FONT_SCALE_RANGE`), mens editorens fire navngitte trinn bor i
  `src/domain/metrics.ts` (`SPACING_PRESETS`, `FONT_SCALE_PRESETS`) og siteres i
  beskrivelsen – de er et utvalg, ikke grensen. En temaendring måler hele dekket
  på nytt og avvises i sin helhet: også fargen som fulgte med en skriftstørrelse
  som ikke gikk.
- **Hodeløs fit-måling dømmer den fonten som ble navngitt, aldri en reservefont.**
  Estimatoren leser `advanceRatioFor(stack)` – katalogens eget tall for den
  fonten – så et agentkall trenger verken nettverk eller webfont-venting, og et
  tema som ble godkjent er det samme temaet previewet tegner. Nettleseren er det
  motsatte tilfellet: der måles den ekte DOM-en, og derfor venter `ThemeModal` på
  `ensureWebFonts` før den commit-er. At agentens inndata er begrenset til
  katalog-id-er er det som holder de to like; en ukjent stack ville falt tilbake
  på `DEFAULT_ADVANCE_RATIO`, som beskriver ingen bestemt font.
- Scopes (`presentations:read/write`, `assets:write`, `sharing:write`) er deklarert på
  selve operasjonen og håndheves serverside på hver forespørsel. `defineOperation` krever
  feltet, så en ny operasjon kan ikke arve «det minst privilegerte tokenet har» ved å tie.
  Vanlig redigering gir aldri rett til å publisere.
- Et agenttoken er en delegasjon fra eieren, ikke en ny bruker. 32 tilfeldige bytes,
  generert i eierens nettleser, vist én gang; bare SHA-256 lagres. `owner_id` settes fra
  tokenraden, aldri fra kalleren. Manglende, ukjent, tilbakekalt og utløpt gir det samme
  401-et med den samme setningen – hvilken av dem det var, hører hjemme i auditen.
- Serverklienten holder en secret key og går forbi row level security. Derfor pinnes
  `SupabaseSlaidsRepository` til tokenets eier og skriver eierfilteret RLS ville lagt på.
  Nøkkelen skal aldri finnes under et `VITE_`-navn – oppstarten nekter å starte hvis den
  gjør det, fordi den da allerede ligger i nettleserbundelen. Uten konfigurasjon svarer
  API-et 503; en server har ingen IndexedDB å falle tilbake på.
- Auditen lagrer identitet, tidspunkt, operasjon, presentasjon, utfall og feilkode – aldri
  slideinnhold, filbytes eller hele payloads. Formen er lukket i `src/server/agent/audit.ts`
  og tabellen har ingen kolonne slikt kan havne i.
- `src/server/` importeres aldri fra resten av `src/`. En import derfra ville kompilert,
  bestått testene og dratt hele operasjonsregisteret inn i nettleserbundelen.
- **Rendret preview bruker Slaids' egen renderer, aldri en til.** `render_slide_preview`
  tegner markupen `DeckPageView` lager – den samme komponenten presentasjonsmodus, den
  delte visningen og filmstripen bruker – inne i den samme `SlideRenderProvider`, under
  appens egne stilark importert med `?inline` fra `src/styles/`. Det finnes ingen geometri,
  typografi, layout eller fit-regel i `src/render/`: en regel lagt til i `slide.css` er i
  previewet uten at noen oppdaterer noe. En egen «agentrenderer» – satori, en
  vektorrasterizer, en egen tekstmåler – er nettopp det §44 forbyr, fordi den slutter å
  stemme med editoren i stillhet.
- Rasteriseringen er en ekte Chromium (`puppeteer-core` + `@sparticuz/chromium`, vanlige
  avhengigheter, ingen nedlasting ved kjøring). Nettleseren gjenbrukes per varm instans.
  Binærene er brotli-blober pakken finner via `import.meta.url`, så **ingen importgraf
  nevner dem**: de står eksplisitt i `vercel.json` (`includeFiles`), og
  `deployment.test.ts` håndhever det. Uten den linjen ville hver preview svart «the input
  directory does not exist» bak en grønn deploy.
- **De to nettleserpakkene pinnes eksakt, og majoren deres må være den samme.**
  `puppeteer-core` er bygget mot én bestemt Chrome-build (`PUPPETEER_REVISIONS.chrome`),
  og `@sparticuz/chromium` *er* Chromium-versjonen – og følger uttrykkelig ikke semver, så
  en `^` der er en lisens til å bytte nettleser under driveren. Ingen av pakkene sjekker
  den andre, og et avvik feiler verken ved install, bygg eller oppstart: det feiler på den
  CDP-kommandoen de to er uenige om, i produksjon, på én kodevei. `browserVersions.test.ts`
  følger kjeden `package.json` → driverens mål → pakken → binæren, og den siste lenken
  spør nettleseren selv.
- Fontene hentes serverside og bakes inn som `data:`-URL-er (`src/render/fonts.ts`), ikke
  lenkes inn i dokumentet. En headless Chromium som henter dem selv kostet tolv sekunder
  per bilde, hver gang, fordi en sides HTTP-cache ikke er noe neste invokasjon kan regne
  med. Bare `fonts.gstatic.com` hentes fra – stilarket er et svar utenfra som navngir
  URL-er å hente – og en familie som ikke kan hentes lenkes i stedet og rapporteres som
  `fontsReady: false`, aldri som en stille reservefont.
- Previewdokumentet kjører ingenting og henter ingenting: ingen script-tagg, statisk markup,
  innbakte fonter, og assets som `data:`-URL-er hentet *før* markupen bygges –
  `renderToStaticMarkup` kjører ingen effekter, så en `useEffect`-basert URL ville gitt et
  preview med «Laster figur …» i stedet for figuren. Det er dét
  `AssetUrlSource.resolveSync` er til for.
- **Agent Core er fortsatt React-fritt.** Rendereren injiseres gjennom
  `AgentContext.preview`, som repositoryet og fit-sjekkerne. `src/agent/preview.ts` sier
  hva et preview er, `src/render/` er implementasjonen, og en installasjon uten renderer
  svarer `PREVIEW_UNAVAILABLE` (`PREVIEW_FAILED` når nettleseren finnes og forsøket gikk
  galt) – aldri et bilde av ingenting.
- `src/render/` importeres av **nøyaktig én** fil i serverlaget:
  `src/server/agent/index.ts`, deployment-sømmen. Appen importerer det aldri, og
  `puppeteer-core` finnes ingen andre steder i `src/`. `boundary.test.ts` håndhever begge
  retninger; klientbundelen er byte for byte den samme som før previewet fantes.
- Bildet er én verdi og to serialiseringer. Operasjonen svarer med et `AgentImage`, og
  `detachImage` i `src/agent/image.ts` deler svaret i JSON og bytes – kalt fra
  `performOperation`, altså den ene funksjonen begge transportene deler. REST svarer med
  bildet (`Content-Type: image/png`, revisjonen i `X-Slaids-Revision`), og hele det
  strukturerte svaret er ett `Accept: application/json` unna med bildet som base64. MCP
  svarer med en `ImageContent`-blokk, fordi det er den blokken en klient gir videre til en
  multimodal modell; `structuredContent` beskriver bildet og gjentar det ikke.
- Et preview er en **lesing**: `presentations:read` alene holder, ingenting lagres, og
  revisjonen svaret bærer er den lesingen bildet viser – så en agent kan rendre, tenke og
  skrive mot den samme revisjonen. `slideId` slås opp mot `deckPages`, så forsiden
  (`__cover__`) og de avledede referansesidene er adresserbare; QR-siden er ikke med, siden
  den bare finnes mens delingen er på.
- Serverfunksjonen deployes som **én bundel** (`src/server/generated/agentApi.js`), ikke som
  kildetreet. Vercel kompilerer hver `.ts`-fil for seg og lar Node løse importene mellom
  dem; TypeScript skriver modulnavn ordrett, og Nodes ESM-resolver har verken
  filtypegjetting eller index-oppslag – så en `api/`-fil som importerer `src/` direkte
  krasjer ved første kall, med en grønn deploy bak seg. `scripts/check-agent-bundle.mjs`
  laster bundelen i vanlig Node under byggingen, så den feilen stopper der.
- Supabase-prosjektet er delt med Huskis og mdeditz, men `supabase_migrations.schema_migrations`
  er prosjektglobal og inneholder deres migrasjoner. **`supabase db push` skal aldri kjøres
  herfra**, og verken `migration repair` eller `db pull` er svaret når den klager – begge
  skader en annen app. Slaids fører sin egen historikk i `public.slaids_migrations` via
  `scripts/deploy-migrations.sh`. Slaids eier bare `slaids_`-prefiksede objekter og sin egen
  Edge Function; `functions deploy --prune` ville slettet de andre appenes funksjoner.
- Slaids-migrasjoner skal være idempotente (`if not exists`, `create or replace`,
  `drop … if exists` før `create`). Det er dét som gjør at en fil kan kjøres på nytt – i SQL
  Editor, eller mot en base der historikken ikke er komplett – uten å gjøre skade.
- **Slaids genererer aldri bilder.** Ingen bildegenerering i appen, ingen ekstern
  bildetjeneste, ingen `generate_image(prompt)`. Et rasterbilde kommer inn ferdig
  (`upload_asset`), en figur kommer inn som SVG-markup (`create_svg_asset`), og
  begge blir helt vanlige assets som `set_zone_asset` plasserer. SVG saneres i
  `src/domain/svg.ts` uansett hvilken av de to dørene den kom gjennom, og lagres
  som reserialisert markup – aldri kallerens streng. Formatet avgjøres av bytene
  (`src/domain/imageBytes.ts`), ikke av hva kalleren kaller filen, og et
  rasterbilde valideres i sin helhet (`src/domain/imageFile.ts`) før det lagres:
  et filhode er ikke et bilde, og størrelsen tas alltid fra bitstrømmen. Et rendret
  preview er ikke et unntak: det er et fotografi av en slide som allerede finnes, aldri
  en generert illustrasjon. Se `IMPLEMENTATION_PLAN.md` §44.
- Rich text lagres som ProseMirror/Tiptap JSON, aldri rå HTML. Ekstern paste normaliseres.
- Alt persistert data valideres med Zod og har `schemaVersion` + migrations.
- Content fit: en lovlig redigering skal aldri ende med at synlig innhold blir skjult.
  Den tilstanden som skal vises etter commit, er den som måles før commit – inkludert
  prospektiv geometri, prospektiv font (vent på webfont-readiness) og prospektiv
  citation-nummerering. Unntak hører hjemme i `src/domain/commands/fitGuard.ts`, med begrunnelse.

## Arkitekturregler

- **Ikke muter domeneobjekter direkte fra React.** All strukturendring går gjennom typed
  domenekommandoer i `src/domain/commands/`, som returnerer `Ok`/`Err` med typed feilkoder.
- Domain-, geometry- og repository-lagene er headless og React-uavhengige (gjenbrukes senere av REST/MCP).
- `src/agent/` (Agent Core) er agentflaten, og er transportuavhengig: ingen HTTP, ingen MCP,
  ingen modell- eller leverandørspesifikk kode. `src/server/agent/` er REST-adapteren over
  den, `src/server/mcp/` er MCP-adapteren, og `api/agent/v1.ts` er Vercel-inngangen – seks
  linjer som leser miljøet og kaller inn. Operasjoner er semantiske og går gjennom
  domenekommandoene med fit-sjekkere påslått; en agent skriver aldri rå `ZoneContent`-JSON.
  Repository og fit-sjekkere injiseres via `AgentContext` – aldri importert direkte.
- MCP-protokollen er skrevet for hånd (`src/server/mcp/jsonrpc.ts` og `endpoint.ts`), ikke
  hentet fra `@modelcontextprotocol/sdk`. SDK-ens servertransport bygger på Nodes
  `IncomingMessage`/`ServerResponse`, mens plattformen her gir en web-`Request` og venter en
  `Response`; og en tilstandsløs Streamable HTTP-server er noen få titalls linjer. SDK-en er
  derfor en **devDependency og et orakel**: `src/server/mcp/interop.test.ts` kjører den
  offisielle klienten mot en ekte socket, og `requests.test.ts` kjører spesifikasjonens egne
  skjemaer mot hver melding parameterleserne godtar – så protokollen valideres mot referansen
  i stedet for mot vår egen lesing av spesifikasjonen. Den skal aldri bli en
  runtime-avhengighet.
- Design-tokens (`G`, min-størrelser, typografi) bor i `src/domain/constants.ts` – ikke hardkod verdier i UI.

## Kommandoer

```bash
npm run dev          # Vite dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
npm run build        # produksjonsbuild
npm run e2e          # Playwright (bygger og serverer selv)

# Databasen. Aldri `supabase db push` – se invarianten over.
SLAIDS_DB_URL=... ./scripts/deploy-migrations.sh --dry-run   # leser bare, endrer ingenting
SLAIDS_DB_URL=... ./scripts/deploy-migrations.sh

# Den offentlige lesefunksjonen. Aldri med --prune.
supabase functions deploy slaids-share --project-ref <ref>
```

I Vercel må **begge** `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` være slått på
for både Production og Preview. Er de bare satt for Production, bygges PR-previews uten
noen av dem – og det er ikke en feil, det er lokal modus, så previewen kjører mot en tom
Dexie-base og ser tom ut.

Agent-API-et trenger i tillegg to **servervariabler**, uten `VITE_`-prefiks:
`SLAIDS_SUPABASE_URL` (eller `SUPABASE_URL`) og `SLAIDS_SUPABASE_SECRET_KEY` (eller
`SUPABASE_SERVICE_ROLE_KEY`). De hører bare hjemme i servermiljøet – `VITE_*` bygges inn i
nettleserbundelen, og finner oppstarten nøkkelen under et slikt navn, nekter den å starte.

Playwright laster ned egen nettleser. Finnes det allerede en Chromium i miljøet:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/sti/til/chrome npm run e2e`

Previewtestene i `npm test` starter også en ekte Chromium, men den kommer fra
`@sparticuz/chromium` (en vanlig avhengighet), så det trengs ingenting.
`SLAIDS_CHROMIUM_EXECUTABLE=/sti/til/chrome` overstyrer den – lokalt og i
produksjon.

## Verifikasjon

En UI-endring er ikke ferdig før den er kjørt i browser: start appen, klikk gjennom flyten,
sjekk console for feil, sammenlign DOM-geometri mot geometry engine og test reload-persistens.
Kjør `npm run typecheck && npm run lint && npm test` før commit.
