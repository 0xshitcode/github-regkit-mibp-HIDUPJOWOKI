import React, { useEffect, useRef } from 'react'

const cx = (...classes) => classes.filter(Boolean).join(' ')

export const Card = React.forwardRef(function Card({ className, children, ...props }, ref) {
  return <section ref={ref} className={cx('ui-card', className)} {...props}>{children}</section>
})

export function Button({ className, variant = 'outline', size = 'default', children, ...props }) {
  return (
    <button className={cx('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)} {...props}>
      {children}
    </button>
  )
}

export function Input({ className, ...props }) {
  return <input className={cx('ui-input', className)} {...props} />
}

export function Badge({ tone = 'muted', children, className }) {
  return <span className={cx('ui-badge', `ui-badge-${tone}`, className)}>{children}</span>
}

export function Dialog({ open, onClose, title, children, footer }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    dialogRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="ui-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex="-1" className="ui-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        {title && <header className="ui-dialog-header"><h2>{title}</h2><button type="button" className="ui-dialog-close" onClick={onClose} aria-label="Close dialog">×</button></header>}
        <div className="ui-dialog-body">{children}</div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </section>
    </div>
  )
}

export function Spinner({ className }) {
  return <span className={cx('ui-spinner', className)} aria-label="Loading" />
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="ui-empty-state">
      {Icon && <Icon size={28} strokeWidth={1.7} />}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}
