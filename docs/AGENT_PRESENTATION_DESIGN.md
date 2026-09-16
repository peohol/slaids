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
4. **Riktig medietype** – illustrasjon → raster (eller et bildenotat); diagrammatisk figur → SVG, og bare i den ene sonen den fyller.
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

Bruk når selve innholdet er budskapet og en ekstra etikett bare ville vært støy.

### Container

Bruk når sonen faktisk er én samlet idé uten behov for synlig innramming. En container er gjennomsiktig og rammer ingenting inn, og det er nettopp poenget med den — men det gjør den også til den innholdstypen en sone får når ingen velger.

Skriver du tekst i en tom sone, blir den en container. Det er utgangspunktet Slaids må velge for å ha et sted å legge teksten, ikke et designvalg. Skal sonen være én av flere navngitte enheter, settes innholdstypen før teksten skrives.

En container er derfor aldri svaret på at stoffet var vanskelig å dekomponere.

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

### Når bildegenerator mangler

Manglende bildegenerator er ikke en grunn til å droppe relevante bilder. Agenten skal planlegge dem:

1. bestem bildets faglige rolle;
2. reserver en sone der et bilde faktisk får plass;
3. legg inn et bildenotat (`notePurpose: "image-prompt"`) i sonen;
4. skriv en konkret prompt tilpasset sonens aspektforhold og komposisjon;
5. bruk én felles bildebrief for dekket dersom minst ett generert rasterbilde planlegges.

Et notat tegner ingenting og har derfor ingen minstestørrelse. Reservasjonen kan altså bli for liten uten at noe protesterer, og en sone som holder et notat med tekst i tilbyr ingen andre innholdstyper før den tømmes. Derfor svarer inspeksjonen med `reservedImageKinds` for bildenotater: bildetypene sonen faktisk kan bli. Et titled image card trenger mer plass enn et bart bilde, så planlegger du et navngitt medlem i en serie, er det den typen som må stå i listen. Tom liste betyr at sonen må få mer plass før noe bilde kan settes inn.

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
- å droppe relevante bilder fordi agenten mangler rastergenerator;
- å tegne en hel slide, en slideoverskrift, kort eller korttitler som SVG i stedet for å bruke Slaids sine egne innholdstyper;
- å tegne mennesker, dyr, bygninger eller andre illustrasjonsmotiver som hjemmelaget SVG i stedet for et rasterbilde eller et bildenotat;
- å tegne en litteraturliste eller kildeoversikt som SVG i stedet for å bruke referansesystemet;
- å bruke bilder som ren fyllmasse;
- én stor container + punktliste som generelt standardsvar;
- gjennomsiktig container + overskrift + tekst som generelt standardsvar;
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
6. Illustrasjonsbilde → raster (bildenotat hvis rastergenerator mangler). Diagrammatisk figur → SVG, avgrenset til den ene sonen den fyller.
7. Klassifiser relasjonen mellom enhetene og bygg det enkleste sonetreet som gjør relasjonen synlig.
8. Velg innholdstype og vekter etter semantisk rolle — før teksten skrives, ikke etter.
9. Skriv kort tekst; bruk avsnitt eller linjeskift når en romslig flate har flere tydelige delpoenger, og bruk citations der en faktapåstand trenger en kilde.
10. Bruk quote bare når et ekte sitat fortjener det.
11. Bruk negativt rom bare når du kan forklare den konkrete kompositoriske gevinsten; særlig for å trimme høyden på synlige kort med lite innhold.
12. Render representative slides og inspiser dem visuelt – spesielt slides med egenprodusert SVG – før dekket anses ferdig. Strukturell validering er nødvendig, men ikke tilstrekkelig.

Den viktigste testen er fortsatt:

> **Hvis jeg bare så geometrien og innholdstypene, ville hierarkiet og relasjonene fortsatt ligne på det innholdet prøver å si?**

Legg nå til en andre test:

> **Hvis jeg fjernet alle forklaringer om designprosessen og alt dekorativt tekstgrep, ville sliden blitt faglig svakere? Hvis nei, skulle de elementene aldri vært der.**
