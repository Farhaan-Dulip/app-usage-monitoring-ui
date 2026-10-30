import { useEffect, useId, useRef, useState } from 'react';

export const LICENSE_SCOPES = [
  { id: 'all', label: 'All', description: 'Every end user license, apps and AI tools' },
  { id: 'apps', label: 'End User Apps License', description: 'Apps such as Postman, Zoom and VS Code' },
  { id: 'ai', label: 'AI Licenses', description: 'AI tools and agents, with vendor seats and spend' },
];

// Which end user licenses the page shows: a button that opens a short list.
export default function LicenseScopePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const listId = useId();
  const selected = LICENSE_SCOPES.find((scope) => scope.id === value) || LICENSE_SCOPES[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (scope) => {
    onChange(scope.id);
    setOpen(false);
  };

  const openList = () => {
    setActive(Math.max(0, LICENSE_SCOPES.findIndex((scope) => scope.id === selected.id)));
    setOpen(true);
  };

  const onKeyDown = (event) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % LICENSE_SCOPES.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index - 1 + LICENSE_SCOPES.length) % LICENSE_SCOPES.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(LICENSE_SCOPES[active]);
    }
  };

  return (
    <div className="license-scope" ref={rootRef}>
      <span className="license-scope-label" id={`${listId}-label`}>Showing</span>
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${listId}-label ${listId}-value`}
        className={open ? 'license-scope-button open' : 'license-scope-button'}
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span id={`${listId}-value`}>{selected.label}</span>
        <svg aria-hidden="true" className="license-scope-chevron" viewBox="0 0 16 16">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </button>
      {open && (
        <ul className="license-scope-menu" id={listId} role="listbox" aria-labelledby={`${listId}-label`}>
          {LICENSE_SCOPES.map((scope, index) => (
            <li
              aria-selected={scope.id === selected.id}
              className={[
                'license-scope-option',
                index === active ? 'active' : '',
                scope.id === selected.id ? 'selected' : '',
              ].join(' ')}
              key={scope.id}
              role="option"
              onClick={() => choose(scope)}
              onMouseEnter={() => setActive(index)}
            >
              <span>
                <strong>{scope.label}</strong>
                <small>{scope.description}</small>
              </span>
              {scope.id === selected.id && (
                <svg aria-hidden="true" className="license-scope-check" viewBox="0 0 16 16">
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
