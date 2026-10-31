/** Asks the one question a new slide must answer: title or no title. */

import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { withPlacement } from './pageKinds'

export function NewSlideModal({
  open,
  onOpenChange,
  onCreate,
  placement,
}: {
  open: boolean
  /** Where the new page will go, as the strip says it — «etter slide 3». */
  placement?: string
  onOpenChange: (open: boolean) => void
  onCreate: (hasTitle: boolean) => void
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ny slide"
      description={withPlacement(placement, 'Skal sliden ha en overskriftssone?')}
      testId="new-slide-modal"
      width={460}
      footer={
        <button type="button" className="btn" onClick={() => onOpenChange(false)}>
          Avbryt
        </button>
      }
    >
      <div className="new-slide__choices">
        <button
          type="button"
          className="new-slide__choice"
          onClick={() => onCreate(true)}
          data-testid="new-slide-with-title"
        >
          <Icon name="card-titled" size={26} />
          <strong>Med overskrift</strong>
          <span className="hint">Fast tittelsone øverst, hovedsonen under.</span>
        </button>
        <button
          type="button"
          className="new-slide__choice"
          onClick={() => onCreate(false)}
          data-testid="new-slide-without-title"
        >
          <Icon name="container" size={26} />
          <strong>Uten overskrift</strong>
          <span className="hint">Hovedsonen dekker hele sliden.</span>
        </button>
      </div>
    </Modal>
  )
}
