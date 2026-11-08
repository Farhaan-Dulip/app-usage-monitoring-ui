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
  '- GitHub Copilot licence (not held yet)',
  '- Postman licence (already held)',
  '- The Allion One tracker on your PC',
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

// The assistant reply for a sample-data message, or null to use the server.
export function mockAssistantReply(text, history) {
  const lastAssistant = [...history].reverse().find((message) => message.role === 'assistant');
  if (lastAssistant?.awaitingProjectConfirm && isYes(text)) {
    return { role: 'assistant', content: PROJECT_SUBMITTED, source: 'mock', embed: PROJECT_EMBED };
  }
  if (isProjectAccessPrompt(text)) {
    return { role: 'assistant', content: PROJECT_ANSWER, source: 'mock', format: 'rich', awaitingProjectConfirm: true };
  }
  return null;
}
