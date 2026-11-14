/**
 * What was not collected, and what it would take.
 *
 * Static and descriptive on purpose: these are capabilities that exist,
 * listed so a visitor can see where the line was drawn here. Nothing in
 * this file collects anything.
 */

const TIERS: { title: string; needs: string; items: string[] }[] = [
  {
    title: 'With a permission prompt',
    needs: 'You would be asked, and could refuse.',
    items: [
      'Precise location, to within metres, instead of a guess from your IP address.',
      'Camera and microphone, and the names of each device attached.',
      'Notifications, which also give a site a way to reach you after you leave.',
      'Clipboard contents, and Bluetooth or USB devices nearby.',
    ],
  },
  {
    title: 'With commercial visitor-identification services',
    needs: 'A third-party tracking tag on the page, and a contract.',
    items: [
      'Company identification tags (Leadfeeder and similar) match your address against their own database of business networks and report the organisation, often with firmographics.',
      'Person-level "identity resolution" services (RB2B and similar) go further, matching a visit against data co-ops built from logins on other sites to suggest a named individual. Coverage is partial and mostly US.',
      'Advertising networks link a browser to a profile built across every site that carries their tags.',
      'None of these is used here. The organisation shown above comes from public address-registration records, looked up on our own server.',
    ],
  },
  {
    title: 'With a sign-in',
    needs: 'You would have to authenticate.',
    items: ['A verified identity: who you are, as vouched for by an identity provider, and what you are entitled to. Everything on this page is about a connection and a browser; none of it is about a person.'],
  },
  {
    title: 'With device management or attestation',
    needs: 'Software or hardware trust that a public website does not have.',
    items: ['Whether the disk is encrypted, the system patched, endpoint protection running, and the device company-managed. A website cannot read these, and anything claiming to from a browser is guessing.'],
  },
];

export function Beyond() {
  return (
    <div className="beyond">
      {TIERS.map((tier) => (
        <section key={tier.title}>
          <h3>{tier.title}</h3>
          <p className="beyond-needs">{tier.needs}</p>
          <ul>
            {tier.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
