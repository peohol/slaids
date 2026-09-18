# Agentstyrt presentasjonsdesign

Denne guiden forklarer hvordan en agent bør komponere presentasjoner i Slaids. Den er ikke en katalog med ferdige maler. Den normative agentkontrakten bor i `src/agent/design.ts`; MCP-instruksen og verktøybeskrivelsene eksponerer reglene derfra. Denne filen forklarer tankegangen og gir eksempler.

Utgangspunktet er enkelt:

> **Innholdets logiske struktur skal bestemme sonetreet. Ikke velg layout først og press innholdet inn etterpå.**

En gyldig slide er ikke nødvendigvis en god slide. Slaids kan kontrollere geometri og fit; agenten må selv kontrollere pedagogikk, relevans, rytme og visuell prioritering.

## Designhierarkiet

Rekkefølgen under er ikke tilfeldig: hvert nivå forutsetter at nivået over er avgjort.

1. **Semantikk** – hva består sliden faktisk av, og hvilke enheter og relasjoner finnes i stoffet?
2. **Slaids-native komposisjon** – sonetreet, slide-overskriften, teksten og kortene *er* sliden. Se «Native komposisjon først» rett under.
3. **Visuelt behov** – trenger en sone bilde eller figur, og er det i så fall et illustrasjonsbilde eller en diagrammatisk figur?
4. **Riktig medietype** – illustrasjon → raster, planlagt som en ekte bildesone pluss en oppføring i bildeplanen; diagrammatisk figur → SVG, og bare i den ene sonen den fyller.
5. **Citations/referanser** – faktapåstander som trenger en kilde bruker referansesystemet, aldri en egen kildeslide eller tekst inne i en SVG.
6. **Render/QA** – strukturell validering er ikke sluttkontrollen; representative slides rendres og inspiseres visuelt før dekket er ferdig.

## Native komposisjon først

> **Slidegeometri er alltid Slaids sitt sonetre. Overskrift er Slaids-overskrift, brødtekst er Slaids-tekst, kort og korttitler er Slaids sine egne innholdstyper. Bilde og SVG fyller bare den visuelle rollen til sonen de ligger i – de er aldri en alternativ slide-motor.**

En tidligere feilslått presentasjon («Menneskets evolusjon», `p_ssk8ao0znyp`) viste hva som skjer når denne regelen mangler: nesten hver innholdsslide ble tegnet ferdig som én stor SVG – tittel, kort, brødtekst, layout, illustrasjoner og bildetekster allerede tegnet inn i markupen. Presentasjonen var strukturelt gyldig og likevel dårligere enn en tidligere versjon der Slaids-soner, kort og tekst faktisk utgjorde sliden. En SVG eller et rasterbilde skal derfor aldri brukes til å omgå sonetreet eller gjenskape en innholdstype Slaids allerede har.

Anti-mønsteret å kjenne igjen: én 1400×700 SVG med tre tegnede kort, overskrifter, avsnitt og illustrasjoner, plassert som eneste innhold på sliden.

## 1. Alt publikum ser skal handle om temaet

Publikumsflaten er ikke et sted for kommentarer om hvordan presentasjonen ble laget. Tekst som forklarer «designgrep», «layoutvalg», Slaids, agentens arbeidsprosess eller testhensikten hører ikke hjemme på en vanlig faglig slide. Det kan finnes i en presentasjon bare når brukeren uttrykkelig har bedt om en presentasjon om selve design- eller arbeidsprosessen.

Det samme gjelder dekorativ tekstbruk:

- sitater bør være sjeldne;
- en quote-blokk bør inneholde en faktisk, etterprøvbar formulering fra en identifiserbar kilde der den eksakte ordlyden er viktig;
- egne oppsummeringer, parafraser og slagord skal ikke settes i anførselstegn eller quote-stil bare for å få visuell variasjon;
- har et kort eller en container god høyde, kan flere tydelige delpoenger med fordel stå som separate avsnitt eller få bevisste linjeskift i stedet for å bli presset sammen i én tett tekstblokk.

Luft i teksten skal hjelpe lesingen, ikke fylle tom plass for sin egen skyld.

## 2. Semantisk dekomponering kommer før geometri

Før agenten deler en sone, skal den spørre hva sliden faktisk består av. Let aktivt etter:

- **kategorier**;
- **aktører**;
- **faser**;
- **alternativer**;
- **årsaker og virkninger**;
- **parallelle dimensjoner**;
- **tidssekvenser**;
- **sammenlignbare objekter**;
- **hovedpåstand + evidens**;
- **ett objekt med interne underdeler**.

Disse er ikke slide-maler, men semantiske enheter. Når flere navngivbare enheter finnes, bør relasjonen mellom dem normalt kunne ses i geometrien.

### Én stor tekstsone og punktlisten

Én udelt tekstsone som hele slidens innhold er sjelden riktig svar mer enn én eller to ganger i et dekk, og aldri svaret på at stoffet var vanskelig å dekomponere.

Dette gjelder like mye uten punktliste. «Én stor tekstsone + overskrift + ett avsnitt», gjentatt slide etter slide, er det samme standardsvaret med listen tatt ut. Ender flere slides på rad slik, er det oftest fordi innholdet skulle vært delt i mindre enheter med hver sin korttittel.

En punktliste er egnet når punktene er underordnede utsagn om samme objekt eller påstand. Dersom punktene egentlig er flere kategorier, faser, aktører eller sammenligningsenheter, bør de normalt få egne soner eller kort.

Parallelle konsepter bør normalt få parallell behandling: samme innholdstype, samme nivå i treet og like eller nesten like vekter.

## 3. Sonetreet skal uttrykke relasjonene

Bygg det enkleste treet som gjør de viktige relasjonene visuelt eksplisitte.

### Likeverdige ting → søsken

To eller flere ting som skal sammenlignes direkte bør vanligvis være søsken i samme split. Eksempler:

- to arter side om side;
- tre parallelle mekanismer;
- fire definisjoner i 2×2;
- flere medlemmer av samme kategori.

Hvis likeverdige elementer får svært ulik størrelse uten semantisk grunn, kommuniserer layouten et hierarki som ikke finnes i innholdet.

### Hierarki → asymmetri

Når én del er viktigere, bør størrelsen vise det. Et hovedpoeng, en sentral figur eller en oppsummering kan dominere, mens støttende detaljer får mindre flater.

### Nested splits → bare ved intern struktur

Nested splits er gode når én del av sliden selv består av flere underdeler. De skal ikke brukes bare fordi det er teknisk mulig eller for å presse inn mer tekst.

### Soner vs. subfelter

Bruk egne soner når deler skal ha selvstendig visuell rolle, ulik størrelse, egen bakgrunn eller sammenlignes på tvers av sliden.

Bruk subfelter når delene sammen utgjør ett semantisk objekt og bør oppfattes som intern struktur i samme kort eller container.

## 4. Velg innholdstype etter rolle

> **Primært tekstinnhold er som hovedregel et `titled-card`.** `untitled-card` er unntaket, og `container` er det sekundære formatet for støttetekst.

Velger du `container` eller `untitled-card` til hovedinnholdet på en slide, skal du kunne si hvorfor en korttittel ville gjort sliden dårligere.

### Titled card og titled image card

Hovedregelen for navngitte, parallelle enheter er at de rammes inn med navnet som korttittel. Hvilken av de to typene det blir, avgjøres av hva som bærer enheten: **titled card** når det er tekst, **titled image card** når det er bildet.

Består sliden av flere av:

- **arter**;
- **kategorier**;
- **aktører**;
- **faser**;
- **alternativer**;
- **sammenligningsobjekter**;

så skal hver enhet normalt rammes inn, med enhetens navn som korttittel. Da ser publikum at enhetene er likeverdige, og navnet blir noe å skanne etter i stedet for en setningsstart inne i en tekstblokk.

Tre arter er både navngitte peers og et emne der bilder hører hjemme (§6). Da er svaret tre titled image cards, ikke tre bare bilder og ikke tre tekstkort. Agenten oppretter korttypen først — den kan settes på en tom sone, og sonen venter da på filen — og legger filen inn etterpå; korttittelen overlever.

Testen er enkel: kan enheten pekes på og kalles noe? Da har korttittelen noe å si.

Korttittelen står på én linje og brytes ikke. Får det fulle navnet ikke plass — «Australopithecus afarensis» i en av tre kolonner, for eksempel — kortes tittelen ned («A. afarensis») og den fulle formen står i teksten eller i bildeteksten. En avvist korttittel er aldri en grunn til å droppe rammen.

### Untitled card

Unntaket, ikke et alternativ på lik linje: bruk det der selve utsagnet er budskapet og en tittel bare ville vært støy — ett tall, én formulering, ett sitat.

### Container

En container er gjennomsiktig og rammer ingenting inn. Det er et **sekundært format**, ikke standardvalget for primært tekstinnhold: små støttefelt, bildeforklaringer, fotnotepregede felt, kildehenvisninger og annet som bevisst ikke skal fremstå som en selvstendig enhet.

Skriver du tekst i en tom sone, blir den en container. Det er utgangspunktet Slaids må velge for å ha et sted å legge teksten, ikke et designvalg. Innholdstypen settes før teksten skrives.

En container er derfor aldri svaret på at stoffet var vanskelig å dekomponere.

### Aksent er ikke korttittel

Inne i et tekstfelt finnes en fremhevet tekstblokk. I agentkontrakten heter den `accent`, og i editoren heter knappen «Aksent». Den er en **underoverskrift**: et fremhevet poeng, eller en intern oppdeling av et kort som rommer flere delpoenger.

Kortets hovedoverskrift er **korttittelen** på et `titled-card`. Et kort som trenger en overskrift, skal ha korttittel — ikke en aksent som later som den er én. Den underliggende editor-noden er fortsatt en `heading`; det er navnet i produktet og i agentkontrakten som er rettet, fordi det var navnet som fikk både forfattere og agenter til å skrive det ene i stedet for det andre.

### Image

Bruk et bart bilde når bildet står alene og bærer informasjonen selv. Er bildet ett navngitt medlem i en serie eller katalog, hører det hjemme i et titled image card i stedet — se over.

### Negativt rom

Negativt rom er bevisst tom flate, men skal brukes konservativt. Det vanligste gode tilfellet er **vertikal høydejustering av synlige kort**:

- et kort har bare én eller to korte tekstblokker;
- et kort som fyller hele tilgjengelige høyde ville fått uforholdsmessig mye tom flate;
- tittellinjen og brødteksten havner visuelt for langt fra hverandre;
- sonen splittes da gjerne som luft / kort / luft, for eksempel omtrent 1:10:1, slik at kortets høyde passer bedre til innholdet.

Dette er særlig nyttig ved siden av et stort bilde: bildet kan fylle høyden, mens et kort med lite tekst får en mer naturlig høyde.

Det er derimot som regel en dårlig idé å legge negativt rom **mellom parallelle kort sideveis**. Slaids har allerede faste mellomrom mellom soner. Ekstra horisontal luft som bare gjør kortene smalere og teksten trangere tilfører vanligvis ingenting.

En enkel kontroll er: Hvis det negative rommet fjernes og resultatet bare blir tydeligere, bredere eller romsligere uten at fokus, hierarki eller rytme svekkes, skal luften bort.

Negativt rom er ikke en måte å «vise at designet bruker negativt rom» på, og det er ikke det samme som en tom, uferdig sone.

## 5. Tekstrytme i romslige soner

Når et kort eller en container har god plass i høyden, trenger teksten ikke stå som ett kompakt avsnitt.

To eller tre korte ideer kan få hvert sitt avsnitt. Dette gjør det lettere å skanne og kan gi bedre balanse i kortet uten å legge til mer tekst. Bruk semantiske avsnitt, ikke tilfeldige tomlinjer.

Et godt kort kan derfor ha:

- kort tittellinje;
- ett tydelig avsnitt;
- et mellomrom;
- et nytt, selvstendig avsnitt.

Dette er ofte bedre enn både et langt avsnitt og et unødvendig sitat.

## 6. Bilder skal planlegges aktivt

Bilder skal ikke være pynt, men de bør heller ikke bli et sjeldent unntak bare fordi tekst er enklere å lage.

Bildespørsmålet stilles på hver enkelt slide: kan et relevant bilde, en figur eller et utsnitt av et viktig visuelt trekk forklare stoffet bedre enn mer tekst?

I visuelt konkrete emner er svaret normalt ja på flere slides:

- mennesker;
- dyr og arter;
- anatomi;
- steder og landskap;
- gjenstander og redskaper;
- historiske miljøer;
- geografi og utbredelse.

Et dekk om et slikt emne som ender uten et eneste planlagt bilde er som regel feil. En presentasjon om menneskets evolusjon skal normalt planlegge flere bilder, ikke ett.

Let konkret etter:

- rekonstruksjon av en art, organisme eller person;
- utsnitt av et viktig anatomisk trekk;
- sammenlignende morfologi;
- kart;
- foto eller rekonstruksjon av et miljø;
- faglig figur;
- illustrasjon av en mekanisme eller prosess.

### Raster vs. SVG

Skillet er **illustrasjon vs. diagram**, ikke «fotografisk vs. resten».

SVG hører hjemme der poenget er struktur: grafer, plott, ekte diagrammer, flytskjemaer, kart der vektor passer, geometriske forklaringsfigurer, enkel ikonografi og enkle skjematiske illustrasjoner. SVG skal forbli SVG.

Illustrasjonsbilder er normalvalget rasterbilder – det gjelder generelt, ikke bare fotografiske eller biologiske motiver: mennesker, dyr, natur, bygninger, arkitektur, miljøer og interiører, mat, gjenstander, produkter, historiske scener, rekonstruerte situasjoner og andre motiver som skal illustrere rikt eller stemningsbærende. En enkel, hjemmelaget SVG-tegning er ikke en akseptabel erstatning for et slikt bilde, uansett motiv. Ikke etterlign et illustrasjonsbilde med SVG og rasteriser det etterpå.

SVG skal heller aldri brukes til å gjenskape det Slaids allerede har som egen innholdstype: en hel slide, slideoverskriften, en vanlig tekstblokk, et kort, en korttittel eller et layoutgrid – heller ikke en litteraturliste eller en teksttung infografikk som i praksis erstatter Slaids-innhold. Tekst inne i en SVG skal normalt bare være korte etiketter som er en del av selve figuren (akseetiketter, diagramnoder, kartetiketter, navn på deler i en skjematisk figur), aldri løpende brødtekst eller faktapåstander som burde hatt en citation.

### Bildearbeidsflyten

Rasterbilder følger én standardflyt uansett hvor filene senere produseres. Agenten skal ikke først undersøke om Slaids eller vertsklienten har en bildegenerator; planleggingen er den samme:

1. **Trenger sliden bilde i det hele tatt?** Bestem bildets faglige rolle først.
2. **Planlegg sonetreet slik at bildesonen passer motivet.** Et stående motiv trenger en høy sone; en vid scene trenger en bred sone. Passer ikke sonens format til motivet, skal sonene planlegges på nytt — motivet skal ikke presses inn i feil rektangel.
3. **Reserver sonen som en ekte bildesone:** sett innholdstypen til `image` eller `titled-image-card` uten fil. Sonen venter da på bildet, og har en bildesones minstemål. Inspeksjonen svarer med `reservedImageKinds`: bildetypene rektangelet faktisk rommer. Et titled image card trenger mer plass enn et bart bilde, så planlegger du et navngitt medlem i en serie, er det den typen som må stå i listen. Tom liste betyr at sonen må få mer plass.
4. **Legg bildet inn i dekkets bildeplan** — én oppføring per bildesone, med motiv, komposisjon og utsnitt, faglige krav, og hva som skal unngås i akkurat det bildet. Motiv og komposisjon er påkrevd — motivet er det som skiller to bilder fra hverandre, og komposisjonen er det sonens format kontrolleres mot. Faglige krav og «unngå» er valgfrie, og prompten utelater dem når de er tomme.
5. **Skriv dekkets felles bildekontekst** så snart minst ett rasterbilde planlegges — også om det bare er ett.

Slaids gjør resten: nummererer bildene i dekkets rekkefølge, måler aspect ratio fra hver sones faktiske geometri, setter plassholder-bildeteksten i hver ufylt bildesone — «Sett inn bilde 1 her», «Sett inn bilde 2 her» og så videre — og setter sammen den ferdige bildeprompten for hver enkelt oppføring. Plassholderen forsvinner av seg selv når filen legges inn i sonen, så den blir aldri stående over det ferdige dekket.

Når Slaids brukes fra en vertsklient som ChatGPT, og dekket har planlagte rasterbilder – det gjelder alltid når brukerbestillingen forutsetter bilder for å være oppfylt, også formuleringer som «med bilder», «bruk bilder» eller «bilder i hvert steg», men planlagte bildesoner er i seg selv nok – skal rastergenereringen skje fra en endelig bildeplan, ikke fra den første gyldige planen under planleggingen. Fullfør først citations, øvrige innholdsendringer, validering og reparasjoner og den visuelle QA-en som kan endre bildesonene. Når bildesonene deretter er stabile, les bildeplanen på nytt fra den endelige presentasjonstilstanden. Dersom klienten har et innebygd bildegenereringsverktøy, skal den da gjøre overleveringen umiddelbart: hent den ene bildejobben som står for tur, og kall bildegenereringsverktøyet med bare den jobbens ferdige `prompt`. Slaids gir én jobb om gangen – neste finnes først når den forrige er generert og kontrollert – slik neste avsnitt beskriver. Start direkte med det første bildet. Det er ikke nok at planen ligger i verktøyresponsen; genereringen er først startet når bildegenereringsverktøyet faktisk er kalt. Agenten skal ikke avslutte oppgaven eller kalle presentasjonen ferdig før alle kallene er gjort og antallet ferdige bildefiler er kontrollert. Hvis bildeplanen endres etter handoff, må planen leses på nytt og de bildene genereres på nytt. Hvis klienten ikke kan gjøre overleveringen direkte, er den samlede briefen fortsatt normal leveranse til stedet bildene produseres – der er den en tekst et menneske limer inn selv, ikke en prompt agenten sender, og det er fortsatt normal arbeidsflyt, ikke en fallback. Direkte overlevering automatiserer bare starten på genereringen; uten en filbro tilbake til Slaids går de ferdige bildefilene fortsatt via bildedeponeringen nedenfor.

**Slaids eksponerer ikke settet i genereringssteget.** Det leser én jobb om gangen, bildeplanens svar bærer ingen ferdige prompter, skrivekallet gjentar ikke tekstene det nettopp fikk, og den samlede briefen følger bare med når noen ber om den. Agenten skriver den ikke ut, oppsummerer ikke bildeplanen, lister ikke opp bildene som skal lages, sier ikke hvor mange de er, henter ikke flere jobber på forskudd og leser ikke planen på nytt for å få tak i de andre motivene mens den genererer. Hver generering skal se ut som en fullstendig selvstendig oppgave, i kallet og i samtalen rundt det. Det er ikke høflighet: en bildegenerator som får se at oppgaven er et sett, lager et sett – collage, kontaktark, storyboard eller ett helt slide-oppsett – og en advarsel mot collage veier ikke opp for å ha vist den at settet finnes. Trengs en kort statusmelding, skal den være nøytral.

Å komponere prompten per oppføring var ikke nok alene: svarene bar fortsatt hele planen – hvert motiv, hver ferdige prompt, antallet – så agenten hadde settet foran seg i det første bildekallet ble skrevet.

**Grensen for hva Slaids kan håndheve går her, og den er verdt å si rett ut.** Agenten skriver bildeplanen, så motivene har vært i samtalen dens uansett hva Slaids svarer etterpå; og arver vertsklientens bildeverktøy den samtalen, er det en egenskap ved verten, ikke ved dette API-et. At bildegeneratoren bare ser den ene prompten er derfor et **krav til vertsklienten**: gjør bildekallet i en isolert kontekst, og kan klienten ikke det, si det til brukeren i stedet for å love en isolasjon den ikke har. Kontrollen mot kryssreferanser hjelper mot kjente formuleringer, men den er lint – «viderefør uttrykket fra resten av presentasjonen» går klar av enhver mønsterliste.

Agenten oppgir aldri aspect ratio i fritekst, og skriver aldri prompten eller den samlede briefen selv. Det er nettopp den doble beskrivelsen som gjorde at brede prompter ble skrevet til nær kvadratiske soner.

### Bildeplanen er et mellomsteg

Den observerte feilen var ikke et bilde som ble feil. Det var en samtale som tok slutt. Brukeren bad om et illustrert foredrag, agenten bygget dekket, skrev bildeplanen, leste et svar med tom `issues`-liste og avsluttet med «presentasjonen er opprettet, bildene er ikke satt inn ennå». Ingenting var ugyldig, og ingen regel var brutt — alle reglene om bildegenerering sto i svaret agenten nettopp hadde lest, som prosa å ha lest.

Derfor svarer `plan_deck_images`, `get_image_brief` og `verify_image_handoff` med `workflow`: hvor rasterflyten står, avledet av dekket selv.

- `workflow.complete` er en påstand om **dokumentet**: de planlagte bildene ligger faktisk i dekket. Den kan bare bli sann av at brukeren deponerer filene, fordi alt en agent melder om et generert bilde er strenger den selv har skrevet – id, nummer, sone og filnavn sto i planen fra før, og avtrykket har Slaids ingen fil å sammenligne med. `complete: false` er derfor aldri i seg selv en beskjed om at agenten skylder noe, og `true` er aldri en kvittering for arbeidet dens. Det agenten skylder, står i `workflow.remainingSteps`, og det er den en stopp avgjøres på — ved at du har gjort det den krever av deg, ikke ved at listen blir tom.
- `workflow.nextAction` sier hva som skal gjøres nå, med dekkets eget tall i seg; `workflow.remainingSteps` er det som fortsatt gjenstår for agenten. I `awaiting-deposit` er den ikke tom, og de to stegene er alternativer Slaids ikke kan velge mellom, fordi betingelsen er noe bare den som leser dem kan se: har du bildefilene, lever dem med manifestet; har du dem ikke, generer de samme oppføringene på nytt og kontroller koblingen igjen. Du velger grenen som gjelder, utfører den, og avslutter når den er gjort — listen blir ikke tom av det, for det er brukerens deponering som endrer dekket.
- `workflow.completionCriteria` er hva fullført krever.
- `workflow.forbiddenClosings` navngir avslutningene som er gale mens `complete` er false: «presentasjonen er opprettet», «bildene er ikke satt inn ennå», «bildeplanen er klar», å be om en ny brukerbeskjed, og å generere et godkjent bilde om igjen fordi sonen fortsatt står tom. De tre første er sanne setninger om et halvferdig dekk — det er nettopp derfor de ble valgt.

Når bildeplanen foreligger og resten av presentasjonsarbeidet er ferdig, er rekkefølgen fast og skjer i **samme arbeidsøkt** – uten å vente på en ny brukerbeskjed, men uten at en avbrutt økt er tapt: køen ligger i dokumentet, og neste jobb er den første oppføringen ingen kobling gjør rede for. start bildegenereringen umiddelbart med det første planlagte bildet, ett kall per bildeoppføring med bare den oppføringens ferdige `prompt`, koble hvert ferdig bilde til riktig oppføring før det neste genereres, og fortsett med én oppføring av gangen til hvert planlagt bilde er laget. Ingenting av planen skrives ut i samtalen underveis. Rekkefølgen bildene returneres i er irrelevant; oppføringens eget nummer, `imagePlanItemId`, motiv og aspect ratio er fasit.

**Stoppkriteriet for bildegenereringen er koblingskontrollen, ikke fylte bildesoner.** Slaids ser aldri en generert bildefil: bildene lages i vertsklienten, og uten en filbro kommer de inn gjennom brukerens deponering i nettleseren. En fylt bildesone svarer derfor på «har filen kommet inn», aldri på «ble bildet laget» — og en agent som venter på fylte soner venter på noe den ikke kan gjøre selv. Når `verify_image_handoff` svarer `ok` for alle planlagte oppføringer, er genereringsoppgaven ferdig — men det er ikke det samme som at dekket er det, og stadiet sier hvilket: ligger filene ennå ikke i sonene, er `workflow.stage` `awaiting-deposit`, og `generation-verified` kommer først når ingenting Slaids kan se er utestående. `awaitingFileCount` forteller bare hvor mange filer Slaids ennå mangler. Et bilde som alt er generert og godkjent skal aldri lages om igjen fordi sonen står tom.

**Svaret blir stående.** Koblingene lagres på dekket, så en senere `get_image_brief` sier det samme som kontrollen gjorde — ellers ville kontrollen svart «ferdig» og neste lesning bedt om alle bildene på nytt. Lagringen er ikke et flagg: koblingene kontrolleres mot planen dekket har *nå*, hver gang. Skriver du om et motiv eller den felles bildekonteksten etterpå, får oppføringen en ny `imagePlanItemId`, kontrollen faller bort av seg selv, og de bildene skal lages om.

**En lagret kontroll er ikke et bevis på at bildet ligger i sonen.** Den sier at bildet ble laget. Genererer du erstatninger for en omskrevet bestilling, holder sonene fortsatt de gamle filene i det øyeblikket kontrollen går gjennom — hver sone har en fil, og ingen av dem er den nye. Da er stadiet `awaiting-deposit`, ikke `generation-verified`, og det blir først `generation-verified` når de nye filene faktisk er lagt inn.

**`generation-verified` sier ikke at filen i sonen er den kontrollerte filen.** Det sier at genereringen er kontrollert og at ingenting dekket kan se er utestående. Slaids ser aldri et bilde, så et bilde byttet for hånd etterpå er ikke til å skille fra det som ble deponert — se derfor gjennom bildene i tillegg, hver gang.

**Og den er ikke et bevis på at du kan levere filene.** Koblingene overlever en reload; bildefilene gjør ikke det, for Slaids lagrer aldri en generert fil. Åpner du et dekk der `workflow.stage` er `awaiting-deposit` og du ikke har filene fra den forrige samtalen, si det til brukeren og lag bildene på nytt for de samme oppføringene. Forbudet mot å lage et godkjent bilde om igjen gjelder bare så lenge du har filen. Det ene som aldri er lov, er å melde dekket ferdig uten å si hva som faktisk gjenstår — og si det slik det er: i `awaiting-deposit` står noen soner tomme, andre viser fortsatt bildet fra forrige bestilling, og `nextAction` sier hvilket av delene dette dekket har. I `generation-verified` er ingen sone tom, og da skal du ikke påstå at noen er det.

To stadier er ikke ferdige selv om ingenting åpenbart mangler:

- **`plan-needs-repair`** — `checkImagePlan` har funn. Kontrollene leses før enhver ferdig-gren, så reserverte bildesoner uten bildeplan, eller planfeil i et dekk der hver sone har fil, kan ikke rapporteres som en leveranse. Feilen rettes, og så fortsetter den samme flyten.
- **`plan-outdated`** — en fil i en sone svarer ikke på bestillingen som gjelder, og de to tilfellene krever motsatt handling: er filen laget for en bestilling som siden er skrevet om (koblingskontrollen svarer `PLAN_CHANGED`), blir sonen stående i planen og erstatningen genereres — og da genererer du hele planen, for kontrollen venter én fil per planlagt oppføring. Er det ingen kobling som gjør rede for filen, er proveniensen ukjent, og da skrives planen på nytt med bare sonene som venter. Følg `nextAction`. Er det en lagret kobling for sonen og bestillingen er skrevet om, sier koblingskontrollen `PLAN_CHANGED`, og da hjelper det ikke å tømme bildeplanen: koblingen blir stående så lenge bildet ligger i sonen, nettopp fordi det var slik en endret bestilling kunne vaskes bort til et «ferdig» dekk. Bildene skal lages om, eller brukeren skal velge å beholde dem. Er det ingen kobling for sonen, er proveniensen ukjent — og da er reparasjonen at planen skrives om med bare sonene som venter. Bildeplanen skal beskrive nøyaktig de sonene som *venter* på et bilde, og det er ikke pirk: `images` lister alle oppføringene, og koblingskontrollen forventer én fil per oppføring — så en plan med tre oppføringer der én sone alt har fil er en plan der «generer to bilder» og «kontroller tre» ikke kan være sanne samtidig. Skriv planen på nytt med bare sonene som venter, og generer dem. Det eksisterende bildet skal aldri lages om igjen for å komme videre — med mindre bestillingen for sonen faktisk er endret, og da sier koblingskontrollen `PLAN_CHANGED` for nettopp den.

Det finnes to gyldige stopp, og ingen andre: brukeren har uttrykkelig bedt om å stoppe før bildene genereres, eller det foreligger en konkret teknisk blokkering som navngis — hvilket kall, hvilken feil, hvilket bilde.

### Ett planlagt bilde er én bildegenerering

Svaret fra `plan_deck_images` og `get_image_brief` har to halvdeler av den samme planen, og de har hver sin jobb:

- **`images`** er den strukturerte listen, én oppføring per bilde: `imagePlanItemId`, nummer, filnavn, sone, format og de fire tekstfeltene. Den beskriver planen — den utfører den ikke. Selve prompten ligger ikke her.
- **Bildejobben** er det genereringen leser, én om gangen: én ferdig **`prompt`** — dekkets felles `imageContext` og bare denne oppføringens motiv, komposisjon, faglige krav og «unngå», med formatet målt fra sonen — pluss koblingsdataene kontrollen etterpå ber om. Ingen søskenoppføring, ingen samlet brief, intet antall. Prompten sendes ordrett og bygges aldri av agenten selv; `imagePlanItemId`, nummeret og filnavnet er bokføring ved siden av kallet, for hvert av dem sier «ett av flere».
- **`brief`** er intern og følger ikke med med mindre kallet ber om den: hele planen som én menneskelesbar tekst, til Slaids sin egen bildebrief-dialog, til dokumentasjon, til feilsøking og til manuell kopiering. Den er ikke et steg i normalflyten, ikke én bildegenereringsprompt, og skal ikke skrives ut i samtalen. Å ligge i svaret er å ligge i konteksten det neste bildekallet skrives fra.

Dette er ikke en smakssak. En plan på åtte bilder ble sendt videre som én jobb, og det som kom tilbake var ett storyboard: åtte motiv på ett lerret, én fil, ingen nummerering, og ingenting bildedeponeringen kunne plassere.

Å dele svaret i en maskinhalvdel og en menneskehalvdel rettet prompten og lot lekkasjen stå. En agent kan kalle generatoren én gang per oppføring og likevel ha vist den hele planen — ved å skrive ut briefen først, ved å liste motivene, ved å melde «nå lager jeg de ni bildene», ved å nummerere sin egen framdrift. Derfor er isolasjonen strukturell i to lag: prompten for ett bilde settes sammen av Slaids fra den ene oppføringen, og genereringssteget *leser* bare den ene — køen er dekket selv, og neste jobb finnes først når den forrige er kontrollert. Antallet er fortsatt tilgjengelig — som kontroll av den ferdige leveransen, ikke som noe agenten gjentar.

Tekstene kan lekke settet selv om prompten er isolert: «samme utsnitt som forrige bilde» eller «alle bildene skal ha samme stil» reiser inni selve ordren. Slike referanser meldes som `CROSS_IMAGE_REFERENCE`, og da leveres ingen jobb før teksten står alene. Den nakne flertallsformen fanges ikke — «ingen tekst i bildene» navngir ikke noe annet bilde.

### Genereringsrekkefølge er aldri identitet

Den andre feilen var ikke et steg gjort galt — hvert genereringskall var riktig. Slaids planla ni bilder i slide-orden, bildegeneratoren produserte dem i rekkefølgen 1, 3, 9, 6, 5, 8, 2, 4, 7, og filene ble navngitt `1`‥`9` **etter rekkefølgen de kom tilbake i**. Sju av ni bilder havnet på en slide de aldri var laget for, og ingenting i flyten kunne se forskjell på det og en vellykket leveranse: planen var riktig, antallet var riktig, filnavnene var velformede.

Derfor har hver bildeoppføring en egen, stabil id — `imagePlanItemId`, på formen `imgplan_…` — som følger bildet fra bildeplan til generering til fil til deponering. Nummeret er hva *filen* heter; id-en er hva bildet *er*.

Id-en dekker **hele bestillingen**, ikke bare motivet: dekket, sonen, nummeret, alle fire bildefeltene, dekkets felles bildekontekst og det målte formatet. Skrives noe av det om etter at bildet er laget, er bildet laget fra en bestilling dekket ikke lenger har, og koblingen avvises. Det som med vilje står utenfor, er alt en generator aldri får høre om — dekkets tittel, slidens tittel, de andre slidene, temaet — så en endring der ugyldiggjør ingenting.

Arbeidsflyten er eksplisitt sekvensiell, og rekkefølgen på stegene er selve mekanismen. For hver oppføring, i stigende `number`:

1. Hent den ene bildejobben som står for tur. `prompt` er hele instruksen, og ingenting skal legges til den.
2. Kall bildegeneratoren nøyaktig én gang, med bare den teksten.
3. Regn ut SHA-256 av bytene som kom tilbake, med en gang, og knytt filen til den samme `imagePlanItemId`.
4. Gi filen navnet jobben oppgir: `<number>.<filendelse>`, der `number` er oppføringens eget nummer.
5. Kjør koblingskontrollen for denne ene oppføringen, med avtrykket. Uten avtrykk blir genereringen aldri verifisert.
6. Hent først deretter neste jobb, uten å kommentere i samtalen at du gjør det.

En agent som samler alle filene først og navngir dem etterpå har ingenting igjen å knytte dem fra. Rekkefølgen bildegeneratoren produserer, returnerer eller *viser* bildene i er ikke en identitetskilde: «det første bildet som kom tilbake» er aldri bilde 1, og et bilde skal aldri nummereres etter når det ble ferdig.

**Sluttkontrollen er et kall, ikke en huskeregel.** Når alle filene er ferdige, og før de leveres eller deponeres, oppgir agenten én kobling per fil til `verify_image_handoff` — `imagePlanItemId`, `number`, `slideId`, `nodeId`, filnavn — og Slaids kontrollerer at alle planlagte id-er finnes nøyaktig én gang, at ingen id er ukjent eller gjentatt, at hvert nummer forekommer én gang, at hver id peker på den sonen planen sier, og at filnavnet stemmer med oppføringens nummer. Er svaret ikke `ok`, skal bildene ikke deponeres: de bildene det gjelder genereres enkeltvis på nytt. Er det `ok`, følger `slaids-bilder.json` med, og den legges ved siden av bildefilene — det er slik koblingen overlever turen gjennom en nedlastingsmappe, og deponeringen kontrollerer den på nytt i nettleseren.

### Metadata er ikke nok: filens egne bytes

En kobling uten avtrykk er en påstand om et *filnavn*, og et filnavn overlever at innholdet byttes om. Bytt innholdet i `1.png` og `2.png` og la navnene og manifestet stå: id-er, numre, soner og navn stemmer fortsatt, og to bilder ligger fortsatt på feil slide.

Derfor oppgir agenten også `contentHash`: SHA-256 av bytene bildegenereringen returnerte for akkurat den oppføringen, **regnet ut i det filen kommer tilbake** og før neste bilde genereres. Et avtrykk beregnet i ettertid, fra en mappe med ferdige filer, fester bare en forveksling som allerede har skjedd. Avtrykket følger manifestet, og nettleseren sammenligner det med filens egne bytes før sanitering, optimalisering og innsetting.

To ting dette **ikke** er:

- **Det er ikke motivkontroll.** Et avtrykk som stemmer sier hvilken fil som hører til hvilken bildeplass. Det sier ingenting om hva bildet viser — ingenting i Slaids kan det, fordi Slaids aldri ser på bildet. Se gjennom bildene i tillegg, og si det samme til brukeren.
- **Det er ikke et krav.** Ikke alle vertsklienter får tilgang til bytene til det bildeverktøyet deres produserte. Utelat feltet da: kontrollen svarer `check: "unchecked"`, leveransen skal omtales som uverifisert, og deponeringen ber brukeren bekrefte manuelt. Den skal aldri presenteres som kontrollert.

`ok` og `check` svarer på to forskjellige spørsmål. `ok: true` betyr bare at ingenting motsier seg selv; `check` sier hvor langt koblingen faktisk er kontrollert, og `checkMeans` sier hva nivået dekker. Les dem sammen.

**Antallet kontrolleres før deponering.** Feltet `generation` i det samme svaret sier hva en ferdig leveranse er, avledet av den samme planen briefen bygges av:

| felt | hva det er |
| --- | --- |
| `expectedFileCount` | antall separate bildefiler planen krever — alltid én per oppføring, og en kontroll av det ferdige settet, aldri noe som sies i samtalen |
| *(bildejobben)* | prompten og koblingsdataene for én oppføring om gangen, hentet fra sin egen flate |
| `rule` | at én oppføring er én hel genereringsoppgave, og hva kallet får inneholde |
| `perImageInstruction` | at instruksen for ett bilde *er* oppføringens `prompt`, og hva som skal holdes utenfor |
| `perImageSteps` | løkken, ett nummerert steg om gangen |
| `isolation` | hva samtalen rundt kallet ikke får avsløre |
| `orderIsNotIdentity` | hvorfor genereringsrekkefølgen ikke kan brukes som nummer |
| `fileNamePattern`, `fileExtensions` | `<nummer>.<filendelse>`, med deponeringens egne filendelser |
| `beforeDeposit` | de kontrollerbare linjene før filene leveres |
| `briefRole` | at den samlede briefen er intern: dokumentasjon og manuell kopiering, aldri en prompt og aldri et steg |

Er antallet, nummereringen eller formatet feil, er bildegenereringen ikke ferdig: de manglende bildene genereres enkeltvis på nytt før deponering. Ett collage-, storyboard-, kontaktark-, split-screen- eller infografikkbilde teller aldri som flere bilder, uansett hvor mange motiv det inneholder.

Nummereringen bevares hele veien — planlagt bilde 1 blir fil `1`, bilde 2 blir fil `2` — fordi bildedeponeringen under kobler nummererte filer til riktige bildeplassholdere. Filnavnet kommer alltid fra oppføringens `number`, aldri fra en teller over de ferdige filene.

### Bildedeponering: brukeren legger inn alle bildene på én gang

Det samme kallet åpner **bildedeponeringen**. Hver planlagte bildesone får det nummeret briefen bruker lagret internt på seg, og presentasjonen merkes som «venter på bilder» (`pending`). Ingen flere Slaids-kall kreves for å åpne eller holde deponeringen klar; svaret fra `plan_deck_images` og `get_image_brief` viser tilstanden i feltet `deposit`. Dette er likevel ikke et stoppunkt for vertsklienten: når rasterflyten krever direkte handoff, skal bildegenereringen faktisk startes før oppgaven kan avsluttes.

Brukeren møter dette slik:

1. Presentasjonen åpnes, og en dialog forklarer at den har *N* bildeplasser som kan fylles automatisk. To valg: **«Generer og legg inn bilder»** eller **«Gå til editoren»**. Å velge editoren avslutter ingenting — knappen for bildebriefen øverst i editoren fører tilbake hit når som helst.
2. Bildebriefen vises med en nummerert liste over bildene som skal lages: nummer, format og motiv. Kopi-knappen finnes fortsatt for klienter og arbeidsflyter som trenger manuell overlevering.
3. Bildene kan genereres direkte av vertsklienten eller produseres et annet sted. Når bildefilene er tilgjengelige, lagres de som `1`, `2`, `3` … opp til *N*, med den filendelsen de får. Formatene kan gjerne være forskjellige: `1.png`, `2.jpg`, `3.webp`. Navn som `01.png`, `bilde1.png` og `1a.png` avvises med en begrunnelse — de blir aldri gjettet på — og to filer med samme nummer meldes som konflikt.
   Er bildene agentgenererte, legges `slaids-bilder.json` ved siden av dem. Da er ikke filnavnet alt Slaids har å gå etter: hver kobling kontrolleres mot bildeplanen, hver fils egne bytes sammenlignes med avtrykket bildegenereringen ga, og en konflikt stopper hele deponeringen med en begrunnelse per bilde. Mangler avtrykkene, sier dialogen at koblingen ikke er verifisert og ber om en uttrykkelig bekreftelse på at hvert nummer viser det motivet det skal. Bekreftelsen gjelder det konkrete settet: byttes et bilde ut etterpå, kreves den på nytt. Et manifest som ikke kan leses regnes som ukjent kobling, ikke som ingen kobling. Manuell opplasting uten manifest fungerer som før — der er nummeret i filnavnet autoritativt, fordi et menneske som lagrer «bilde 3» som `3.png` har laget koblingen selv, og det kreves ingen ekstra bekreftelse.
4. «Bildene er klare» åpner deponeringsdialogen. Filene dras inn eller velges, og en statusliste viser hvilke numre som er på plass, hvilke som mangler og hva som eventuelt er feil. **«Fullfør»** er deaktivert til nøyaktig 1…*N* er der uten feil, og uten koblingskonflikter.
5. Når deponeringen fullføres, lastes alle filene opp, hvert bilde havner i sonen det ble bestilt for, plassholderteksten forsvinner, og statusen settes til `completed`.

Sonene er vanlige bildeelementer hele veien; deponeringsnummeret er intern metadata på bildepanelet og vises aldri for publikum.

Endrer brukeren strukturen slik at koblingen brytes — sletter en nummerert bildesone, tømmer den eller gjør den om til tekst — advarer appen om at den automatiske innsettingen avsluttes for godt. Bekreftes det, settes statusen til `abandoned`, numrene fjernes, og dekket oppfører seg som et vanlig dekk. Avbrytes det, skjer ingenting i det hele tatt. `completed` og `abandoned` er endelige: ingenting setter et dekk tilbake til `pending`, heller ikke en ny bildeplan.

Reglene bor i `src/domain/imageDeposit.ts` og `src/domain/commands/imageDeposit.ts`, og er dekket av tester.

### Felles bildekontekst vs. motiv

To forskjellige ting, og de må holdes fra hverandre:

- **Felles bildekontekst** er det som er sant om alle bildene i dekket: uttrykk, realismegrad, lyssetting, kontrast, tidsperiode, miljø, bakgrunnskarakter, detaljnivå, fargeholdning, komposisjonsprinsipper, hvordan mennesker, dyr og gjenstander fremstilles, og hva som konsekvent skal unngås.
- **Motivet** er hva ett bestemt bilde viser, og hører hjemme i bildeplanens oppføring for den sonen.

Beskriver konteksten ett enkelt motiv, overstyrer den oppføringen for det bildet når de to settes sammen — og det er en av kontrollene Slaids faktisk melder fra om.

### Prompten for ett bilde

Prompten er **generert**, ikke skrevet, og den er det bildegeneratoren får. Den inneholder alt det ene bildet trenger, og ingenting som antyder at det finnes et bilde til: ingen opptelling, ingen nummerering, ingen bildeplan-ID, intet filnavn, ingen slide, ingen presentasjon og intet annet motiv. Formatet er dette:

```
Lag ett bilde.

Stil og kvalitet:
[Den felles bildekonteksten, ordrett — som stilen dette bildet skal ha.]

Motiv:
[...]

Komposisjon og utsnitt:
[...]

Faglige krav:
[...]

Unngå:
[...]

Format:
Aspect ratio 4:5 (stående). Følg dette forholdet så nøyaktig som
bildegeneratoren tillater, og gjør ikke et stående eller nær kvadratisk
bilde liggende fordi motivet også kunne vært fremstilt i landskapsformat.

Krav til bildefilen:
Ett motiv i ett bilde: ikke del flaten i paneler, ikke sett varianter av
motivet ved siden av hverandre, og ikke legg ramme rundt bildet. Ingen
tekst, etiketter eller infografikkelementer i bildet med mindre det er
bedt om over.
```

Seksjoner som ikke sier noe, utelates — en overskrift over ingenting er en instruks om å tegne ingenting bestemt. «Unngå» heter nettopp `Unngå` og ikke «Unngå i akkurat dette bildet», som briefen kaller den: i en prompt som *er* det eneste bildet som finnes, er «akkurat dette» en henvisning til de andre.

### Den samlede bildebriefen — intern

Briefen er også **generert**, ikke skrevet, men den er den *interne* halvdelen: Slaids sin egen bildebrief-dialog, dokumentasjon, feilsøking og manuell kopiering når brukeren ber om den. Den skrives ikke ut i samtalen, og den er ikke en prompt — den teller bildene, nummererer dem og viser alle motivene samtidig, og det er nøyaktig det én bildegenerering ikke skal se. Formatet er dette:

```
Lag nøyaktig [ANTALL] separate bilder til én presentasjon.

VIKTIGE REGLER FOR LEVERANSEN
Hvert nummer nedenfor er én selvstendig bildefil.
Ikke kombiner flere nummer i samme bilde.
Ikke lag collage, kontaktark, storyboard, diptyk, split-screen,
før/etter-paneler eller ett bredt bilde som viser flere av motivene samtidig,
med mindre dette uttrykkelig står i beskrivelsen av akkurat det bildet.
Bilde 1 skal bare vise motivet til bilde 1, bilde 2 bare motivet til bilde 2 osv.

Aspect ratio for hvert bilde er spesifisert eksplisitt.
Følg dette forholdet så nøyaktig som bildegeneratoren tillater.
Ikke gjør et stående eller nær-kvadratisk bilde liggende bare fordi motivet
også kunne vært fremstilt i landskapsformat.

Ingen tekst, etiketter, rammer eller infografikkelementer i bildene
med mindre dette eksplisitt er bedt om for det aktuelle bildet.

ETT BILDE OM GANGEN, OG REKKEFØLGEN ER IKKE IDENTITET
Generer bildene enkeltvis, ett kall per nummer nedenfor.
Rekkefølgen bildene blir ferdige i, og rekkefølgen de vises i,
sier ingenting om hvilket nummer de hører til.
Bruk aldri «det første bildet som kom tilbake» som bilde 1.
Hvert bilde hører til den oppføringen det ble generert fra – identifisert
av «Bildeplan-ID» – og filen skal ha filnavnet den oppføringen oppgir,
uansett når i samtalen bildet ble laget.

FELLES BILDEKONTEKST
[Den felles bildekonteksten, ordrett.]

BILDE 1 AV [ANTALL]
Bildeplan-ID: imgplan_[DIGEST]
Filnavn: 1.<filendelse>
Skal brukes på slide: [SLIDETITTEL]
Aspect ratio: 4:5 (stående)

Motiv:
[...]

Komposisjon og utsnitt:
[...]

Faglige krav:
[...]

Unngå i akkurat dette bildet:
[...]

[fortsett til bilde N]

FØR GENERERING
Kontroller at det er nøyaktig [ANTALL] separate bilder i listen,
at hvert bilde har ett eksplisitt aspect ratio,
at hvert nummer beskriver ett entydig motiv,
og at motivene ikke utilsiktet er slått sammen eller gjort til varianter
av det samme bildet.

Generer deretter alle [ANTALL] bildene enkeltvis, ett kall per oppføring.

ETTER GENERERING
Kontroller for hver ferdige fil at den hører til den oppføringen den ble
generert fra: samme Bildeplan-ID, samme nummer og filnavnet oppføringen
oppgir. Stemmer ikke koblingen, skal bildene ikke leveres videre.
Kan du lese bytene til de ferdige filene, regn ut SHA-256 av hver fil
i det den kommer tilbake, og lever avtrykkene sammen med bildene: et
filnavn overlever at innholdet byttes om, et avtrykk gjør det ikke.
Et avtrykk sier hvilken fil som hører til hvilken bildeplass, ikke hva
bildet viser – se gjennom bildene selv i tillegg.
```

Begge malene bor i `src/domain/imagePlan.ts` og er dekket av tester. Utdragene over er en gjengivelse for lesere, ikke en andre normativ kilde: endres formatet, endres det der.

### Kontrollene før bildeplanen er ferdig

Slaids sjekker planen mot dekket og melder fra om:

- en bildeoppføring som peker på en sone som ikke finnes lenger, eller ikke er en bildesone;
- en bildesone som venter på en fil uten at noen oppføring beskriver den;
- en beskrivelse som oppgir et annet format enn sonen faktisk har — enten som et uttrykkelig formatuttrykk («panorama», «stående utsnitt», «liggende format», «portrettformat») eller som et forholdstall skrevet inn i teksten. Positur og fasong er ikke formatpåstander: «stående helfigur» og «kvadratisk steinplate» beskriver motivet, og telles ikke;
- to oppføringer som i praksis beskriver samme motiv;
- en plassholdertekst på sliden som ikke lenger sier det samme nummeret som briefen — det skjer når slides flyttes etter at planen ble skrevet, og rettes ved å skrive bildeplanen på nytt;
- en bildeplanoppføring som har endret seg etter at bildet ble generert — koblingskontrollen skiller det fra en ukjent id, fordi svaret er forskjellig: det ene er «lag dette bildet på nytt», det andre er «disse filene hører ikke til dette dekket»;
- planlagte bilder uten felles bildekontekst;
- en felles bildekontekst som gjentar motivet til ett enkelt bilde.

En tom liste betyr at *planen* er klar til bildegenerering — ikke at bildearbeidet er ferdig. Hvor bildearbeidet står, svarer `workflow` på; se «Bildeplanen er et mellomsteg» over.

## 7. Komposisjoner som ofte fungerer

Dette er startpunkter, ikke maler.

### Hovedpåstand + forklaring + peers

En sterk faglig komposisjon er:

- et kort hovedutsagn øverst;
- en kort forklaring under;
- 2–4 likeverdige kort eller figurer i en rad nederst.

Dette fungerer når sliden først skal etablere én idé og deretter vise flere dimensjoner eller bevis som hører til den. Det er særlig effektivt når hver underdel har en kort, naturlig etikett.

### Direkte sammenligning

To likeverdige objekter → to like søskensoner. Dersom innholdet er kort, kan hvert kort få redusert høyde med luft over og under i stedet for å fylle hele hovedområdet.

### Bilde + kompakt kort

Et stort bilde kan dominere én side. Et kort med bare en kort forklaring på den andre siden trenger ikke strekke seg over samme høyde; bruk heller vertikal negativ plass rundt kortet dersom det gir bedre balanse.

### Taksonomi / katalog

Flere parallelle medlemmer → regelmessig grid eller rad med konsistent innholdstype.

### Oversikt + detaljer

Én overordnet idé → stor hovedsone, med en mindre nested gruppe for evidens eller detaljer.

### Fokus / pause

Ett stort bilde, ett tall eller én kort formulering kan få dominere en hel slide når poenget faktisk tåler det.

## 8. Farger skal støtte semantikk

Like roller bør ha en gjenkjennelig visuell grammatikk, men det betyr ikke at alle kort må ha identisk farge.

- samme farge kan understreke at flere kort tilhører samme gruppe;
- ulike, harmoniske headerfarger kan hjelpe publikum å skille to kontrasterende eller tydelig separate peers;
- fargevariasjon skal ha en funksjon, ikke være tilfeldig dekorasjon.

Typografi, kortform, spacing og hierarki bør være mer konsistente enn selve fargene.

## 9. Kilder går gjennom referansesystemet

Når en faktapåstand støttes av en ekstern kilde, registrer kilden i Slaids sitt innebygde referansesystem og la tekstblokken bruke en citation som peker på den. Slaids sine avledede referansesider genererer selve kildelisten – agenten skriver aldri et nummer eller en bibliografi for hånd.

Ikke opprett en egen slide bare for å ramse opp kilder eller referanser. Unntaket er en faglig slide brukeren uttrykkelig har bedt om, som diskuterer f.eks. evidenskvalitet eller metodiske begrensninger; selv da hører selve bibliografien hjemme i referansesystemet, ikke skrevet eller tegnet som en liste på sliden.

En konsekvens av dette: en faktapåstand som trenger en citation skal aldri bakes inn som tekst i en SVG. Det er nettopp den veien som omgår citation-systemet, og validatoren kan ikke lese SVG-tekst som en referanse.

## 10. Fit er redaksjonell tilbakemelding

Når noe ikke får plass:

1. kort ned teksten;
2. fjern redundans og detaljer som kan sies muntlig;
3. sjekk om grouping er feil;
4. juster vekter dersom hierarkiet tilsier det;
5. bygg om treet hvis relasjonen er feil representert;
6. del sliden hvis den egentlig gjør flere kommunikative jobber.

Ikke løs overflow ved å gjøre skriften stadig mindre eller ved å lage ekstremt smale soner.

## 11. Visuell konsistens uten layoutmonotoni

Repeter den samme visuelle grammatikken for like semantiske roller:

- typografi;
- korttype;
- hierarki;
- fargebruk med samme betydning;
- rekkefølge i gjentatte sammenligninger.

Varier geometrien når innholdsrelasjonen endres. Et godt dekk trenger ikke at hver slide ser ulik ut, men det skal heller ikke falle tilbake til samme layout bare fordi den er enkel å produsere.

## 12. Anti-mønstre

Unngå aktivt:

- publikumsinnhold som beskriver Slaids, layoutvalget eller agentens arbeidsprosess;
- oppdiktede eller parafraserte «sitater» brukt som dekorasjon;
- negativt rom mellom sideordnede kort når det bare gjør kortene smalere;
- store synlige kort med svært lite tekst og unødvendig mye tom høyde når en enkel vertikal trim ville gitt bedre balanse;
- å bruke negativt rom for å demonstrere at presentasjonen har negativt rom;
- å behandle bildeplanen som en fallback fordi rasterfilen produseres utenfor Slaids;
- å skrive en bred, liggende bildeprompt til en nær kvadratisk eller stående sone;
- å oppgi aspect ratio i fritekst i stedet for å la sonen bestemme den;
- å skrive bildeprompten eller den samlede bildebriefen for hånd i stedet for å la dem genereres fra bildeplanen;
- å skrive ut den samlede briefen, liste opp bildene eller si hvor mange de er før bildegenereringen — det er nettopp det som gjør oppgaven til en flerbildeoppgave;
- å navngi bildefilene etter rekkefølgen bildegeneratoren ble ferdig med dem, i stedet for etter oppføringens eget nummer;
- å levere eller deponere bildene uten å ha kontrollert koblingen mellom hver fil og bildeplanoppføringen den ble generert fra;
- å regne ut avtrykkene i ettertid fra en mappe med ferdige filer, i stedet for fra hver genereringsrespons;
- å omtale en leveranse uten avtrykk som kontrollert, eller å lese et avtrykk som stemmer som en godkjenning av hva bildet viser;
- å bruke en aksent som om den var kortets hovedoverskrift, der korttittelen skulle båret navnet;
- å tegne en hel slide, en slideoverskrift, kort eller korttitler som SVG i stedet for å bruke Slaids sine egne innholdstyper;
- å tegne mennesker, dyr, bygninger eller andre illustrasjonsmotiver som hjemmelaget SVG i stedet for et rasterbilde eller en planlagt bildesone;
- å tegne en litteraturliste eller kildeoversikt som SVG i stedet for å bruke referansesystemet;
- å bruke bilder som ren fyllmasse;
- én stor tekstsone + punktliste som generelt standardsvar;
- gjennomsiktig container brukt som format for primært tekstinnhold;
- navngitte, parallelle enheter uten synlig innramming, der korttittelen kunne båret navnet — også når enheten bæres av et bilde;
- flere navngivbare konsepter i én punktliste når de burde være peers;
- nested splits uten faktisk hierarki;
- asymmetri uten semantisk grunn;
- tekst lagt inn bare for å fylle tom plass;
- å levere en presentasjon som bare er strukturelt validert, uten at representative slides – særlig med egenprodusert SVG – faktisk er rendret og sett på.

## 13. Arbeidsflyt

For hver slide:

1. Formuler én kommunikativ oppgave.
2. Kontroller at alt planlagt publikumsinnhold faktisk handler om denne oppgaven.
3. Dekomponer stoffet i semantiske enheter.
4. Uttrykk enhetene som Slaids-soner og native innholdstyper – sonetreet, overskriften, tekst og kort er komposisjonen, ikke en SVG.
5. Still bildespørsmålet for hver sone som trenger visuelt innhold: er behovet et illustrasjonsbilde eller en diagrammatisk figur?
6. Illustrasjonsbilde → raster: lag bildesonen slik at formatet passer motivet, og legg bildet inn i bildeplanen. Diagrammatisk figur → SVG, avgrenset til den ene sonen den fyller.
7. Klassifiser relasjonen mellom enhetene og bygg det enkleste sonetreet som gjør relasjonen synlig.
8. Velg innholdstype og vekter etter semantisk rolle — før teksten skrives, ikke etter. Primært tekstinnhold er et `titled-card` med mindre du kan si hvorfor ikke.
9. Skriv kort tekst; bruk avsnitt eller linjeskift når en romslig flate har flere tydelige delpoenger, og bruk citations der en faktapåstand trenger en kilde.
10. Bruk quote bare når et ekte sitat fortjener det.
11. Bruk negativt rom bare når du kan forklare den konkrete kompositoriske gevinsten; særlig for å trimme høyden på synlige kort med lite innhold.
12. Render representative slides og inspiser dem visuelt – spesielt slides med egenprodusert SVG – før dekket anses ferdig. Strukturell validering er nødvendig, men ikke tilstrekkelig.

### Kontrollpunkter

For hver tekstsone:

1. Har jeg brukt `container` eller `untitled-card` der dette egentlig burde vært et `titled-card`?
2. Har jeg brukt en aksent som om den var kortets hovedoverskrift, der korttittelen skulle båret navnet?
3. Kunne dette tekstinnholdet vært fordelt på flere mindre soner med hver sin korttittel?
4. Hvis ikke: kunne sonen likevel fått bedre intern oppdeling med subfelter og aksenter?

Når første hele utkast står:

1. Har semantisk like elementer fått lik visuell behandling gjennom hele presentasjonen?
2. Passer fargevalgene til temaene og strukturen, og bærer de mening i stedet for å være dekorasjon?
3. Har flere slides falt tilbake til det samme standardmønsteret uten god grunn?
4. Er bildeplanen i samsvar med sonene: én oppføring per bildesone som venter på en fil, og ingen sone uten oppføring?
5. Stemmer hvert planlagt motiv med formatet på sonen det skal ligge i?
6. Er to planlagte bilder blitt så like at de i praksis beskriver nesten samme motiv?

Når kontrollpunktene er besvart, det du fant er rettet og du har gjort det `workflow.remainingSteps` krever av deg, er *ditt* arbeid ferdig: ikke start en ny forbedringsrunde uten at det er kommet en ny instruks eller et nytt funn – dette er en sluttkontroll, ikke en åpen sløyfe. Det er `remainingSteps` som avgjør det, ikke `complete` alene: `complete` svarer for dokumentet, og kontrollen lagres på dekket mens bildefilene ikke gjør det. I `no-planned-images` og `generation-verified` er listen tom, og da er både du og dekket ferdig. I `awaiting-deposit` er den ikke tom, og de to stegene er alternativer Slaids ikke kan velge mellom: du velger den grenen som gjelder denne samtalen, utfører den, og avslutter når *den* er gjort – ikke når listen blir tom, for den blir ikke tom av det du gjør. Har du bildefilene, lever dem med manifestet og si hva brukeren skal gjøre – da har du gjort ditt, mens bildene fortsatt mangler i dekket, og da skal du ikke si at presentasjonen er ferdig, og ikke vente på at brukeren deponerer dem. Har du dem ikke, fordi dekket er åpnet i en senere samtale, er den lagrede kontrollen ingen leveranse du kan gjøre: da gjenstår det agentarbeid, og du genererer de samme oppføringene på nytt og kontrollerer koblingen igjen før du avslutter. Uansett hvilken av de to: si hva som gjenstår og hvem som gjør det, slik `nextAction` beskriver. Det er ingen åpen forbedringssløyfe etter det.

Den viktigste testen er fortsatt:

> **Hvis jeg bare så geometrien og innholdstypene, ville hierarkiet og relasjonene fortsatt ligne på det innholdet prøver å si?**

Legg nå til en andre test:

> **Hvis jeg fjernet alle forklaringer om designprosessen og alt dekorativt tekstgrep, ville sliden blitt faglig svakere? Hvis nei, skulle de elementene aldri vært der.**
