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

Manglende bildegenerator er ikke en grunn til å droppe relevante bilder. Rekkefølgen er alltid den samme, også når filene skal lages et annet sted:

1. **Trenger sliden bilde i det hele tatt?** Bestem bildets faglige rolle først.
2. **Planlegg sonetreet slik at bildesonen passer motivet.** Et stående motiv trenger en høy sone; en vid scene trenger en bred sone. Passer ikke sonens format til motivet, skal sonene planlegges på nytt — motivet skal ikke presses inn i feil rektangel.
3. **Reserver sonen som en ekte bildesone:** sett innholdstypen til `image` eller `titled-image-card` uten fil. Sonen venter da på bildet, og har en bildesones minstemål. Inspeksjonen svarer med `reservedImageKinds`: bildetypene rektangelet faktisk rommer. Et titled image card trenger mer plass enn et bart bilde, så planlegger du et navngitt medlem i en serie, er det den typen som må stå i listen. Tom liste betyr at sonen må få mer plass.
4. **Legg bildet inn i dekkets bildeplan** — én oppføring per bildesone, med motiv, komposisjon og utsnitt, faglige krav, og hva som skal unngås i akkurat det bildet.
5. **Skriv dekkets felles bildekontekst** så snart minst ett rasterbilde planlegges — også om det bare er ett.

Slaids gjør resten: nummererer bildene i dekkets rekkefølge, måler aspect ratio fra hver sones faktiske geometri, setter plassholder-bildeteksten i hver ufylt bildesone — «Sett inn bilde 1 her», «Sett inn bilde 2 her» og så videre — og genererer den samlede bildebriefen. Plassholderen forsvinner av seg selv når filen legges inn i sonen, så den blir aldri stående over det ferdige dekket.

Agenten oppgir aldri aspect ratio i fritekst, og skriver aldri den samlede briefen selv. Det er nettopp den doble beskrivelsen som gjorde at brede prompter ble skrevet til nær kvadratiske soner.

### Felles bildekontekst vs. motiv

To forskjellige ting, og de må holdes fra hverandre:

- **Felles bildekontekst** er det som er sant om alle bildene i dekket: uttrykk, realismegrad, lyssetting, kontrast, tidsperiode, miljø, bakgrunnskarakter, detaljnivå, fargeholdning, komposisjonsprinsipper, hvordan mennesker, dyr og gjenstander fremstilles, og hva som konsekvent skal unngås.
- **Motivet** er hva ett bestemt bilde viser, og hører hjemme i bildeplanens oppføring for den sonen.

Beskriver konteksten ett enkelt motiv, overstyrer den oppføringen for det bildet når de to settes sammen — og det er en av kontrollene Slaids faktisk melder fra om.

### Den samlede bildebriefen

Briefen er **generert**, ikke skrevet. Den er én sammenhengende tekst brukeren limer rett inn der bildene lages, og formatet er dette:

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

FELLES BILDEKONTEKST
[Den felles bildekonteksten, ordrett.]

BILDE 1 AV [ANTALL]
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

Generer deretter alle [ANTALL] bildene som separate bilder.
```

Malen bor i `src/domain/imagePlan.ts` og er dekket av tester. Utdraget over er en gjengivelse for lesere, ikke en andre normativ kilde: endres formatet, endres det der.

### Kontrollene før briefen er ferdig

Slaids sjekker planen mot dekket og melder fra om:

- en bildeoppføring som peker på en sone som ikke finnes lenger, eller ikke er en bildesone;
- en bildesone som venter på en fil uten at noen oppføring beskriver den;
- et motiv som beskriver et annet format enn sonen faktisk har — enten i ord («panorama», «stående») eller som et forholdstall skrevet inn i teksten;
- to oppføringer som i praksis beskriver samme motiv;
- planlagte bilder uten felles bildekontekst;
- en felles bildekontekst som gjentar motivet til ett enkelt bilde.

En tom liste er sluttpunktet for bildearbeidet. Det er ingen åpen forbedringssløyfe etter det.

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
- å skrive en bred, liggende bildeprompt til en nær kvadratisk eller stående sone;
- å oppgi aspect ratio i fritekst i stedet for å la sonen bestemme den;
- å skrive den samlede bildebriefen for hånd i stedet for å la den genereres fra bildeplanen;
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

Når kontrollpunktene er besvart og det du fant er rettet, er presentasjonen ferdig. Det er ingen åpen forbedringssløyfe etter det.

Den viktigste testen er fortsatt:

> **Hvis jeg bare så geometrien og innholdstypene, ville hierarkiet og relasjonene fortsatt ligne på det innholdet prøver å si?**

Legg nå til en andre test:

> **Hvis jeg fjernet alle forklaringer om designprosessen og alt dekorativt tekstgrep, ville sliden blitt faglig svakere? Hvis nei, skulle de elementene aldri vært der.**
