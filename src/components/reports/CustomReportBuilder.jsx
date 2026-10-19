import { useState } from 'react';

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
    if (!question) return;
    setChat((messages) => [...messages, { role: 'user', text: question }, {
      role: 'assistant',
      text: 'I can help shape this report. Choose a template or adjust the options below, then generate the report when it looks right.',
    }]);
    setPrompt('');
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
                <div className={`report-builder-chat-message ${message.role}`} key={`${message.role}-${index}`}>
                  <span className="report-builder-chat-avatar" aria-label={message.role === 'user' ? 'You' : 'AI assistant'}>
                    {message.role === 'user' ? 'U' : 'AI'}
                  </span>
                  <p>{message.text}</p>
                </div>
              ))}
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
