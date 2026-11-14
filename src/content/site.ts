/**
 * Site copy.
 *
 * Everything factual here comes from the existing personal site
 * (markgraziano.com). Where the wording is new, it restates what that
 * site and its author already say; no employers, dates, metrics or
 * credentials have been added.
 */

export const profile = {
  name: 'Mark Graziano',
  motto: ['Features solve requirements.', 'Experience solves problems.'],
  email: 'hello@markgraziano.com',
  github: 'https://github.com/blueskynoise',
  intro:
    'I started in security governance, automated the parts that hurt, and followed the automation into engineering. Now I build systems, and a few products, that people don’t have to fight.',
  heroNotes: [
    'Anyone can implement a checklist.',
    'Great products come from understanding where people struggle, what slows them down, and what they put up with because nobody fixed it.',
  ],
};

export const path = [
  {
    step: 'Governance',
    title: 'Start with what the control is for.',
    body:
      'Too much of the industry treats GRC as the function that slows the business down. Controls become checklists, engineers get requirements without context, and security becomes the team that says no. A good practitioner understands the intent behind a control and works with engineers on a practical way to meet it.',
  },
  {
    step: 'Automation',
    title: 'Then fix the part that hurts.',
    body:
      'The useful questions about any security process are plain ones: what is manual, what hurts, and what should be automated first. A process should get easier every time it is repeated, and repetition is where automation, defaults and better workflows reveal themselves.',
  },
  {
    step: 'Engineering',
    title: 'Automation turned into engineering.',
    body:
      'Automating security processes kept pulling me further into the systems behind them, and into deeper engineering responsibilities. These days that means building the whole thing: the pipeline, the product around it, and the experience of the person who has to use it.',
  },
];

export const podcast = {
  name: 'The GRC Podcast',
  tag: 'Industry podcast',
  url: 'https://open.spotify.com/show/4vD7XV8vP323P7raPjtAq0',
  logo: 'grc-podcast-logo.png',
  summary:
    'Conversations with security champions about governance, risk, and compliance as it actually gets done, not as it looks on paper.',
  principle: 'Design security around enablement, not gatekeeping.',
  body: [
    'Make the secure path the easiest path. The best controls are the ones people barely notice.',
    'The podcast held itself to the same standard. Every episode dug into a real process: what was manual, what hurt, what got automated first, and what a listener could do tomorrow.',
  ],
};

export const lenses = {
  intro:
    'A working feature is only the baseline. I look at the experience around it: who has to learn it, maintain it, operate it, and justify it.',
  items: [
    {
      title: 'People using it',
      body: 'Can someone reach the outcome without confusion, extra steps, or decisions they shouldn’t have to make?',
    },
    {
      title: 'People building it',
      body: 'Can developers understand, change, and extend the system without inheriting avoidable complexity?',
    },
    {
      title: 'People running it',
      body: 'Can operators and business stakeholders support the product without it creating new drag elsewhere?',
    },
  ],
  close: 'The best systems remove friction for everyone involved, not just the person clicking the button.',
};

export const principles = {
  quote: {
    text: 'Users don’t fall in love with specs. They remember how a product makes them feel.',
    cite: 'Tony Fadell',
  },
  items: [
    ['People do not care about your architecture.', 'They care whether the experience feels effortless.'],
    ['The best feature is the one users never need to think about.', 'Remove steps, decisions, and explanations wherever you can.'],
    ['A process should get easier every time it is repeated.', 'Repetition is where automation, defaults, and better workflows reveal themselves.'],
    ['Simple and powerful are not opposites.', 'The best systems hide complexity until it is actually needed.'],
    ['Done matters. Delight lasts.', 'Shipping is important, but the products people remember are the ones they enjoy using.'],
  ] as const,
};

export const onAi = {
  lead: 'The hard part is no longer building software. The hard part is building software people love using.',
  aside:
    'I am not interested in proving I can build software without AI any more than I am interested in proving I can navigate the internet without a search engine.',
  callouts: [
    'AI helped build the solution. It did not discover the problem.',
    'AI made implementation cheaper. That made product judgment more valuable.',
    'The best products start with understanding people, not technology.',
  ],
  body: [
    'An engineer’s value was never memorizing syntax and framework details. It comes from understanding problems, workflows, incentives, and constraints. I use AI coding tools every day to refine requirements, explore architectures, implement, review, and iterate faster. The products still come from repeated cycles of observation, judgment, and refinement, not a single prompt.',
    'Most of my projects started with something people had accepted as normal. AI can generate software quickly, but it cannot sit through a confusing workflow or feel an unnecessary click. As software gets cheaper to make, the differentiator moves from implementation to judgment.',
  ],
};
