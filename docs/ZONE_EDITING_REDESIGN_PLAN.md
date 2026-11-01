# Overhaling av soneredigering i Slaids – plan

**Dato:** 01.11.2026  
**Status:** Planlagt, ikke implementert.  
**Ansvar:** ChatGPT utarbeider planen og kontrollerer PR-er; Claude Code implementerer.  
**Omfang:** Soneredigeringsmodal, visualisering av sonetreet og nødvendige sammenhenger med inspektør, soneoverlegg og malredigering.  
**Normativ forankring:** IMPLEMENTATION_PLAN.md, særlig § 9–11.5 og § 44.6; docs/UX_DESIGN_SYSTEM.md og docs/MOBILE_WORKSPACE.md. Ved konflikt med eldre beskrivende tekst undersøkes faktisk domenekontrakt og nyeste vedtak før implementering.

## 1. Mål

Brukeren skal uten å gjette forstå **hvilken sone** som er valgt, **hvilken deling** som endres, **hvilke direkte subsoner** som påvirkes, **hvilke underinndelinger** som bare vises som kontekst, **hva de nye forholdstallene betyr**, og **om noe innhold kan flyttes eller slettes**.

Forhåndsvisningen skal alltid vise hele den aktuelle sonen innenfor et **størrelsesbegrenset, responsivt visningsfelt**, bevare dens faktiske aspektforhold og alle fire ytterkanter. Forhåndsvisningen må aldri ha egen scrolling eller kunne presse dialogen utover skjermens høyde. På svært lave skjermer kan dialogens *kontrolldel* fortsatt måtte rulle; ikke lov at forhåndsvisningen vokser med sonens aspektforhold.

Målet er en bedre mental modell for det rekursive sonetreet, ikke et nytt layoutsystem.

## 2. Bekreftede kodefunn og hypoteser

| ID | Kodefunn | UX-konsekvens |
| --- | --- | --- |
| F1 | src/ui/editor/SplitModal.tsx setter PREVIEW_WIDTH = 560 og previewHeight = targetRect.height * (560 / targetRect.width). | Smale, høye soner gir vilkårlig høy forhåndsvisning og scrolling i modalens body. |
| F2 | Samme fil tegner samtlige noder i foreslått tre; klasse «--split» brukes når node.kind === 'split'. | Heltrukne/stiplede grenser skiller nodetype, ikke redigeringsnivå. En direkte subsone med tre barnebarn ser selv ut som en ekstra redigeringsenhet. |
| F3 | src/styles/editor.css tegner cellekanter helt i kantene av en «split-preview» med egen border og overflow:hidden. | Sannsynlig forklaring på at nederste/høyre blå kant delvis klippes; verifiser i nettleser. |
| F4 | Modalens tittel og beskrivelse viser ikke sti til målsonen. Sti finnes allerede via breadcrumbLabels/pathToNode. | Brukeren må selv holde rede på om det er Rot, 2 eller 2.1 som endres. |
| F5 | Antall 2–10 styres med range-input; forholdstallene vises som nøytrale, løse tallfelt og lang hjelpetekst. | Vanskelig å knytte inndata til sonene og velge eksakt antall. |
| F6 | Ugyldig geometri erstatter hele tegningen med en generell feilmelding. Domenets fulle fit-guard kjøres først ved faktisk anvendelse. | Brukeren mister visuell kontekst ved feil; «Bruk» kan i enkelte innholdstilfeller avvises sent. |
| F7 | SplitModal henter tema direkte fra editorstore. TemplateModal beregner sin målrektangelgeometri på et separat scratch-dekk. | Mulig tema-/metrikksprik i malredigering; gjør geometrikontekst eksplisitt hos kalleren og test. |
| F8 | ZoneSizeControls håndterer både valgt split (egne barn) og valgt barn (størrelse blant søsken), mens begge vises under «Størrelse». | Oppgavene er teknisk forskjellige, men lite tydelig atskilt. |
| F9 | TemplateModal.LayoutPreview benytter også fast PREVIEW_WIDTH og egen absolutt-posisjonert forhåndsvisning. | Et nærliggende konsistenspunkt; vurder gjenbruk av visningsprimitiv, uten å endre malenes operasjoner eller tre. |

Kildekode er gjennomgått, men ingen interaktiv nettlesertest er gjennomført ved planleggingen. F3 og F7 må derfor bekreftes med reproduksjon før årsaksforklaring lukkes.

## 3. Et konsekvent visuelt språk

Brukerens eksempel er normerende: målsonen er delt **Over/under** i **to direkte subsoner**; den nederste har **tre egne subsoner**.

1. **Målsone:** Én nøytral, tydelig avgrenset ramme rundt hele visningsobjektet. Dette er den sonen brukeren redigerer, ikke en tredje «aktiv» subsone.
2. **Direkte subsoner (redigeres nå):** Heltrukket, tydelig kant og lett, ensartet fargetone; entydig markering «1», «2» ... «10». Disse skal være visuelt dominerende.
3. **Dypere subsoner (beholdes som kontekst):** Tynnere, mer dempede **stiplede** skiller, uavhengig av om noden selv er split eller leaf. Direkte subsone 2 skal ikke i tillegg få en stiplet ramme fordi den er split. Få fram grensene til dens tre barn; eventuelt diskrete stier «2.1», «2.2» og «2.3».
4. **Dybde:** Tegn ikke en ny full ramme for hver strukturell mellomnode. Tegn barnas nødvendige grenser; unngå doble linjer. Nedton ytterligere for dypere nivåer. Vurder å utelate uleselige indre etiketter og vise dem i en tekstlig oversikt fremfor å presse dem inn i svært smale felter.
5. **Forklaring:** Kort bildetekst under visningen: «Heltrukket: sonene du endrer. Stiplet: underinndelinger som beholdes.» Vis også «Du redigerer: Rot › 2» eller tilsvarende, fra sonetreet. En mer presis linje er «Du endrer fordelingen mellom 2 direkte subsoner».
6. **Knytt visning til kontroller:** Fokus/hover på forholdstallsfelt for «Sone 2» uthever bare den direkte subsonen. Et klikk inne i «2.3» skal aldri bytte redigeringsnivå i denne modalens pågående endring; det kan eventuelt fokusere feltet for direkte subsone 2. Dypere redigering gjøres ved å velge den sonen i editoren, ikke med nye nestede modaltrinn.
7. **Samme betydning uten farge:** Solid/stiplet, etiketter, rammetykkelse og tekst må bære skillet i lyst/mørkt utseende og høy kontrast. Bruk eksisterende chrome-tokens fra designsystemet, ikke ny presentasjonspalett.

**Aksept for eksemplet:** Nøyaktig to heltrukne, nummererte hovedsoner i forhåndsvisningen; den nederste inneholder tre stiplede subsoner; ingen stiplet ramme rundt hele nederste direkte subsone; bildeteksten forklarer skillet.

## 4. Visningsområde og skalering – ufravikelige kontrakter

- Visningsfeltet har en **øvre bredde og en øvre høyde**, for eksempel rundt 560 × 260–300 CSS-px på desktop. Dette er et maksareal, ikke et krav om å strekke sonen til begge dimensjoner. Tilgjengelig bredde og høyde reduseres responsivt, særlig ved lite vindu, mobil, åpnet tastatur og nettleserzoom.
- Beregn geometrien fra den samme prospektive, **kvantiserte** sonemodellen som domenet vil lagre. Behold riktig gap, undertrær og tema-avhengige mål. **Skaler uniformt** til både tilgjengelig bredde og tilgjengelig høyde, sentrer tegningen, og la ledig rom være tomt.
- Anbefalt teknisk uttrykk er SVG med viewBox og preserveAspectRatio="xMidYMid meet" i en avgrenset container, med ikke-skalerende strekbredde. Alternativt brukes eksisterende rects med en felles contain-skala: min(tilgjengelig bredde / målbredde, tilgjengelig høyde / målhøyde). **Ingen egen geometrimotor.**
- Legg inn synlig, beregnet innvendig sikkerhetsmargin slik at ytterste strokestreker (inkludert høyre og nedre side), fokusrammer og avrundede hjørner aldri skjæres av av border/overflow. Ikke løs dette ved å gjøre hele tegningen bredere enn containeren.
- Preview-containeren skal ha overflow uten scroll. Ingen intern x-/y-rulling, verken for 16:9, 1:10, 10:1 eller enda mer ekstreme gyldige rektangler. Ekstremt smale felt kan bli små; forholdstall, nummer og struktur må fortsatt kunne leses fra tekstlig tilleggsinformasjon.
- Skala og viewport må oppdateres ved endring i tilgjengelig plass; unngå faste JS-bredder som ignorerer CSS/containeren eller det synlige området når tastatur åpnes. Ikke baser logikken på slide-bredde alene.
- Unngå transform-triks som endrer visuell størrelse uten å endre plassopptak i modalens layout.

## 5. Ny organisering av modal og arbeidsflyt

### 5.1 Kontekst først

Øverst: «Del sone» eller «Rediger deling», deretter sti/sonenavn og konkret handling, for eksempel «Du endrer delingen i Rot. Direkte subsoner: 2.» Ved eksisterende underinndelinger: «Sone 2 inneholder 3 underordnede soner; disse beholdes.»

### 5.2 Kontroller på ett nivå

- Retning: «Side ved side» / «Over/under», tydelig valgt status og snarlig oppdatert preview.
- Antall direkte subsoner: eksakt justerbart med minus/pluss og synlig tall/velger for 2–10, heller enn en upresis slider. Endring i antall må ikke skjule konsekvensene av å fjerne eksisterende barn.
- Fordeling: én navngitt kontroll per direkte subsone, med samme nummer som i tegningen og en avrundet, **informativ** prosentandel av disponibel plass (eksklusive gap). Behold støtte for alle gyldige positive desimaltall, komma og verdier utenfor 1–10; det lagrede forholdet kvantiseres sentralt til heltall 1–10.
- Hurtigvalget «Fordel likt» bør være tilgjengelig. Gjenbruk eksisterende ratioPresets hvis flere forholdspresets tilbys; lag ikke parallell liste med andre regler.
- Flytt den lange forklaringen om ekvivalente forholdstall til en enkel «Hvordan fungerer forholdstall?»; vis derimot alltid den reelle verdien, f.eks. «Lagres som 1 : 2», nær feltene. Ikke presenter prosent som eksakt fysisk andel av hele målrektangelet når gap tar plass.
- Preview og kontroller skal være samtidig synlige i en **to-kolonners desktop-modal** der bredden tillater det. Ved smal skjerm stables de, med preview først; ved svært kort høyde kan kontroller rulle, men preview skal ikke være større enn visningsfeltet. Behold modalens faste header/footer og «Avbryt»/«Bruk».
- Ikke implementer direkte dragging i forhåndsvisningen i denne omgangen. Det gir et nytt interaksjonssystem, krever tastaturmotpart og risikerer feilaktig forventning om at de stiplede underinndelingene også kan dras. Stage har allerede dragehåndtak.

### 5.3 Håndtering av innhold og fjerning

- Når en fylt leaf deles: Vis hvilket **direkte barn** som får innholdet. Valget skal korrespondere visuelt med 1, 2 ... i preview. Behold trygg fallback til sandkassen hvis innholdet ikke får plass, men opplys eksplisitt om dette før «Bruk».
- Når antallet reduseres: Vis «Sone 3–N fjernes» og antall innholdselementer **i hele de berørte undertrærne**, også når undertrærne er nøstet. Bruk ikke bare «X innholdselementer mister sonen sin» uten å forklare strukturendringen.
- Standard er å redde innhold til sandkassen. Den eksisterende muligheten til å slette innhold kan beholdes, men krever **tydelig og separat bekreftelse** før den irreversible kommandoen. Bekreftelsen skal oppgi antall innholdselementer. Ingen automatisk sletting ved antallsjustering.
- Avbryt, Escape og lukking må forkaste *utkastet* uten å endre presentasjonen. Først «Bruk» skal gi én undo-bar strukturendring. Etter en avvisning må modal og felter stå åpne med synlig begrunnelse.
- Validering: Vis feltspesifikke feil ved ugyldig input; ved geometrisk «for liten» tegn lovlig foreslått geometri med problemsonene markert **hvis den kan beregnes**, i stedet for å fjerne hele forhåndsvisningen. Når tall ikke kan tolkes, vis en nøytral feilmelding uten å late som om en gammel skisse er det foreslåtte resultatet.
- Bruk de eksisterende domenekommandoene og fit-guard ved anvendelse. Dersom faktisk DOM-innhold kan kontrolleres på forhånd uten dobbelt implementert validering, gjør det. Ellers skal «geometri gyldig» ikke utlegges som garanti for at alt innhold passer; vis domenets eksakte avvisningsgrunn ved «Bruk».

## 6. Sammenheng med resten av soneredigeringen

### 6.1 Valg og inspektør

Behold eksisterende breadcrumb, tastaturnavigering og hit-test (inkludert treff på parent i gap). Skillet mellom de to størrelsesoppgavene skal gjøres eksplisitt i inspektøren:

- Valgt **delt sone**: «Fordeling inni denne sonen» redigerer dens direkte barn.
- Valgt **barn/søskensone**: «Størrelse blant søskensonene» endrer dens vekt i foreldrens deling.

Når modal åpnes fra soneoverlegg, inspektør eller kontekstmeny, skal samme målsti og samme handling vises. Tekst, nummer og forholdstall må identifisere samme noder.

### 6.2 Konsistent sonemarkering

Definer en enkel semantisk regel for appens chrome: heltrukket/sterkt markert = aktivt redigeringsmål i denne konteksten; stiplet/svakt = synlig strukturell kontekst. På scenen er **valgt sone** det aktive målet og andre soner fortsatt navigerbare, mens i delingsmodalen er **direkte barn av målsonen** det som får nye geometrier. Derfor kan detaljert tegning være forskjellig, men betydningen av markeringene skal ikke stride mot hverandre. Ikke legg igjen et nytt lag som dekker slidens innhold, eller endre etablerte dragegester bare for å få identiske streker.

### 6.3 Malredigering

SplitModal benyttes også fra TemplateModal: samme nye hierarki og bounding skal fungere der. Send riktig geometrikontekst eksplisitt fra kalleren, særlig tema/gap/minstemål; unngå at malens scratch-dekk måles med andre metrikker enn forhåndsvisningen. Vurder å bruke den samme avgrensede preview-primitiven i malredigeringens oversikt, dersom det faktisk eliminerer duplisering uten å gjøre malenes klikkbare valg vanskeligere.

## 7. Arkitektur og grenser

**Bevar:**
- Rekursivt LayoutNode-tre med split/leaf, stabile node-ID-er, child-count 2–10 og kvantiserte vekter 1–10.
- src/domain/geometry.ts, metrics, quantizeRatios, updateSplit, splitLeaf, fit-guard, Sandkasse, angre/gjør om og autosave.
- Én logisk gap-regel. Ingen ny «layoutgeometri» i CSS, React eller SVG.
- Tilgjengelige handlinger i inspektør, stage, kontekstmeny, touch og tastatur.
- Eksisterende relevante test-ID-er (split-modal, split-axis-x/y, split-count, split-weight-N, split-invalid, split-apply).

**Anbefalt komponentansvar:** SplitModal eier utkast/handlinger; en ren visualiseringskomponent mottar beregnede rects, direkte-barn-indekser, dybde og validitetsstatus; responsive mål styres av layout/SVG uten ny kilde til domenegeometri. En liten, ren funksjon kan beregne «primær versus etterkommer» og navngivning. Ikke innfør ny avhengighet eller refaktorer øvrige forhåndsvisninger bare for gjenbrukens skyld.

**Utenfor omfanget:** ny datamodell, friposisjonering, endring av slide-rendering, generelt redesignet modal-rammeverk, ny REST-/MCP-operasjon, og ny interaktiv drag-editor inne i denne previewen. Alle slike forslag krever egen beslutning.

## 8. Leveransepakker – Claude Code

**Z1 – Sannhetsgetro, avgrenset forhåndsvisning (første PR).**
- Utled viewport/skalering fra begge dimensjoner og faktisk tilgjengelig plass.
- Innfør visuell primær-/etterkommer-semantikk, nummer, sti, kort forklaring og sikre ytterkanter.
- Bruk samme rekursive geometri med gap/kvantisering. Håndter gyldige/ugyldige forslag.
- Sørg for at vanlig editor og maleditor får samme resultat.
- Legg til målrettede komponent-/E2E-tester og skjermbilder for nøstet eksempel og ekstreme aspektforhold.

**Z2 – Forståelig og trygg endringsflyt (andre PR).**
- Reorganiser modalens kontroller og responsive oppsett; presist antallsvalg, nummererte vektfelt, faktisk lagret forhold og «Fordel likt».
- Gi live sammenkobling mellom felt og direkte subsone. Behold inputfrihet og kvantiseringsregel.
- Tydeliggjør eksisterende innholdsmål, fjerning av undertrær, konsekvenser for sandkassen, separat bekreftelse ved sletting og forståelige feil.
- Test Avbryt/Bruk/angre/gjør om og innholdsfit.

**Z3 – Konsistens i hele soneredigeringen (tredje, avgrensede PR).**
- Avklar inspektørteksten for «fordeling inni sonen» kontra «størrelse blant søsken».
- Sørg for konsekvent målsti og handling fra alle innganger uten å endre domenekommandoer eller gester.
- Rydd bare i konkret duplisering mellom split-preview og mal-preview der det kan begrunnes.
- Fullfør keyboard/touch, kontrast, viewport-/zoom-, lys/mørk- og regresjonstestene.

**Ingen Z-pakke skal blandes med urelatert UX-opprydding.** Claude skal dokumentere avvik fra planen før de implementeres. Etter hver PR leveres før/etter-bilder, hvilke akseptkrav som er bestått, hvilke som står igjen, og om API/MCP-kontrakten er endret (forventet: nei).

## 9. Akseptanseprøver – mekanisk og manuelt

- [ ] «Rot» med 2 over/under, nederste med 3 subsoner: **to** tydelige redigerbare primærsoner, **tre** stiplede undersoneområder, ingen stiplet parentramme på hele subsone 2; labels og tekst korrekt.
- [ ] Flere nivåer, 2–10 direkte barn og eksisterende innhold: samme nummerorden i preview, inputfelter og lagret layout.
- [ ] Ekstreme gyldige målrektangler: 100×1000, 1000×100, svært smale nøstede soner, ulike faktiske tema-gap. Ingen preview-scroll, alle fire ytterkanter fullt synlige, korrekt aspect og én gap.
- [ ] Desktop 1600×1000, 1366×768 og 1025×768; mobil 412×892 og 892×412; smalt vindu 900×760; nettleserzoom 200 %, med og uten skjermtastatur. Ingen horisontal overflyt; modalens header/footer og handlinger kan nås; preview overskrider aldri sitt område.
- [ ] Lys/mørk, high contrast/forced colors, fargesvakhetsrobusthet og redusert bevegelse. Skillet aktiv/kontekst og feilstatus kan forstås uten farge alene.
- [ ] Både direkte sonevalg og malredigering: forhåndsvisning og faktisk commit svarer overens, også ved retning, antall og forholdstall.
- [ ] Gyldige desimaltall og komma, ekvivalente forholdstall, 0/negative/tomme/NaN/ekstreme tall, minimumsbrudd, fit-avslag. Ingen falsk forhåndsvisning og ingen taus feil.
- [ ] Reduksjon av antall med nøstet innhold viser eksakt hvilke subtrær som fjernes; sandkassen beholder innholdet, «Slett» krever ny bekreftelse, Avbryt endrer ingen ting.
- [ ] Tab, piltaster der relevant, skjermleser-label, Escape, touch på minst 44 px (når berøringsmodus), og konsekvent fokusretur.
- [ ] Angre/gjør om, persistering etter reload, hurtigsplitt via kontekstmeny, resize via stage og inspektør, eksisterende E2E, typecheck, lint og unit-tester består.
- [ ] Nye Playwright-tester testes på faktisk viewport og måler previewens bounding box/stroke-inset; skjermbilder i e2e/visual-chrome.spec.ts eller egen avgrenset spesifikasjon beskytter mot visuell regresjon.

## 10. Arbeidsregler og ansvar

Claude Code skal først lese dette dokumentet, relevante kapitler i IMPLEMENTATION_PLAN.md, UX_DESIGN_SYSTEM.md og de konkrete filene fra § 2. Implementer Z1, Z2 og Z3 som separate, vurderbare PR-er med tester og bilder. Ikke gjør direkte endringer på main. ChatGPT kontrollerer hver PR og avgjør om neste pakke kan starte. Oppdater planens status og relevante normative dokumenter når arbeid faktisk er levert, ikke før.

**MCP-konsekvens:** Ingen planlagte endringer i API, Agent Core, datamodell eller MCP-skjema. Slaids Dev MCP-verktøyet trenger dermed ikke oppdatering når tiltakene implementeres som spesifisert; vurder dette på nytt dersom Claude foreslår endringer utenfor omfanget.
