-- Slaids: en endret temamal får logoen på en ny sti (IMPLEMENTATION_PLAN.md § 15.4).
--
-- En mal kan nå endres, også logoen. Hadde logoen alltid den samme stien
-- (`<eier>/<mal>/logo`), måtte en ny logo skrives over den gamle før raden
-- endres, og to lagringer samtidig – eller en feil midt mellom filen og raden –
-- kunne la raden beskrive én logo mens filen var en annen.
--
-- Derfor får hver ny utgave av logoen sin egen sti, `<eier>/<mal>/logo-<utgave>`.
-- Filen lastes opp til en ledig sti, raden pekes dit i én oppdatering, og den
-- gamle filen slettes etterpå. Avvises raden, slettes bare den nye filen; den
-- gamle er urørt. Regelen er den samme som før: en mal kan bare peke på en fil i
-- eierens egen mappe for den malen. Stier fra før (`…/logo`) er fortsatt gyldige.
--
-- Bare regelen på `slaids_theme_templates` endres. Storage-reglene sammenligner
-- med `logo_path` og trenger ingen endring.

alter table public.slaids_theme_templates
  drop constraint if exists slaids_theme_templates_check;

alter table public.slaids_theme_templates
  add constraint slaids_theme_templates_check check (
    logo_path is null
    or logo_path = owner_id::text || '/' || id || '/logo'
    or (
      starts_with(logo_path, owner_id::text || '/' || id || '/logo-')
      and substr(logo_path, length(owner_id::text || '/' || id || '/logo-') + 1) ~ '^[a-z0-9]{1,64}$'
    )
  );
