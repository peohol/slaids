/**
 * Temamalene i temaeditoren (§ 15.4): Mine maler og Delte maler, med en enkel
 * forhåndsvisning av hver. Et trykk på en mal bruker den; stjernen gjør den til
 * standard for nye presentasjoner; egne maler kan slettes. Gjeldende tema
 * lagres som ny mal med navn og synlighet.
 *
 * Mine maler er brukerens private maler. Delte maler er alle delte, også
 * brukerens egne, som er merket og kan slettes der. Hver mal står ett sted.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  THEME_TEMPLATE_NAME_MAX,
  type ThemeTemplate,
  type ThemeTemplateVisibility,
} from '../../domain/themeTemplate'
import type { Presentation } from '../../domain/types'
import { themeTemplates } from '../../persistence/activeRepository'
import { notify } from '../../state/toast'
import { useUserSettings } from '../../state/userSettings'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { RadioRow } from './ThemeLogoSettings'
import {
  applyThemeTemplateToOpenDeck,
  chooseDefaultThemeTemplate,
  saveThemeAsTemplate,
} from './themeTemplates'

const VISIBILITY_LABELS: Record<ThemeTemplateVisibility, string> = {
  private: 'Bare meg',
  shared: 'Alle i Slaids',
}

const TABS: readonly { visibility: ThemeTemplateVisibility; label: string; empty: string }[] = [
  { visibility: 'private', label: 'Mine maler', empty: 'Du har ingen egne maler ennå.' },
  { visibility: 'shared', label: 'Delte maler', empty: 'Ingen har delt en mal ennå.' },
]

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function ThemeTemplates({ presentation }: { presentation: Presentation }) {
  const [templates, setTemplates] = useState<ThemeTemplate[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<ThemeTemplateVisibility>('private')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ThemeTemplate | null>(null)
  const defaultId = useUserSettings((state) => state.defaultThemeTemplateId)
  const settingsReady = useUserSettings((state) => state.status === 'ready')

  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    let cancelled = false
    themeTemplates
      .listThemeTemplates()
      .then((list) => {
        if (cancelled) return
        setTemplates(list)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const shown = useMemo(
    () => (templates ?? []).filter((template) => template.visibility === tab),
    [templates, tab],
  )

  const apply = async (template: ThemeTemplate): Promise<void> => {
    setBusy(template.id)
    try {
      if ((await applyThemeTemplateToOpenDeck(template)) === 'set') {
        notify.success(`Malen «${template.name}» er brukt.`)
      }
    } finally {
      setBusy(null)
    }
  }

  const toggleDefault = async (template: ThemeTemplate): Promise<void> => {
    const next = defaultId === template.id ? null : template.id
    try {
      await chooseDefaultThemeTemplate(next)
      notify.success(
        next
          ? `Nye presentasjoner starter i «${template.name}».`
          : 'Nye presentasjoner starter i standardtemaet.',
      )
    } catch (error) {
      notify.error(errorText(error, 'Valget kunne ikke lagres.'))
    }
  }

  const remove = async (template: ThemeTemplate): Promise<void> => {
    setDeleting(null)
    try {
      await themeTemplates.deleteThemeTemplate(template.id)
      // Databasen tømmer standardvalget selv; her følger visningen etter.
      if (defaultId === template.id) useUserSettings.setState({ defaultThemeTemplateId: null })
      notify.info(`Malen «${template.name}» er slettet.`)
    } catch (error) {
      notify.error(errorText(error, 'Malen kunne ikke slettes.'))
    }
    reload()
  }

  return (
    <div className="field theme-templates" data-testid="theme-templates">
      <div className="theme-templates__head">
        <label id="theme-templates-label">Temamaler</label>
        <button
          type="button"
          className="btn btn--sm"
          data-testid="theme-template-save"
          aria-expanded={saving}
          onClick={() => setSaving((open) => !open)}
        >
          Lagre som mal …
        </button>
      </div>

      {saving && (
        <SaveTemplateForm
          presentation={presentation}
          canChooseDefault={settingsReady}
          onCancel={() => setSaving(false)}
          onSaved={(template) => {
            setSaving(false)
            setTab(template.visibility)
            reload()
          }}
        />
      )}

      <div className="inspector__actions" role="group" aria-labelledby="theme-templates-label">
        {TABS.map((entry) => (
          <button
            key={entry.visibility}
            type="button"
            className={entry.visibility === tab ? 'btn btn--sm btn--active' : 'btn btn--sm'}
            aria-pressed={entry.visibility === tab}
            data-testid={`theme-templates-${entry.visibility}`}
            onClick={() => setTab(entry.visibility)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {failed ? (
        <p className="hint" data-testid="theme-templates-failed">
          Malene kunne ikke hentes.{' '}
          <button type="button" className="btn btn--sm" onClick={reload}>
            Prøv igjen
          </button>
        </p>
      ) : templates === null ? (
        <p className="hint">Henter malene …</p>
      ) : shown.length === 0 ? (
        <p className="hint" data-testid="theme-templates-empty">
          {TABS.find((entry) => entry.visibility === tab)?.empty}
        </p>
      ) : (
        <ul className="theme-templates__list" data-testid="theme-templates-list">
          {shown.map((template) => (
            <TemplateItem
              key={template.id}
              template={template}
              isDefault={template.id === defaultId}
              canChooseDefault={settingsReady}
              busy={busy === template.id}
              disabled={busy !== null}
              onApply={() => void apply(template)}
              onToggleDefault={() => void toggleDefault(template)}
              onDelete={() => setDeleting(template)}
            />
          ))}
        </ul>
      )}
      <p className="hint">
        En mal setter tema, forsidens farger og logo i ett steg, som kan angres. Senere endringer i
        malen endrer ikke presentasjoner som allerede har brukt den. Stjernen velger malen nye
        presentasjoner starter i.
      </p>

      <ConfirmDialog
        open={deleting !== null}
        title="Slette malen?"
        message={
          deleting
            ? deleting.visibility === 'shared'
              ? `«${deleting.name}» forsvinner for alle i Slaids. Presentasjoner som har brukt den, beholder temaet og logoen.`
              : `«${deleting.name}» slettes. Presentasjoner som har brukt den, beholder temaet og logoen.`
            : ''
        }
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

function TemplateItem({
  template,
  isDefault,
  canChooseDefault,
  busy,
  disabled,
  onApply,
  onToggleDefault,
  onDelete,
}: {
  template: ThemeTemplate
  isDefault: boolean
  canChooseDefault: boolean
  busy: boolean
  disabled: boolean
  onApply: () => void
  onToggleDefault: () => void
  onDelete: () => void
}) {
  return (
    <li className="theme-template" data-testid="theme-template" data-template-id={template.id}>
      <button
        type="button"
        className="theme-template__apply"
        data-testid="theme-template-apply"
        disabled={disabled}
        aria-busy={busy || undefined}
        title={`Bruk «${template.name}» i denne presentasjonen`}
        onClick={onApply}
      >
        <TemplateSwatch template={template} />
        <span className="theme-template__name">
          {template.name}
          {template.own && template.visibility === 'shared' && (
            <span className="theme-template__badge">Din</span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="btn btn--sm btn--icon theme-template__default"
        data-testid="theme-template-default"
        aria-pressed={isDefault}
        disabled={!canChooseDefault}
        aria-label={
          isDefault
            ? `«${template.name}» er standard for nye presentasjoner. Trykk for å slutte å bruke den.`
            : `Bruk «${template.name}» som standard for nye presentasjoner`
        }
        title={isDefault ? 'Standard for nye presentasjoner' : 'Bruk som standard for nye presentasjoner'}
        onClick={onToggleDefault}
      >
        <Icon name="star" size={16} />
      </button>
      {template.own && (
        <button
          type="button"
          className="btn btn--sm btn--icon"
          data-testid="theme-template-delete"
          aria-label={`Slett malen «${template.name}»`}
          title="Slett malen"
          onClick={onDelete}
        >
          <Icon name="trash" size={16} />
        </button>
      )}
    </li>
  )
}

/**
 * Et lite bilde av malen: forsidens bakgrunn, en aksentstripe, «Aa» i
 * titlenes font og logoen. Et bilde av ideen, ikke en forminsket slide – den
 * ekte forhåndsvisningen øverst i dialogen viser malen når den er brukt.
 */
function TemplateSwatch({ template }: { template: ThemeTemplate }) {
  const { theme, front } = template.content
  const logoUrl = useTemplateLogoUrl(template)
  return (
    <span className="theme-template__swatch" style={{ background: front.backgroundColor }} aria-hidden="true">
      <span className="theme-template__accent" style={{ background: front.accentColor }} />
      <span className="theme-template__sample" style={{ fontFamily: theme.headingFontFamily, color: front.accentColor }}>
        Aa
      </span>
      {logoUrl && <img className="theme-template__logo" src={logoUrl} alt="" draggable={false} />}
    </span>
  )
}

/**
 * Logoen i en mal som en adresse nettleseren kan vise. En mal endres aldri, så
 * filen hentes én gang per mal og huskes så lenge siden er åpen.
 */
const logoUrls = new Map<string, Promise<string | null>>()

function useTemplateLogoUrl(template: ThemeTemplate): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const hasLogo = template.content.logo !== null
  useEffect(() => {
    if (!hasLogo) return
    let cancelled = false
    let pending = logoUrls.get(template.id)
    if (!pending) {
      pending = themeTemplates
        .getThemeTemplateLogo(template.id)
        .then((blob) => (blob ? URL.createObjectURL(blob) : null))
        .catch(() => {
          logoUrls.delete(template.id)
          return null
        })
      logoUrls.set(template.id, pending)
    }
    void pending.then((next) => {
      if (!cancelled) setUrl(next)
    })
    return () => {
      cancelled = true
    }
  }, [template.id, hasLogo])
  return hasLogo ? url : null
}

function SaveTemplateForm({
  presentation,
  canChooseDefault,
  onCancel,
  onSaved,
}: {
  presentation: Presentation
  canChooseDefault: boolean
  onCancel: () => void
  onSaved: (template: ThemeTemplate) => void
}) {
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<ThemeTemplateVisibility>('private')
  const [asDefault, setAsDefault] = useState(false)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || pending) return
    setPending(true)
    try {
      const template = await saveThemeAsTemplate(presentation, { name, visibility })
      if (asDefault) await chooseDefaultThemeTemplate(template.id)
      notify.success(
        asDefault
          ? `Malen «${template.name}» er lagret, og nye presentasjoner starter i den.`
          : `Malen «${template.name}» er lagret.`,
      )
      onSaved(template)
    } catch (error) {
      notify.error(errorText(error, 'Malen kunne ikke lagres.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="theme-templates__save" data-testid="theme-template-form" onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label htmlFor="theme-template-name">Navn på malen</label>
        <input
          id="theme-template-name"
          className="input"
          data-testid="theme-template-name"
          value={name}
          maxLength={THEME_TEMPLATE_NAME_MAX}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label id="theme-template-visibility-label">Hvem kan bruke den</label>
        <RadioRow
          label="Hvem kan bruke malen"
          name="theme-template-visibility"
          options={['private', 'shared'] as const}
          labels={VISIBILITY_LABELS}
          value={visibility}
          testId="theme-template-visibility"
          onChange={setVisibility}
        />
      </div>
      <label className="user-settings-option">
        <input
          type="checkbox"
          data-testid="theme-template-as-default"
          checked={asDefault}
          disabled={!canChooseDefault}
          onChange={(event) => setAsDefault(event.currentTarget.checked)}
        />
        Bruk som standard for nye presentasjoner
      </label>
      <p className="hint">
        Malen tar med temaet, forsidens farger og logoen – aldri tekst eller slides.
      </p>
      <div className="theme-templates__save-actions">
        <button type="button" className="btn btn--sm" onClick={onCancel}>
          Avbryt
        </button>
        <button
          type="submit"
          className="btn btn--sm btn--primary"
          data-testid="theme-template-submit"
          disabled={!name.trim() || pending}
        >
          {pending ? 'Lagrer …' : 'Lagre mal'}
        </button>
      </div>
    </form>
  )
}
