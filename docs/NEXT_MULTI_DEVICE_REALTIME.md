# Neste leveranse etter mobil-PR: multi-device kontinuitet og realtime

> **Status:** Planlagt, ikke implementert.
>
> **Rekkefølge:** Dette er neste større leveranse etter mobil-PR-en som innfører sveiping, fullhøyde slideoversikt, lokal pinch-zoom i slideområdet og direkte tekstredigering i fokusert sone.
>
> **Normativ status:** Dette dokumentet er en arbeidsplan/agenda, ikke en parallell produktspesifikasjon. Når arbeidet starter, skal relevante varige produkt- og arkitekturregler først innarbeides i `IMPLEMENTATION_PLAN.md`, som fortsatt er eneste normative spesifikasjon.

## 1. Mål

Slaids skal oppføre seg som én sammenhengende arbeidsflate på tvers av brukerens enheter:

1. Appen åpner på samme sted brukeren sist forlot den, på tvers av enheter.
2. Endringer i en åpen presentasjon dukker opp på andre åpne enheter uten reload.
3. En klient skal aldri stille overskrive en nyere lagret versjon fra en annen klient eller agent.
4. UI-et skal skille tydelig mellom «synkronisert» og «frakoblet / kan være utdatert».
5. Samtidig redigering av ulike deler av samme presentasjon skal fungere uten at én enhet overskriver hele dokumentet med et gammelt snapshot.
6. Samtidig redigering av nøyaktig samme tekstfelt skal ikke tillates før Slaids eventuelt får en ekte samarbeids-/CRDT-motor.

Dette er primært en same-user/multi-device-leveranse, ikke et generelt Google-Docs-lignende flerbrukersamarbeidssystem.

## 2. Del A — serverlagret arbeidsposisjon

Dagens `LAST_OPEN_PRESENTATION_KEY` i `localStorage` er lokal for én browser og er derfor ikke tilstrekkelig.

Innfør en liten serverlagret brukerstatus, separat fra presentasjonsdokumentet. Den bør minst kunne uttrykke:

- `surface`: `library` eller `presentation`
- `presentation_id`: nullable
- `slide_id`: nullable
- `updated_at`

Én rad per bruker er tilstrekkelig. Dette er navigasjons-/arbeidsflate-state, ikke presentasjonsdata og ikke undoable dokumentinnhold.

### Regler

- Når brukeren åpner en presentasjon: lagre `surface=presentation`, presentasjons-ID og aktuell slide.
- Når brukeren bytter slide: oppdater siste slide med lett debounce/coalescing slik at rask navigasjon ikke gir unødvendige writes.
- Når brukeren eksplisitt lukker presentasjonen og går tilbake til biblioteket: lagre `surface=library` og nullstill presentasjon/slide.
- Ved appstart etter autentisering: hent denne statusen før endelig startflate velges.
- Dersom lagret presentasjon ikke lenger finnes, gå til biblioteket og reparer statusen.
- Dersom presentasjonen finnes, men lagret slide er slettet, åpne en gyldig fallback-slide og reparer statusen.
- En allerede åpen enhet skal **ikke** tvinges til å følge slidevalget fra en annen enhet. Den serverlagrede arbeidsposisjonen brukes til neste åpning/ny sesjon, ikke som live fjernstyring av navigasjonen.
- Local/Dexie-modus kan beholde lokal preferanse som fallback; cross-device-garantien gjelder Supabase-modus.

Schema/RLS skal følge eksisterende eiermodell. Slaids-migrasjoner deployes med prosjektets `scripts/deploy-migrations.sh`, aldri med forbudte globale Supabase-kommandoer nevnt i `CLAUDE.md`.

## 3. Del B — realtime signal om ny autoritativ versjon

Produksjonseditoren skal abonnere på endringer for presentasjonen som er åpen.

Foretrukket form:

- ett privat realtime-tema/channel per presentasjon og bruker;
- database-trigger eller tilsvarende serverstyrt broadcast når presentasjonsraden faktisk er lagret;
- broadcast-payload skal være liten: presentasjons-ID, ny versjon/revisjon og nødvendig metadata — ikke hele presentasjons-JSON-en;
- mottakeren henter deretter den autoritative raden gjennom eksisterende repository-lag.

Fordeler:

- alle skrivere omfattes, også Agent API og andre fremtidige serverklienter;
- frontend slipper å stole på at hver skriver husker å sende et event;
- store presentasjoner sendes ikke som realtime-payload flere ganger.

Realtime skal være et tillegg til repositoryets eksisterende conflict guards, ikke en erstatning for dem.

## 4. Del C — synkroniseringsstatus

Editoren skal ha eksplisitt connectivity/sync-state, minst konseptuelt:

- `connecting`
- `synced`
- `local_changes`
- `reconciling`
- `offline_or_stale`
- `conflict`

UI-et trenger ikke vise alle interne tilstander med hvert sitt ord, men følgende brukerbetydning må være tydelig:

- Når realtime-abonnementet er friskt og klienten har hentet siste versjon: vis at dokumentet er synkronisert.
- Når det finnes lokale ulagrede endringer: eksisterende lagringsstatus skal fortsatt gi mening.
- Ved bortfall av nett/realtime: vis tydelig at visningen **kan være utdatert**.
- Ved reconnect: hent autoritativ siste versjon før klienten igjen hevder at den er synkronisert.

«Alltid siste versjon» må aldri påstås mens klienten faktisk ikke kan vite det.

## 5. Del D — remote update uten lokale endringer

Hvis en nyere serverversjon ankommer og klienten ikke har lokale endringer:

1. hent ny autoritativ presentasjon;
2. erstatt dokumentet i editor-store uten å opprette en lokal undo-handling;
3. behold gjeldende slide og valgt sone når de fortsatt finnes;
4. fall tilbake deterministisk dersom en remote-endring har slettet dem;
5. re-render og re-mål gjennom eksisterende felles rendering/fit;
6. remote endringer skal ikke kunne angres som om de var lokale handlinger.

Unngå at vanlig realtime-oppdatering remounter hele editoren eller mister unødvendig UI-state.

## 6. Del E — remote update mens lokale endringer finnes

**Ikke bruk «siste hele dokument vinner».** Presentasjonen lagres som et samlet dokument, men editoren må ikke behandle den som en udifferensiert blob når to klienter arbeider samtidig.

Dagens UI sender alle reelle dokumentendringer gjennom `run` / `runStructural` og typed domenekommandoer. Bygg videre på dette prinsippet.

### Anbefalt modell

Hold en kortvarig, in-memory liste over lokale operasjoner som ennå ikke er bekreftet som del av den autoritative serverversjonen. Hver oppføring må kunne re-appliseres mot en ny base og må fortsatt gå gjennom samme domenekommando/fit-validering som opprinnelig handling.

Når en remote-versjon kommer mens lokale operasjoner finnes:

1. frys ny autosave kortvarig;
2. hent autoritativ remote-base;
3. sett den som ny base;
4. spill lokale, ennå ubekreftede operasjoner på nytt i original rekkefølge;
5. dersom alle fortsatt er lovlige: vis rebased resultat lokalt og autosave det mot den nye serverversjonen;
6. dersom en operasjon ikke lenger kan anvendes, gå til eksplisitt konfliktstatus — aldri dropp den stille og aldri overskriv remote-versjonen med gammelt snapshot.

### Krav til konfliktsti

Ved ekte semantisk konflikt, for eksempel at en annen enhet har slettet sonen en lokal operasjon adresserer:

- behold den autoritative remote-versjonen som sannhetskilde;
- bevar den lokale endringen/recovery-data lenge nok til at den ikke går tapt;
- presenter en kort og forståelig konfliktmelding;
- ikke autosave et delvis eller ugyldig rebase-resultat;
- ikke gjeninnfør slettede strukturer ved å skrive et gammelt snapshot tilbake.

Den konkrete recovery-UI-en kan bestemmes under implementasjon ut fra hvilke konfliktklasser som faktisk finnes, men data skal ikke tapes stille.

## 7. Del F — samme tekstfelt på to enheter

Full-document RichDoc-oppdatering per tastetrykk kan ikke flettes sikkert hvis to enheter skriver i nøyaktig samme tekstfelt samtidig. Ikke bygg en hjemmelaget tegn-for-tegn merge.

Innfør derfor en kortvarig, sterk edit-lease for aktivt tekstfelt:

- lease identifiseres av bruker + presentasjon + stabil `TextTarget`-identitet + klient-ID;
- acquire skal være atomisk;
- bare én ikke-utløpt lease kan eie samme tekstfelt;
- lease fornyes mens feltet faktisk redigeres;
- lease frigis ved blur/avsluttet redigering og får alltid kort TTL slik at krasj/frakobling ikke låser feltet permanent;
- andre enheter kan se realtime-oppdateringer i feltet, men feltet er midlertidig read-only der med en enkel forklaring;
- reconnect må ikke anta at en gammel lease fortsatt eies uten ny bekreftelse.

Dette er en avgrenset same-user-beskyttelse. Hvis Slaids senere skal ha ekte samtidig flerbrukertekst, bør Tiptap/Yjs eller tilsvarende CRDT vurderes som en egen arkitektonisk leveranse.

## 8. Del G — autosave, revisions og egne realtime-events

Eksisterende optimistic concurrency/version-guard beholdes som siste forsvar mot stale writes.

Implementasjonen må kunne skille minst disse tilfellene:

- eventet representerer klientens egen nylig bekreftede lagring;
- eventet representerer en annen klient/agent;
- klienten har eldre base og ingen lokale endringer;
- klienten har eldre base og lokale, ennå ubekreftede operasjoner.

Ikke skap en loop der:

`remote event -> reload -> local save -> remote event -> reload ...`

Utvid repository/sync-kontrakten bare så mye som nødvendig for å eksponere versjon/revisjon og bekreftet save-base. Ikke legg Supabase-spesifikk logikk direkte inn i editor-komponentene; lokal/Dexie-implementasjon skal fortsatt kunne oppfylle samme grensesnitt uten nettverksrealtime.

## 9. Undo/redo

Remote endringer skal ikke havne i lokal undo-historikk som brukerens egne handlinger.

Når remote-base endres:

- lokale ubekreftede operasjoner som lykkes med rebase bør fortsatt kunne representeres som lokale handlinger hvis dette kan gjøres uten å komplisere modellen urimelig;
- aldri la `undo` gjenopprette et gammelt helt dokument og dermed fjerne remote endringer;
- dersom dagens snapshot-baserte historie ikke kan bevares sikkert gjennom remote rebase, er det bedre å starte lokal undo-historikk på nytt etter en remote reconcile og forklare det kort enn å tilby en farlig undo.

Avklar og test dette eksplisitt i implementasjonen; grønne save-tester er ikke nok.

## 10. Feil- og reconnect-scenarier som må testes

Minst disse scenariene skal være dekket av tester der det er praktisk og av E2E/manual smoke test der nettverksadferd krever det:

1. PC lukker på slide 5 -> mobil åpner samme presentasjon på slide 5.
2. PC lukker til biblioteket -> mobil starter i biblioteket.
3. Lagret presentasjon er slettet før neste oppstart -> bibliotek, ingen loop/feilside.
4. Lagret slide er slettet -> trygg fallback og reparert workspace-state.
5. Enhet A lagrer en tekstendring -> enhet B viser den uten reload.
6. Agent API endrer presentasjonen -> åpen editor mottar og viser ny versjon.
7. Enhet A endrer tekst i sone X mens B endrer layout i en annen del -> begge endringer overlever.
8. To klienter prøver å redigere samme tekstfelt -> én får lease, den andre blir read-only.
9. Lease-eier krasjer/frakobles -> lease utløper og feltet kan tas over.
10. Remote sletter en sone som en lokal ubekreftet operasjon peker på -> eksplisitt konflikt/recovery, ingen stille datatap.
11. Nett/realtime forsvinner -> UI sier at dokumentet kan være utdatert.
12. Reconnect med ingen lokale endringer -> siste versjon hentes og `synced` gjenopprettes.
13. Reconnect med lokale endringer -> rebase eller eksplisitt konflikt, aldri blind overwrite.
14. Realtime-event fra egen lagring skaper ikke event/save-loop.
15. To raske serverversjoner i rekkefølge ender deterministisk på siste autoritative versjon.
16. Undo etter remote reconcile kan ikke fjerne remote endringer.

## 11. Dokumentasjon og arkitekturarbeid ved oppstart av PR-en

Før kode:

1. Les `CLAUDE.md`, relevante persistens-/autosave-/store-filer og gjeldende `IMPLEMENTATION_PLAN.md`.
2. Oppdater `IMPLEMENTATION_PLAN.md` med de varige reglene som faktisk skal implementeres: cross-device workspace-state, autoritativ serverversjon, realtime-status, rebase/konfliktprinsipp og same-field lease.
3. Bruk dette dokumentet som sjekkliste og slett/arkiver det når leveransen er ferdig dersom all varig kunnskap da finnes i normativ plan, kode og tester.

## 12. Avgrensninger

Ikke ta med i denne leveransen med mindre implementasjonen viser at det er nødvendig:

- generell flerbrukersamarbeid med inviterte redaktører;
- caret/presence-visning av andre brukere;
- CRDT/Yjs;
- live synkronisering av hvilken slide andre allerede åpne enheter ser på;
- synkronisering av transient UI-state som zoom, åpne paneler, valgt sone eller markørposisjon på tvers av sesjoner;
- endring av selve `.slaids`-dokumentformatet bare for å lagre workspace-state.

## 13. Ferdigdefinisjon

Leveransen er ikke ferdig før:

- cross-device resume fungerer i produksjons-/Supabase-modus;
- åpne klienter mottar remote dokumentendringer uten reload;
- stale snapshots kan ikke overskrive nyere dokumenter;
- minst ulike, ikke-konflikterende samtidige endringer kan sameksistere;
- samme tekstfelt er beskyttet mot parallell skriving;
- offline/stale status er synlig og sannferdig;
- reconnect/rebase/conflict er testet;
- relevante unit/integration/E2E-tester er grønne;
- `npm run typecheck`, `npm run lint`, `npm test` og relevante Playwright-tester er kjørt;
- `npm run build` er kjørt når migrasjon/realtime/server/build-konfigurasjon berøres;
- `IMPLEMENTATION_PLAN.md` er oppdatert og dette arbeidsdokumentet er enten markert utført eller arkivert.
