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
    'I connect fragmented security systems, make programs measurable, and build the automation that lets an organization act on what the data shows.',
  email: 'hello@markgraziano.com',
  github: 'https://github.com/blueskynoise',
};

/**
 * Facts a reader can check, and nothing else: the career path as the owner describes it, the tools he names,
 * the projects linked below, and this site's own source. No employers, dates or figures.
 */
export const credentials = [
  { label: 'Background', value: 'GRC leadership, then a dedicated security automation engineering role' },
  { label: 'Builds with', value: 'CloudQuery · dbt · Athena · Superset · Tines · Jira' },
  { label: 'Independent work', value: 'Three software products and a podcast' },
  { label: 'This site', value: 'A working access gateway. Open source, with tests.' },
];

/** How the site itself demonstrates each capability. One line each. */
export const proof = [
  {
    capability: 'Security engineering',
    title: 'Policy as code',
    body: 'The gate you came through is a versioned, pure function. It returns reason codes. There is no risk score.',
    link: { label: 'Read the policy', to: '/access' },
  },
  {
    capability: 'Security data intelligence',
    title: 'Provenance on everything',
    body: 'Every signal and every sentence says how it was obtained and how far it can be trusted.',
    link: { label: 'See it in the case study', to: '/program' },
  },
  {
    capability: 'Product engineering',
    title: 'Privacy by design',
    body: 'Addresses stored truncated, fingerprinting opt-in and deletable, records removed on a schedule.',
    link: { label: 'What was collected', to: '/access' },
  },
];

export const career = {
  title: 'From GRC to security automation engineering',
  lede:
    'I started in governance, risk and compliance, and led that work. Running a security program teaches you exactly where it leaks time: the evidence gathered by hand, the questionnaire answered for the fortieth time, the finding that sits because nobody knows whose it is.',
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
    problem: 'The facts about the program lived in separate systems that did not agree with each other, so reporting meant reconciling exports by hand.',
    built: 'I connected the sources, modeled and transformed their data, and built reporting that gave leadership a more useful view of the program.',
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
  { stage: 'Model', tools: 'dbt', role: 'Transformation and modeling.' },
  { stage: 'Report', tools: 'Superset', role: 'Security analytics and dashboards.' },
  { stage: 'Act', tools: 'Tines, Jira', role: 'Automation and workflow integration.' },
];
