import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AppInventoryIcon from './AppInventoryIcon';

export default function InventoryAppPicker({ apps, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const [position, setPosition] = useState(null);
  const selected = apps.find((app) => app.id === value);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) return undefined;
    const place = () => {
      const rect = buttonRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const openUp = below < Math.min(320, Math.max(160, apps.length * 52)) && above > below;
      setPosition({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(120, Math.min(320, openUp ? above : below)),
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, apps.length]);

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (app) => {
    onChange(app.id);
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (!open && ['ArrowDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setActive(Math.max(0, apps.findIndex((app) => app.id === value)));
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(apps.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && apps[active]) {
      event.preventDefault();
      choose(apps[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="app-name-picker inventory-app-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="app-name-picker-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="App name"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        {selected ? (
          <>
            <AppInventoryIcon appName={selected.appName} className="app-name-picker-icon" />
            <span>{selected.appName}</span>
          </>
        ) : <span className="app-name-picker-placeholder">Select inventory app</span>}
        <span className="app-name-picker-caret" aria-hidden="true">▾</span>
      </button>
      {open && position && createPortal(
        <ul
          ref={listRef}
          className="app-name-picker-list"
          id={listId}
          role="listbox"
          aria-label="Inventory apps"
          style={{ position: 'fixed', ...position }}
        >
          {apps.map((app, index) => (
            <li
              key={app.id}
              role="option"
              aria-selected={app.id === value}
              className={`app-name-picker-option${index === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); choose(app); }}
            >
              <AppInventoryIcon appName={app.appName} className="app-name-picker-icon" />
              <span className="app-name-picker-text">
                <strong>{app.appName}</strong>
                <small>{app.processName}</small>
              </span>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
