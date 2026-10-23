import { useEffect, useRef, useState } from 'react';
import AllionMark from './components/AllionMark';

const REQUESTER_PROFILE_STORAGE_KEY = 'app-usage-monitoring-requester-profile';
// The left panel collapsed to a slim rail (remembered per browser).
const SIDEBAR_STORAGE_KEY = 'allionone-assistant-sidebar-collapsed';
// Recent chats are kept in this browser only (per signed-in user).
const HISTORY_STORAGE_PREFIX = 'allionone-chat-history';
const HISTORY_LIMIT = 30;
const TITLE_LENGTH = 60;

function readStorage(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; the chat keeps working for this visit.
  }
}

// The conversation topic is the first question, trimmed to one line.
function conversationTitle(text) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line;
}

function relativeTime(timestamp) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

// Same drawer icon as the navigation panel's keep-open toggle.
function DrawerIcon({ open }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="16" height="16">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4">
        <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
        <path d="M6 2.75v10.5" />
        {open ? <path d="m10.75 6.25-1.75 1.75 1.75 1.75" /> : <path d="m9 6.25 1.75 1.75L9 9.75" />}
      </g>
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export default function ChatAssistant({ backendBaseUrl, clientId, userEmail = '' }) {
  const historyKey = `${HISTORY_STORAGE_PREFIX}:${userEmail || 'local'}`;
  const [conversations, setConversations] = useState(() => readStorage(historyKey, []));
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState('');
  const [sendingId, setSendingId] = useState(null);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);
  const [requester, setRequester] = useState(() => readStorage(REQUESTER_PROFILE_STORAGE_KEY, { name: '', email: '' }));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStorage(SIDEBAR_STORAGE_KEY, false) === true);
  const messageEndRef = useRef(null);
  const composerRef = useRef(null);

  const active = conversations.find((conversation) => conversation.id === activeId) || null;
  const isSending = sendingId !== null;

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [active?.messages.length, sendingId]);

  useEffect(() => {
    writeStorage(historyKey, conversations.slice(0, HISTORY_LIMIT));
  }, [conversations, historyKey]);

  useEffect(() => {
    writeStorage(REQUESTER_PROFILE_STORAGE_KEY, requester);
  }, [requester]);

  useEffect(() => {
    writeStorage(SIDEBAR_STORAGE_KEY, sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    composerRef.current?.focus();
  }, [activeId]);

  const loadRequests = async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/assistant/requests`, {
        headers: { 'X-Client-Id': clientId },
      });
      if (!response.ok) throw new Error('Unable to load requests');
      const payload = await response.json();
      setRequests(payload.requests || []);
    } catch {
      // The chat remains usable if request history is temporarily unavailable.
    }
  };

  useEffect(() => {
    loadRequests();
  }, [backendBaseUrl, clientId]);

  const updateConversation = (id, change) => {
    setConversations((current) => {
      const target = current.find((conversation) => conversation.id === id);
      if (!target) return current;
      const updated = { ...change(target), updatedAt: Date.now() };
      // Most recently used first.
      return [updated, ...current.filter((conversation) => conversation.id !== id)];
    });
  };

  const sendMessage = async (messageText) => {
    const content = messageText.trim();
    if (!content || isSending) return;

    const userMessage = { role: 'user', content };
    let id = activeId;
    let history = active?.messages || [];
    if (!active) {
      id = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      history = [];
      setConversations((current) => [
        { id, title: conversationTitle(content), messages: [userMessage], createdAt: Date.now(), updatedAt: Date.now() },
        ...current,
      ].slice(0, HISTORY_LIMIT));
      setActiveId(id);
    } else {
      updateConversation(id, (conversation) => ({ ...conversation, messages: [...conversation.messages, userMessage] }));
    }
    const conversation = [...history, userMessage];
    setDraft('');
    setError('');
    setSendingId(id);

    try {
      const response = await fetch(`${backendBaseUrl}/api/assistant/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientId,
        },
        body: JSON.stringify({
          messages: conversation.slice(-10).map(({ role, content: text }) => ({
            role,
            content: text,
          })),
          requester,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Assistant request failed with status ${response.status}`);
      }
      updateConversation(id, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            role: 'assistant',
            content: payload.answer,
            source: payload.source,
            recordsReviewed: payload.recordsReviewed,
            workflow: payload.workflow,
          },
        ],
      }));
      if (payload.workflow) loadRequests();
    } catch (requestError) {
      setError(requestError.message || 'The assistant is temporarily unavailable.');
    } finally {
      setSendingId(null);
    }
  };

  const openConversation = (id) => {
    setActiveId(id);
    setError('');
    setDraft('');
  };

  const deleteConversation = (id) => {
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
    if (id === activeId) setActiveId(null);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage(draft);
  };

  const composerKeys = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(draft);
    }
  };

  return (
    <section className={sidebarCollapsed ? 'assistant-workspace sidebar-collapsed' : 'assistant-workspace'} aria-label="AI license assistant">
      <aside className="assistant-sidebar">
        <div className="assistant-sidebar-top">
          <button
            className="assistant-sidebar-toggle"
            type="button"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
            title={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <DrawerIcon open={!sidebarCollapsed} />
          </button>
        </div>
        {/* Both views stay mounted so the width change animates smoothly: the
            full panel fades out as the rail's New chat button fades in. */}
        <button
          className="assistant-new-chat assistant-new-chat-icon"
          type="button"
          aria-label="New chat"
          title="New chat"
          tabIndex={sidebarCollapsed ? 0 : -1}
          aria-hidden={!sidebarCollapsed}
          onClick={() => openConversation(null)}
          disabled={!active}
        >
          <span aria-hidden="true">+</span>
        </button>
        <div className="assistant-sidebar-full" aria-hidden={sidebarCollapsed} inert={sidebarCollapsed ? '' : undefined}>
        <button className="assistant-new-chat" type="button" onClick={() => openConversation(null)} disabled={!active}>
          <span aria-hidden="true">+</span> New chat
        </button>
        <div className="assistant-history">
          <span>Recent chats</span>
          {conversations.length ? (
            <ul>
              {conversations.map((conversation) => (
                <li key={conversation.id} className={conversation.id === activeId ? 'active' : ''}>
                  <button type="button" className="assistant-history-open" onClick={() => openConversation(conversation.id)}>
                    <strong>{conversation.title}</strong>
                    <small>{relativeTime(conversation.updatedAt)}</small>
                  </button>
                  <button
                    type="button"
                    className="assistant-history-delete"
                    aria-label={`Delete chat: ${conversation.title}`}
                    title="Delete chat"
                    onClick={() => deleteConversation(conversation.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No chats yet. Ask a question to start one.</p>
          )}
        </div>
        <div className="assistant-scope-note">
          <strong>Request workflow</strong>
          <p>Ask for an app in your own words, e.g. “I need access to Postman”. The request goes to the app owner for approval.</p>
        </div>
        <div className="assistant-requester-profile">
          <span>Requester details</span>
          <input
            aria-label="Requester name"
            value={requester.name}
            onChange={(event) => setRequester((current) => ({ ...current, name: event.target.value }))}
            placeholder="Your name"
          />
          <input
            aria-label="Requester work email"
            type="email"
            value={requester.email}
            onChange={(event) => setRequester((current) => ({ ...current, email: event.target.value }))}
            placeholder="you@company.com"
          />
        </div>
        <div className="assistant-request-history">
          <span>Recent requests</span>
          {requests.length ? (
            <ul>
              {requests.map((request) => (
                <li key={request.id}>
                  <strong>{request.requestedApp}</strong>
                  <small>{request.status.replace('_', ' ')}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No requests in this portal session.</p>
          )}
        </div>
        </div>
      </aside>

      {!active ? (
        <div className="assistant-landing">
          <div className="assistant-landing-brand">
            <AllionMark className="assistant-landing-mark" tone="light" />
            <h2>
              <span className="assistant-landing-allion">Allion</span>
              <span className="assistant-landing-one">One</span> AI Assistant
            </h2>
          </div>
          <form className="assistant-launch" onSubmit={handleSubmit}>
            <textarea
              ref={composerRef}
              aria-label="Ask AllionOne AI to start a new chat"
              maxLength={2000}
              placeholder="Ask about license availability, reclaimable licenses, or savings…"
              rows="1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={composerKeys}
            />
            <button aria-label="Start chat" disabled={!draft.trim() || isSending} type="submit">
              <SendIcon />
            </button>
          </form>
        </div>
      ) : (
        <div className="assistant-chat-panel" key={active.id}>
          <div className="assistant-chat-header">
            <div className="assistant-avatar" aria-hidden="true">AI</div>
            <div>
              <h2 title={active.title}>{active.title}</h2>
              <p>
                Started {relativeTime(active.createdAt).toLowerCase()} · {active.messages.length} message{active.messages.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="assistant-header-brand" aria-label="AllionOne AI Assistant">
              <AllionMark className="assistant-header-mark" />
              <span>
                <span className="assistant-header-allion">Allion</span>
                <span className="assistant-header-one">One</span> AI Assistant
              </span>
            </div>
          </div>

          <div className="assistant-messages" aria-live="polite">
            {active.messages.map((message, index) => (
              <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="assistant-message-label">
                  {message.role === 'assistant' ? 'AllionOne AI' : 'You'}
                </div>
                <div className="assistant-message-bubble">
                  {message.content.split('\n').map((line, lineIndex) => (
                    <span key={`${line}-${lineIndex}`}>{line || ' '}</span>
                  ))}
                </div>
                {message.source && (
                  <small className="assistant-message-source">
                    {message.source === 'openai-mcp'
                      ? 'AI Agent answer'
                      : message.source === 'workflow'
                        ? `Workflow request ${message.workflow?.status?.replace('_', ' ') || 'submitted'}`
                      : message.source === 'monitoring-agent-fallback'
                        ? 'Monitoring-agent fallback from live database context'
                        : 'Database summary'}
                    {Number.isFinite(message.recordsReviewed)
                      ? ` · ${message.recordsReviewed} records reviewed`
                      : ''}
                  </small>
                )}
              </div>
            ))}
            {sendingId === active.id && (
              <div className="assistant-message assistant">
                <div className="assistant-message-label">AllionOne AI</div>
                <div className="assistant-typing" aria-label="Assistant is analyzing">
                  <i /><i /><i />
                </div>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>

          {error && <div className="assistant-error">{error}</div>}

          <form className="assistant-composer" onSubmit={handleSubmit}>
            <textarea
              ref={composerRef}
              aria-label="Ask the license assistant"
              disabled={isSending}
              maxLength={2000}
              placeholder="Ask a follow-up…"
              rows="2"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={composerKeys}
            />
            <button disabled={isSending || !draft.trim()} type="submit">
              {isSending ? 'Analyzing…' : 'Send'}
            </button>
          </form>
          <small className="assistant-disclaimer">
            Responses may require verification before procurement or reclamation decisions.
          </small>
        </div>
      )}
    </section>
  );
}
