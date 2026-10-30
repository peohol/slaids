# UX-forenkling og visuelt designsystem i Slaids

**Opprettet:** 30.10.2026  
**Status:** U0, U1 og U2 er gjennomført (se § 10); U3–U7 venter.  
**Omfang:** Bibliotek, desktopeditor, kompakt editor, felles UI-komponenter og interaksjoner.  
**Normativ forankring:** IMPLEMENTATION_PLAN.md § 44.6, med § 44.5 som fortsatt gjeldende kontrakt for kompakt arbeidsflate.

## 1. Mål og definisjon av suksess

Slaids skal bli mer effektiv, forutsigbar, intuitiv, logisk, ryddig og enkel å bruke. Målet er **mindre kognitiv belastning og færre unødvendige valg**, ikke primært en ny estetikk. Fargede ikoner er ett virkemiddel, ikke et mål i seg selv.

En endring er vellykket når:
- Brukeren kan se **hva som er valgt**, **hvilke handlinger som gjelder valget** og **hva handlingene gjør** uten å tolke et felt av like, hvite strekikoner.
- Vanlige oppgaver er minst like raske som før; sjeldne oppgaver er lette å finne på faste steder.
- Samme handling har samme navn, ikon, tilstand, begrunnelse og virkning på tvers av verktøylinje, inspektør, kontekstmeny og kompakt arbeidsflate.
- Det er tydelig forskjell på *innholdsredigering*, *soneredigering*, *presentasjonsnivå* og *visning*.
- Brukeren får klar og relevant tilbakemelding på lagring, avvist handling, vellykket handling og delingsstatus.
- Tastatur, mus og berøring gir funksjonelt likeverdige veier til de samme kommandoene, selv om betjeningen kan se forskjellig ut.
- Presentasjonen ser nøyaktig lik ut før og etter en ren UI-endring.

**Ikke målet:** Å gjøre Slaids om til PowerPoint; innføre fri plassering; endre presentasjonsmodell; redesigne publiserte slides; modernisere hver flate samtidig; eller gjennomføre en rent kosmetisk redesign uten å adressere oppgaveflyt.

## 2. Undersøkte forhold og arbeidshypoteser

Kildekodegjennomgang 30.10.2026. Dette er **kodefunn**, ikke resultater fra observerte brukertester.

| ID | Observasjon | Relevante filer | Konsekvens / hypotese |
| --- | --- | --- | --- |
| F01 | Hovedverktøylinjen tilbyr mange ikonvalg med relativt lik visuell vekt. | src/ui/editor/TopToolbar.tsx; src/styles/editor.css | Hyppige og sjeldne handlinger konkurrerer om oppmerksomheten. |
| F02 | Alle ikoner er 24x24-strektegninger med stroke=currentColor. Seks innholdstyper har delvis svært like silhuetter. | src/ui/components/Icon.tsx; src/ui/editor/contentKinds.ts | Mange små, ensfargede knapper er vanskelige å skille. |
| F03 | Valgt innholdstype er ikke like tydelig markert overalt: inspektøren markerer typen; hovedverktøylinjen er en rad med nøytrale ikonknapper; kompakt verktøyliste markerer ikke valgt type. | src/ui/editor/Inspector.tsx; TopToolbar.tsx; compact/CompactToolsPanel.tsx | Svak eller motstridende tilbakemelding om aktivt valg. |
| F04 | Teksthandlinger har en can()-funksjon, men renderActionButtons bruker bare isActive(); knapper for vertikaljustering markeres ikke etter gjeldende verdi. | src/ui/editor/textActions.ts; TextToolbar.tsx | Mulig å tilby handlinger som ikke kan utføres, og vanskeligere å lese gjeldende justering. |
| F05 | Bibliotekkort viser fem ikonhandlinger, inkludert kopiering av presentasjons-ID; mappe- og slideoppføringer tilbyr mange direkte kontroller. | src/ui/library/LibraryView.tsx; src/ui/editor/Filmstrip.tsx | Sekundære handlinger konkurrerer med å åpne/navigere. |
| F06 | Inspektøren er smal (244 px), og både sone- og innholdsdetaljer listes med mange kontroller og forklaringer. | src/styles/global.css; src/styles/editor.css; src/ui/editor/Inspector.tsx | Svak visuell prioritering og mye permanent tekst. |
| F07 | Kompakt arbeidsflate har fire faner; fanen «Soner» endrer samtidig redigeringsmodus. | compact/CompactTabBar.tsx; shell/CompactEditorShell.tsx | Bør testes om faner oppfattes som navigasjon eller modusskifte. |
| F08 | Dagens kontrast-/statusfarger og aktive knapper finnes allerede, men ikke et enhetlig funksjonsfargespråk for ikoner. | src/styles/global.css; src/ui/components/Icon.tsx | Kan innføre et begrenset og semantisk fargesystem uten å endre slidepaletten. |
| F09 | E2E dekker mye redigeringslogikk, mobil og kontekstmenyer; visuell regresjon er valgfri og i stor grad slideorientert. | playwright.config.ts; e2e/visual.spec.ts; e2e/compact.spec.ts | Trenger eget regresjonsnett for appens chrome, responsive verktøylinjer og tilstander. |
| F10 | Noen arveetiketter viser «fra forsiden» der fargen faktisk følger gjeldende inndeling. | src/ui/editor/TextToolbar.tsx; src/ui/editor/Inspector.tsx | Små språklige inkonsekvenser kan svekke forståelsen av arveregler. |

**Valideringskrav:** Hypotesene over skal undersøkes i representative arbeidsflyter. Ikke anta at flere menyer alltid er bedre, eller at færre knapper automatisk gir færre klikk.

## 3. Ufravikelige rammer

- Behold Slaids' rekursive sonetre, logiske 1600 × 900-rom, matematisk like gap, eksisterende renderer, geometriberegning, fit-sjekker, domeneoperasjoner og lagrede presentasjonsdata.
- Ikke endre slide-/presentasjonstema eller publikumsvisning som utilsiktet følge av nye UI-farger. Appens chrome og selve presentasjonen må ha separate fargetoken og stilansvar.
- Ikke endre REST-/MCP-agent-API, verktøydefinisjoner, datamodell eller migrasjoner i et UX-løp. Hvis behov likevel oppstår, stopp og beskriv særskilt hvorfor det er nødvendig; det er ikke en implisitt tillatelse.
- Behold angre/gjør om, autosave, feilbegrunnelser, bekreftelse ved destruktive operasjoner, delingsstatus, tastatursnarveier og eksisterende kontekstmenyer.
- Behold mobilinvariantene i IMPLEMENTATION_PLAN.md § 44.5: én mountet editor, én dokumentmodell, ingen viktig handling avhengig av hover/drag, velg-først-modell, gestene og skjermtastaturhåndteringen.
- **Samme kommando – flere innganger:** Ikke lag nye lokale regler for om en handling er lov. Bruk allerede etablerte domene-/Tiptap-kilder og den samme kommandoen fra alle innganger.
- Behold eksisterende test-id-er der det er praktisk. Endres DOM-struktur, oppdater testene etter faktiske brukeroppgaver, ikke ved bare å slette gamle forventninger.
- Arbeid i avgrensede, vurderbare PR-er. Ikke kombiner redesign med urelatert opprydding.

## 4. Beslutninger om informasjonsarkitektur

### 4.1 Hvilket nivå eier en handling?

| Nivå | Typiske handlinger | Anbefalt plass |
| --- | --- | --- |
| Presentasjon | Gi nytt navn, tema, referanser, del, bildebrief, optimaliser alle bilder, vis | Hovedlinjens prioriterte kontroller + tydelig gruppert presentasjonsmeny |
| Slide | Ny slide/inndeling/miniapp, dupliser, flytt, slett | Slideoversikt og slidekontekstmeny |
| Valgt sone | Del, juster størrelse, kopier/flytt, fjern, endre innholdstype | Kontekstbasert inspektør / sonemeny |
| Valgt innhold | Bilde, kort, bildetekst, kortfarge, subfelt | Innholdsdelen av inspektør og innholdskontekstmeny |
| Aktivt tekstfelt | Formatering, avsnitt, lister, justering, lenke og tabell | Tekstverktøylinje og tekstkontekstmeny |
| Hjelpeverktøy | Idéer, sandkasse, hurtigtaster, spesialverktøy | En fast navngitt verktøygruppe; ikke tilfeldig fordelt |

Menyplassering må være konsekvent og skal ikke baseres på å gjemme så mye som mulig. Oppgaver som er svært hyppige, eller krever rask seriebruk, kan fortjene direkteknapper.

### 4.2 Hovedverktøylinjen på desktop

**Målstruktur** (skal utprøves, ikke kopieres ukritisk):
1. Tilbake + presentasjonens tittel; lagringsstatus må være synlig/tilgjengelig.
2. Tydelig segmentert valg «Innhold | Soner» når siden har soner.
3. Angre/gjør om.
4. Handling for valgt objekt: oppgi valgt sone og innholdstype; én navngitt inngang «Endre innholdstype» der det er relevant.
5. Tydelig gruppert inngang til presentasjonsverktøy (tema, referanser, maler, bildebrief, optimalisering m.m.).
6. Delingsstatus og «Vis» lett tilgjengelig som egne, entydige handlinger.

Ikke la de seks innholdstypeikonene og en egen bildeknapp forbli som konkurrerende, nesten like handlinger uten avklart forskjell. Skillet mellom «gjør valgt sone til bildetype» og «velg/last opp bildefil» skal være uttrykkelig og konsekvent.

Kontroller tilgjengelig plass også på smal desktop. Prioritert handling skal ikke skyves utenfor vinduet; sekundære valg kan flytte inn i grupper ved dokumentert behov.

### 4.3 Inspektør og valg av innholdstype

- Vis alltid hva som er valgt (sone, type, eventuelt nivå i hierarkiet). Tomt/avledet/ikke-redigerbart valg får en forståelig tomtilstand.
- **Endre innholdstype** viser tydelig gjeldende valg; identisk valgt-tilstand i hovedlinje, inspektør, kontekstmeny og kompakt liste.
- Først relevante og vanlige valg, så utvidbare avanserte innstillinger (f.eks. detaljerte forholdstall). Avanserte muligheter skal ikke forsvinne.
- Skill mellom «sone» (struktur) og «innholdet i sonen». Beskriv endringen før handlingen hvis den kan flytte, erstatte eller slette innhold.
- Behold synlig og tilgjengelig sonehierarki/breadcrumb og en vei til å velge dypt nestede soner uten presis peking.
- Bruk korte, konkrete forklaringer nær avviste valg; flytt lengre teknisk veiledning bak en relevant hjelpemulighet.

### 4.4 Bibliotek og filmstripe

- Hele presentasjonskortets primære handling er «Åpne».
- Samle sjeldne korthandlinger som «Kopier presentasjons-ID», eksport og sletting i en tilgjengelig «Flere handlinger»-meny; behold eventuelt en direktehandling for den hyppigste sekundæroppgaven etter testing.
- For mapper og miniatyrslides: vurder tilsvarende sekundærmenyer, men ikke fjern en fungerende diskret vei til flytting (spesielt mobil/tastatur). Den kan ligge i en meny dersom den er lett å oppdage og bruke.
- Gi «Ny slide» en tydelig standardplass; «Ny inndeling» og «Ny miniapp» kan ligge ved siden av i en navngitt «Ny»-meny. Bevar mulighet for innsetting mellom eksisterende slides.
- Menyer må fungere med mus, tastatur og berøring. Ingen kritisk operasjon bare ved hover eller høyreklikk.

### 4.5 Tekstverktøylinjen

- Vis bare det som gjelder det aktive tekstfeltet; bevar dagens tittelbegrensninger.
- Organiser formatering, justering og innsetting i lesbare grupper.
- Bruk TextAction.can() til å deaktivere kommandoer der resultatet ikke kan utføres, med forklaring der det finnes en begrunnelse.
- Marker gjeldende horisontal **og vertikal** justering semantisk; ikke bare som en annen ikonfarge.
- Ikke forveksle korttittel, slideoverskrift og «Aksent» inne i et kort.
- Rett arvebeskrivelser: farge «fra gjeldende inndeling» der det er den faktiske kilden.

## 5. Visuelt designsystem: farge, ikon, tilstand og hierarki

### 5.1 Fargeregler

Foreslå en avgrenset semantisk palett for **appgrensesnittet**. Farge skal ha stabil betydning, ikke tildeles tilfeldig per knapp. Start som designhypoteser:

| Funksjon | Mulig familie | Eksempler |
| --- | --- | --- |
| Tekst/innhold | turkisblå | tekst, kort, innholdstype |
| Soner/layout | fiolett | sonestruktur, deling av soner, størrelse |
| Bilder/medier | grønnblå | bilder, bildefiler, bildeverktøy |
| Visning/presentasjon | blå | presentasjon, visning, delingsinngang |
| Bekreftet/trygg status | grønn | lagret, kopiert, fullført |
| Advarsel/destruktivt | gul/rød | viktige varsler, slett |

**Før fargevalg fastsettes:** vurder faktisk kontrast mot mørke flater, distinksjon for fargesynsvariasjoner, hvor mye farge hele editoren tåler, og hvordan paletten opptrer ved høy ikon-tetthet. Grønne/røde statusfarger må ikke blandes sammen med kategorifarger.

Skill mellom:
- **Funksjonskategori:** stabil ikon- eller gruppefarge.
- **Aktivt valg:** tydelig valgt flate/ramme, eventuell avkryssing og aria-pressed/aria-checked. Ikke bruk bare farge.
- **Primærhandling:** kontrasterende, men få slike knapper.
- **Fare:** rød bare når handlingen faktisk er destruktiv eller tilstanden er feil.
- **Utilgjengelig:** dempet og deaktivert, med forklaring som også er tilgjengelig uten hover.
- **Fokus:** synlig tastaturfokus uavhengig av valgt tilstand.

### 5.2 Ikoner

- Behold/videreutvikle felles Icon-komponent, med sentral semantisk mapping; unngå spredte hardkodede farger i hver skjerm.
- Tegn om visuelt tvetydige innholdstypeikoner ved behov. Særlig «Kort», «Kort med tittel», «Bilde» og «Bildekort med tittel» må kunne identifiseres i vanlig UI-størrelse.
- Ikon med tekst der valget ikke er selvforklarende. Bruk bare ikonknapper når ikonets betydning er velkjent eller handlingen støttes av en pålitelig og tilgjengelig etikett.
- Ikke bruk flerfargede ikoner overalt; farge skal skape gjenkjennelse, ikke konfetti.
- Alle ikoner må fungere når brukeren benytter tastatur, skjermleser eller høy kontrast; dekorative SVG-er forblir aria-hidden.

### 5.3 Komponentkontrakt

Felles komponenter/handlingsmetadata bør så langt mulig gi samme:
- Navn, ikon, funksjonskategori og eventuelt hurtigtast.
- Tilgjengelighet og begrunnelse fra den reelle kommandoen.
- Aktiv/valgt tilstand fra faktisk editor-/domene-state.
- Eventuell bekreftelse og tilbakemelding etter utført handling.

Unngå å innføre én stor abstraksjon bare for å gjøre alt «generisk». Del metadata der det motvirker reell divergens, og la hver overflate beholde riktig layout og interaksjonsmønster.

## 6. Mobil og responsiv betjening

**Behold** firedelt panelstruktur i utgangspunktet, valgt-først-modellen, langtrykk for fokusert felt, sveip, pinch og én aktiv editor. Test om navigasjonen er forståelig før eventuell omstrukturering.

- Gjør det tydelig at «Soner» kan bytte redigeringsmodus; unngå at et fanebytte gir et uventet oppførselsbytte uten signal.
- Legg handlingene så nær det aktuelle objektet som mulig i kompakte paneler.
- Innholdstypevalg skal bruke samme metadata og aktiv tilstand som desktop.
- Vurder diskret hjelp til å oppdage langtrykk og redigering, men unngå permanente hjelpetekster som tar viktig plass.
- Verktøylinjer som scroller horisontalt skal gi et forståelig signal om at mer innhold finnes. Ingen viktig funksjon skal kreve skjult, presis horisontal scrolling.
- Treffflater dimensjoneres ut fra faktisk pointer-kapabilitet, ikke bare viewport. Kontroller CSS-kaskaden: generelle regler for touch-target og særregler for .btn--sm må ikke gi utilsiktede for små treffflater.
- Side-/panelvalg, zoom, tekstfokus, lagring og historikk skal overleve samme rotasjoner som før.

## 7. Arbeidspakker og rekkefølge

Hver arbeidspakke leveres som liten PR eller tydelig isolert endringssett. **Ikke start med en total redesign.**

### U0 — Baseline og beslutningsgrunnlag (først)

- [x] Kartlegg synlige innganger til handlinger og grupper dem etter nivå fra § 4.1.
- [x] Lag en kort oppgavematrise: ny presentasjon, ny slide, kort med tittel, sett inn bilde, rediger tekst, del/endre sone, endre størrelse, flytt/dupliser slide, angre/gjør om, del, vis, finn avansert valg.
- [x] Ta sammenlignbare skjermbilder av bibliotek, desktopeditor i innholds- og sonemodus, tekstfelt, kontekstmeny, smal desktop og kompakt mobil.
- [x] Kontroller minst viewport 1600x1000, 1366x768, 1180x820, 1025x768, 900x760, 412x892 og 892x412; test i tillegg berøring på større flate der praktisk mulig. *(Berøring på fysisk nettbrett er ikke testet; se UX_BASELINE.md.)*
- [x] Noter antall klikk/trykk og eventuelle vanskelige valg for oppgavene. Før måling skal dagens flyt være baseline, ikke bare den nye.
- [x] Beskriv foreslått informasjonsarkitektur i en kort beslutningslogg, med alternativer og hvorfor ett er valgt.
- [x] Identifiser forhold som krever produktbeslutning før endring. Bevar ellers eksisterende oppførsel.

**Aksept:** Baseline, oppgavematrise og informasjonsarkitektur finnes i repoet. De konkrete endringene som skal gjøres først er dokumentert.

**Resultat:** [UX_BASELINE.md](UX_BASELINE.md), skjermbilder i [ux/baseline/](ux/baseline/).

### U1 — Visuell grunnmur med /frontend-design

- [x] Bruk Claude Code-skillen /frontend-design for en designretning som prioriterer arbeidsro, skille mellom funksjoner og tydelige tilstander.
- [x] Etabler UI-tokens for nøytrale flater, funksjonsfarger, aktiv/hover/fokus/deaktivert, grenser, mellomrom, typografisk hierarki.
- [x] Oppgrader Icon og felles knappe-/menymønstre slik at funksjonsfarge kan angis sentralt; ingen redesign av slide-tema.
- [x] Vis et begrenset, representativt sett av komponenter og tilstander før hele grensesnittet fargelegges.
- [x] Verifiser tekstkontrast minst 4,5:1 for vanlig tekst og ikke-tekstlig tilstandskontrast minst 3:1 der WCAG krever det.
- [x] Kontroller at tilstander fortsatt er lesbare uten farge.

**Aksept:** Designsystemet er dokumentert, gjenbrukbart, testet og begrenset til appens chrome. Ingen presentasjonspiksler eller lagrede data er endret.

**Resultat:** [UX_DESIGN_SYSTEM.md](UX_DESIGN_SYSTEM.md), før/etter-bilder i [ux/u1/](ux/u1/).

### U2 — Desktop: hovedverktøylinje og innholdstype

- [x] Del handlinger etter presentasjon, valgt sone og aktivt tekstfelt. *(Hovedlinjen er ordnet etter nivå; tekstfeltets handlinger ligger fortsatt i tekstlinjen, som er U4.)*
- [x] Reduser den permanente ikonrekken og innfør navngitte, semantiske grupper/menyer.
- [x] Vis hva som er valgt og hvilken innholdstype valgt sone har.
- [x] Ha én gjenkjennelig og korrekt inngang for å endre innholdstype.
- [x] Skille tydelig mellom å endre innhold til bildetype og å velge/erstatte bildefil.
- [x] Behold primærhandlinger og lagrings-/delingsstatus tilgjengelig.
- [x] Kontroller bredder i og like over desktop/compact-grensen, uten overflyt.

**Aksept:** Færre likeverdige toppnivåknapper, konsistent valgt-tilstand, alle kommandoer tilgjengelige, og normale oppgaver ikke tregere enn baseline.

### U3 — Inspektør og soneredigering

- [ ] Gruppér relevante kontroller etter valgt objekt og handlingstype.
- [ ] Lag gode tomtilstander for intet valg, avledet side og innholdsløs sone.
- [ ] Vis aktive innholdstyper og gjeldende verdier eksplisitt.
- [ ] Legg avanserte forholdstall og sjeldne tekniske valg i lett tilgjengelige utvidbare grupper, dersom dette fungerer i brukerflyt.
- [ ] Behold størrelsesendring uten dragging og dyp sonenavigasjon.
- [ ] Samordne med de eksisterende høyreklikkmenyene, ikke bygg konkurrerende menyer.

**Aksept:** Bruker kan se målobjekt, endre det og forstå hvorfor en handling nektes, uten å lære to ulike innholdsmodeller.

### U4 — Tekstredigering

- [ ] Bruk can()-informasjonen for handlinger der den er egnet og korrekt.
- [ ] Marker aktiv horisontal og vertikal justering, lister og øvrig formatering.
- [ ] Grupper formatvalgene og bevar viktig skriveplass.
- [ ] Gjør fargearv og terminologi entydig, særlig «gjeldende inndeling».
- [ ] Verifiser at formatering fortsatt retter seg mot aktivt felt, uten å stjele markøren.

**Aksept:** Korrekte tilgjengelighets-/valgt-tilstander og ingen regresjon i Tiptap, fit eller tastatursnarveier.

### U5 — Bibliotek, filmstripe og oppretting

- [ ] Gjør åpning/navigasjon til primærhandling.
- [ ] Samle sekundærhandlinger uten å gjemme dem bak hover eller bare høyreklikk.
- [ ] Forenkle opprettelse av slide/inndeling/miniapp uten å miste innsetting mellom slides.
- [ ] Behold omorganisering og duplisering via tastatur/berøring som alternativ til dragging.
- [ ] Gjør destruktive valg tydelige og bekreftede der det er nødvendig.

**Aksept:** Enklere oppføringer; alle tidligere handlinger kan finnes, brukes og forstås fra mus, tastatur og berøring.

### U6 — Kompakt og responsiv arbeidsflate

- [ ] Verifiser faner, modus, paneler og tilgang til vanlige handlinger.
- [ ] Samordne farger, ikonbetydninger og aktiv tilstand med desktop.
- [ ] Kontroller treffflater, ikke-hover-tilgang, skjermtastatur og responsiv overflyt.
- [ ] Verifiser velg-først, langtrykk, sveip, pinch, fokusert tekst og paneloverganger.
- [ ] Bevar tilstand ved orienteringsendring og skifte mellom shells.

**Aksept:** Ikke mindre funksjonell enn før, ingen uventede modusskifter, ingen tap av utvalg/redigering.

### U7 — Helhetlig kvalitetssikring

- [ ] Kjør typecheck, lint, enhetstester, E2E og relevante visuelle tester.
- [ ] Legg inn visuelle regresjonstester av app-chrome og kritiske tilstander, ikke bare slideinnhold.
- [ ] Test tastaturnavigasjon, synlig fokus, aria-pressed/checked, disabled-reasons og fokusretur fra menyer.
- [ ] Test kontrast, tvetydige ikoner, reduced motion og høy kontrast der mulig.
- [ ] Gjenta oppgavematrisen og sammenlign med baseline (klikk/trykk, tid ved manuell test, feil og misforståelser).
- [ ] Gå gjennom desktop, smal desktop, mobil stående/liggende og stor touch-flate.
- [ ] Verifiser at renderet slideinnhold og presentasjoners filer/datastruktur ikke påvirkes.
- [ ] Registrer resterende forbedringer som egne oppgaver, ikke som ubegrenset scope i siste PR.

**Aksept:** Påviselig forbedret oppgaveflyt og ingen vesentlige funksjonelle, visuelle eller tilgjengelighetsmessige regresjoner.

## 8. Arbeidsflyter som skal testes etter hver relevant endring

| Test | Viktig spørsmål |
| --- | --- |
| Lag ny presentasjon og ny slide | Ser brukeren umiddelbart hva som er neste steg? |
| Lag et kort med tittel og skriv innhold | Er riktig innholdstype tydelig og lett å velge? |
| Sett inn bilde og erstatt bildefilen | Er «innholdstype» og «velg fil» forståelig atskilt? |
| Del en sone og endre forholdstall | Er innholdsmodus/sonemodus tydelige og resultatet forutsigbart? |
| Marker og formater tekst | Vises aktivt felt, aktuelle valg og gjeldende formatering? |
| Angre og gjør om en strukturendring | Er resultatet forståelig og historikken intakt? |
| Reorganiser en slide uten dragging | Kan oppgaven gjøres med tastatur og berøring? |
| Del og kopier lenke | Forstår brukeren om presentasjonen faktisk er delt? |
| Bruk mobil i stående og liggende modus | Er de samme funksjonene tilgjengelige uten å miste tilstand? |
| Finn kopiering av presentasjons-ID, bildebrief og avansert sonestørrelse | Er sjeldne funksjoner fortsatt lette å oppdage? |

Ikke fastsett tidsmål uten baseline. Foretrekk en faktisk forbedret median/observerbar enklere flyt fremfor tall satt på forhånd. Minstekrav: ingen vesentlig forverring for vanlige oppgaver uten begrunnet gevinst.

## 9. Implementasjon og kvalitet – praktiske regler

- Bruk eksisterende React/TypeScript, Radix, Tiptap, Zustand og CSS-struktur. Ikke innfør nytt UI-rammeverk uten særskilt begrunnelse.
- Skill komponent-/chrome-stil i src/styles/global.css og src/styles/editor.css fra selve slide-renderingen.
- Hold ikon- og handlingsmetadata sentralisert der det gir faktisk verdi (Icon, contentKinds, textActions, pageKinds). Ikke bygg parallell logikk mellom desktop og compact.
- Preserve touch-/keyboard-invarianter i eksisterende e2e; oppdater skjermbildetester etter reelle, tilsiktede UI-endringer.
- Ved hver PR: oppgi berørte arbeidsflyter, før/etter-skjermbilder, testresultater, tilgjengelighetskontroll og eksplisitt om agent-API-/MCP-kontrakt er endret (forventet: nei).
- Ikke flytt eller fjern eksisterende funksjoner i én stor PR uten testbar erstatning.
**Resultat:** Hovedlinjen har nå seks grupper i fast rekkefølge: tilbake, navn og lagringsstatus · modus og overskrift · angre/gjør om · innholdstype (én knapp som viser gjeldende type og åpner en meny med alle typer, utilgjengelige med domenets begrunnelse) og «Bilde fra fil» · menyene «Presentasjon» (navn, tema, maler, referanser, bildebrief, optimalisering) og «Verktøy» (idéer, sandkassen med antall, hurtigtaster) · «Del» og «Vis». Menyene er appens felles meny og virker med mus, tastatur og berøring. Ved smalere vindu viker etikettene for ikonene; ingen kontroll forlater vinduet ved 1025–1600 px (N1 løst, kontrollert av `e2e/toolbar.spec.ts`). Kompakt arbeidsflate er uendret, men leser de samme verktøylistene. Før/etter-bilder i [ux/u2/](ux/u2/).

- Hvis /frontend-design foreslår en annerledes struktur enn denne planen, dokumenter konkret nytte, risiko og konsekvenser for eksisterende arbeidsflyt før endring.

## 10. Fremdriftslogg

| Arbeidspakke | Status | Merknad / PR |
| --- | --- | --- |
| U0 Baseline og informasjonsarkitektur | Ferdig 30.10.2026 | UX_BASELINE.md. Nytt funn N1: hovedlinjen flyter over under ca. 1366 px, «Vis» havner utenfor vinduet. |
| U1 Designsystem og ikon-/fargespråk | Ferdig 30.10.2026 | UX_DESIGN_SYSTEM.md. Tokens, blekkfarger, ikonfamilie, felles tilstander, segmentert modusvalg. Samme PR som U0. |
| U2 Hovedverktøylinje og innholdstype | Ferdig 30.10.2026 | N1 løst. Innholdstype som én meny, eget «Bilde fra fil», menyene «Presentasjon» og «Verktøy», lagringsstatus ved tittelen. |
| U3 Inspektør og soner | Ikke startet | Anbefalt neste. Inspektørens egen liste over innholdstyper kan nå bruke samme meny som verktøylinjen. |
| U4 Tekstverktøy | Ikke startet | Høy prioritet |
| U5 Bibliotek og filmstripe | Ikke startet | Neste runde |
| U6 Mobil/responsivt | Ikke startet | Verifiser fortløpende, egen samlet gjennomgang |
| U7 Samlet QA | Ikke startet | Tester kjøres også kontinuerlig |

**Startpunkt for Claude Code:** Les denne planen og IMPLEMENTATION_PLAN.md § 44.5–44.6. Begynn med U0, og bruk deretter /frontend-design til U1. Lag en avgrenset implementerings-PR for U1; ikke start en full redesign av alle flater i samme PR.
