import { createElement as h } from 'react'

export function NumberField(props: any) {
  const { label, value, onChange, disabled, min, max, step } = props
  return h('label', { className: 'csm-row' },
    h('span', { className: 'csm-row-label' }, label),
    h('input', {
      className: 'csm-input', type: 'number',
      value: String(value ?? ''),
      min: typeof min === 'number' ? min : undefined,
      max: typeof max === 'number' ? max : undefined,
      step: typeof step === 'number' ? step : undefined,
      disabled: disabled === true,
      onChange: (e: any) => { if (typeof onChange === 'function') onChange(e.target.value) },
    }),
  )
}
