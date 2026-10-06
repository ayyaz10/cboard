import { useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Card, Panel } from '../ui/Card.jsx';
import { Badge } from '../ui/Badge.jsx';
import { FileUpload } from '../ui/FileUpload.jsx';
import { FormField } from '../ui/FormField.jsx';
import { PageHeader, SectionHeader } from '../ui/PageHeader.jsx';
import { Tabs } from '../ui/Tabs.jsx';
import { useTheme } from '../../contexts/ThemeContext.jsx';

const colorTokens = ['--color-bg', '--color-surface', '--color-surface-raised', '--color-border', '--color-text', '--color-text-secondary', '--color-accent', '--color-success', '--color-warning', '--color-danger', '--color-info', '--chart-primary', '--chart-secondary', '--chart-tertiary'];

export function ThemePreview() {
  const { theme, themes } = useTheme();
  const [tab, setTab] = useState('controls');
  const [value, setValue] = useState('');
  const [testOverride, setTestOverride] = useState(false);
  function toggleTestOverride() {
    const root = document.documentElement;
    if (testOverride) {
      ['--color-accent', '--color-accent-hover', '--color-accent-active', '--color-accent-soft', '--color-focus', '--radius-card', '--radius-panel', '--radius-button'].forEach(token => root.style.removeProperty(token));
    } else {
      root.style.setProperty('--color-accent', '#a855f7');
      root.style.setProperty('--color-accent-hover', '#c084fc');
      root.style.setProperty('--color-accent-active', '#9333ea');
      root.style.setProperty('--color-accent-soft', '#f3e8ff');
      root.style.setProperty('--color-focus', '#a855f7');
      root.style.setProperty('--radius-card', '20px');
      root.style.setProperty('--radius-panel', '20px');
      root.style.setProperty('--radius-button', '20px');
    }
    setTestOverride(!testOverride);
  }
  return <main className="theme-preview page-shell mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
    <PageHeader eyebrow="Developer preview" title="Theme & component preview" description={`Shared UI primitives with the ${themes.find(item => item.id === theme)?.name || theme} tokens.`} actions={<label>Theme <select className="ui-control" value={theme} onChange={event => document.dispatchEvent(new CustomEvent('cboard-theme-preview', { detail: event.target.value }))}>{themes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>} />
    <Panel className="grid gap-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Temporary purple accent and 20px radius override for architecture checks.</p><Button variant={testOverride ? 'danger' : 'secondary'} onClick={toggleTestOverride}>{testOverride ? 'Clear test override' : 'Apply test override'}</Button></div>
      <SectionHeader title="Palette" description="Computed semantic tokens from the active theme." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{colorTokens.map(token => <div key={token} className="ui-token-swatch"><span style={{ background: `var(${token})` }} /><code>{token}</code><small>{getComputedStyle(document.documentElement).getPropertyValue(token).trim()}</small></div>)}</div>
    </Panel>
    <Panel className="grid gap-5 p-5">
      <Tabs ariaLabel="Preview groups" value={tab} onChange={setTab} items={[{ value: 'controls', label: 'Controls' }, { value: 'feedback', label: 'Feedback' }, { value: 'data', label: 'Data display' }]} />
      {tab === 'controls' && <div className="grid gap-5 sm:grid-cols-2"><div className="flex flex-wrap items-start gap-2"><Button variant="primary">Primary</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button></div><div className="grid gap-3"><FormField label="Text field" htmlFor="preview-input" help="Focus, placeholder and disabled styles use tokens."><input id="preview-input" className="ui-control" value={value} onChange={event => setValue(event.target.value)} placeholder="Type to preview" /></FormField><label><input type="checkbox" defaultChecked /> Checkbox</label><label><input type="radio" name="preview-radio" defaultChecked /> Radio</label><FileUpload accept="image/*">Choose a file</FileUpload></div></div>}
      {tab === 'feedback' && <div className="flex flex-wrap gap-2"><Badge>Neutral</Badge><Badge variant="accent">Accent</Badge><Badge variant="success">Success</Badge><Badge variant="warning">Warning</Badge><Badge variant="danger">Danger</Badge><Badge variant="info">Info</Badge></div>}
      {tab === 'data' && <Card className="grid gap-3 p-4"><SectionHeader title="Metric card" description="Surface, geometry and typography respond to theme tokens." actions={<Badge variant="success">On track</Badge>} /><strong className="text-3xl">£1,284.50</strong><progress value="68" max="100" /></Card>}
    </Panel>
  </main>;
}
