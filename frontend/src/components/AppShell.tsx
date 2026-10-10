import { BrainCircuit, CircleHelp, Menu, Sparkles } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { cn } from '../utils/cn'

export function Brand() { return <Link className="brand" to="/"><span><BrainCircuit size={20} /></span>RU<span>Prepped</span></Link> }
export function AppShell({ children }: { children: React.ReactNode }) { return <div className="app-shell"><header className="topbar"><Brand /><nav aria-label="Main navigation"><NavLink to="/setup">Practice</NavLink><a href="#how-it-works">How it works</a><a href="#about">About</a></nav><Link className="nav-cta" to="/setup">Start practicing <Sparkles size={15} /></Link><button className="menu-button" aria-label="Open navigation"><Menu size={20} /></button></header>{children}<footer><Brand /><span>Mock demo — no camera, microphone, or AI services are connected.</span><a href="mailto:team@ruprepped.demo"><CircleHelp size={15} /> Demo support</a></footer></div> }
export function Stepper({ current }: { current: number }) { return <div className="stepper" aria-label={`Step ${current} of 3`}><span className={cn(current >= 1 && 'active')}>1 <i>Setup</i></span><b /><span className={cn(current >= 2 && 'active')}>2 <i>Interview</i></span><b /><span className={cn(current >= 3 && 'active')}>3 <i>Results</i></span></div> }
