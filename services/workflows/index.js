// Workflow definitions: a named list of steps (title, owner, type, detail)
// that a request or a policy violation runs through. Stored one document per
// workflow; each can be downloaded as a .json file from Workflow Management.
// The sample workflows in ./seed load the first time the list is empty.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TRIGGER_TYPES = ['request', 'policy-violation', 'onboarding', 'offboarding'];
export const APPROVER_ROLES = ['app-owner', 'licence-owner', 'manager'];
export const STEP_TYPES = ['raise', 'check', 'approval', 'task', 'notify'];
export const MAX_STEPS = 20;

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), 'seed');

export class WorkflowError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

export function slugify(value) {
  return text(value, 64).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// A clean workflow from user input, or a WorkflowError naming what is wrong.
// Step statuses are runtime state, so a definition always starts not-started.
export function validateWorkflow(input) {
  if (!input || typeof input !== 'object') throw new WorkflowError('A workflow is required');
  const id = text(input.id, 64);
  if (!ID.test(id)) throw new WorkflowError('The workflow id must be 2–64 lowercase letters, numbers or dashes');
  const name = text(input.name, 120);
  if (!name) throw new WorkflowError('Give the workflow a name');
  const triggerType = text(input.trigger?.type, 40);
  if (!TRIGGER_TYPES.includes(triggerType)) throw new WorkflowError(`The trigger must be one of: ${TRIGGER_TYPES.join(', ')}`);
  const approverRole = text(input.approver?.role, 40);
  if (!APPROVER_ROLES.includes(approverRole)) throw new WorkflowError(`The approver must be one of: ${APPROVER_ROLES.join(', ')}`);

  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length === 0) throw new WorkflowError('Add at least one step');
  if (steps.length > MAX_STEPS) throw new WorkflowError(`A workflow can have at most ${MAX_STEPS} steps`);
  const seen = new Set();
  const cleanSteps = steps.map((step, index) => {
    const title = text(step?.title, 120);
    if (!title) throw new WorkflowError(`Step ${index + 1} needs a title`);
    const type = text(step?.type, 20);
    if (!STEP_TYPES.includes(type)) throw new WorkflowError(`Step ${index + 1}: the type must be one of: ${STEP_TYPES.join(', ')}`);
    let stepId = slugify(step?.id || title) || `step-${index + 1}`;
    while (seen.has(stepId)) stepId = `${stepId}-${index + 1}`;
    seen.add(stepId);
    const clean = { id: stepId, title, owner: text(step?.owner, 80), type, status: 'not-started', detail: text(step?.detail, 300) };
    if (type === 'approval') clean.onDecline = 'stop';
    if (type === 'check') clean.onFail = 'stop';
    return clean;
  });

  const workflow = {
    id,
    name,
    version: Number.isInteger(input.version) && input.version > 0 ? input.version : 1,
    trigger: { ...(input.trigger || {}), type: triggerType },
    approver: { ...(input.approver || {}), role: approverRole },
    steps: cleanSteps,
  };
  if (input.rules && typeof input.rules === 'object') workflow.rules = input.rules;
  if (input.notifications && typeof input.notifications === 'object') workflow.notifications = input.notifications;
  return workflow;
}

// The sample workflows shipped with the app.
export function seedWorkflows() {
  return readdirSync(SEED_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => validateWorkflow(JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8'))));
}

const toWorkflow = ({ _id, createdAt, updatedAt, ...workflow }) => ({ ...workflow, updatedAt });

export async function listWorkflows(collection) {
  if ((await collection.countDocuments()) === 0) {
    const now = new Date();
    await collection.insertMany(seedWorkflows().map((workflow) => ({ ...workflow, createdAt: now, updatedAt: now })));
  }
  const docs = await collection.find({}).sort({ name: 1 }).toArray();
  return docs.map(toWorkflow);
}

// Saves a workflow under its id; an existing one gets the next version.
export async function saveWorkflow(collection, input) {
  const workflow = validateWorkflow(input);
  const existing = await collection.findOne({ id: workflow.id });
  const now = new Date();
  const saved = { ...workflow, version: existing ? (existing.version || 1) + 1 : 1, updatedAt: now };
  await collection.updateOne({ id: workflow.id }, { $set: saved, $setOnInsert: { createdAt: now } }, { upsert: true });
  return toWorkflow(saved);
}

export async function deleteWorkflow(collection, id) {
  const result = await collection.deleteOne({ id: text(id, 64) });
  return result.deletedCount > 0;
}
