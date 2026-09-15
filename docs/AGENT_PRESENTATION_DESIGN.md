# Agentstyrt presentasjonsdesign

Denne guiden forklarer hvordan en agent bør komponere presentasjoner i Slaids. Den er ikke en katalog med ferdige maler. Den normative agentkontrakten bor i `src/agent/design.ts`; MCP-instruksen og verktøybeskrivelsene eksponerer reglene derfra. Denne filen forklarer tankegangen og gir eksempler.

Utgangspunktet er enkelt:

> **Innholdets logiske struktur skal bestemme sonetreet. Ikke velg layout først og press innholdet inn etterpå.**

En gyldig slide er ikke nødvendigvis en god slide. Slaids kan kontrollere geometri og fit; agenten må selv kontrollere pedagogikk, relevans, rytme og visuell prioritering.

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

### Container og punktliste

Én stor container er riktig når sliden faktisk er én sammenhengende idé. Den er ikke et standardsvar.

Dette gjelder like mye uten punktliste. «Gjennomsiktig container + overskrift + ett avsnitt», gjentatt slide etter slide, er det samme standardsvaret med listen tatt ut.

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

### Titled card

Hovedregelen for navngitte, parallelle enheter. Består sliden av flere av:

- **arter**;
- **kategorier**;
- **aktører**;
- **faser**;
- **alternativer**;
- **sammenligningsobjekter**;

så skal hver enhet normalt være et titled card med enhetens navn som korttittel. Da ser publikum at enhetene er likeverdige, og navnet blir noe å skanne etter i stedet for en setningsstart inne i en tekstblokk.

Testen er enkel: kan enheten pekes på og kalles noe? Da har korttittelen noe å si.

Korttittelen står på én linje og brytes ikke. Får det fulle navnet ikke plass — «Australopithecus afarensis» i en av tre kolonner, for eksempel — kortes tittelen ned («A. afarensis») og den fulle formen står i teksten. En avvist korttittel er aldri en grunn til å gå tilbake til en container.

### Untitled card

Bruk når selve innholdet er budskapet og en ekstra etikett bare ville vært støy.

### Container

Bruk når sonen faktisk er én samlet idé uten behov for synlig innramming. En container er gjennomsiktig og rammer ingenting inn, og det er nettopp poenget med den — men det gjør den også til den innholdstypen en sone får når ingen velger.

Skriver du tekst i en tom sone, blir den en container. Det er utgangspunktet Slaids må velge for å ha et sted å legge teksten, ikke et designvalg. Skal sonen være én av flere navngitte enheter, settes innholdstypen før teksten skrives.

En container er derfor aldri svaret på at stoffet var vanskelig å dekomponere.

### Image / titled image card

Bruk et selvstendig bilde når bildet selv bærer informasjonen. Bruk titled image card når bildet er ett medlem av en navngitt serie eller katalog.

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

Bruk SVG til grafer, diagrammer, flytskjemaer, enkel ikonografi og geometriske forklaringsfigurer. SVG skal forbli SVG.

Fotografiske, naturtro, kunstneriske og visuelt komplekse motiver skal være rasterbilder fra en egnet bildegenerator. Ikke etterlign fotografiske eller organiske motiver med hjemmelaget SVG og rasteriser dem etterpå.

### Når bildegenerator mangler

Manglende bildegenerator er ikke en grunn til å droppe relevante bilder. Agenten skal planlegge dem:

1. bestem bildets faglige rolle;
2. reserver en sone der et bilde faktisk får plass;
3. legg inn et bildenotat (`notePurpose: "image-prompt"`) i sonen;
4. skriv en konkret prompt tilpasset sonens aspektforhold og komposisjon;
5. bruk én felles bildebrief for dekket dersom minst ett generert rasterbilde planlegges.

Et notat tegner ingenting og har derfor ingen minstestørrelse. Reservasjonen kan altså bli for liten uten at noe protesterer, og en sone som holder et notat med tekst i tilbyr ingen andre innholdstyper før den tømmes. Derfor svarer inspeksjonen med `reservedImageFits` for bildenotater: er den `false`, må sonen få mer plass før bildet kan settes inn.

Bildenotatet er et fremtidig bilde, ikke negativt rom.

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

## 9. Fit er redaksjonell tilbakemelding

Når noe ikke får plass:

1. kort ned teksten;
2. fjern redundans og detaljer som kan sies muntlig;
3. sjekk om grouping er feil;
4. juster vekter dersom hierarkiet tilsier det;
5. bygg om treet hvis relasjonen er feil representert;
6. del sliden hvis den egentlig gjør flere kommunikative jobber.

Ikke løs overflow ved å gjøre skriften stadig mindre eller ved å lage ekstremt smale soner.

## 10. Visuell konsistens uten layoutmonotoni

Repeter den samme visuelle grammatikken for like semantiske roller:

- typografi;
- korttype;
- hierarki;
- fargebruk med samme betydning;
- rekkefølge i gjentatte sammenligninger.

Varier geometrien når innholdsrelasjonen endres. Et godt dekk trenger ikke at hver slide ser ulik ut, men det skal heller ikke falle tilbake til samme layout bare fordi den er enkel å produsere.

## 11. Anti-mønstre

Unngå aktivt:

- publikumsinnhold som beskriver Slaids, layoutvalget eller agentens arbeidsprosess;
- oppdiktede eller parafraserte «sitater» brukt som dekorasjon;
- negativt rom mellom sideordnede kort når det bare gjør kortene smalere;
- store synlige kort med svært lite tekst og unødvendig mye tom høyde når en enkel vertikal trim ville gitt bedre balanse;
- å bruke negativt rom for å demonstrere at presentasjonen har negativt rom;
- å droppe relevante bilder fordi agenten mangler rastergenerator;
- å tegne mennesker, dyr eller andre organiske motiver som hjemmelaget SVG;
- å bruke bilder som ren fyllmasse;
- én stor container + punktliste som generelt standardsvar;
- gjennomsiktig container + overskrift + tekst som generelt standardsvar;
- navngitte, parallelle enheter uten synlig innramming, der korttittelen kunne båret navnet;
- flere navngivbare konsepter i én punktliste når de burde være peers;
- nested splits uten faktisk hierarki;
- asymmetri uten semantisk grunn;
- tekst lagt inn bare for å fylle tom plass.

## 12. Arbeidsflyt

For hver slide:

1. Formuler én kommunikativ oppgave.
2. Kontroller at alt planlagt publikumsinnhold faktisk handler om denne oppgaven.
3. Dekomponer stoffet i semantiske enheter.
4. Still bildespørsmålet for denne sliden: vil et bilde, en figur eller et visuelt utsnitt forklare noe bedre enn mer tekst?
5. Klassifiser relasjonen mellom enhetene.
6. Bygg det enkleste sonetreet som gjør relasjonen synlig.
7. Velg innholdstype og vekter etter semantisk rolle — før teksten skrives, ikke etter.
8. Skriv kort tekst; bruk avsnitt eller linjeskift når en romslig flate har flere tydelige delpoenger.
9. Bruk quote bare når et ekte sitat fortjener det.
10. Bruk negativt rom bare når du kan forklare den konkrete kompositoriske gevinsten; særlig for å trimme høyden på synlige kort med lite innhold.
11. Hvis et relevant rasterbilde mangler, reserver sonen med bildenotat i stedet for å droppe bildet.
12. Inspiser, render representative slides og valider dekket.

Den viktigste testen er fortsatt:

> **Hvis jeg bare så geometrien og innholdstypene, ville hierarkiet og relasjonene fortsatt ligne på det innholdet prøver å si?**

Legg nå til en andre test:

> **Hvis jeg fjernet alle forklaringer om designprosessen og alt dekorativt tekstgrep, ville sliden blitt faglig svakere? Hvis nei, skulle de elementene aldri vært der.**
