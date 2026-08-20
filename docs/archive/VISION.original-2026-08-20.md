# Introduksjon

Vi skal nå lage en app for å lage, lagre og vise PowerPoint-lignende presentasjoner i nettleseren – Slydes.

Appen skal kun være tilpasset desktop – redigering på mobil er ikke aktuelt, så det skal ikke brukes noe tid overhodet på tilpasning til mobilskjerm. Men den må fungere godt også på laptop-skjerm, ikke bare på store monitorer.

Appen skal ha toolbars øverst og nederst med knapper for vanlige funksjoner. Noen av knappene kan åpne popovermenyer.

Målet er ikke å gjenskape PowerPoint i nettleser, men å lage et verktøy skreddersydd for mine personlige behov. Det er ikke et mål å ha haugevis av funksjoner; i stedet ønsker jeg å optimalisere systemet så jeg enklest mulig kan lage presentasjoner som alle har min personlige visuelle identitet. Jeg trenger derfor ikke uendelig med tilpasningsmuligheter, men et robust og brukervennlig system som lar meg jobbe slik jeg ønsker.

Kort oppsummert er appens hovedstyrke evnen til å inndele slides i rigide, matematisk definerte soner – i bunn og grunn et grid layout – der sonenes relative proporsjoner defineres av forholdstall, og alt innhold tvinges til å holde seg innenfor sin sone. Sonene kan igjen inndeles i subsoner og sub-subsoner. Målet er at slides skal bli så ryddige og geometrisk perfekte som mulig. Alle avstander og størrelser skal være jevne innad i en slide og på tvers av slides. Og her er et svært viktig poeng: det skal være samme gap mellom alt faktisk innhold. "Innhold" betyr i første instans beholdere og kort for tekst og figurer. Hvis man har delt inn en sone i to subsoner; en av subsonene igjen er delt inn i to sub-subsoner; og hver subsone/sub-subsone inneholder et kort med innhold – så skal alle kortene ha likt gap mellom seg, over, under og på sidene. Sonene skal altså i seg selv ikke introdusere ekstra gap som kan dobles opp hvis man har mange nestede soner – det er bare det faktiske innholdet som skal ha gap mellom seg. Vi må derfor lage et intelligent system som aldri tillater dupliserte gaps/margins/padding. Nestede CSS grid layouts er allerede velegnet til dette, men må oppdateres dynamisk hvis vi skal oppnå målet om samme gap uansett hva. Det vi skal lage, er altså et UI der man kan redigere layoutet intuitivt og friksjonsfritt – for så å fylle sonene med innhold.

Jeg skal kunne opprette, redigere, lagre og vise presentasjoner. Alle presentasjoner skal ha 16:9-format. I første omgang er målet ikke å eksportere presentasjonene til PowerPoint-format, men å vise dem direkte i nettleseren slik at jeg blir fullstendig uavhengig av ekstern programvare annet enn en nettleser.

Appen skal ha et visuelt behagelig, intuitiv og logisk UI, men vi trenger ikke å bry oss om tilgjengelighetshensyn siden det bare er jeg personlig som skal bruke appen. UI skal altså være tilpasset meg, og ikke personer med nedsatt syn eller funksjon. Jeg liker bruk av knapper/ikoner med bakgrunnsfarger fyllfarger der det passer seg, siden dette gir sterkere visuelle cues enn bare svarte streker.

Jeg har ikke flere tilgjengelige databaser i gratisversjonen av Supabase, så vi må tyvlåne databasen til som brukes av appen Huskis, slik vi også har gjort i appen mdeditz. Men før vi går i gang med Supabase, ønsker jeg å lage selve editoren ferdig; til det formålet kan vi lagre presentasjonen i en JSON-fil i localStorage i første omgang.

# Viktige prinsipper

- Jeg ønsker ikke, slik PowerPoint tilbyr, muligheten til å tilpasse, flytte og justere innhold på alle tenkelige måter.
- I stedet ønsker jeg at appens styrke skal være evnen til å tvinge innhold til forbli innenfor definerte rammer for å gjøre alt pent og ryddig, med jevne, standardiserte størrelser og avstander overalt.
- Jeg ønsker at appen skal gjøre det enkelt for meg å lage slides med ulike soneinndelinger.
- Innhold skal aldri havne utenfor sin sone, og definitivt ikke utenfor viewporten.
- Intet innhold skal kunne eksistere utenfor en sone eller mellom soner.
- To soner har absolutte størrelser: spesialsonen for overskrift, og hovedsonen. Hovedsonens størrelse avgjøres likevel av hvorvidt sliden har en overskriftssone eller ikke. Alle andre soner har kun relative størrelser i forhold til sine supersoner, og som igjen til syvende og sist er relative til hovedsonen.
- Det skal være to modi:
  1. Innholdsredigering – der man redigerer tekst, figurer osv.
  2. Soneredigering – der man redigerer sonene innholdet rammes inn av
- Økten må lagres fortløpende.
- Når appen kodes, prøver vi å hardkode så lite som mulig, men gjenbruke så mye kode som mulig. Appen skal lages modulær, skalerbar og fleksibel. Den må være klar for å implementere nye funksjoner i fremtiden.

# Når man oppretter en presentasjon

Når man lager en ny presentasjon, skal man velge følgende ved start:

1. Tittel på presentasjonen
2. Bakgrunnsfarge; standard er #678.
3. Fontene som skal brukes – én for titler/overskrifter og én for brødtekst – fra en liste over vanlige Windows og Google fonts. Man kan bruke samme font for alt hvis man vil.

Bakgrunnsfarge og fonter skal gjelde globalt i presentasjonen. Man skal ikke kunne endre bakgrunnsfarge eller fonter på enkeltslides. Fordelen med dette er at presentasjonen tvinges til å ha et konsistent uttrykk, uten mulighet for at slides kan ende opp med ulike fonter ved et uhell.

# Soner og bokser

Hver slide skal kunne deles opp i soner. Sonene skal i bunn og grunn være et grid layout som kan tilpasses på mange ulike måter. Sonene rammer inn det øvrige innholdet. For eksempel vil jeg kunne lage et layout med to rader, der øverste rad har to soner hvor den første tar opp 1/3 av bredden og den andre 2/3 av bredden, og nederste rad har tre like brede soner.

## Overskrift eller ikke

Når man lager en ny slide, må man aller først bestemme om den skal ha en overskrift eller ikke. Hvis man velger overskrift, opprettes det automatisk to soner: én som tar opp hele bredden til sliden og nøyaktig så mye vertikal plass som overskriften trenger, og én som tar opp resten av vinduet under overskriften. Man skal kunne slette overskriften igjen senere hvis man angrer seg; sonen som opprinnelig var under overskriften, må da strekkes for å dekke hele vinduet, og eventuelle sub-soner må tilpasse seg i høyde for å fortsette å passe inn.

## Hovedsonen

Alle slides starter med én stor hovedsone, som altså enten dekker hele vinduet, eller hele området under overskriften.

Hovedsonen kan deretter splittes i subsoner, som igjen kan splittes i nye subsoner osv.

## Hierarki innad i slides

I hver slide skal følgende hierarki gjelde. Mer detaljer kommer etter hvert.

- Spesialsonen for slidens overskrift (mer om dette senere)
  - Ingen subinndelinger
- Hovedsonen
  - Subsoner
    - Beholdere/kort
      - Innholdsfelt
        - Tekst/figurer
        - Subfelt
          - Tekst/figurer
    - Sub-subsoner
      - Beholdere/kort
        - Innholdsfelt
          - Tekst/figurer
          - Subfelt
            - Tekst/figurer
- Vi kan gjerne åpne for at det også går an å ha sub-sub-subsoner osv., men på ett eller annet tidspunkt vil de bli så små at det ikke er plass til noen form for innhold – og da må appen ikke lenger tillate ytterligere subinndelinger. Foreslå gjerne hvordan vi løser dette problemet.

## Soneredigering

Til vanlig skal klikking på en slide brukes til å plassere tekstmarkøren som brukes når man redigerer tekst. Ved å trykke på en knapp i toolbaren eller en tilhørende tastatursnarvei, går man over til soneredigeringsmodus. Da vises sonene/grid layoutet som stiplede firkanter. Når man hoverer en gitt sone, får innholdet i sonen et delvis gjennomsiktig slør over seg, som også har litt backdrop blur for å ta oppmerksomheten vekk fra selve innholdet. "Innholdet" omfatter også subsoner og deres stiplede linjer, så det er viktig at vi har et system der man både nå en liten subsone nederst i hierarkiet, men også alle soner i nivåene over. Hvis sA inneholder ssB1 og ssB2, og ssB1 inneholder sssC1 og sssC2, skal man både kunne nå A, B1, B2, C1 og C2.

### Navigering mellom soner og nivåer

Her er mine forslag for hvordan man når de ulike sonene.

1. Ved å hovere gap-området mellom to subsoner; appen må finne ut hvilken supersone som ligger bak gapet, og velge den. Jeg er usikker på hvordan dette kan komme til å fungere – bare et forslag.
2. Ved å klikke på en gitt sone for å markere den, og deretter bruke piltastene:
   1. Piltast opp velger supersonen som ligger ett hakk opp i hierarkiet for den som er markert.
   2. Piltast ned velger den første subsonen (hvis den finnes) ett hakk ned i hierarkiet.
   3. Piltast venstre velger den "forrige" (over eller til venstre) sonen som ligger på samme nivå i hierarkiet
   4. Piltast høyre velger den "neste" (under eller til høyre) sonen på samme nivå i hierarkiet.

Hvis man bruker piltast opp/ned skal det ikke skje noe mer når man har kommet til øverste eller nederste nivå. Hvis man bruker piltast venstre/høyre, skal man starte rotasjonen på nytt når man kommer til siste søsken; f.eks., hvis det er tre søsken, og trykker høyre gjentatte ganger, går man 1 → 2 → 3 → 1 → osv.

### Når man har valgt riktig sone

Som nevnt skal det vises et slør over valgt sone. Hvis valgt sone inneholder subsoner, skal også subsonene tilsløres og blurres. Foran sløret vises et sett med knapper (funksjonene vil bli beskrevet i detalj senere):

1. Velg innholdstype – åpner en popover som brukeren velge mellom ulike innholdstyper
2. Flytt innhold til sandkassen
3. Splitt sone – åpner en popover for å dele opp sonen i subsoner
4. Tøm sone – fjerner alt innhold og alle subsoner slik at bare en tom sone står igjen
5. Slett sone – sletter sonen; dette fjerner hele cellen fra grid layoutet, og de øvrige sonene på samme nivå i hierarkiet må strekkes ut for å fylle opp "hullet".

Knappene har ikoner som illustrerer hva de gjør, og det vises en forklarende tooltip over dem når man hoverer med musen.

### Splitt sone

Knappen åpner en modal. I modalen vises valgt sone i full størrelse og med riktige proporsjoner. Over visningen er et panel med inputs brukeren må bruke:

1. En orienteringstoggle der brukeren må velge mellom
   1. horisontal splitting (standardvalg hvis valgt sone er bredere enn den er høy) – deler sonen opp i horisontalt orienterte subsoner
   2. vertikal splitting (standard hvis høyere enn bred) – deler opp i vertikalt orienterte subsoner
2. En slider-input med min 1, maks 10 og step 1; denne bestemmer hvor mange subsoner som skal opprettes.
3. Et sett med numeriske inputs for forholdstall – endres dynamisk etter hvor mange subsoner jeg valgte i forrige steg.
   1. Som standard har alle forholdstall 1.
   2. \[1, 2\] betyr at den andre er dobbelt så bred/høy som den første
   3. \[2, 3\] betyr at den andre er 3/2 av den første osv.
   4. Man kan også bruke desimaltall, slik at \[1, 2\] kan erstattes av \[0.5, 1\] og \[2, 3\] av \[1, 1.5\] hvis jeg vil.

Hvis man ønsker å splitte en sone inn i både horisontale og vertikale komponenter, gjør man dette stegvis ved å først splitte opp i den ene retningen, og deretter splitte opp de resulterende subsonene i den andre retningen.

### Maler

Mens vi først er inne på sonesplitting, ønsker jeg å introdusere maler (templater). Brukeren skal kunne lagre layoutet til gjeldende slide til en mal, som senere kan gjenbrukes i alle nye presentasjoner. Maler skal også kunne slettes. Man skal også kunne redigere maler; dette åpner en modal som minner om vanlig soneredigeringsmodus, men der man kun har mulighet til å redigere soner, ikke innhold. Maler skal aldri ha innhold – kun soneinndelinger. Maler lagres separat fra presentasjonen man aktuel er i, og eksisterer alltid på tvers av økter og presentasjoner.

# Innhold

Soner kan ha tre typer innhold i seg:

1. Beholdere
   - Usynlige, dvs. ingen bakgrunnsfarge, boks-skygge e.l. – innhold vises direkte over slidens bakgrunn.
   - Kan inneholde tekst og figurer.
   - Ingen padding – tekst og figurer kan gå helt ut til kanten av beholderen; men har selvfølgelig gap mot tilsluttende innhold fra andre soner.
   - Hvit tekst med tekstskygge brukes hvis bakgrunnen er mørk; svart tekst uten skygge brukes hvis bakgrunnen er lys. Beregnes automatisk basert på hva som gir best kontrast.
2. Kort
   - Har avrundede hjørner og boks-skygge, og bakgrunnsfarge(r).
   - Det skal finnes to typer:
     1. Kort med tittel og innhold
        - Farget panel øverst der tittelen står
          - Bakgrunnsfargen skal velges via en fargevelger (beskrevet senere).
          - Skriftfargen (og hvorvidt man har tekstskygge) bestemmes automatisk (som tidligere beskrevet) avhengig av hva som gir best kontrast mot valgt bakgrunnsfarge.
          - Tittelens lengde begrenses av hvor bredt kortet er (som igjen defineres av hvor bred sonen er). Tittelen skal aldri kunne gå utenfor tittelpanelet.
        - Innholdsfeltet
          - Har litt padding, men ikke like stor som gap-størrelsen som brukes mellom innhold i sonene.
          - Har alltid hvit bakgrunn.
          - Brødtekst er alltid svart.
          - Man kan velge farge på overskriftenes bakgrunn (mer om dette senere).
          - Man kan sette inn bilder og figurerer.
          - Man kan splitte feltet i subfelt. Samme system som brukes for å splitte soner, men en forskjell er at subfeltene skal skilles med skillelinjer (none få px tykke, lysegrå og med avrundede ender). Skillelinjene skal ikke gå helt ut til kantene, men holdes innenfor feltets padding. Skillelinjene kan være horisontale eller vertikale, avhengig av hvordan subfeltene er orientert.
     2. Kort uten tittel
        1. Har ikke tittelpanel, kun et innholdsfelt.
        2. Kortets bakgrunnsfarge kan justeres via fargevelgeren – ikke bare hvit slik innholdsfeltet til kort med tittel er. Hvit er standardfarge.
        3. Tekstfarge og -skygge velges som ellers basert på hva som gir best kontrast mot valgt bakgrunnsfarge.

Beholdere og kort (kun innholdsfelt, ikke tittel) skal kunne ha ulike typer innhold i seg:

- Tekst
- Referanser (tekstbasert, men strukturert; mer senere)
- Tabeller
- Bilder (vanlige raster-formater)
- Vektorgrafikk (.svg)

Bilder og vektorfiler skal kunne settes inn via en felles bildeknapp, som åpner en opplastningsmodal. I modalen kan man enten åpne filutforsker for å finne filen, eller trekke filen direkte fra desktop og inn i et opplastningsfelt. Appen skal automatisk identifisere om det er snakk om et bilde (raster-formater) eller vektorgrafikk (.svg). Vektorgrafikk skal ikke rasteriseres, men vises som vektorgrafikk.

# Tekstredigering, formatering og tabeller

Når (og bare når) man er i innholdsfeltet til et kort eller en beholder, skal det vises en egen toolbar for tekstredigering. Fordi man ikke kan formatere teksten til titler, skal toolbaren ikke vises når man redigerer titteltekst. Du kan låne mye redigeringsfunksjonalitet fra appen mdeditz.

## Brødtekst

Brødteksten i innholdsfelt kan gjøres fet, kursiv og understreket. Hvis font-familien som brukes har ulike font weights, italics osv. tilgjengelig, skal disse brukes fremfor en generisk mekanisme for å justere glyfenes utseende.

Tekst i slide-tittel eller kort-tittel skal ikke kunne formateres; der kan kun selve tekstinnholdet redigeres.

## Overskrifter

Innholdsfelt skal kunne ha overskrifter i seg. Vi skal ikke ha ulike nivåer av overskrifter som i mdeditz (ikke H1, H2 osv.) – kun én form for overskrift.

Overskriftene skal ha pilledesign, dvs. de skal ha bakgrunnsfarge og runde ender på sidene. Bakgrunnsfargen kan velges manuelt via fargevelgeren; tekstfargen settes automatisk til svart eller hvit (med tekstskygge) avhengig av bakgrunnsfargen som er valgt.

## Sitater

Sitater skal ikke formeteres som i mdeditz, men "innrammet" i et felt med en stor, grå “ i øvre, venstre hjørne og en tilsvarende ” i nedre, høyre hjørne.

## Punktlister og nummererte lister

Her kan du låne redigeringssystemet fra mdeditz.

## Tabeller

Her kan du låne tabellredigeringssystemet fra mdeditz.

## Kode

Her kan du låne kodeformateringen til mdeditz.

# Fargevelger

Brukeren skal kunne velge farger rundt omkring i appen fra en 12 × 4-grid som vises ved å trykke på en knapp i nær relasjon til objektet hvis farge skal redigeres.

- Hue-dimensjonen er inndelt in 12 diskrete steg med like avstander
- Luminosity-delen er inndelt i 4 diskrete steg: 20 %, 40 %, 60 % og 80 %
- Saturation er 25 % for alle farger, og kan ikke justeres.

I tillegg skal svart og hvit alltid kunne velges, og har sin egen rad nederst.

# Referanser

Brukeren skal kunne sette inn referanser hvor som helst teksten som redigeres – inkludert i titlene til slides og kort. For å legge til en referanse brukes en egen knapp i toolbaren (ikke i tekstformateringstoolbaren, men i hovedtoolbaren, siden dette strengt tatt ikke er en tekstredigeringsfunksjon men en type innhold).

Knappen åpner en referansemodal der presentasjonens eksisterende referanser listes opp alfabetisk.

En knapp i modalen legger til en ny referanse. Hver referanse har følgende komponenter, som alle får sin egen input ved oppretting:

1. Tittel
2. Forfatter(e)
3. Hyperkobling
4. År

Minst ett av punktene 1.–3. må være utfylt for at kilden skal være gyldig; et år alene er ikke nok.

Når man setter inn en referanse, setter appen egentlig inn en referanse-ID i teksten. Appen går dermed gjennom alle referanser som er brukt i slidsene, og indekserer dem etter rekkefølge. Den tidligst nevnte referansen blir 1, den neste 2 osv. Hvis en referanse gjenbrukes flere steder, bevares tallet på tvers av slides. Men hvis rekkefølgen endrer seg ved at nye referanser legges til, fjernes eller byttes om på, skal appen umiddelbart reindeksere referansene og gi nye tall slik at rekkefølgesystemet stemmer igjen.

Bare selve tallet skal faktisk vises i tekstinnholdet; referanse-ID-en brukes bare i appens bakgrunnsprosesser. Tallet skal være omsluttet av en grå sirkel, og hele tallet skal være superscript relativt til resten av teksten. Hvis man har flere tilsluttende kilder på samme sted, skal de slås sammen og vises i en pille i stedet for en sirkel. Her er et eksempel på hvordan jeg ønsker at sammenslåingen skal skje: \`1`2`3`5`6`8`9\``10` blir `1–3, 5, 6, 8–10`; ekstrapoler reglene fra eksempelet.

Hvis man fjerner alle eksemplarer av en referanse i slidsene, skal referansen ikke slettes fra referanselisten i modalen. I stedet skal den havne i en egen liste for ubrukte referanser. Formålet med de ubrukte referansene er at man kan velge å bruke dem igjen hvis man ønsker. Man skal kunne slette de ubrukte referansene enkeltvis via en ×-knapp som hver av dem har, eller slette alle på én gang via en søppelkasseknapp øverst i ubrukt-listen.

Man skal også kunne slette levende referanser via ×-knapper; dette må bekreftes før det trer i kraft. Sletting av levende referanser fjerner alle eksemplarer i slidene.

Hvis det finnes minst én referanse i presentasjonen, skal det opprettes en egen spesialslide helt på slutten av presentasjonen. Denne kan ikke slettes så lenge det fortsatt finnes minst én referanse. På referansesiden listes referansene opp i følgende format: "Tittel ⋅ Forfatter(e) ⋅ År ⋅ Lenke" (fjern komponentene som sto blankt i inputen i modalen, slik at man f.eks. får "Tittel ⋅ År". Lenker skal faktisk være klikkbare og åpnes i en ny fane.

Hvis det er for mange referanser til å vise i én kolonne, lages så mange kolonner som trengs. Hvis det er så mange referanser at alle kolonner er fylt opp, og det ikke er plass til flere kolonner, må skriftstørrelsen på referansene reduseres til det er plass til alle.

# Idéer

Lån idé-vinduet fra mdeditz. Vi skal ha nøyaktig samme i Slaids.

# Sandkassen

Sandkassen skal være et lignende vindu som Idéer i den forstand at det skal kunne flyttes rundt, resizes osv.), og at den er spesifikk for hvert prosjekt (hver presentasjon). Den er imidlertid felles for alle slides i presentasjonen. Formålet til sandkassen er at man midlertidig kan flytte innholdet ut av en sone og over til sandkassen. Som tidligere beskrevet skal "Flytt til sandkassen" være en knapp som vises over sonen i soneredigeringsmodus. Knappen skal være disabled hvis det ikke er noe innhold å flytte. Fra sandkassen kan man senere flytte det tilbake til en ny sone via DnD. Hvis man forsøker å sletter en sone som har innhold i seg, skal man alltid få tre valg:

1. Avbryt
2. Flytt innhold til sandkassen
3. Slett innhold

Hvis man flytter innholdet til sandkassen, forsvinner det altså ikke, men er tilgjengelig for relokalisering. Innhold i sandkassen har et håndtak på seg som man tar tak i, for så å trekke og slippe innholdet på en ledig sone. Dette skal fungere både i soneredigeringsmodus og innholdsredigeringsmodus. Mens DnD pågår, skal innholdet forminskes (via zoom e.l.) til en fast størrelse som er likt for alt innhold, og liten nok til at det er enkelt å se hvor man slipper.

VIKTIG: det må være plass til innholdet i den nye sonen. Mens DnD pågår, skal alle soner som faktisk kan romme det nye innholdet, markeres så man vet hvilke muligheter man har. Når man hoverer en tilgjengelig sone med kapasitet, skal sonen markeres på en måte som gjør det tydelig at det er her innholdet vil lande hvis man slipper.

Man skal også kunne redigere innholdet mens det ligger i sandkassen, på samme måte som man redigerer det andre steder. Man skal derfor også kunne klippe og lime deler av innholdet vekk og lime det inn i innholdet i en slide.

# Spesialtilfelle: splitting av sone som allerede har innhold i seg

Hvis man splitter en sone med innhold, må man velge hvilken av de nye sonene innholdet skal flyttes til. Men det må være plass til det innholdet i den nye sonen. Hvis det IKKE er plass, flyttes innholdet til sandkassen i stedet, og jeg får beskjed om at det har skjedd.

# Kopiering, klipping og liming

Vi må sørge for at vi har et robust system for klipping og liming. Det er vanskelig å se for seg hvordan man kan klippe ut innhold fra mange soner samtidig, og deretter lime det inn i et område eller en annen slide med et annet layout. Jeg tenker at dette derfor ikke bør være mulig. Men det bør være mulig å klippe ut innholdet til én sone og lime det inn i en annen, så lenge den nye sonen faktisk har plass til innholdet (samme logikk som for sandkassen).

Jeg ber deg også om å finne et lurt system for hvordan man kan lime inn eksternt innhold. Jeg ønsker ikke at det skal være mulig å lime inn html fra nettsider, f.eks. Alt innlimt innhold må tvinges til å passe inn i det formatet appen aksepterer. Kom gjerne med forslag!

# Arbeidsflyt – oppsummert

1. Logg inn (appen er kun for meg personlig, så det holder med et passord og ingen brukernavn)
2. Opprett en ny presentasjon, eller åpne en tidligere presentasjon fra appens interne mappesystem
3. Velg tittel, bakgrunnsfarge, fonter og skyggeeffekter
4. Opprett en slide
5. Velg om sliden skal ha overskrift eller ikke
6. Splitt hovedsonen i subsoner hvis ønskelig
7. Rediger subsonenes dimensjoner og organisering
8. Velg hva slags innhold som skal være i hver subsone:
   1. Blank (ingenting); sonen påvirker andre soners dimensjoner og plassering, men har ikke selv innhold
   2. Fritt innhold (tekst eller figurer) i usynlig beholder – vises direkte over slidens bakgrunn
   3. Kort uten tittel
   4. Kort med tittel – tittelteksten redigeres for seg, og annet innhold for seg
9. Innholdsfeltene i beholderne/kortene skal igjen kunne inndeles i subfelt, som i praksis vises som bolker adskilt med skillelinjer.
10. Korttitler skal ikke kunne formateres; deres tekststørrelse og farge settes automatisk av appen.
11. Tekst i innholdsdelene skal kunne formateres:
    1. Brødtekst – vanlig svart tekst. Kan gjøres fet, kursiv og understreket, osv.
    2. Overskrift (kun ett nivå, pilledesign som tidligere beskrevet)
    3. Sitat
    4. Punktlister og nummererte lister
12. I tillegg skal man kunne sette inn:
    1. Bilder (vanlige bildeformater) og vektorgrafikk (.svg) via en opplastningsmodal der man kan åpne filutforsker eller trekke filen inn i et opplastningsfelt.
    2. Referanser – vises som små tall med grå sirkel rundt, superscript, fortløpende i brødteksten. Legges til via en egen referanseknapp/hurtigtast som åpner en kildemodal (beskrevet tidligere). De faktiske referansene skrives ut i en egen sone eller en egen referanseslide.

# Eksempel på ferdig slide

- Jeg skriver x rem for å beskrive den faste avstanden som brukes globalt i appen.
- Øverst er slide-tittelen i en egen spesialsone øverst. Sonen tar opp hele slidens bredde, men har x rem luft over, under, til venstre og til høyre slik at teksten aldri skvises inntil viewportens ytterkanter. Titler skal alltid ha samme skriftstørrelse, og det er bare plass til en viss mengde tekst. Man får ikke lov til å skrive lengre titler enn tittelsonen tillater.
- Hovedsonen er delt inn på følgende måte:
  - Vertikalt splittet i to subsoner i 2:3-forhold; den høyre sonen har altså 3/2 av bredden til den venstre (den er 50 % bredere), og de to subsonene tar til sammen opp hele hovedsonens bredde.
  - Den vertikale avstanden fra tittelsonen til toppen av de to subsonene, er x rem. Hovedsonen legger altså ikke til en egen margin/padding som dobler avstanden mellom tittelsonen og subsonene.
  - Den horisontale avstanden mellom venstre og høyre subsone er x rem.
  - Høyre subsone er igjen splittet horisontalt i to sub-subsoner i 1:2-forhold; den øverste sonen er altså halvparten så høy som den nederste.
  - Den vertikale avstanden mellom de to sub-subsonene er x rem, og den horisontale avstanden mellom de to sub-subsonene og den venstre subsonen i nivået over er også x rem. Den høyre subsonen har altså ikke et ekstra lag med luft inni seg som dobler avstanden sub-subsonene i praksis har til den venstre subsonen.
  - Den venstre subsonen inneholder et kort med tittel. Innholdsfeltet til kortet inneholder følgende:
    - To vertikalt orienterte subfelt med hver sin overskrift og brødtekst (horisontal skillelinje med samme farge som tittelfeltet opprettes automatisk mellom subfeltene).
  - Den øverste sub-subsonen i høyre subsone inneholder en SVG-figur i en usynlig beholder.
  - Den nederste sub-subsonen inneholder et kort uten tittel, hvor det står en beskrivelse av figuren.
- Det er altså x rem avstand mellom alt det synlige innholdet. Ingen steder i sliden er det 2x rem eller noe annet enn x rem avstand.

# CLAUDE.md og andre instrukser

CLAUDE.md og andre instruksdokumenter må skrives i henhold til de offisielle anbefalingene (https://code.claude.com/docs/en/best-practices).

# Et siste, men ganske stort ønske

Jeg ønsker at appen skal ha et API-system som kodeagenter (Claude Code, ChatGPT, Codex osv.) kan kommunisere med, slik at agentene autonomt kan opprette ferdige presentasjoner med systemet vårt. Agenten får da frie tøyler til å bruke verktøyene kreativt, dele inn i soner, velge innholdstyper osv. Det bør derfor finnes ganske klare instrukser for hvordan agentene skal gjøre dette. Vi må også sørge for at agentene kan "logge inn" i appen så de faktisk får tilgang til API-et.
