import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_CATALOG } from '../data/appCatalog';
import AppInventoryIcon from './AppInventoryIcon';

const OTHER = '__other__';
const LIST_MAX_HEIGHT = 320;
const GAP = 4;

// Where the floating list goes: under the field, or above it when there is
// not enough room below (it lives on document.body so cards don't clip it).
function listPosition(button) {
  const rect = button.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - GAP - 8;
  const above = rect.top - GAP - 8;
  const openUp = below < Math.min(LIST_MAX_HEIGHT, 200) && above > below;
  const maxHeight = Math.max(120, Math.min(LIST_MAX_HEIGHT, openUp ? above : below));
  return {
    left: rect.left,
    width: rect.width,
    maxHeight,
    ...(openUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
  };
}

// App Name field for the inventory form: a dropdown of recognised apps (with
// logos) of the chosen type, plus "Other app…" to type any name. Picking an app
// hands its catalog entry to onPick so the form can fill in the detection details.
export default function AppNamePicker({ appType, value, onPick, onTypeName }) {
  const options = useMemo(() => APP_CATALOG.filter((entry) => entry.appType === appType), [appType]);
  const selected = options.find((entry) => entry.appName === value) || null;
  const [custom, setCustom] = useState(Boolean(value) && !selected);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const [position, setPosition] = useState(null);
  const listId = useId();
  const items = options;

  useEffect(() => {
    if (value && !options.some((entry) => entry.appName === value)) setCustom(true);
    if (!value) setCustom(false);
  }, [value, options]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Keep the floating list attached to the field while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return undefined;
    const place = () => setPosition(listPosition(buttonRef.current));
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Keep the highlighted option visible when moving with the arrow keys.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (item) => {
    setOpen(false);
    if (item.id === OTHER) {
      setCustom(true);
      onTypeName('');
      return;
    }
    setCustom(false);
    onPick(item);
  };

  const onKeyDown = (event) => {
    if (!open && ['ArrowDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setActive(Math.max(0, items.findIndex((item) => item.appName === value)));
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(items.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(items[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
  };

  return (
    <div className="app-name-picker" ref={rootRef}>
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
        ) : (
          <span className="app-name-picker-placeholder">{custom ? 'Other app (type the name below)' : 'Select an app'}</span>
        )}
        <span className="app-name-picker-caret" aria-hidden="true">▾</span>
      </button>

      {open && position && createPortal(
        <ul
          ref={listRef}
          className="app-name-picker-list"
          id={listId}
          role="listbox"
          aria-label="Recognised apps"
          style={{ position: 'fixed', ...position }}
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              role="option"
              aria-selected={item.id === OTHER ? custom : item.appName === value}
              className={`app-name-picker-option${index === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => { event.preventDefault(); choose(item); }}
            >
              {item.id === OTHER ? (
                <span className="app-name-picker-other">+</span>
              ) : (
                <AppInventoryIcon appName={item.appName} className="app-name-picker-icon" />
              )}
              <span className="app-name-picker-text">
                <strong>{item.appName}</strong>
                {item.id !== OTHER && <small>{item.processName}{item.parentApp ? ` · in ${item.parentApp}` : ''}</small>}
              </span>
            </li>
          ))}
        </ul>,
        document.body
      )}

      {custom && (
        <input
          className="app-name-picker-custom"
          name="appName"
          placeholder="App name"
          type="text"
          value={value}
          onChange={(event) => onTypeName(event.target.value)}
        />
      )}
    </div>
  );
}
