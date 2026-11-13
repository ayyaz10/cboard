import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ReminderStore } from '../../../src/features/focusTimer/ReminderProvider.jsx';
import { ScrollControls } from '../../../src/components/layout/ScrollControls.jsx';
import '../../../src/styles/index.css';
import '../../../src/styles/design-tokens.css';
import '../../../src/styles/shared-ui.css';
import '../../../src/styles/danger-actions.css';
import '../../../src/styles/midnight.css';

function ReminderHarness() {
  const modal = useRef(null);
  return <main className="page-shell min-h-screen px-4 pb-6 sm:px-6 lg:px-8">
    <div className="page-shell-layout mx-auto flex max-w-6xl flex-col gap-4">
      <header className="panel p-5"><h1 className="text-2xl font-bold">Reminder positioning QA</h1>
        <button className="ui-button mt-4" type="button" onClick={() => modal.current?.showModal()}>Open sample modal</button>
      </header>
      <section className="panel p-5" style={{ minHeight: '1800px' }} aria-label="Long page content">
        <h2 className="text-xl font-bold">Page content</h2>
        <p className="mt-2">The reminder tray must stay in the viewport while this page scrolls.</p>
      </section>
      <ScrollControls />
    </div>
    <dialog ref={modal} className="ui-dialog p-5" aria-labelledby="sample-modal-title" style={{ width: 'min(26rem, calc(100vw - 2rem))' }}>
      <h2 id="sample-modal-title" className="text-xl font-bold">Sample modal</h2>
      <button className="ui-button mt-4" type="button" onClick={() => modal.current?.close()}>Close sample modal</button>
    </dialog>
  </main>;
}

createRoot(document.getElementById('root')).render(
  <ReminderStore userId="qa-user"><ReminderHarness /></ReminderStore>,
);