import { createElement as h } from 'react'

export function ModelPicker(props: any) {
  const t = props?.t ?? ((k: string) => k)
  const provider = typeof props?.provider === 'string' ? props.provider : ''
  const model = typeof props?.model === 'string' ? props.model : ''
  const disabled = props?.disabled === true
  const groups = Array.isArray(props?.catalog?.groups) ? props.catalog.groups : []
  const providerModels = groups.find((g: any) => g?.id === provider)?.models ?? []
  const providerKnown = provider !== '' && groups.some((g: any) => g?.id === provider)
  const modelKnown = model !== '' && providerModels.some((m: any) => m?.id === model)
  return h('div', { className: 'csm-section' },
    h('p', { className: 'csm-section-title' }, t('picker.title')),
    h('label', { className: 'csm-row' },
      h('span', { className: 'csm-row-label' }, t('picker.provider')),
      h('select', {
        className: 'csm-input', value: providerKnown ? provider : '',
        disabled: disabled || groups.length === 0,
        onChange: (e: any) => { props.onProvider(e.target.value); props.onModel('') },
      },
        h('option', { value: '', key: 'blank' }, groups.length === 0 ? t('picker.unavailable') : t('picker.select')),
        ...groups.map((g: any) => h('option', { value: g.id, key: g.id }, `${g.name} (${g.id})`)),
      ),
    ),
    h('label', { className: 'csm-row' },
      h('span', { className: 'csm-row-label' }, t('picker.model')),
      h('select', {
        className: 'csm-input', value: modelKnown ? model : '',
        disabled: disabled || providerModels.length === 0,
        onChange: (e: any) => { props.onModel(e.target.value) },
      },
        h('option', { value: '', key: 'blank' }, t('picker.select')),
        ...providerModels.map((m: any) => h('option', { value: m.id, key: m.id }, `${m.name} (${m.id})`)),
      ),
    ),
    h('label', { className: 'csm-row' },
      h('span', { className: 'csm-row-label' }, t('picker.manual')),
      h('input', {
        className: 'csm-input', type: 'text', placeholder: 'provider/model', disabled,
        value: provider === '' && model === '' ? '' : `${provider}/${model}`,
        onChange: (e: any) => {
          const value = e.target.value
          const at = value.indexOf('/')
          if (at < 0) { props.onProvider(value); return }
          props.onProvider(value.slice(0, at))
          props.onModel(value.slice(at + 1))
        },
      }),
    ),
    provider !== '' && !providerKnown ? h('p', { className: 'csm-warn', key: 'warn-provider' }, t('picker.notInCatalog')) : null,
    model !== '' && !modelKnown ? h('p', { className: 'csm-warn', key: 'warn-model' }, t('picker.modelNotInCatalog')) : null,
  )
}
