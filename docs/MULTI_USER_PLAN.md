# Flerbrukerstøtte – kartlegging og implementeringsplan

Status: plan, 2026-11-09. Normativ produkt- og arkitekturspesifikasjon er
`IMPLEMENTATION_PLAN.md` § 43.1 (skrives i etappe 1). Denne filen er
arbeidsplanen: hva som finnes i dag, hva hver etappe leverer, hvilke kontrakter
etappene deler, og i hvilken rekkefølge ting går ut i produksjon. Når alle
etapper er ute, er filen historikk.

## 1. Kartlegging: hva som forutsetter én bruker i dag

| Sted | Antakelse i dag |
| --- | --- |
| `supabase/migrations/20260902061716_restrict_slaids_to_owner.sql` | Alle RLS-policyer på `slaids_folders/presentations/templates/assets` og Storage krever `auth.uid() = 'dab4f04f-…'` i tillegg til eierskap. |
| `supabase/migrations/20260902190000_slaids_agent_api.sql` | Policyene på `slaids_agent_tokens` og `slaids_agent_audit` har samme faste UUID. |
| `src/supabase/access.ts` | `SLAIDS_OWNER_ID` / `SLAIDS_OWNER_EMAIL` – brukt av `AuthGate` (slipper bare én UUID inn) og `SignInView` (fast e-post, bare passordfelt). |
| `src/state/session.ts` | `signInWithPassword`; klienten lagrer alltid økten i `localStorage`. |
| `src/server/agent/oauth.ts` | `SLAIDS_AGENT_OAUTH_OWNERS` er både på-knappen for OAuth og listen over hvem som slipper inn. |
| `src/server/agent/supabase.ts`, `index.ts` | Agenttokens slås opp på hash og gir eierens `owner_id`; ingen sjekk av om eieren fortsatt har tilgang. |
| `supabase/functions/slaids-share` | Leser delte dekk med service-rollen; vet ingenting om om eieren er aktiv. |
| `README.md`, `IMPLEMENTATION_PLAN.md` § 43, § 44 | Beskriver Slaids som en énbruker-app. |

Det som **allerede** er per bruker, og som derfor ikke flyttes eller skrives om:

- Alle tabeller har `owner_id uuid → auth.users`, og alle policyer krever
  `auth.uid() = owner_id`. Sammensatte fremmednøkler (`(folder_id, owner_id)`,
  `(presentation_id, owner_id)`) hindrer at en referanse krysser eiere.
- Storage-stien er `<owner_id>/<presentation_id>/<asset_id>`, og policyene krever
  at første ledd er brukerens egen UUID.
- Agenttokens har `owner_id`, og repositoryet agent-API-et bygger er festet til
  tokenets eier (`pinnedOwnerId`). Agenttokens er altså allerede per bruker.
- Deling går gjennom Edge Function med eksakt token; `anon` har ingen
  tabelltilgang.
- Utlogging bruker `scope: 'local'` (logger ikke ut andre enheter).

Konsekvens: Flerbrukerstøtte er i hovedsak å **bytte den faste UUID-en ut med en
tilgangsliste**, ikke å endre datamodellen. Eksisterende data tilhører allerede
Peders UUID og skal ikke flyttes (bekreftes mot produksjon før migrasjonen kjøres,
se § 6).

### Funn som påvirker planen

1. **Innebygd e-post sender bare til teammedlemmer – derfor egen SMTP.**
   Bestillingen sa opprinnelig at Supabases innebygde e-post skulle brukes og at
   Resend/SMTP ikke skulle settes opp. Kartleggingen viste at den innebygde
   tjenesten bare leverer til adresser som er medlemmer av
   Supabase-organisasjonen (`email_address_not_authorized` ellers; se
   [Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). En ny
   Slaids-bruker kan altså ikke få en kode med den innebygde tjenesten, og å
   gjøre brukeren til medlem av organisasjonen er uakseptabelt fordi det gir
   innsyn i databasen. Dette ble lagt fram for Peder som et eget valg, og
   **Peder besluttet uttrykkelig 2026-11-09 kl. 07:46 å sende kodene via
   Resend**. Beslutningen ble tatt på et beslutningskort i Claude-prosjektets
   hovedtråd «Innfør flerbrukerstøtte i Slaids», med valget «Bruk Resend for
   innloggingskoder». Peder har bekreftet den skriftlig på PR #126. Den
   erstatter punktet i den opprinnelige bestillingen.
   - Det som faktisk er konfigurert, er egen SMTP i **Supabase Auth** (§ 6
     steg 5): `smtp.resend.com:465`, avsender `Slaids <innlogging@slaids.no>`,
     og en Resend-nøkkel som bare kan sende fra `slaids.no`.
   - Ingenting om Resend er konfigurert i Slaids' Vercel-prosjekt, og
     ingenting trengs der, fordi Slaids aldri sender e-post selv.
   - Ingen etappe inneholder kode for Resend eller SMTP. Slaids kaller bare
     `signInWithOtp`/`verifyOtp` og er lik uansett hvem som leverer e-posten.
   - Går man tilbake til innebygd e-post, virker innlogging bare for
     organisasjonsmedlemmer, altså Peder.
   - **Åpent til § 6 steg 8 er gjort:** at en kode faktisk kommer fram til en
     adresse som ikke er medlem av organisasjonen, er ennå ikke prøvd i
     produksjon. CI prøver innloggingen bare mot en stubbet Supabase.
     Flerbrukerflyten regnes ikke som produksjonsklar før den ekte prøven
     (Peder og en ny bruker) er bestått.
2. **Andre apper i prosjektet.** Kontrollert i produksjon 2026-11-09: den eneste
   Auth-brukeren er Peder, og mdeditz har ingen tilgang for `anon`/
   `authenticated` – den bruker ikke Supabase Auth. Endringer i e-postmal og
   SMTP rammer derfor bare Slaids. «Magic Link»-malen inneholder bare koden:
   lenken er fjernet fordi ingen annen flyt bruker den, og fordi en
   e-postskanner som åpner lenken ville brukt opp koden. Gammel mal og
   reverseringsoppskrift ligger i kontrollrapporten
   (`/mnt/project-files/sikkerhetskopi-2026-11-09/`).
3. **Global registrering er på** i prosjektet. Det endres ikke. Slaids lukker
   sin egen dør: `shouldCreateUser: false` i klienten, og en Auth-bruker som ikke
   står i Slaids' tilgangsliste får ingenting – verken i appen, i RLS eller i
   agent-API-et.
4. **`slaids_assets.object_path` er fri tekst.** En bruker kunne i prinsippet
   lagre en rad som peker på en annen brukers fil, og server/Edge Function, som
   bruker service-rollen, ville lastet den ned. Med én bruker var det uten
   betydning; nå får kolonnen en `check` om at stien begynner med `owner_id/`.

## 2. Valgt løsning i korte trekk

- Ny tabell `public.slaids_users` (tilgangsliste: UUID, rolle, aktiv).
- Én SQL-funksjon, `public.slaids_is_active_user()`, erstatter den faste UUID-en
  i alle Slaids-policyer. Deaktivering virker dermed umiddelbart på hver eneste
  databaseforespørsel, også for økter som allerede finnes.
- Rolle og status kan bare skrives med service-rollen (serveren). Nettleseren
  kan lese sin egen rad, ingenting annet.
- Siste aktive administrator beskyttes av en trigger i databasen, ikke bare i
  serverkoden.
- Innlogging: `signInWithOtp({ shouldCreateUser: false })` + `verifyOtp`, og ett
  lagringsvalg som styrer om økten ligger i `localStorage` (huskes) eller
  `sessionStorage` (bare denne nettleserøkten). Én Supabase-klient som før.
- Administrasjon: en liten servermodul i den eksisterende serverfunksjonen
  (`/api/agent/v1/admin/users`), autentisert med brukerens vanlige
  innloggingstoken – aldri agenttoken eller OAuth – og håndhevet mot
  `slaids_users` på serveren.
- Agent-API/MCP/OAuth: hver autentisering (agenttoken og OAuth) krever at eieren
  er aktiv i `slaids_users`. OAuth-allowlisten i miljøet erstattes av
  tilgangslisten.
- Delte lenker: virker som før. En deaktivert konto sine publiseringer svarer som
  «ikke aktiv» mens kontoen er deaktivert, og kommer tilbake ved reaktivering.

## 3. Felles kontrakter mellom etappene

Disse er låst her slik at etappene kan bygges parallelt uten å finne opp hver sin
variant. Endres en kontrakt, endres den her først.

### 3.1 Database (etappe 1 eier)

```sql
create table public.slaids_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'user' check (role in ('user', 'admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
```

- RLS på. `authenticated` får `select` på **egen rad** (`user_id = auth.uid()`),
  og ingen skrivetilgang. `anon` får ingenting.
- `public.slaids_is_active_user() returns boolean` – `security definer`, tom
  `search_path`, `stable`. Sann når `auth.uid()` har en aktiv rad. Brukes av
  alle Slaids-policyer (tabeller og Storage) i stedet for den faste UUID-en.
- `public.slaids_admin_list_users()` returnerer
  `(user_id, email, role, active, created_at, last_sign_in_at)` – bare
  `service_role` kan kjøre den.
- `public.slaids_auth_user_id_by_email(p_email text) returns uuid` – bare
  `service_role`. Finner en eksisterende Auth-bruker (også fra andre apper i
  prosjektet), uten å skille på store/små bokstaver.
- Trigger på `slaids_users` (update/delete): hvis en endring fjerner den siste
  aktive administratoren, avbrytes den med
  `raise exception 'SLAIDS_LAST_ACTIVE_ADMIN'` (errcode `P0001`). Låst med en
  transaksjonsbundet advisory lock, så to samtidige endringer ikke kan passere
  hverandre.
- `slaids_assets` får `check (split_part(object_path, '/', 1) = owner_id::text)`.
- Bootstrap: Peders eksisterende Auth-bruker
  (`dab4f04f-cc4c-46b1-854e-3c8b17341966`, `peder.holman@gmail.com`) settes inn
  som `admin`, aktiv – bare hvis både UUID og e-post stemmer.

### 3.2 Delt TypeScript (etappe 1 eier): `src/persistence/slaidsUsers.ts`

- `SLAIDS_USERS_TABLE = 'slaids_users'`
- `SLAIDS_ROLES = ['user', 'admin'] as const`, `type SlaidsRole`
- `LAST_ACTIVE_ADMIN_ERROR = 'SLAIDS_LAST_ACTIVE_ADMIN'`
- `interface SlaidsUserAccess { userId; role; active }` og
  `slaidsUserAccessFromRow(row): SlaidsUserAccess | null`
- `isActiveAccess(access)`
- `readUserAccess(client, userId)` – samme lesing i nettleseren (RLS gir bare
  egen rad) og på serveren (service-rollen, `userId` fra den autentiserte
  prinsipalen).
- `ADMIN_LIST_USERS_FUNCTION`, `AUTH_USER_BY_EMAIL_FUNCTION` – navnene på
  SQL-funksjonene i 3.1.

`src/supabase/access.ts` slettes i etappe 2 (siste bruker er `AuthGate` og
`SignInView`). Bootstrap-UUID-en finnes bare i migrasjonen.

### 3.3 Sesjonslageret i nettleseren (etappe 2 eier)

`useSessionStore` får:

- `access: 'checking' | 'member' | 'no-access' | 'deactivated' | null`
  (`null` når ikke innlogget eller lokal modus);
- `role: SlaidsRole | null`;
- `requestCode(email)`, `verifyCode(email, code, remember)`, `signOut()`;
- `refreshAccess()` – leser egen rad på nytt (ved start, ved innlogging og når
  fanen får fokus igjen).

`AuthGate` slipper bare `access === 'member'` inn. Etappe 3 leser `role` herfra
og legger ikke til egne sesjonsfelt.

### 3.4 Admin-HTTP (etappe 3 eier)

Alle under `/api/agent/v1/admin/users` i den eksisterende serverfunksjonen,
håndtert før agentruteren og aldri listet i agentkatalogen eller som MCP-verktøy.

| Metode | Sti | Kropp | Svar |
| --- | --- | --- | --- |
| `GET` | `/admin/users` | – | `{ users: AdminUser[] }` |
| `POST` | `/admin/users` | `{ email, role }` | `201 { user }`; allerede medlem gir `409 ALREADY_MEMBER` |
| `PATCH` | `/admin/users/:userId` | `{ role?, active? }` | `{ user }` |

- Legitimasjon: `Authorization: Bearer <Supabase access token fra nettleseren>`.
  Serveren verifiserer med `auth.getUser(token)`, avviser tokens med
  `client_id` (OAuth-delegasjoner) og alt som ikke er et JWT (agenttokens), og
  krever `slaids_users.role = 'admin' and active` for kalleren.
- Feilkoder i samme format som agent-API-et: `UNAUTHENTICATED` (401),
  `FORBIDDEN` (403), `INVALID_INPUT` (400), `ALREADY_MEMBER` (409),
  `LAST_ACTIVE_ADMIN` (409, fra triggeren), `NOT_FOUND` (404).
- Opprettelse: finn Auth-bruker med `slaids_auth_user_id_by_email`; finnes den
  ikke, `auth.admin.createUser({ email, email_confirm: true })` (ingen e-post
  sendes, ingen passord). Deretter innsetting i `slaids_users` med
  `created_by`. Ingen invitasjonsflyt: brukeren logger inn med engangskode.
- `AdminUser = { userId, email, role, active, createdAt, lastSignInAt }`.

### 3.5 Agent-API (etappe 4 eier)

- `authenticateAgentToken` og `oauthAuthenticator` sjekker begge
  `readUserAccess(...).active` etter at legitimasjonen er gyldig. Ikke aktiv →
  samme 401 utad, ny audit-/loggårsak `owner-inactive` (`OWNER_INACTIVE`).
- OAuth slås på med `SLAIDS_AGENT_OAUTH=on`. Den gamle
  `SLAIDS_AGENT_OAUTH_OWNERS` godtas fortsatt som på-knapp (så Peders
  Vercel-oppsett virker uendret), men listen i den avgjør ikke lenger hvem som
  slipper inn – det gjør `slaids_users`.

## 4. Etapper, avhengigheter og PR-er

```text
            ┌─► Etappe 2: Innlogging (klient) ───────┐
Etappe 1 ───┤                                        ├─► Produksjonsutrulling + ekte test
(DB+kontrakt)├─► Etappe 3: Administrasjon ───────────┤
            └─► Etappe 4: Agent/MCP/OAuth + deling ──┘
```

- **Etappe 1 – Brukermodell og sikkerhet** (denne tråden). Migrasjon
  `…_slaids_multi_user.sql`, `src/persistence/slaidsUsers.ts`, RLS-tester mot en
  ekte Postgres (PGlite) som kjører alle migrasjonene og prøver tilgang som ulike
  brukere, normativ spesifikasjon i `IMPLEMENTATION_PLAN.md` § 43.1. Migrasjonen
  er bakoverkompatibel: dagens klient (passord, fast UUID-gate) virker etter at
  den er kjørt, så den kan rulles ut før klientendringene.
- **Etappe 2 – Innlogging.** Engangskode-skjermen, lagringsvalget,
  tilgangssjekken i `AuthGate`, «ingen tilgang»/«deaktivert»-skjermer,
  feilhåndtering (feil kode, utløpt kode, ventetid, e-postgrense), sletting av
  `src/supabase/access.ts`. Enhetstester + Playwright med stubbet Supabase-auth.
  Avhenger bare av kontrakt 3.1/3.2.
- **Etappe 3 – Administrasjon.** Servermodul `src/server/admin/` + UI
  «Administrasjon → Brukere» i biblioteket. Avhenger av 3.1/3.2 og av `role` fra
  3.3 (kan bygges parallelt og rebases når etappe 2 er inne).
- **Etappe 4 – Integrasjoner og sluttkontroll.** Aktiv-sjekk for agenttokens og
  OAuth, OAuth-konfigurasjonen, Edge Function-sjekk av eierens status,
  regresjonstester for tverrbrukertilgang via API/MCP, README/§ 44.
  Avhenger av 3.1/3.2.

Etappe 2, 3 og 4 rører ulike filer (klient-auth, ny admin-modul + bibliotek-UI,
agent-server + Edge Function). Den eneste felles filen er
`src/server/agent/index.ts`, der etappe 3 legger inn én dispatch-linje for
`/admin/`; etappe 4 endrer bare `depsFor`. README-endringene skrives i hver sin
seksjon.

Grener: Etappe 1 er `claude/project-thread-iplfqg`. Etappe 2–4 starter fra
etappe 1-grenen (stablet), og får `main` flettet inn når etappe 1 er
squash-merget.

**Anbefalt merge-rekkefølge:** 1 → 4 → 2 → 3. Etappe 4 før 2 fordi den ikke
endrer noe for Peder, men stenger agentdøren for alle andre; etappe 2 før 3 fordi
admin-UI-et leser rollen fra sesjonslageret.

## 5. Tester (kravliste → hvor det dekkes)

| # | Krav | Dekning |
| --- | --- | --- |
| 1 | Peder logger inn med kode og ser sine data | E2E (etappe 2, stubbet auth) + ekte innlogging i produksjon (§ 6) |
| 2 | Bare admin kan opprette brukere | Admin-handler-tester (3) + RLS-test: ingen skrivetilgang til `slaids_users` (1) |
| 3 | Ny bruker får tomt bibliotek | RLS-test (1) |
| 4 | Ingen tilgang til andres data, heller ikke direkte | RLS-tester for alle tabeller + Storage (1), API/MCP-tester (4) |
| 5 | Ny bruker kan logge ut/inn uten datatap | E2E (2) |
| 6 | Vedvarende innlogging overlever gjenåpning | Enhetstest av lagringsadapteren + E2E med ny kontekst fra lagret tilstand (2) |
| 7 | Uten vedvarende lagring avsluttes økten | Samme (2) |
| 8 | Admin kan gis og fjernes | Admin-handler-tester (3) + RLS/trigger-test (1) |
| 9 | Siste aktive admin er beskyttet | Trigger-test inkl. samtidighet (1) + handler (3) |
| 10 | Deaktivering stopper økter, agenttokens, OAuth | RLS-test (1), agent-tester (4), gate-test (2) |
| 11 | Delingslenker virker | Eksisterende tester + Edge Function-test (4), produksjonsprøve (§ 6) |
| 12 | Slaids Dev / agentintegrasjoner virker for Peder | Agent-tester (4) + `scripts/mcp-smoke.mjs` mot produksjon (§ 6) |
| 13 | Andre apper påvirkes ikke | Migrasjonstest: bare `slaids_`-objekter (1); kontroll av `auth`-bruk før og etter (§ 6) |

E-postflyten testes med stubber i CI. Ekte koder brukes bare i
produksjonskontrollen i § 6 – én til Peder, én til den nye brukeren.

## 6. Produksjonsutrulling (rekkefølge)

Ingen av stegene under gjøres som del av en uverifisert PR. Hvert steg kan
reverseres som beskrevet.

1. **Les-kontroll** (gjort 2026-11-09, uten avvik): alle rader i Slaids-tabellene og alle objekter i
   `slaids-assets` har Peders UUID som eier/første ledd; Peders Auth-bruker har
   e-posten `peder.holman@gmail.com`; hvilke Auth-brukere/identiteter andre apper
   har (for § 1 funn 2). Avvik stopper utrullingen.
2. **Sikkerhetskopi** (gjort 2026-11-09): JSON-eksport av alle `slaids_*`-tabeller og listen over
   Storage-objekter, lagret i prosjektmappen. Filene i Storage flyttes ikke.
3. **Migrasjon (etappe 1)** (gjort 2026-11-09 08:59 UTC fra 851e34d) i én transaksjon sammen med raden i
   `public.slaids_migrations`. Reversering:
   `supabase/rollback/20261109090000_slaids_multi_user.down.sql` setter de gamle
   policyene tilbake og fjerner ledger-raden (testet i
   `supabase/tests/access.test.ts`).
4. **Kontroll** (gjort 2026-11-09, uten avvik): RLS prøvd med simulerte JWT-er i en transaksjon som rulles
   tilbake (Peder ser alt, en annen Auth-bruker ser ingenting).
5. **Auth-innstillinger** (gjort 2026-11-09): egen SMTP via Resend
   (`innlogging@slaids.no`, nøkkel som bare kan sende fra slaids.no);
   e-post-OTP-lengde 6; e-postgrense 30 per time; «Magic Link»-malen med koden.
   Gamle verdier er lagret, så alt kan settes tilbake.
6. **Edge Function** (etappe 4) deployes uten `--prune`.
7. **Merge og Vercel**: PR-ene i rekkefølgen over. Ingen nye Vercel-variabler
   kreves; `SLAIDS_AGENT_OAUTH=on` kan erstatte `SLAIDS_AGENT_OAUTH_OWNERS`
   senere.
8. **Ekte prøve** (gjenstår; avgjør om flerbrukerflyten er produksjonsklar): Peder logger inn med kode og ser biblioteket; Peder oppretter
   den nye brukeren; den nye brukeren logger inn og ser et tomt bibliotek;
   `mcp-smoke` mot produksjon; en eksisterende delingslenke åpnes.
