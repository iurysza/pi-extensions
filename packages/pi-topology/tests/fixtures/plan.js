export const meta = {
  name: 'plan',
  description: 'Lead writes the Markdown plan, oracle challenges it until approved, scribe writes the HTML explainer',
  whenToUse: 'Before building anything non-trivial. Stops for Iury to approve the plan.',
  phases: [{ title: 'Plan' }, { title: 'Challenge' }, { title: 'Explain' }],
}

// args: { task: string, slug: string, dir?: string, rounds?: number }
const task = args?.task
const slug = args?.slug
if (!task || !slug) throw new Error('plan needs args.task and args.slug')
const dir = args?.dir ?? '.'
const maxRounds = args?.rounds ?? 3
const out = `ai-artifacts/workflows/${slug}`

const VERDICT = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    feedback: { type: 'string', description: 'What must change, or why it is approved' },
  },
  required: ['approved', 'feedback'],
}

phase('Plan')
let summary = await agent(
  `Project directory: ${dir}\nWrite your Markdown plan files in: ${out}/\n\nTask:\n${task}`,
  { agentType: 'lead', label: 'lead:draft' },
)
if (summary === null) throw new Error('lead failed to draft a plan')

let verdict = null
for (let round = 1; round <= maxRounds; round++) {
  phase('Challenge')
  verdict = await agent(
    `Project directory: ${dir}\nTask:\n${task}\n\nThe lead's plan is in ${out}/. Lead's summary:\n${summary}\n\n` +
      'Read the plan files and the relevant code. Look for drift from the task, hidden assumptions, missing tests and risky steps. ' +
      'Approve only if it is ready to build.',
    { agentType: 'oracle', label: `oracle:round-${round}`, schema: VERDICT },
  )
  if (verdict === null) throw new Error(`oracle failed in round ${round}`)
  log(`round ${round}: ${verdict.approved ? 'approved' : 'changes requested'}`)
  if (verdict.approved || round === maxRounds) break

  phase('Plan')
  const revised = await agent(
    `Project directory: ${dir}\nYour plan files are in ${out}/. Revise them in place using this oracle feedback:\n${verdict.feedback}`,
    { agentType: 'lead', label: `lead:revise-${round}` },
  )
  if (revised === null) throw new Error(`lead failed to revise in round ${round}`)
  summary = revised
}

phase('Explain')
const status = verdict.approved
  ? `Approved by the oracle. ${verdict.feedback}`
  : `Not approved after ${maxRounds} rounds. Open concerns: ${verdict.feedback}`
await agent(
  `Read the plan files in ${out}/ and the code they reference in ${dir}. Write ${out}/plan.html: a visual explainer for Iury to review and approve before anything is built.\n\n` +
    `Oracle status, show it prominently at the top: ${status}\n\nTask:\n${task}`,
  { agentType: 'scribe', label: 'scribe:explainer' },
)

return { approved: verdict.approved, oracle: verdict.feedback, planDir: out, explainer: `${out}/plan.html`, summary }
