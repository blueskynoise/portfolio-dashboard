/**
 * Site copy.
 *
 * Professional experience here restates what the site's owner has said
 * about his own work. It names no employer, date or metric, because none
 * was supplied, and it must stay that way unless he supplies them.
 *
 * Three things are kept strictly apart throughout the site:
 *   - professional work (this file)
 *   - independent projects (projects.ts)
 *   - the synthetic company used in the case study (packages/analytics)
 */

export const profile = {
  name: 'Mark Graziano',
  headline: 'I build the systems that turn security data into decisions.',
  intro:
    'I work where security engineering, data analytics and automation meet: connecting fragmented systems, making security programmes measurable, and building the workflows that let an organisation act on what the data shows.',
  email: 'hello@markgraziano.com',
  github: 'https://github.com/blueskynoise',
};

export const capabilities = [
  {
    title: 'Security engineering',
    body: 'Integrations, automation and operational workflows that keep working when an API rate-limits, a token expires or a scanner returns nothing.',
    proof: { label: 'You came in through one', to: '/access' },
  },
  {
    title: 'Security data intelligence',
    body: 'Turning scattered findings, tickets and ownership records into an honest picture of a programme: what changed, why, and whether the fix worked.',
    proof: { label: 'Work through a case', to: '/program' },
  },
  {
    title: 'Product engineering',
    body: 'Software people choose to use. Internal tools deserve the same care as consumer products, and I build both.',
    proof: { label: 'See the projects', to: '/#projects' },
  },
];

export const career = {
  title: 'From GRC to security automation engineering',
  lede:
    'I started in governance, risk and compliance, and led that work. Running a security programme teaches you exactly where it leaks time: the evidence gathered by hand, the questionnaire answered for the fortieth time, the finding that sits because nobody knows whose it is.',
  turn:
    'I kept fixing those with engineering rather than process, often enough that it became the job: a dedicated security automation engineering role. I did not leave governance behind to become an engineer. Knowing what a control is for is how I know what is worth building.',
};

export interface Example {
  title: string;
  problem: string;
  built: string;
  tools: string[];
}

export const examples: Example[] = [
  {
    title: 'Customer security questions, self-served',
    problem: 'Sharing security information with customers was a slow, manual response process: each request waited on a person.',
    built: 'I saw that it could be automated, and implemented SafeBase with the automation around it, so customers get what they need themselves.',
    tools: ['SafeBase'],
  },
  {
    title: 'Secrets: from detection to fix without the chasing',
    problem: 'A leaked secret is only handled once someone finds it, works out whose it is, opens a ticket and follows up. Each hand-off is a place for it to stall.',
    built: 'An end-to-end process connecting secret detection, findings, ticket creation and remediation workflows, with minimal manual coordination.',
    tools: ['TruffleHog'],
  },
  {
    title: 'Security data that leadership could use',
    problem: 'The facts about the programme lived in separate systems that did not agree with each other, so reporting meant reconciling exports by hand.',
    built: 'I connected the sources, modelled and transformed their data, and built reporting that gave leadership a more useful view of the programme.',
    tools: ['CloudQuery', 'dbt', 'S3 + Athena', 'Superset', 'Wiz', 'Snyk', 'Backstage'],
  },
  {
    title: 'Operations that run themselves, reliably',
    problem: 'Routine security operations depended on people remembering to do them, and on moving information between tools by hand.',
    built: 'Integrations and workflows that reduced the manual effort and made existing security processes more reliable.',
    tools: ['Tines', 'Jira', 'Proofpoint', 'Workday', 'Okta'],
  },
];

/** What each tool was for, in the data work above. Roles only; no claims about scale. */
export const stack = [
  { stage: 'Collect', tools: 'CloudQuery', role: 'Cloud and infrastructure data collection.' },
  { stage: 'Findings', tools: 'Wiz, Snyk', role: 'Security findings from cloud and code.' },
  { stage: 'Ownership', tools: 'Backstage', role: 'Which team owns which service.' },
  { stage: 'Store and query', tools: 'S3, Athena', role: 'Security data storage and querying.' },
  { stage: 'Model', tools: 'dbt', role: 'Transformation and modelling.' },
  { stage: 'Report', tools: 'Superset', role: 'Security analytics and dashboards.' },
  { stage: 'Act', tools: 'Tines, Jira', role: 'Automation and workflow integration.' },
];
