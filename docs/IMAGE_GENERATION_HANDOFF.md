# Bildegenerering: standard arbeidsflyt

Slaids skal ikke ha en betalt bildegenererings-API, og agentarbeidsflyten skal ikke behandle fravær av en slik API som en feiltilstand eller en nødløsning.

## Fast arkitektur

For rasterbilder er standardflyten alltid:

1. Agenten avgjør hvilke rasterbilder presentasjonen trenger.
2. Agenten reserverer riktige bildesoner i Slaids.
3. Agenten skriver bildeplan og felles bildekontekst.
4. Slaids genererer én samlet bildebrief med antall, nummerering og aspect ratio målt fra de faktiske sonene.
5. Bildene produseres utenfor Slaids-API-et og legges deretter inn i de reserverte sonene.

Dette er normal arkitektur, ikke fallback. Agenten skal derfor ikke bruke tid på å undersøke om Slaids har et bildegenereringsverktøy, og skal ikke omtale bildebrief/plassholdere som en redusert løsning.

SVG-reglene endres ikke: diagrammer, plott, flytskjemaer og andre motiver der poenget er struktur kan produseres direkte som SVG. Fotografiske, naturtro, kunstneriske og andre rikt illustrerende motiver planlegges som rasterbilder.

## ChatGPT som vertsklient

Når Slaids brukes fra ChatGPT og ChatGPT allerede har et separat, innebygd bildegenereringsverktøy tilgjengelig, skal arbeidsflyten fortsette i samme samtale:

1. Slaids bygger presentasjonen, reserverer bildesonene og genererer bildebriefen.
2. ChatGPT henter den ferdige briefen.
3. ChatGPT viser briefen i samtalen når det er nyttig, men skal ikke be brukeren kopiere og lime den inn igjen.
4. Hvis brukeren har bedt om at bildene faktisk skal genereres, sender ChatGPT briefen direkte videre til sitt innebygde bildegenereringsverktøy og starter genereringen i samme samtale.

Dette er en klient-side handoff. Slaids-API-et selv genererer fortsatt ikke rasterbilder og trenger ingen bilde-API-nøkkel.

## Avgrensning

Den innebygde bildegenereringen i ChatGPT og Slaids-API-et er separate verktøy. At ChatGPT kan starte bildegenereringen i samme samtale betyr ikke nødvendigvis at de ferdige bildefilene kan lastes direkte tilbake til Slaids uten en fil-/connector-bro. Inntil en slik bro finnes, er den automatiske delen: planlegging -> bildebrief -> bildegenerering i samme samtale. Selve innsettingen kan fortsatt kreve bildedeponeringen i Slaids.
