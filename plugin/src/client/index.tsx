import { CompactionCard } from './CompactionCard.tsx'
import { zh, en } from './locales.ts'

const CARD_CSS = `
.csm-card{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#202126);color:var(--dsw-alias-label-primary,#e6e6e6)}
.csm-hint{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary,#999)}
.csm-section{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2,#2c2d31);border-radius:10px}
.csm-section-title{font-size:12px;color:var(--dsw-alias-label-tertiary,#999);margin:0}
.csm-row{display:flex;align-items:center;gap:8px;font-size:13px}
.csm-row-label{min-width:120px;color:var(--dsw-alias-label-secondary,#aaa)}
.csm-input{font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-2,#25262b);color:inherit;max-width:100%}
.csm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;padding:6px 14px;background:transparent;color:inherit;align-self:flex-start}
.csm-btn:disabled{opacity:.4;cursor:default}
.csm-warn{font-size:12px;margin:0;color:var(--dsw-alias-state-warning-primary,#d9822b)}
.csm-status{font-size:13px;margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#25262b)}
.csm-status-ok{color:var(--dsw-alias-label-secondary,#aaa)}
.csm-status-pending{color:var(--dsw-alias-state-warning-primary,#d9822b)}
.csm-errors{display:flex;flex-direction:column;gap:4px}
.csm-field-error{font-size:12px;margin:0;color:var(--dsw-alias-state-error-primary,#d92d20)}
`

export const name = 'compaction-setmodel-client'
export const inject = ['slots', 'locale']

export function apply(ctx: any): void {
  try {
    if (typeof document !== 'undefined') {
      const id = 'compaction-setmodel/css'
      let tag = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
      if (!tag) { tag = document.createElement('style'); tag.dataset.pluginCss = id; document.head.appendChild(tag) }
      tag.textContent = CARD_CSS
    }
    const ns = 'settings.compaction-setmodel'
    ctx.effect?.(() => ctx.locale.register(ns, { zh, en }))
    const t = ctx.locale.bind(ns)
    let cardDisposer: any
    const registerCard = () => {
      if (cardDisposer) { try { cardDisposer() } catch { /* ignore */ } }
      cardDisposer = ctx.slots.register({
        name: 'settings.section', id: 'compaction-setmodel', order: 60,
        label: () => t('nav.panel'), locale: ns, inject: () => ({ t }),
      }, CompactionCard)
    }
    ctx.slots.inject('settings.section', () => {
      registerCard()
      return () => { try { cardDisposer?.() } catch { /* ignore */ } }
    })
  } catch (e) {
    console.error('[compaction-setmodel] client failed to load:', e)
  }
}
