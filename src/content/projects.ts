/**
 * The three featured projects, taken from the existing personal site.
 *
 * The source describes the problem each product solves and the design
 * decisions behind it. It does not document internal architecture,
 * metrics or outcomes, so neither does this file.
 */

export type ProjectSlug = 'bivvi' | 'txr-studio' | 'summa';

export interface Decision {
  title: string;
  body: string;
}

export interface FlowStep {
  who: string;
  does: string;
}

export interface Project {
  slug: ProjectSlug;
  name: string;
  tag: string;
  url: string;
  linkLabel: string;
  logo: string;
  accent: string;
  /** A tint of the accent for large surfaces. */
  wash: string;
  summary: string;
  principle: string;
  problem: { title: string; body: string[] };
  approach: { title: string; body: string[] };
  decisions: Decision[];
  flow: { title: string; steps: FlowStep[] };
  closing: string;
}

export const projects: Project[] = [
  {
    slug: 'bivvi',
    name: 'Bivvi',
    tag: 'Family connection',
    url: 'https://bivvi.app',
    linkLabel: 'Visit bivvi.app',
    logo: 'bivvi-logo.png',
    accent: '#b45f06',
    wash: '#fdf1dc',
    summary:
      'A shared reading app for grandparents and grandchildren who live far apart. A video call gives them a screen. Bivvi gives them something to do together.',
    principle: 'Design around a shared moment, not a video call.',
    problem: {
      title: 'A four-year-old will not hold a conversation with a screen.',
      body: [
        'Video calling already exists. The challenge was keeping a grandparent and a four-year-old engaged with each other across distance, and a conversation rarely does that. A book does.',
        'That came from my own family. Every minute spent on a blurred camera filter or a FaceTime hiccup was a minute the kids drifted away.',
      ],
    },
    approach: {
      title: 'So the product protects the reading.',
      body: [
        'Parents manage the account and content. Grandparents join through an email magic link, and in many sessions the only thing they touch is the arrow that turns the page.',
        'The goal wasn’t a better video call. It was making grandparents feel like they were sitting next to their grandchildren with a book.',
      ],
    },
    decisions: [
      {
        title: 'Parents carry the setup.',
        body: 'Parents manage the account and the content, so the people doing the reading never have to.',
      },
      {
        title: 'No password for Grandma.',
        body: 'Grandparents join through an email magic link. There is nothing to remember and nothing to reset.',
      },
      {
        title: 'One control.',
        body: 'In many sessions the only thing a grandparent touches is the arrow that turns the page.',
      },
    ],
    flow: {
      title: 'Who does what',
      steps: [
        { who: 'Parent', does: 'Manages the account and chooses the books' },
        { who: 'Grandparent', does: 'Opens a magic link from their email' },
        { who: 'Together', does: 'Read the same book, turning pages with one arrow' },
      ],
    },
    closing: 'Design around a shared moment, not a video call.',
  },
  {
    slug: 'txr-studio',
    name: 'TxR Studio',
    tag: 'Radio programming',
    url: 'https://txrstudio.com',
    linkLabel: 'Visit txrstudio.com',
    logo: 'txr-logo.png',
    accent: '#4338ca',
    wash: '#eceafd',
    summary:
      'A web-first radio programming tool that turns telecom configuration into guided, plain-language setup for people who program a radio a few times a year.',
    principle: 'Make radio programming feel approachable, not technical.',
    problem: {
      title: 'Software that expects you to remember vocabulary you use twice a year.',
      body: [
        'Most radio software assumes you want to understand tones, offsets, duplex settings, and memory layouts. Most people don’t.',
        'They program a radio occasionally, forget the vocabulary in between, and relearn it every time for no good reason.',
      ],
    },
    approach: {
      title: 'Start from where you want to communicate.',
      body: [
        'TxR starts from where you want to communicate, not how the radio stores configuration. Guided flows, RepeaterBook integration, and sensible defaults take most of the decisions off the table.',
        'Running in the browser means there is nothing to install or update for a task you do twice a year.',
      ],
    },
    decisions: [
      {
        title: 'The place, not the memory layout.',
        body: 'Setup begins with where you want to communicate rather than with how the radio stores its configuration.',
      },
      {
        title: 'Defaults over decisions.',
        body: 'Guided flows, RepeaterBook integration, and sensible defaults take most of the decisions off the table.',
      },
      {
        title: 'In the browser.',
        body: 'Nothing to install and nothing to update for a task you do twice a year.',
      },
    ],
    flow: {
      title: 'How a setup goes',
      steps: [
        { who: 'You', does: 'Say where you want to communicate' },
        { who: 'TxR', does: 'Fills in the details from RepeaterBook and sensible defaults' },
        { who: 'You', does: 'Follow a guided flow, in the browser, with nothing to install' },
      ],
    },
    closing: 'Radio software doesn’t have to look like a spreadsheet. Powerful and pleasant are not opposites.',
  },
  {
    slug: 'summa',
    name: 'Summa',
    tag: 'Sales enablement',
    url: 'https://summahq.com',
    linkLabel: 'Visit summahq.com',
    logo: 'summa-logo.png',
    accent: '#0b7a70',
    wash: '#def5f1',
    summary:
      'Meeting intelligence for sales teams. One call becomes the follow-up email, the CRM update, and the task list, without retyping any of it.',
    principle: 'One conversation. Multiple outcomes.',
    problem: {
      title: 'None of the follow-up is hard. All of it is retyping.',
      body: [
        'Every sales call produces the same follow-up work: the client email, the collateral, the CRM update, the action items, the summary for leadership.',
        'None of it is hard. The pain is entering the same information into five systems.',
      ],
    },
    approach: {
      title: 'Capture it once. Let the rep decide where it goes.',
      body: [
        'The conversation already contains everything those tasks need. Summa captures it once and lets the rep decide where it goes.',
        'Review the draft email and click Send. Review the CRM changes and click Update. Push tasks to Google Tasks with a click.',
      ],
    },
    decisions: [
      {
        title: 'One source.',
        body: 'The conversation already contains everything the follow-up needs, so it is captured once.',
      },
      {
        title: 'The rep stays in charge.',
        body: 'Every output is a draft to review. Nothing goes to a client or a CRM until someone clicks.',
      },
      {
        title: 'One click per destination.',
        body: 'Send the email. Update the CRM. Push the tasks to Google Tasks.',
      },
    ],
    flow: {
      title: 'What one call turns into',
      steps: [
        { who: 'The call', does: 'Is transcribed once' },
        { who: 'Summa', does: 'Drafts the email, the CRM changes and the task list' },
        { who: 'The rep', does: 'Reviews each one and clicks Send, Update, or Push' },
      ],
    },
    closing: 'One call. One transcription. One click for everything else.',
  },
];

export const projectBySlug = (slug: string): Project | undefined => projects.find((p) => p.slug === slug);
