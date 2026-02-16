import { useState } from 'react'
import './CollapsiblePanel.css'

interface CollapsiblePanelProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}

export function CollapsiblePanel({ title, children, defaultOpen = true }: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="collapsible-panel">
      <div className="collapsible-panel-header" onClick={() => setOpen(!open)}>
        <span className="collapsible-panel-title">{title}</span>
        <span className={`collapsible-panel-chevron${open ? ' open' : ''}`}>▸</span>
      </div>
      <div className={`collapsible-panel-body${open ? ' open' : ''}`}>
        {children}
      </div>
    </div>
  )
}
