import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from '../icons/Icon'

type B = ButtonHTMLAttributes<HTMLButtonElement>

export function AddFilesButton({ children = 'Add files', ...rest }: B): JSX.Element {
  return (
    <button type="button" className="tbtn add" {...rest}>
      <Icon name="addfile" />
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  ...rest
}: B & { icon: IconName; label: string }): JSX.Element {
  return (
    <button type="button" className="ibtn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  )
}

export function SmallButton({
  icon,
  children,
  ...rest
}: B & { icon?: IconName; children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="sbtn" {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

export function RowAction({
  icon,
  label,
  ghost,
  ...rest
}: B & { icon: IconName; label: string; ghost?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={`row-act${ghost ? ' ghost' : ''}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  )
}

export function PrimaryButton({
  icon = 'play',
  children,
  ...rest
}: B & { icon?: IconName; children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="primary" {...rest}>
      <Icon name={icon} />
      {children}
    </button>
  )
}
