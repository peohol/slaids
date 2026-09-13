# Agentstyrt presentasjonsdesign

Denne guiden beskriver **hvordan en agent bør tenke når den komponerer slides i Slaids**. Den er ikke en katalog med ferdige maler. Domeneregler, datamodell og tekniske invariants ligger fortsatt i `IMPLEMENTATION_PLAN.md` og koden.

Utgangspunktet er et enkelt prinsipp:

> **Innholdets logiske struktur skal bestemme sonetreet. Agenten skal aldri velge et vilkårlig layout først og deretter presse innholdet inn i det.**

Et layoutmønster er derfor en hypotese om hvordan et bestemt informasjonsforhold kan uttrykkes visuelt — ikke en template som skal fylles.

## 1. Fra mening til geometri

Før agenten oppretter eller deler en sone, skal den svare på hva sliden faktisk skal gjøre for publikum.

Typiske logiske forhold er:

- **ett hovedpoeng med støtte** — én påstand, med forklaring, figur eller evidens;
- **sammenligning eller kontrast** — to eller flere likeverdige ting skal leses mot hverandre;
- **taksonomi eller katalog** — flere medlemmer av samme kategori skal kunne skannes som en familie;
- **sekvens eller prosess** — rekkefølgen er en del av meningen;
- **oversikt med detaljer** — én overordnet idé har flere underordnede deler;
- **argument med evidens** — konklusjonen og dokumentasjonen har ulik hierarkisk tyngde;
- **ett semantisk objekt med interne deler** — delene hører så tett sammen at de bør være subfelter i samme innholdsenhet;
- **fokus eller pause** — ett bilde, ett tall eller én kort formulering skal dominere sliden;
- **negativt rom** — tom flate brukes bevisst for å styre bredde, balanse, fokus eller vertikal plassering.

Først når dette er bestemt, velges trestruktur, akser og vekter.

## 2. Sonetreet skal speile informasjonsstrukturen

Slaids sitt rekursive split-tre er ikke bare en måte å få bokser på skjermen. Det skal uttrykke hierarki.

### Likeverdige ting → søsken

Elementer som skal sammenlignes direkte bør normalt være søsken i samme split, med like eller nesten like vekter og samme type visuell behandling.

Eksempler:

- to mekanismer side om side;
- tre parallelle prosesser i tre kolonner;
- fire definisjoner i et 2×2-rutenett;
- en produktfamilie i et regelmessig grid.

Hvis to elementer er faglig likeverdige, men får svært ulik størrelse uten en god grunn, kommuniserer layouten et hierarki som innholdet ikke har.

### Hierarki → asymmetri

Når én del er viktigere enn en annen, bør størrelsen vise det. En stor figur med en smal forklaring, eller en stor oppsummering med mindre evidenspaneler, er ofte bedre enn 1:1 bare fordi to elementer finnes.

Vektene skal altså svare på **hva som skal dominere**, ikke på hvor mange elementer agenten tilfeldigvis har.

### Underordnede grupper → nested splits

Nested splits er nyttige når én del av sliden har en annen intern struktur enn resten.

Eksempel:

- venstre side: to mindre kort stablet;
- midten: ett høyt hovedkort;
- høyre side: én stor illustrasjon.

Dette er en god komposisjon når innholdet faktisk har tre forskjellige roller. Nested splits uten en semantisk grunn gjør bare layouten vanskeligere å lese og vedlikeholde.

## 3. Velg innholdstype etter semantisk rolle

### Titled card

Bruk når tittelen navngir en **kategori, aktør, fase eller sammenligningsenhet**.

Typiske bruksområder:

- «Alternativ A» / «Alternativ B»;
- reseptor A / reseptor B;
- akutt / kronisk;
- absorpsjon / distribusjon / metabolisme;
- medlemmer av en taksonomi.

Korttittelen skal hjelpe publikum å forstå hva slags enhet de ser på før de leser innholdet.

### Untitled card

Bruk når selve innholdet er **budskapet**, og en ekstra kategorietikett bare ville lagt til støy.

Typiske bruksområder:

- én konklusjon;
- et resonnement;
- en kort forklaring;
- et sentrert nøkkelutsagn;
- et lite sett med poenger som til sammen utgjør én påstand.

### Container

Bruk når flere tekstdeler hører sammen, men ikke trenger kortets visuelle ramme eller header. En container er særlig nyttig når sliden trenger intern struktur uten at hvert felt skal se ut som et selvstendig objekt.

### Image

Bruk når bildet er et **selvstendig visuelt felt**: figur, foto, diagram eller illustrasjon som ikke trenger en egen kategoriheader.

Et bilde skal ikke legges til bare for å fylle en tom sone. Hvis det ikke bærer informasjon, gir emosjonell støtte eller skaper en bevisst pause, er negativt rom ofte bedre.

### Titled image card

Bruk når bildet representerer **ett medlem av en navngitt kategori eller katalog**. Det er særlig egnet når flere visuelle objekter skal kunne skannes med samme struktur.

### Negativt rom

Negativt rom er et legitimt innholdsgrep, ikke «ubrukte rester» av layouten. Det kan brukes til å:

- begrense tekstbredden;
- sentrere et kort eller en figur uten absolutt posisjonering;
- skape visuell ro rundt et viktig poeng;
- forskyve tyngdepunktet i komposisjonen;
- lage en rytmisk pause mellom tette slides.

**Nåværende implementasjon:** negativt rom representeres foreløpig av et tomt blad og er underlagt dagens generelle minstemål. En eksplisitt innholdstype og innholdsspesifikke minstemål er planlagt i issue #60. Agenten skal ikke sende en ikke-eksisterende innholdstype før den er implementert.

## 4. Sone eller subfelt?

Dette skillet er viktig.

Bruk **egen sone** når delene:

- har selvstendig visuell rolle;
- skal sammenlignes på tvers av sliden;
- trenger ulik bakgrunn, bildebehandling eller størrelse;
- skal kunne flyttes eller vektes som egne kompositoriske enheter.

Bruk **subfelt i samme innholdsenhet** når delene:

- sammen utgjør ett semantisk objekt;
- deler samme korttittel eller visuelle ramme;
- bør oppfattes som intern struktur, ikke som separate paneler.

En god tommelfingerregel er: **sonetreet uttrykker makrokomposisjon; subfelter uttrykker intern struktur.**

## 5. Anbefalte komposisjonskonsepter

Dette er startpunkter, ikke maler.

### A. Hovedpoeng + visuell støtte

**Logikk:** én påstand er viktigst; bildet eller figuren støtter den.

**Tre:** to søsken, ofte asymmetriske.

**Typisk:** tekst 2:3 bilde, 3:5 eller 1:1 avhengig av hvor mye figuren skal dominere.

### B. Direkte sammenligning

**Logikk:** publikum skal se forskjellen mellom to likeverdige alternativer.

**Tre:** 1:1 langs x, samme innholdstype på begge sider.

Hvis ett alternativ trenger dobbelt så mye tekst, er løsningen oftest å redigere teksten eller revurdere om sammenligningen faktisk er likeverdig — ikke automatisk å gi det dobbel bredde.

### C. Taksonomi / katalog

**Logikk:** flere ting er medlemmer av samme familie.

**Tre:** regelmessig grid, for eksempel 3×2 eller 2×2.

**Innhold:** titled cards eller titled image cards med konsistent struktur.

Tom celle kan være bevisst hvis antallet objekter ikke fyller hele gridet; ikke legg inn fyllstoff bare for symmetri.

### D. Oversikt + detaljer

**Logikk:** én overordnet idé med flere bevis eller detaljpaneler.

**Tre:** stor hovedsone ved siden av en nested split med to eller flere mindre soner.

Dette er ofte bedre enn tre like kolonner fordi hierarkiet blir synlig.

### E. Én idé med intern todeling

**Logikk:** to delpoenger hører til samme konsept.

**Tre:** én sone.

**Innhold:** ett kort/container med to subfelter, ofte 1:1 internt.

Bruk dette fremfor to separate kort når publikum først og fremst skal huske helheten.

### F. Sentrert nøkkelpoeng med negativt rom

**Logikk:** én kort formulering skal få høy saliens.

**Tre:** for eksempel y-split med luft / innhold / luft, eller x-split med smale luftsoner på sidene.

Dette kan være mer effektivt enn å gjøre teksten større eller legge på dekorasjon.

### G. Teknisk oversikt i parallelle kolonner

**Logikk:** flere faser, komponenter eller dimensjoner må kunne skannes raskt.

**Tre:** 3–4 søsken langs x, eventuelt med subfelter internt.

Bruk bare når hver kolonne kan holdes kort. Hvis hver kolonne blir et miniessay, bør innholdet deles over flere slides.

### H. Argument + evidensstack

**Logikk:** én konklusjon ledsages av flere figurer, studier eller eksempler.

**Tre:** stor tekst-/konklusjonssone mot en nabosone som splittes vertikalt i flere evidensfelter.

### I. Full visuell flate / pause

**Logikk:** publikum skal se, ikke lese.

**Tre:** ett blad som fyller hovedområdet.

**Innhold:** bilde eller svært kort innhold. Dette kan brukes som emosjonell eller rytmisk pause mellom tette faglige slides.

## 6. Retning og leseflyt

Velg split-akse etter hvordan publikum naturlig skal lese relasjonen:

- **x-akse**: sammenligning, progresjon fra venstre mot høyre, tekst + bilde;
- **y-akse**: før/etter, overskrift/evidens, stablede figurer, vertikal prioritering;
- **nested x/y**: når en hovedgruppe trenger sin egen interne orden.

Ikke velg akse bare for å få teksten til å passe. Hvis bytte av retning endrer hvordan relasjonen forstås, er det en semantisk endring.

## 7. Vekter uttrykker prioritet

Vekter er ikke bare plassfordeling. De kommuniserer betydning.

- likeverdige elementer → like eller nesten like vekter;
- hovedpoeng → større andel;
- sekundær støtte → mindre andel;
- bilde som faktisk er beviset → bildet kan dominere;
- bilde som bare illustrerer → teksten kan dominere.

Agenten bør kunne forklare hver tydelig asymmetri med innholdets rolle.

## 8. Fit er en redaksjonell tilbakemelding

Når innhold ikke får plass, er dette normalt et signal om at enten teksten eller informasjonsarkitekturen er feil.

Anbefalt reparasjonsrekkefølge:

1. **Rediger teksten.** Fjern redundans, detaljer som kan sies muntlig og formuleringer som ikke er nødvendige for poenget.
2. **Sjekk grouping.** Burde noe være et subfelt, egen sone eller en ny slide?
3. **Juster hierarkiet.** Gi det viktigste mer areal og mindre viktige deler mindre.
4. **Endre treet** hvis den logiske strukturen var feil representert.
5. **Del sliden** hvis den faktisk rommer mer enn én tydelig kommunikativ oppgave.

Ikke løs overflow ved å gjøre skriften stadig mindre eller ved å bygge ekstremt smale/høye soner som gjør lesbarheten dårligere. Fit-regelen er en kvalitetsmekanisme, ikke en hindring som skal omgås.

## 9. Visuell konsistens uten layoutmonotoni

Et godt dekk bør være gjenkjennelig uten at alle slides har samme geometri.

Repeter:

- typografi;
- fargehierarki;
- hvordan like semantiske roller ser ut;
- korttype for samme type innhold;
- retning og orden i gjentatte sammenligninger.

Varier:

- sonegeometri når informasjonsforholdet endres;
- grad av asymmetri;
- mengde negativt rom;
- forholdet mellom tekst og bilde;
- antall parallelle enheter.

Konsistens betyr altså **samme visuelle grammatikk**, ikke samme slide-mal.

## 10. Anti-mønstre

Agenten bør aktivt unngå:

- å velge «to kolonner» før den har analysert innholdet;
- å dele hver paragraf i sin egen sone;
- å gi like store soner til elementer med tydelig ulik betydning;
- å bruke bilder som dekorativ fyllmasse;
- å legge inn tekst bare for å fylle en tom celle i et grid;
- å lage nested splits som ikke uttrykker et faktisk hierarki;
- å bruke ulike innholdstyper for semantisk parallelle enheter uten grunn;
- å redusere fontstørrelse som standardløsning på overflow;
- å beholde alt kildemateriale på sliden bare fordi det er faglig korrekt.

## 11. Arbeidsflyt for en agent

For hver slide:

1. Formuler **én kommunikativ oppgave** for sliden.
2. Identifiser elementene som trengs for å løse den.
3. Klassifiser relasjonene: peer, hierarki, sekvens, gruppe, evidens eller fokus.
4. Velg innholdstype for hvert semantisk objekt.
5. Bygg det enkleste sonetreet som uttrykker relasjonene korrekt.
6. Sett vekter etter prioritet, ikke etter tekstmengde alene.
7. Legg inn innholdet kortfattet.
8. Inspiser den faktiske geometrien og fit-resultatet.
9. Ved overflow: rediger først, komponer deretter på nytt hvis nødvendig.
10. Valider sliden og dekket før den anses ferdig.

For hele dekket:

- bruk seksjoner og visuell rytme til å markere større argumentasjonsdeler;
- varier komposisjon når innholdets logikk varierer;
- repeter visuelle regler når semantiske roller repeteres;
- la enkelte slides være luftige slik at tette slides får kontrast;
- vurder dekket som en sekvens, ikke som 30 isolerte plakater.

## 12. Den viktigste testen

Før agenten godtar en slide, bør den kunne svare på dette spørsmålet:

> **Hvis jeg bare så geometrien og innholdstypene, ville hierarkiet og relasjonene fortsatt ligne på det innholdet prøver å si?**

Hvis svaret er nei, er sonetreet sannsynligvis valgt for tidlig.