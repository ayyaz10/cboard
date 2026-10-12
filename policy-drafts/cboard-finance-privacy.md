# CBoard Privacy Notice — Draft for review

**Last updated:** [publication date]

This notice explains how CBoard handles information when you use the CBoard web app, including its finance and bank connection features. CBoard is operated by **Ayyaz Ahmed, trading as CBoard**, an individual based in Scotland. Contact: [ayyazahmad009@gmail.com](mailto:ayyazahmad009@gmail.com). **[Add the public geographical business address before publication.]**

## Information CBoard handles

Depending on which features you use, CBoard may handle:

- **Account and profile details:** email address and account identifier used for sign-in, username, display name, and profile picture.
- **Information you enter:** notes, goals, focus sessions, recipes, grocery lists, food diary entries, training records, calculator inputs and saved results, finance records, and preferences.
- **Health-related information:** weight entries, body measurements, weight photos, food and nutrition records, and training information. Some of this may reveal information about your health. You choose whether to enter or upload it.
- **Bank information, if you connect a bank:** bank and account names, account type, currency, masked account identifiers, balances, transaction details, connection status, and consent expiry. The feature is read-only and does not initiate payments. CBoard does not receive your bank password or one-time passcode through its own interface; authentication occurs in the bank or Enable Banking authorisation flow.
- **Technical and service information:** information needed for sign-in, security, troubleshooting, and operation of the app. Your browser also stores authentication session data and app preferences. The service worker caches app files, not bank transaction data.

Please avoid putting another person’s personal information into CBoard unless you have a valid reason and permission to do so.

## How and why we use information

We use information to create and maintain your account; save and display the records you choose to keep; provide requested finance, food, fitness, recipe, and productivity tools; connect to a bank and retrieve account information at your direction; respond to support and deletion requests; protect the service; and diagnose or fix faults.

Our proposed UK GDPR lawful bases are:

- **Contract:** to create your account and provide features you request.
- **Legitimate interests:** to secure, maintain, and improve CBoard and respond to service issues, balanced against your rights and expectations.
- **Consent:** for optional bank access where required in the bank authorisation flow, and for processing health-related information where explicit consent is the applicable special-category condition. You can stop optional processing by withdrawing consent or stopping use of the relevant feature; this does not affect processing already carried out lawfully.
- **Legal obligation:** where we must keep or disclose information to comply with the law.

**Operator review required before publication:** confirm these bases match the actual purposes and add an explicit, affirmative consent step for health-related information if required. A privacy notice alone does not collect consent.

## AI and external lookups

If you use an AI-assisted feature, the information needed for that request may be sent to **Google Gemini** for processing. Depending on the feature, this can include recipe text, food details, finance records you submit for parsing, or an image of a nutrition label. Do not submit information you do not want processed by that provider. Provider handling is subject to its terms and privacy information.

If you request generated grocery or recipe imagery, the relevant food or recipe name is sent to **Cloudflare** to generate an image. If you search a food or scan a barcode, the search term or barcode is sent to **Open Food Facts** to retrieve product information. Currency conversion requests use a public currency data service. These services receive the request data and technical connection data needed to return a response.

## Bank connections

When you choose to connect a bank, **Enable Banking** helps obtain the account information you authorise. CBoard stores connection records and imported account, balance, and transaction information in its **Supabase** project, linked to your CBoard account. Access to bank records from the public browser client is restricted; the bank integration uses server-side functions. Disconnecting a bank closes or attempts to close the authorisation session and stops further synchronisation. It does not automatically delete information already imported into CBoard.

## Providers and international processing

CBoard uses **Supabase** for account authentication, database, file storage, and server-side functions; **Enable Banking** for bank account information; **GitHub Pages** to host the web app; **Google** for the AI features described above; **Cloudflare** for generated images; and **Open Food Facts** and a currency data provider for requested lookups. They process information according to their own roles, terms, and privacy information.

Some providers may process information outside the UK. **Before publication, the operator must confirm the Supabase project region, each provider’s relevant processing locations and transfer safeguards, and add provider privacy links.**

## Retention and deletion

We keep account and user-created information while your account is active and while it is needed to provide the features you use. You may delete records using available in-app controls. To request deletion of your account and associated cloud data, including imported bank information, email **ayyazahmad009@gmail.com** from your account address. We may ask for reasonable information to verify the request. We aim to respond without undue delay and within one month where UK data protection law requires; some information may be retained where the law permits or requires it. Deleted data may remain in provider-managed backups until those backups are overwritten through the provider’s normal cycle. **The operator must establish and follow an actual backup deletion/retention process before publication.**

Disconnecting a bank does not delete imported data. You can request deletion as described above. We retain minimal records needed to handle a request, protect the service, or meet legal obligations only for as long as needed for those purposes.

## Your rights and complaints

Subject to the conditions and exceptions in UK data protection law, you may ask for access to, correction or deletion of your personal information, restriction of processing, or a copy for portability. Where we rely on consent, you can withdraw it. Where we rely on legitimate interests, you may object. Contact **ayyazahmad009@gmail.com** to exercise a right or ask a question. You can also complain to the UK Information Commissioner's Office (ICO) at [ico.org.uk](https://ico.org.uk/make-a-complaint/).

## Security

We use account-scoped access controls and server-side functions for sensitive bank operations, and keep the Enable Banking signing key in server-side configuration. No online service can guarantee absolute security. If a personal data breach requires notification, we will follow applicable legal requirements.

## Changes

We will update this notice if CBoard’s features or data handling change. The current notice and its effective date will be available at this URL.

---

**Publication checklist:** add business address; verify lawful bases and health-data consent flow; confirm provider locations/transfers and privacy links; set backup retention; set publication date; ensure users can access this notice before entering data.
