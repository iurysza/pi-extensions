export const meta = {
  name: 'build',
  description: 'Coder builds an approved plan, two reviewers and the oracle agree fixes, a fresh coder applies them, QA proves it; reruns on QA failure',
  whenToUse: 'After Iury approves a plan produced by the plan workflow.',
  phases: [{ title: 'Build' }, { title: 'Review' }, { title: 'Agree' }, { title: 'Fix' }, { title: 'QA' }, { title: 'Report' }],
}

// args: { slug: string, dir?: string, checks?: string, retries?: number }
const slug = args?.slug
if (!slug) throw new Error('build needs args.slug (same as the plan run)')
const dir = args?.dir ?? '.'
const checks = args?.checks ?? 'the project check and test scripts in package.json'
const maxAttempts = 1 + (args?.retries ?? 2)
const out = `ai-artifacts/workflows/${slug}`
const planFile = `the plan files in ${out}/`

const FIXES = {
  type: 'object',
  properties: {
    fixes: { type: 'string', description: 'Numbered list of agreed fixes with file:line and the change' },
    dropped: { type: 'string', description: 'Findings rejected and why' },
  },
  required: ['fixes', 'dropped'],
}
const QA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    report: { type: 'string', description: 'Evidence for every check: command and output, or browser steps and result' },
  },
  required: ['passed', 'report'],
}

const history = []
let qa = null
let attempt = 0

while (attempt < maxAttempts) {
  attempt++
  const tag = `a${attempt}`
  const retryNote = qa
    ? `\n\nThis is attempt ${attempt}. The previous attempt's changes are already in the working tree. QA failed with this report; fix the causes:\n${qa.report}`
    : ''

  phase('Build')
  const built = await agent(
    `Project directory: ${dir}\nRead the approved plan at ${planFile} and implement it.${retryNote}\n\nRun ${checks} before you finish. List the files you changed.`,
    { agentType: 'coder', label: `coder:${tag}` },
  )
  if (built === null) { history.push({ attempt, failed: 'coder' }); break }

  const reviews = await parallel([
    () => agent(
      `Project directory: ${dir}\nPlan: ${planFile}\nCoder summary:\n${built}\n\nReview the change for CORRECTNESS: bugs, unhandled failures, invalid states, missing tests. Use git diff.`,
      { agentType: 'reviewer', label: `reviewer-a:${tag}`, phase: 'Review' },
    ),
    () => agent(
      `Project directory: ${dir}\nPlan: ${planFile}\nCoder summary:\n${built}\n\nReview the change for DESIGN and FIT: does it match the plan and the codebase conventions, are names clear, is it the simplest change? Use git diff.`,
      { agentType: 'reviewer', label: `reviewer-b:${tag}`, phase: 'Review' },
    ),
  ])

  phase('Agree')
  const agreed = await agent(
    `Project directory: ${dir}\nApproved plan: ${planFile}\n\nTwo reviewers looked at the same change.\n\nReviewer A:\n${reviews[0] ?? '(failed)'}\n\nReviewer B:\n${reviews[1] ?? '(failed)'}\n\n` +
      'Merge their findings. Keep what is real and in scope of the plan; drop the rest with a reason. Resolve conflicts against the plan.',
    { agentType: 'oracle', label: `oracle:${tag}`, schema: FIXES },
  )

  phase('Fix')
  const fixed = await agent(
    `Project directory: ${dir}\nApproved plan: ${planFile}\nThe change is already in the working tree. Apply ONLY these agreed fixes:\n${agreed?.fixes ?? '(oracle failed: re-check the reviews yourself)\n' + reviews.join('\n\n')}\n\nRun ${checks} before you finish.`,
    { agentType: 'coder', label: `fresh-coder:${tag}` },
  )

  phase('QA')
  qa = await agent(
    `Project directory: ${dir}\nApproved plan: ${planFile}\nRun ${checks}, then test the changed behaviour by hand. Decide pass or fail against the plan.`,
    { agentType: 'qa', label: `qa:${tag}`, schema: QA },
  )
  history.push({ attempt, built, reviews, agreed, fixed, qa })
  log(`attempt ${attempt}: QA ${qa?.passed ? 'passed' : 'failed'}`)
  if (qa?.passed) break
  if (qa === null) qa = { passed: false, report: 'QA agent failed to report.' }
}

phase('Report')
const passed = qa?.passed === true
const summary = history.map((h) =>
  `## Attempt ${h.attempt}\n` + (h.failed ? `Failed at ${h.failed}.` :
    `### Coder\n${h.built}\n### Reviewer A\n${h.reviews[0]}\n### Reviewer B\n${h.reviews[1]}\n### Agreed fixes\n${h.agreed?.fixes}\n### Dropped\n${h.agreed?.dropped}\n### Fresh coder\n${h.fixed}\n### QA (${h.qa?.passed ? 'pass' : 'fail'})\n${h.qa?.report}`),
).join('\n\n')

await agent(
  (passed ? `QA passed. First update the project docs in ${dir} that this change affects. Then write` : `QA did NOT pass after ${attempt} attempts. Do not update project docs. Write`) +
    ` ${out}/run-report.html: a report of this build run for Iury. Show the outcome at the top (${passed ? 'PASSED' : 'FAILED'}), then the plan, each attempt, review findings and which were fixed, QA evidence, and anything left open.\n\nPlan file: ${planFile}\n\nRun log:\n${summary}`,
  { agentType: 'scribe', label: 'scribe:report' },
)

return { passed, attempts: attempt, report: `${out}/run-report.html`, qa: qa?.report }
