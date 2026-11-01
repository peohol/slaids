/**
 * The split dialog as a draft (zone-editing plan, Z2).
 *
 * The rules under test are about what the dialog does with its answer, not
 * about geometry (`splitPreviewModel.test.ts`, the E2E specs): «Bruk» is the
 * only thing that reaches the caller; a refusal keeps the dialog open and is
 * said in it; deleting content is asked about once more, with the count, and
 * can be turned into rescuing it; and the dry run's verdict — asked only once
 * the fields rest — is shown before «Bruk» and blocks it when it is a refusal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createContentOfKind } from '../../domain/content'
import { createLeaf, createSplit } from '../../domain/layout'
import type { LayoutNode } from '../../domain/types'
import { SplitModal, type SplitModalProps, type SplitModalResult } from './SplitModal'
import type { SplitCheck } from './splitDraft'

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function render(props: Partial<SplitModalProps>): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <SplitModal
        open
        onOpenChange={() => {}}
        targetRect={{ x: 0, y: 0, width: 1500, height: 700 }}
        theme={undefined}
        targetLabels={['Rot']}
        mode="create"
        onApply={() => null}
        {...props}
      />,
    ),
  )
}

const byTestId = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`)

function click(id: string): void {
  act(() => byTestId(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

/** Type into a controlled input the way React notices. */
function type(id: string, value: string): void {
  const input = byTestId(id) as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** A split of three, the last holding two cards one level down. */
function threeZones(): LayoutNode[] {
  return [
    createLeaf(),
    createLeaf(),
    createSplit('y', [1, 1], [
      createLeaf(createContentOfKind('titled-card')),
      createLeaf(createContentOfKind('untitled-card')),
    ]),
  ]
}

const editThree = (onApply: SplitModalProps['onApply']): Partial<SplitModalProps> => ({
  mode: 'edit',
  existingChildren: threeZones(),
  existingAxis: 'x',
  existingWeights: [1, 1, 1],
  onApply,
})

describe('SplitModal as a draft', () => {
  it('says a refusal at «Bruk» in the dialog, which stays as it was, until the proposal changes', () => {
    const onApply = vi.fn<(result: SplitModalResult) => string | null>(() => 'Innholdet får ikke plass.')
    const onOpenChange = vi.fn()
    render({ onApply, onOpenChange })

    click('split-apply')
    expect(onApply).toHaveBeenCalledWith({
      axis: 'x',
      weights: [1, 1],
      contentTargetIndex: 0,
      removedDisposition: 'sandbox',
    })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(byTestId('split-modal')).not.toBeNull()
    const refusal = byTestId('split-refusal')!
    expect(refusal.getAttribute('role')).toBe('alert')
    expect(refusal.textContent).toBe('Ikke endret: Innholdet får ikke plass.')
    expect((byTestId('split-weight-1') as HTMLInputElement).value).toBe('1')

    type('split-weight-1', '2')
    expect(byTestId('split-refusal')).toBeNull()
  })

  it('names the zones a lower count removes, with the content in their whole subtrees', () => {
    render(editThree(() => null))
    expect(byTestId('split-removed')).toBeNull()
    click('split-count-decrease')
    expect(byTestId('split-removed')!.textContent).toContain(
      'Sone 3 fjernes. 2 innholdselementer mister sonen sin.',
    )
    expect(byTestId('split-removed')!.textContent).toContain(
      'Sone 3 inneholder 2 innholdselementer i 2 underordnede soner.',
    )
    click('split-count-increase')
    expect(byTestId('split-removed')).toBeNull()
  })

  it('asks once more, with the count, before deleting — and can rescue instead', () => {
    const onApply = vi.fn<(result: SplitModalResult) => string | null>(() => null)
    render(editThree(onApply))
    click('split-count-decrease')

    // Rescuing is the default and needs no second question.
    click('split-apply')
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ removedDisposition: 'sandbox' }))
    onApply.mockClear()

    click('removed-delete')
    click('split-apply')
    expect(onApply).not.toHaveBeenCalled()
    const confirm = byTestId('confirm-dialog')!
    expect(confirm.textContent).toContain('Slette 2 innholdselementer?')
    expect(confirm.textContent).toContain('Sone 3 fjernes.')

    // Cancelling the question changes nothing.
    act(() =>
      [...confirm.querySelectorAll('button')]
        .find((button) => button.textContent === 'Avbryt')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
    expect(byTestId('confirm-dialog')).toBeNull()
    expect(onApply).not.toHaveBeenCalled()

    click('split-apply')
    click('confirm-accept')
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ removedDisposition: 'delete', weights: [1, 1] }))

    click('split-apply')
    click('confirm-alternative')
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ removedDisposition: 'sandbox' }))
  })

  it('asks the dry run once the fields rest, and shows and obeys its verdict before «Bruk»', () => {
    vi.useFakeTimers()
    let verdict: SplitCheck = { ok: false, message: 'Innholdet får ikke plass med disse forholdstallene.', zones: [0] }
    const check = vi.fn<(result: SplitModalResult) => SplitCheck>(() => verdict)
    render({ ...editThree(() => null), existingChildren: [createLeaf(createContentOfKind('titled-card')), createLeaf()], existingWeights: [1, 1], check })

    type('split-weight-1', '4')
    type('split-weight-1', '5')
    expect(check).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200))
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ weights: [1, 5] }))
    expect(byTestId('split-check')!.textContent).toBe(
      'Innholdet får ikke plass med disse forholdstallene. Gjelder sone 1 (skravert).',
    )
    expect((byTestId('split-apply') as HTMLButtonElement).disabled).toBe(true)

    // A verdict belongs to the proposal it was asked about.
    verdict = { ok: true, movedToSandbox: 0, discarded: 0 }
    type('split-weight-1', '2')
    expect(byTestId('split-check')).toBeNull()
    // Until the dry run has answered for this proposal, «Bruk» waits for it.
    expect((byTestId('split-apply') as HTMLButtonElement).disabled).toBe(true)
    act(() => vi.advanceTimersByTime(200))
    expect(byTestId('split-check')).toBeNull()
    expect((byTestId('split-apply') as HTMLButtonElement).disabled).toBe(false)
  })

  /**
   * What the caption says about where the content goes. (The picture is not
   * drawn here — jsdom has no layout to size it — so the picture and its
   * description are checked in `e2e/split-flow.spec.ts`.)
   */
  const contentClaims = () => ({ line: byTestId('split-content-line')?.textContent ?? null })

  it('says before «Bruk» when the content of a split leaf will go to the sandbox, and claims no zone for it', () => {
    vi.useFakeTimers()
    const check = vi.fn<(result: SplitModalResult) => SplitCheck>(() => ({ ok: true, movedToSandbox: 1, discarded: 0 }))
    render({ leafContent: createContentOfKind('titled-card'), check })
    click('split-content-target-1')
    expect((byTestId('split-apply') as HTMLButtonElement).disabled).toBe(true)
    // Until the dry run answers, the chosen zone is a proposal, not a result.
    const proposed = 'Innholdet er tenkt i sone 2; om det får plass der, er ikke kontrollert ennå.'
    expect(contentClaims().line).toBe(proposed)

    act(() => vi.advanceTimersByTime(200))
    expect(check).toHaveBeenLastCalledWith(expect.objectContaining({ contentTargetIndex: 1 }))
    expect(byTestId('split-check')!.textContent).toBe(
      'Innholdet får ikke plass i sone 2, så det flyttes til sandkassen når du trykker «Bruk».',
    )
    expect(contentClaims().line).toBeNull()
    expect((byTestId('split-apply') as HTMLButtonElement).disabled).toBe(false)
  })

  it('names the zone the content lands in once the dry run says it fits', () => {
    vi.useFakeTimers()
    const check = vi.fn<(result: SplitModalResult) => SplitCheck>(() => ({ ok: true, movedToSandbox: 0, discarded: 0 }))
    render({ leafContent: createContentOfKind('titled-card'), check })
    act(() => vi.advanceTimersByTime(200))
    expect(contentClaims().line).toBe('Innholdet havner i sone 1.')
    expect(byTestId('split-check')).toBeNull()
  })

  it('does not ask the dry run when no content is involved', () => {
    vi.useFakeTimers()
    const check = vi.fn<(result: SplitModalResult) => SplitCheck>(() => ({ ok: true, movedToSandbox: 0, discarded: 0 }))
    render({ check })
    type('split-weight-1', '3')
    act(() => vi.advanceTimersByTime(500))
    expect(check).not.toHaveBeenCalled()
  })

  it('keeps an unfinished count in the field without acting on it, and says why', () => {
    render({})
    type('split-count', '1')
    expect(byTestId('split-count-error')!.textContent).toBe('Velg et helt tall fra 2 til 10.')
    expect((byTestId('split-apply') as HTMLButtonElement).disabled).toBe(true)
    expect(byTestId('split-weight-1')).not.toBeNull()
    type('split-count', '10')
    expect(byTestId('split-count-error')).toBeNull()
    expect(byTestId('split-weight-9')).not.toBeNull()
    expect((byTestId('split-count-increase') as HTMLButtonElement).disabled).toBe(true)
  })

  it('evens out the ratios in one press, and names the field and its share by the zone number', () => {
    render({})
    type('split-weight-0', '3')
    expect(byTestId('split-share-0')!.textContent).toBe('75 %')
    expect(byTestId('split-quantized')!.textContent).toContain('Lagres som 3 : 1.')
    click('split-equalize')
    expect((byTestId('split-weight-0') as HTMLInputElement).value).toBe('1')
    expect(byTestId('split-share-0')!.textContent).toBe('50 %')
    expect((byTestId('split-equalize') as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelector('label[for="split-weight-1"]')!.textContent).toBe('Sone 2')
  })

  it('marks a field that cannot be read, on the field itself', () => {
    render({})
    type('split-weight-0', '0')
    const field = byTestId('split-weight-0')!
    expect(field.getAttribute('aria-invalid')).toBe('true')
    const error = document.getElementById(field.getAttribute('aria-describedby')!)!
    expect(error.textContent).toBe('Forholdstallet må være større enn 0.')
    expect(byTestId('split-share-0')!.textContent).toBe('–')
    expect(byTestId('split-invalid')!.textContent).toBe('Alle forholdstall må være tall større enn 0.')
  })
})
