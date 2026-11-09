import { useState } from 'react';
import CombinedReportPreview from './CombinedReportPreview';
import RenewalSavingsPreview from './RenewalSavingsPreview';
import AiAdoptionPreview from './AiAdoptionPreview';

// Sample prompts under the AI box; each draws its sample report in the chat.
const SAMPLE_PROMPTS = [
  'Generate a combined licence report for apps and AI tools for the last 30 days',
  'Which renewals are coming up and how much can we save by right-sizing before they renew?',
  'How well are our teams adopting AI tools, and which AI seats are going unused?',
];
const REPORTS = {
  combined: CombinedReportPreview,
  renewals: RenewalSavingsPreview,
  'ai-adoption': AiAdoptionPreview,
};
const REPLIES = {
  combined: 'Here is your combined licence report for apps and AI tools over the last 30 days.',
  renewals: 'Here are the renewals due in the next 90 days, and what you save by renewing only the seats people use.',
  'ai-adoption': 'Here is AI adoption across Claude, Codex and GitHub Copilot over the last 30 days.',
};

// Which sample report a prompt asks for, or null for the general reply.
function reportFor(text) {
  if (/adopt/i.test(text)) return 'ai-adoption';
  if (/renew|right-?siz/i.test(text)) return 'renewals';
  if (/(combined|combine|all\s+(apps|licen))/i.test(text) && /report/i.test(text)) return 'combined';
  return null;
}

const TEMPLATES = [
  { id: 'license', name: 'License health', description: 'Seats, spend, active users, and reclaim opportunities.', scope: 'Enterprise applications' },
  { id: 'usage', name: 'Usage review', description: 'Application activity and connected-PC insights.', scope: 'Tracker usage' },
  { id: 'ai', name: 'AI adoption', description: 'AI tool seats, activity, spend, and usage trends.', scope: 'AI tools & agents' },
];

const SECTIONS = ['Summary', 'Seats & cost', 'Usage trends', 'Reclaim opportunities'];

export default function CustomReportBuilder() {
  const [reportName, setReportName] = useState('Monthly license overview');
  const [scope, setScope] = useState('Enterprise applications');
  const [timeframe, setTimeframe] = useState('Last 30 days');
  const [format, setFormat] = useState('PDF');
  const [selectedTemplate, setSelectedTemplate] = useState('license');
  const [sections, setSections] = useState(['Summary', 'Seats & cost', 'Usage trends']);
  const [generated, setGenerated] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [chat, setChat] = useState([]);
  const [thinking, setThinking] = useState(false);

  const chooseTemplate = (template) => {
    setSelectedTemplate(template.id);
    setScope(template.scope);
    setReportName(`${template.name} report`);
    setGenerated(false);
  };

  const toggleSection = (section) => {
    setSections((current) => current.includes(section)
      ? current.filter((item) => item !== section)
      : [...current, section]);
  };

  const sendPrompt = (event) => {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || thinking) return;
    setChat((messages) => [...messages, { role: 'user', text: question }]);
    setPrompt('');
    const report = reportFor(question);
    if (!report) {
      setChat((messages) => [...messages, {
        role: 'assistant',
        text: 'I can help shape this report. Choose a template or adjust the options below, then generate the report when it looks right.',
      }]);
      return;
    }
    // A short wait, so the sample report arrives like a generated one.
    setThinking(true);
    window.setTimeout(() => {
      setChat((messages) => [...messages, { role: 'assistant', text: REPLIES[report], report }]);
      setThinking(false);
    }, 1600);
  };

  return (
    <section className="panel simple-report-builder">
      <div className="panel-header">
        <div>
          <h2>Custom Report Builder</h2>
          <p>Start with a template, tailor the content, then generate your report.</p>
        </div>
      </div>
      <div className={`report-builder-chat ${chat.length > 0 ? 'has-conversation' : ''}`}>
        {chat.length > 0 && (
          <>
            <button className="report-builder-chat-close" type="button" aria-label="Close conversation" onClick={() => setChat([])}>×</button>
            <div className="report-builder-chat-messages" aria-live="polite">
              {chat.map((message, index) => (
                <div className={`report-builder-chat-message ${message.role}${message.report ? ' has-report' : ''}`} key={`${message.role}-${index}`}>
                  <span className="report-builder-chat-avatar" aria-label={message.role === 'user' ? 'You' : 'AI assistant'}>
                    {message.role === 'user' ? 'U' : 'AI'}
                  </span>
                  <div className="report-builder-chat-body">
                    <p>{message.text}</p>
                    {message.report && REPORTS[message.report] && (() => {
                      const Report = REPORTS[message.report];
                      return <Report />;
                    })()}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="report-builder-chat-message assistant">
                  <span className="report-builder-chat-avatar" aria-label="AI assistant">AI</span>
                  <p>Generating your report…</p>
                </div>
              )}
            </div>
          </>
        )}
        <form className="report-builder-chat-form" onSubmit={sendPrompt}>
          <textarea
            aria-label="Ask AI about your report"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask AI to build a report…"
            rows="1"
          />
          <button type="submit" aria-label="Send prompt">↑</button>
        </form>
        <div className="report-builder-sample-prompts">
          <span>Try:</span>
          {SAMPLE_PROMPTS.map((sample) => (
            <button key={sample} type="button" onClick={() => setPrompt(sample)}>{sample}</button>
          ))}
        </div>
      </div>
      <div className="simple-report-template-grid">
        {TEMPLATES.map((template) => (
          <button
            className={`simple-report-template ${selectedTemplate === template.id ? 'active' : ''}`}
            key={template.id}
            type="button"
            onClick={() => chooseTemplate(template)}
          >
            <strong>{template.name}</strong>
            <span>{template.description}</span>
          </button>
        ))}
      </div>
      <form
        className="simple-report-builder-form"
        onSubmit={(event) => {
          event.preventDefault();
          setGenerated(true);
        }}
      >
        <label className="filter-control">
          <span>Report name</span>
          <input value={reportName} onChange={(event) => setReportName(event.target.value)} />
        </label>
        <label className="filter-control">
          <span>Include data from</span>
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option>Enterprise applications</option>
            <option>AI tools & agents</option>
            <option>Tracker usage</option>
          </select>
        </label>
        <label className="filter-control">
          <span>Timeframe</span>
          <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
          </select>
        </label>
        <label className="filter-control">
          <span>Export format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value)}>
            <option>PDF</option>
            <option>Excel</option>
            <option>CSV</option>
          </select>
        </label>
        <fieldset className="simple-report-sections">
          <legend>Include sections</legend>
          <div>
            {SECTIONS.map((section) => (
              <label key={section}>
                <input checked={sections.includes(section)} type="checkbox" onChange={() => toggleSection(section)} />
                <span>{section}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="report-select-button" type="submit">Generate report</button>
      </form>
      {generated && <p className="simple-report-builder-status">{reportName || 'Custom report'} is ready as a {format} for {scope.toLowerCase()} over the {timeframe.toLowerCase()}.</p>}
    </section>
  );
}
