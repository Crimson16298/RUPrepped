import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils/cn'

export function Button({ children, className, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; className?: string }) { return <button className={cn('button', `button-${variant}`, className)} {...props}>{children}</button> }
export function Card({ children, className }: { children: ReactNode; className?: string }) { return <section className={cn('card', className)}>{children}</section> }
export function Badge({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'violet' | 'muted' }) { return <span className={`badge badge-${tone}`}>{children}</span> }
export function ScoreRing({ value, label }: { value: number; label: string }) { return <div className="score-wrap"><div className="score-ring" style={{ '--score': `${value * 3.6}deg` } as React.CSSProperties}><strong>{value}</strong></div><span>{label}</span></div> }
