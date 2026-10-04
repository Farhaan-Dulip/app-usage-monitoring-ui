import { useEffect, useRef, useState } from 'react';

const SUGGESTED_QUESTIONS = [
  'Is there any license available for Postman?',
  'Which licenses can be reclaimed now?',
  'What are the largest monthly savings opportunities?',
  'Summarize the latest license decisions.',
  'Submit a request for a Postman license.',
];

const WELCOME_MESSAGE = {
  role: 'assistant',
  content:
    'Hello! I can analyze license inventory, completed evaluation decisions, and recent usage metrics. What would you like to know?',
};
const REQUESTER_PROFILE_STORAGE_KEY = 'app-usage-monitoring-requester-profile';

function getRequesterProfile() {
  try {
    return JSON.parse(window.localStorage.getItem(REQUESTER_PROFILE_STORAGE_KEY)) || { name: '', email: '' };
  } catch {
    return { name: '', email: '' };
  }
}

export default function ChatAssistant({ backendBaseUrl, clientId }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState([]);
  const [requester, setRequester] = useState(getRequesterProfile);
  const messageEndRef = useRef(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isSending]);

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

  useEffect(() => {
    window.localStorage.setItem(REQUESTER_PROFILE_STORAGE_KEY, JSON.stringify(requester));
  }, [requester]);

  const sendMessage = async (messageText) => {
    const content = messageText.trim();
    if (!content || isSending) return;

    const userMessage = { role: 'user', content };
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    setDraft('');
    setError('');
    setIsSending(true);

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
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: payload.answer,
          source: payload.source,
          recordsReviewed: payload.recordsReviewed,
          workflow: payload.workflow,
        },
      ]);
      if (payload.workflow) loadRequests();
    } catch (requestError) {
      setError(requestError.message || 'The assistant is temporarily unavailable.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendMessage(draft);
  };

  return (
    <section className="assistant-workspace" aria-label="AI license assistant">
      <aside className="assistant-sidebar">
        <div className="assistant-suggestions">
          <span>Try asking</span>
          {SUGGESTED_QUESTIONS.map((question) => (
            <button
              disabled={isSending}
              key={question}
              type="button"
              onClick={() => sendMessage(question)}
            >
              {question}
            </button>
          ))}
        </div>
        <div className="assistant-scope-note">
          <strong>Request workflow</strong>
          <p>Use “Submit a request for a [app] license” to create an approval-pending request.</p>
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
      </aside>

      <div className="assistant-chat-panel">
        <div className="assistant-chat-header">
          <div className="assistant-avatar" aria-hidden="true">AI</div>
          <div>
            <h2>License Intelligence Assistant</h2>
            <p>Ask in plain language about availability, utilization, and savings.</p>
          </div>
          <button
            className="assistant-clear-button"
            type="button"
            onClick={() => {
              setMessages([WELCOME_MESSAGE]);
              setError('');
            }}
          >
            New chat
          </button>
        </div>

        <div className="assistant-messages" aria-live="polite">
          {messages.map((message, index) => (
            <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="assistant-message-label">
                {message.role === 'assistant' ? 'AgentOps AI' : 'You'}
              </div>
              <div className="assistant-message-bubble">
                {message.content.split('\n').map((line, lineIndex) => (
                  <span key={`${line}-${lineIndex}`}>{line || '\u00a0'}</span>
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
          {isSending && (
            <div className="assistant-message assistant">
              <div className="assistant-message-label">AgentOps AI</div>
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
            aria-label="Ask the license assistant"
            disabled={isSending}
            maxLength={2000}
            placeholder="Ask about license availability, reclaimable licenses, or savings…"
            rows="2"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage(draft);
              }
            }}
          />
          <button disabled={isSending || !draft.trim()} type="submit">
            {isSending ? 'Analyzing…' : 'Send'}
          </button>
        </form>
        <small className="assistant-disclaimer">
          Responses may require verification before procurement or reclamation decisions.
        </small>
      </div>
    </section>
  );
}
