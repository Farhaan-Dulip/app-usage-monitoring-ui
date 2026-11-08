// Sample-data replies for the AI assistant. They run only when Sample data is
// on, and never call the server. Asking about a project's tools and access gets
// a tech-stack answer that asks whether to proceed; a yes starts the sample
// project-access request and shows its workflow in an embedded frame.

export const PROJECT_EMBED = 'project-access';

// '## ' is a topic and '### ' a sub-topic; '- ' is a bullet.
const PROJECT_ANSWER = [
  '## Payments integrations project',
  'The project uses this tech stack:',
  '',
  '### Tech stack',
  '- Node.js API on AWS',
  '- Stripe for payment processing',
  '- PostgreSQL for storage',
  '- Postman to test the APIs',
  '- GitHub Copilot for development',
  '',
  '### Tools and access you need',
  '- GitHub Copilot licence',
  '- VS Code Enterprise edition',
  '',
  '### Next step',
  'Do you want to proceed with requesting these?',
].join('\n');

const PROJECT_SUBMITTED = [
  'Your request has been initiated.',
  '',
  'Please visit Allion One for tracking the live process.',
].join('\n');

export function isProjectAccessPrompt(text) {
  const asksAboutProject = /payments?/i.test(text) && /(integration|project)/i.test(text);
  const asksAboutAccess = /(tool|app|licen[cs]e|access|necessary)/i.test(text);
  return asksAboutProject && asksAboutAccess;
}

export function isYes(text) {
  return /^\s*(yes|yep|yeah|y|sure|ok|okay|proceed|go ahead)\b/i.test(text);
}

// Each prompt the Request workflow offers, with its sample reply.
export const UNUSED_PROMPT = 'Which licences am I paying for that nobody uses?';
export const RECLAIM_REASON_PROMPT = 'Why was my Claude seat flagged for reclaim?';
export const SAVINGS_PROMPT = 'How much can we save this month?';
export const VSCODE_PROMPT = 'I need license for VS Code Enterprise app';

export const VSCODE_EMBED = 'vscode-access';

const VSCODE_ASK = [
  'This needs a request to be initiated for VS Code Enterprise edition, which goes to the app owner for approval.',
  '',
  'Do you want me to start the request?',
].join('\n');

const VSCODE_SUBMITTED = [
  'Your request has been initiated.',
  '',
  'Please visit Allion One for tracking the live process.',
].join('\n');

export function isVsCodePrompt(text) {
  return /vs\s*code/i.test(text) && /(licen[cs]e|access|need)/i.test(text);
}

const UNUSED_ANSWER = [
  '## Licences nobody is using',
  'Four seats have almost no use over the last 30 days. Each one is flagged for an owner to approve a reclaim.',
  '',
  '### Flagged seats',
  '- Claude on SAMPLE-ENG-07: 1.2 hours active, $25 a month',
  '- Claude on SAMPLE-ENG-03: no use in 30 days, $25 a month',
  '- Postman on SAMPLE-QA-01: last used 26 days ago',
  '- Codex on SAMPLE-SALES-01: no sign-in recorded',
  '',
  '### Next step',
  'Do you want to start the reclaim for these seats?',
].join('\n');

const RECLAIM_REASON_ANSWER = [
  '## Why your Claude seat was flagged',
  'Your Claude seat on SAMPLE-ENG-07 fell below the Claude usage policy, so the system asked for a reclaim.',
  '',
  '### Policy rules checked (last 30 days)',
  '- Active time: 1.2 hours, needs at least 8 hours (not met)',
  '- Claude Code use: last used 41 days ago, needs within 7 days (not met)',
  '- Sign-in: signed in 12 days ago, needs within 30 days (met)',
  '',
  '### What happens next',
  'Three alerts were sent with a request for a business justification, and none came back. Your manager, Maya Fernando, now decides whether to reclaim the seat.',
  '',
  'If you still need Claude, reply with a business justification and it goes back for review.',
].join('\n');

const SAVINGS_ANSWER = [
  '## Savings this month',
  'The flagged seats can save about $325 a month if their owners approve a reclaim.',
  '',
  '### Where it comes from',
  '- Claude: $325 a month across the flagged seats',
  '- Postman and Codex: flagged seats, not yet priced; they add to this total once the owners approve',
  '',
  '### Next step',
  'Do you want me to open the reclaim requests for the owners to approve?',
].join('\n');

export function isUnusedPrompt(text) {
  return /(nobody uses|not using|paying for|unused)/i.test(text) && /licen[cs]e/i.test(text);
}

export function isReclaimReasonPrompt(text) {
  return /why/i.test(text) && /(flagged|reclaim)/i.test(text);
}

export function isSavingsPrompt(text) {
  return /(save|saving|savings)/i.test(text) && /(month|this month)/i.test(text);
}

// The assistant reply for a sample-data message, or null to use the server.
export function mockAssistantReply(text, history) {
  const lastAssistant = [...history].reverse().find((message) => message.role === 'assistant');
  if (lastAssistant?.awaitingProjectConfirm && isYes(text)) {
    return { role: 'assistant', content: PROJECT_SUBMITTED, source: 'mock', embed: PROJECT_EMBED };
  }
  if (lastAssistant?.awaitingVsCodeConfirm && isYes(text)) {
    return { role: 'assistant', content: VSCODE_SUBMITTED, source: 'mock', embed: VSCODE_EMBED };
  }
  if (isProjectAccessPrompt(text)) {
    return { role: 'assistant', content: PROJECT_ANSWER, source: 'mock', format: 'rich', awaitingProjectConfirm: true };
  }
  if (isReclaimReasonPrompt(text)) {
    return { role: 'assistant', content: RECLAIM_REASON_ANSWER, source: 'mock', format: 'rich' };
  }
  if (isUnusedPrompt(text)) {
    return { role: 'assistant', content: UNUSED_ANSWER, source: 'mock', format: 'rich' };
  }
  if (isSavingsPrompt(text)) {
    return { role: 'assistant', content: SAVINGS_ANSWER, source: 'mock', format: 'rich' };
  }
  if (isVsCodePrompt(text)) {
    return { role: 'assistant', content: VSCODE_ASK, source: 'mock', awaitingVsCodeConfirm: true };
  }
  return null;
}
